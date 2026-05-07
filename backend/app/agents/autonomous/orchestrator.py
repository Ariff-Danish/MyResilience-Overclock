"""Orchestrator — Coordinates All Autonomous Agents.

The central coordinator that:
- Starts/stops all agents in the correct order
- Manages agent lifecycle (health checks, restarts on failure)
- Provides unified status API for frontend
- Handles graceful shutdown
- Broadcasts state changes via WebSocket
"""
import asyncio
import json
from typing import Optional, Callable, List
from datetime import datetime

from app.agents.autonomous.state import (
    log_event, update_agent_status, get_all_agent_status,
    get_shared_state, update_shared_state, get_recent_events,
)


class AgentOrchestrator:
    """Master coordinator for all autonomous agents."""

    AGENT_NAME = "orchestrator"
    HEALTH_CHECK_INTERVAL = 60  # Check agent health every 60 seconds
    MAX_RESTART_ATTEMPTS = 3

    def __init__(self):
        self._running = False
        self._health_task: Optional[asyncio.Task] = None
        self._restart_counts: dict[str, int] = {}
        self._ws_broadcast: Optional[Callable] = None

        # Agent registry — import lazily to avoid circular imports
        self._agents = {}
        self._agent_order = ["sentinel", "guardian", "escalator", "briefing"]

    def set_ws_broadcaster(self, broadcast_fn: Callable):
        """Set the WebSocket broadcast function for real-time updates."""
        self._ws_broadcast = broadcast_fn

    async def start_all(self):
        """Start all autonomous agents in dependency order."""
        if self._running:
            return

        self._running = True
        log_event(self.AGENT_NAME, "orchestrator_starting", {
            "agents": self._agent_order,
        })

        # Import agents lazily
        from app.agents.autonomous.sentinel import sentinel
        from app.agents.autonomous.guardian import guardian
        from app.agents.autonomous.escalator import escalator
        from app.agents.autonomous.briefing import briefing

        self._agents = {
            "sentinel": sentinel,
            "guardian": guardian,
            "escalator": escalator,
            "briefing": briefing,
        }

        # Start in order: sentinel + guardian first (data producers),
        # then escalator (consumer), then briefing (scheduler)
        for agent_name in self._agent_order:
            agent = self._agents.get(agent_name)
            if agent:
                try:
                    await agent.start()
                    self._restart_counts[agent_name] = 0
                    log_event(self.AGENT_NAME, "agent_started", {"agent": agent_name})
                except Exception as e:
                    log_event(self.AGENT_NAME, "agent_start_failed", {
                        "agent": agent_name,
                        "error": str(e),
                    }, severity="warning")

        # Start health check loop
        self._health_task = asyncio.create_task(self._health_loop())

        update_agent_status(self.AGENT_NAME, "active", {
            "message": "All agents coordinated",
            "agents_running": len(self._agents),
        })
        log_event(self.AGENT_NAME, "orchestrator_active", {
            "agents": list(self._agents.keys()),
        })

        # Broadcast initial state
        await self._broadcast_status()

    async def stop_all(self):
        """Gracefully stop all agents."""
        self._running = False

        # Stop health check
        if self._health_task:
            self._health_task.cancel()
            try:
                await self._health_task
            except asyncio.CancelledError:
                pass

        # Stop agents in reverse order
        for agent_name in reversed(self._agent_order):
            agent = self._agents.get(agent_name)
            if agent:
                try:
                    await agent.stop()
                    log_event(self.AGENT_NAME, "agent_stopped", {"agent": agent_name})
                except Exception as e:
                    log_event(self.AGENT_NAME, "agent_stop_error", {
                        "agent": agent_name,
                        "error": str(e),
                    }, severity="warning")

        update_agent_status(self.AGENT_NAME, "stopped")
        log_event(self.AGENT_NAME, "orchestrator_stopped", {})

    async def _health_loop(self):
        """Periodically check agent health and restart failed agents."""
        while self._running:
            try:
                await asyncio.sleep(self.HEALTH_CHECK_INTERVAL)
                await self._check_agent_health()
                await self._broadcast_status()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log_event(self.AGENT_NAME, "health_check_error", {"error": str(e)}, severity="warning")

    async def _check_agent_health(self):
        """Check if all agents are still running, restart if needed."""
        all_status = get_all_agent_status()

        for agent_name in self._agent_order:
            agent = self._agents.get(agent_name)
            if not agent:
                continue

            status = all_status.get(agent_name, {})
            agent_status = status.get("status", "unknown")

            # Check for error state or stale heartbeat
            if agent_status == "error":
                restarts = self._restart_counts.get(agent_name, 0)
                if restarts < self.MAX_RESTART_ATTEMPTS:
                    log_event(self.AGENT_NAME, "restarting_agent", {
                        "agent": agent_name,
                        "attempt": restarts + 1,
                    })
                    try:
                        await agent.stop()
                        await asyncio.sleep(2)
                        await agent.start()
                        self._restart_counts[agent_name] = restarts + 1
                        log_event(self.AGENT_NAME, "agent_restarted", {"agent": agent_name})
                    except Exception as e:
                        log_event(self.AGENT_NAME, "restart_failed", {
                            "agent": agent_name,
                            "error": str(e),
                        }, severity="critical")
                else:
                    log_event(self.AGENT_NAME, "agent_restart_exhausted", {
                        "agent": agent_name,
                        "attempts": restarts,
                    }, severity="critical")

    async def _broadcast_status(self):
        """Broadcast current status to all connected WebSocket clients."""
        if not self._ws_broadcast:
            return

        try:
            status = self.get_full_status()
            await self._ws_broadcast(json.dumps(status, default=str))
        except Exception as e:
            log_event(self.AGENT_NAME, "broadcast_error", {"error": str(e)}, severity="warning")

    def get_full_status(self) -> dict:
        """Get comprehensive status of all agents and system."""
        all_status = get_all_agent_status()

        return {
            "type": "agent_status",
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "orchestrator": {
                "status": "active" if self._running else "stopped",
                "agents_managed": len(self._agents),
            },
            "agents": {
                name: {
                    "status": all_status.get(name, {}).get("status", "unknown"),
                    "details": all_status.get(name, {}).get("details", {}),
                    "last_heartbeat": all_status.get(name, {}).get("last_heartbeat", None),
                    "restart_count": self._restart_counts.get(name, 0),
                }
                for name in self._agent_order
            },
            "shared_state": {
                "weather": get_shared_state("last_weather", None),
                "inventory_health": get_shared_state("inventory_health", None),
                "latest_briefing": get_shared_state("latest_briefing", None),
                "evacuation": get_shared_state("autonomous_evacuation", None),
                "recommendations": get_shared_state("guardian_recommendations", []),
            },
            "recent_events": get_recent_events(limit=10),
        }

    def configure_sentinel(self, user_lat: Optional[float] = None,
                           user_lng: Optional[float] = None,
                           location_name: str = "Petaling",
                           demo: bool = False):
        """Update sentinel agent configuration."""
        from app.agents.autonomous.sentinel import sentinel
        sentinel.configure(
            user_lat=user_lat,
            user_lng=user_lng,
            location_name=location_name,
            demo=demo,
        )
        # Also store in shared state for other agents
        update_shared_state("user_lat", user_lat)
        update_shared_state("user_lng", user_lng)
        update_shared_state("user_location_display", location_name)

    def update_inventory(self, inventory: list):
        """Update inventory data in shared state for agents to consume."""
        update_shared_state("inventory", inventory)

    def update_team(self, team: list):
        """Update team data in shared state for agents to consume."""
        update_shared_state("team", team)


# Singleton instance
orchestrator = AgentOrchestrator()
