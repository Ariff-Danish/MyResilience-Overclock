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
    """Get comprehensive status of all autonomous agents."""
    from app.agents.autonomous.orchestrator import orchestrator
    return orchestrator.get_full_status()


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
    """Update agent configuration (location, inventory, team)."""
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

    return {"status": "configured", "location": req.location_name}


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
