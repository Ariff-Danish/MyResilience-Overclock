"""Agent Status API — Real-time autonomous agent monitoring.

Endpoints:
  GET  /api/agents/status       — Full agent status + shared state
  GET  /api/agents/events       — Recent agent events
  GET  /api/agents/escalations  — Escalation history
  POST /api/agents/briefing     — Generate on-demand briefing
  POST /api/agents/configure    — Update agent configuration
  WS   /ws/agents               — Real-time agent status stream
"""
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Optional
from pydantic import BaseModel
import asyncio
import json

router = APIRouter(prefix="/agents", tags=["agents"])

# WebSocket connection manager
_ws_clients: set[WebSocket] = set()


async def broadcast_to_ws(message: str):
    """Broadcast a message to all connected WebSocket clients."""
    disconnected = set()
    for client in _ws_clients:
        try:
            await client.send_text(message)
        except Exception:
            disconnected.add(client)
    _ws_clients.difference_update(disconnected)


# ── REST Endpoints ────────────────────────────────────────────────────────────

@router.get("/status")
async def get_agent_status():
    """Get comprehensive status of all autonomous agents.

    On serverless (Vercel): runs a live lightweight check for each agent
    since persistent state is not available across invocations.
    On long-running server: returns orchestrator's in-memory state.
    """
    import os
    from datetime import datetime

    IS_SERVERLESS = bool(os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"))

    if not IS_SERVERLESS:
        from app.agents.autonomous.orchestrator import orchestrator
        return orchestrator.get_full_status()

    # Serverless: run ALL agents on every status check (autonomous behavior)
    from app.agents.autonomous.state import get_all_agent_status, get_recent_events, get_shared_state

    # Always run agents — they are autonomous and should work on every invocation
    # Agent 1: Sentinel — weather monitoring
    try:
        from app.agents.autonomous.sentinel import sentinel
        await sentinel._check_weather()
    except Exception:
        pass

    # Agent 2: Escalator — threat scoring
    try:
        from app.agents.autonomous.escalator import escalator
        await escalator._evaluate_situation()
    except Exception:
        pass

    # Agent 3: Guardian — inventory health (runs if inventory data exists in shared state)
    try:
        from app.agents.autonomous.guardian import guardian
        await guardian._check_inventory_health()
    except Exception:
        pass

    # Agent 4: Briefing — status update (lightweight, no LLM call on status check)
    try:
        from app.agents.autonomous.state import update_agent_status
        update_agent_status("briefing", "standby", {
            "message": "Ready for on-demand generation",
            "last_available": datetime.utcnow().isoformat() + "Z",
        })
    except Exception:
        pass

    all_status = get_all_agent_status()

    return {
        "type": "agent_status",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "orchestrator": {
            "status": "cron-managed",
            "agents_managed": 4,
        },
        "agents": all_status,
        "shared_state": {
            "weather": get_shared_state("weather"),
            "inventory_health": get_shared_state("inventory_health"),
            "latest_briefing": get_shared_state("latest_briefing"),
            "evacuation": get_shared_state("evacuation"),
            "recommendations": get_shared_state("recommendations", []),
        },
        "recent_events": get_recent_events(limit=20),
    }


@router.get("/events")
async def get_agent_events(limit: int = 50, agent: Optional[str] = None):
    """Get recent agent events."""
    from app.agents.autonomous.state import get_recent_events
    return {
        "events": get_recent_events(limit=limit, agent=agent),
        "total": limit,
    }


@router.get("/escalations")
async def get_escalations(limit: int = 20):
    """Get escalation history."""
    from app.agents.autonomous.state import get_escalation_history
    return {
        "escalations": get_escalation_history(limit=limit),
    }


class BriefingRequest(BaseModel):
    type: str = "on_demand"  # morning, evening, on_demand


@router.post("/briefing")
async def generate_briefing(req: BriefingRequest):
    """Generate an on-demand briefing."""
    from app.agents.autonomous.briefing import briefing
    result = await briefing.generate_on_demand(req.type)
    return result


class AgentConfigRequest(BaseModel):
    user_lat: Optional[float] = None
    user_lng: Optional[float] = None
    location_name: str = "Petaling"
    demo: bool = False
    inventory: Optional[list] = None
    team: Optional[list] = None


@router.post("/configure")
async def configure_agents(req: AgentConfigRequest):
    """Update agent configuration (location, inventory, team).
    
    In serverless mode, stores directly in shared state for Guardian agent.
    In long-running mode, delegates to orchestrator.
    """
    import os
    from app.agents.autonomous.state import update_shared_state, log_event

    IS_SERVERLESS = bool(os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"))

    if IS_SERVERLESS:
        # Store directly in shared state for serverless agents
        if req.inventory is not None:
            update_shared_state("inventory", req.inventory)
        if req.team is not None:
            update_shared_state("team", req.team)
        update_shared_state("user_location", {
            "lat": req.user_lat,
            "lng": req.user_lng,
            "name": req.location_name,
        })
        update_shared_state("demo_mode", req.demo)
        log_event("orchestrator", "configured", {
            "location": req.location_name,
            "inventory_items": len(req.inventory) if req.inventory else 0,
            "team_members": len(req.team) if req.team else 0,
        })
    else:
        from app.agents.autonomous.orchestrator import orchestrator
        orchestrator.configure_sentinel(
            user_lat=req.user_lat,
            user_lng=req.user_lng,
            location_name=req.location_name,
            demo=req.demo,
        )
        if req.inventory is not None:
            orchestrator.update_inventory(req.inventory)
        if req.team is not None:
            orchestrator.update_team(req.team)

    return {"status": "configured", "location": req.location_name, "agents_synced": 4}


# ── WebSocket Endpoint ────────────────────────────────────────────────────────

@router.websocket("/ws")
async def agent_status_ws(websocket: WebSocket):
    """WebSocket endpoint for real-time agent status updates.

    Clients receive:
    - Initial full status on connect
    - Periodic status updates every 10 seconds
    - Immediate updates on escalations
    """
    await websocket.accept()
    _ws_clients.add(websocket)

    try:
        # Send initial status
        from app.agents.autonomous.orchestrator import orchestrator
        initial = orchestrator.get_full_status()
        await websocket.send_text(json.dumps(initial, default=str))

        # Keep connection alive, send periodic updates
        while True:
            await asyncio.sleep(10)
            status = orchestrator.get_full_status()
            await websocket.send_text(json.dumps(status, default=str))

    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        _ws_clients.discard(websocket)
