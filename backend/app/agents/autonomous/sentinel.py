"""Sentinel Agent — Autonomous Weather & Threat Monitoring.

Runs on a schedule (every 5 minutes) without human intervention.
- Fetches MET Malaysia weather data
- Detects new threats and changes in severity
- Triggers escalation when threats are detected
- Maintains threat memory to avoid duplicate alerts
"""
import asyncio
import json
import hashlib
from typing import Optional
from datetime import datetime

from app.agents.autonomous.state import (
    log_event, update_agent_status, get_decision, save_decision,
    log_escalation, update_shared_state,
)


class SentinelAgent:
    """Continuously monitors weather conditions and national warnings."""

    AGENT_NAME = "sentinel"
    POLL_INTERVAL_SECONDS = 300  # 5 minutes
    THREAT_COOLDOWN_SECONDS = 1800  # 30 min between same-type escalations

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._last_threat_hash = ""
        self._user_lat: Optional[float] = None
        self._user_lng: Optional[float] = None
        self._user_location_name: str = "Petaling"
        self._demo_mode = False

    def configure(self, user_lat: Optional[float] = None, user_lng: Optional[float] = None,
                  location_name: str = "Petaling", demo: bool = False):
        """Update sentinel configuration from frontend settings."""
        self._user_lat = user_lat
        self._user_lng = user_lng
        self._user_location_name = location_name
        self._demo_mode = demo

    async def start(self):
        """Start the sentinel monitoring loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        update_agent_status(self.AGENT_NAME, "active", {"message": "Sentinel monitoring started"})
        log_event(self.AGENT_NAME, "agent_started", {"poll_interval": self.POLL_INTERVAL_SECONDS})

    async def stop(self):
        """Stop the sentinel monitoring loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        update_agent_status(self.AGENT_NAME, "stopped")
        log_event(self.AGENT_NAME, "agent_stopped", {})

    async def _monitor_loop(self):
        """Main monitoring loop — runs indefinitely."""
        while self._running:
            try:
                await self._check_weather()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log_event(self.AGENT_NAME, "error", {"error": str(e)}, severity="warning")
                update_agent_status(self.AGENT_NAME, "error", {"error": str(e)})
            await asyncio.sleep(self.POLL_INTERVAL_SECONDS)

    async def _check_weather(self):
        """Fetch weather and evaluate threats autonomously."""
        update_agent_status(self.AGENT_NAME, "scanning", {
            "location": self._user_location_name,
            "demo": self._demo_mode,
        })

        # Import here to avoid circular imports
        from app.routers.emergency import fetch_mock_weather_data, filter_alerts_by_proximity

        raw = await fetch_mock_weather_data(self._demo_mode, self._user_location_name)
        data = json.loads(raw)

        # Proximity filter if GPS available
        nearby_alerts = data.get("alerts", [])
        distant_alerts = []
        if self._user_lat and self._user_lng:
            nearby_alerts, distant_alerts = filter_alerts_by_proximity(
                data.get("alerts", []), self._user_lat, self._user_lng
            )

        # Compute threat hash for change detection
        threat_hash = hashlib.md5(
            json.dumps([a.get("type", "") for a in nearby_alerts], sort_keys=True).encode()
        ).hexdigest()

        weather_summary = data.get("current_conditions", {}).get("summary", "Tiada hujan")
        temp = data.get("current_conditions", {}).get("temperature_celsius", 32)

        # Update shared state for other agents to read
        update_shared_state("last_weather", {
            "location": data.get("location", self._user_location_name),
            "summary": weather_summary,
            "temp_celsius": temp,
            "nearby_alerts": len(nearby_alerts),
            "distant_alerts": len(distant_alerts),
            "alerts": nearby_alerts,
        })

        if nearby_alerts and threat_hash != self._last_threat_hash:
            # NEW THREAT DETECTED — autonomous escalation
            self._last_threat_hash = threat_hash
            primary_alert = nearby_alerts[0]

            # Check cooldown to avoid spam
            last_escalation = get_decision(self.AGENT_NAME, f"escalation_{primary_alert['type']}")
            now_ts = datetime.utcnow().timestamp()
            if last_escalation:
                last_ts = datetime.fromisoformat(last_escalation.get("timestamp", "2000-01-01T00:00:00Z").rstrip("Z")).timestamp()
                if now_ts - last_ts < self.THREAT_COOLDOWN_SECONDS:
                    log_event(self.AGENT_NAME, "threat_cooldown_active", {
                        "alert_type": primary_alert["type"],
                        "cooldown_remaining_s": int(self.THREAT_COOLDOWN_SECONDS - (now_ts - last_ts)),
                    })
                    update_agent_status(self.AGENT_NAME, "monitoring", {
                        "threats": len(nearby_alerts),
                        "cooldown": True,
                    })
                    return

            escalation = log_escalation(
                self.AGENT_NAME,
                level="warning" if len(nearby_alerts) == 1 else "critical",
                action="threat_detected",
                context={
                    "alert_type": primary_alert["type"],
                    "description": primary_alert.get("description", "")[:200],
                    "nearby_count": len(nearby_alerts),
                    "distant_count": len(distant_alerts),
                    "location": data.get("location", ""),
                },
            )

            save_decision(self.AGENT_NAME, f"escalation_{primary_alert['type']}", {
                "timestamp": _timestamp(),
                "alert": primary_alert,
            })

            # Trigger autonomous evacuation advisory
            await self._trigger_autonomous_evacuation(primary_alert, nearby_alerts)

            log_event(self.AGENT_NAME, "threat_escalated", {
                "escalation_id": escalation["id"],
                "alert_type": primary_alert["type"],
                "nearby_alerts": len(nearby_alerts),
            }, severity="warning")

        elif not nearby_alerts:
            self._last_threat_hash = ""

        update_agent_status(self.AGENT_NAME, "monitoring", {
            "threats": len(nearby_alerts),
            "distant": len(distant_alerts),
            "weather": weather_summary,
            "temp": temp,
            "last_check": datetime.utcnow().isoformat() + "Z",
        })

    async def _trigger_autonomous_evacuation(self, primary_alert: dict, all_alerts: list):
        """Autonomously generate evacuation advisory when threats detected."""
        try:
            from app.agents.safesync_agents import run_evacuation_advisor_agent
            from app.agents.autonomous.state import get_shared_state

            team = get_shared_state("team", [])
            location = get_shared_state("user_location_display", "Malaysia")

            # Determine disaster type from alert
            alert_text = primary_alert.get("type", "").lower()
            disaster_type = "flood"  # default
            for dtype in ["flood", "storm", "haze", "fire", "earthquake", "tsunami", "landslide"]:
                if dtype in alert_text:
                    disaster_type = dtype
                    break

            result = await run_evacuation_advisor_agent(
                disaster_type=disaster_type,
                severity="warning",
                location=location,
                team=team,
                user_lat=self._user_lat,
                user_lng=self._user_lng,
            )

            # Cache the advisory for frontend to pick up
            update_shared_state("autonomous_evacuation", {
                "advisory": result.model_dump(),
                "generated_at": datetime.utcnow().isoformat() + "Z",
                "trigger": "sentinel_autonomous",
                "alert_type": primary_alert["type"],
            })

            log_event(self.AGENT_NAME, "evacuation_generated", {
                "disaster_type": disaster_type,
                "shelters": len(result.shelter_locations or []),
                "agencies": len(result.enforcement_agencies or []),
            })

            # Auto-SMS if team has phone numbers
            phone_numbers = [m.get("phone", "").strip() for m in team if m.get("phone", "").strip()]
            if phone_numbers:
                from app.agents.sms_tools import send_bulk_sms
                sms_results = send_bulk_sms(phone_numbers, result.sms_alert_text)
                sent_count = sum(1 for r in sms_results if r.get("status") == "sent")
                log_event(self.AGENT_NAME, "auto_sms_dispatched", {
                    "sent": sent_count,
                    "total": len(phone_numbers),
                })

        except Exception as e:
            log_event(self.AGENT_NAME, "evacuation_failed", {"error": str(e)}, severity="warning")


def _timestamp() -> str:
    return datetime.utcnow().isoformat() + "Z"


# Singleton instance
sentinel = SentinelAgent()
