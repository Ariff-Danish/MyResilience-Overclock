"""Briefing API — Automated briefing management and SSE streaming.

Endpoints:
  POST /api/briefing/run              — Trigger a briefing manually
  GET  /api/briefing/stream/{id}      — SSE stream for a briefing session
  GET  /api/briefing/sessions         — List recent briefing sessions
  GET  /api/briefing/sessions/{id}    — Get a specific session
  GET  /api/briefing/schedules        — List briefing schedules
  POST /api/briefing/schedules        — Create a new schedule
  PUT  /api/briefing/schedules/{id}   — Update a schedule
  GET  /api/briefing/failures         — List recent failures
  GET  /api/briefing/health           — Latest deployment health check
  POST /api/briefing/subscribe        — Subscribe to a briefing schedule
  DELETE /api/briefing/subscribe/{id} — Unsubscribe from a schedule
  GET  /api/briefing/subscriptions    — List user's subscriptions
"""
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from app.auth import AuthUser, get_current_user, get_optional_user
from app.db.client import get_supabase_admin

logger = logging.getLogger("briefing_api")
router = APIRouter(prefix="/briefing", tags=["briefing"])

MYT = timezone(timedelta(hours=8))


# ── Pydantic Models ───────────────────────────────────────────────────────

class BriefingRunRequest(BaseModel):
    briefing_type: str = Field("on_demand", pattern=r"^(morning|evening|emergency|on_demand)$")
    schedule_id: Optional[str] = None
    timeout: int = Field(30, ge=5, le=120)
    max_retries: int = Field(3, ge=0, le=5)


class ScheduleCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    briefing_type: str = Field(..., pattern=r"^(morning|evening|emergency|on_demand)$")
    cron_expression: str = Field(..., min_length=5, max_length=50)
    timezone: str = Field("Asia/Kuala_Lumpur", max_length=50)
    is_active: bool = True
    agents_required: List[str] = Field(default=["sentinel", "guardian", "escalator"])
    timeout_seconds: int = Field(30, ge=5, le=120)
    max_retries: int = Field(3, ge=0, le=5)
    retry_delays: List[int] = Field(default=[5, 15, 45])


class ScheduleUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    cron_expression: Optional[str] = Field(None, min_length=5, max_length=50)
    is_active: Optional[bool] = None
    agents_required: Optional[List[str]] = None
    timeout_seconds: Optional[int] = Field(None, ge=5, le=120)
    max_retries: Optional[int] = Field(None, ge=0, le=5)


class SubscriptionCreate(BaseModel):
    schedule_id: str
    delivery_channel: str = Field("in_app", pattern=r"^(in_app|email|sms|push|all)$")
    preferred_language: str = Field("en", pattern=r"^(en|ms|zh|ta)$")


# ── Endpoints ─────────────────────────────────────────────────────────────

@router.post("/run")
async def trigger_briefing(
    req: BriefingRunRequest,
    user: AuthUser = Depends(get_current_user),
):
    """Trigger a briefing manually. Runs all agents and streams results."""
    from app.agents.briefing_orchestrator import briefing_orchestrator

    try:
        session = await briefing_orchestrator.execute_briefing(
            briefing_type=req.briefing_type,
            schedule_id=req.schedule_id,
            timeout=req.timeout,
            max_retries=req.max_retries,
        )
        return {
            "session_id": session["id"],
            "status": session["status"],
            "briefing": session.get("briefing_content"),
            "agents_succeeded": session.get("agents_succeeded", []),
            "agents_failed": session.get("agents_failed", []),
            "duration_ms": session.get("duration_ms"),
        }
    except Exception as e:
        logger.error(f"Briefing execution failed: {e}")
        raise HTTPException(status_code=500, detail=f"Briefing failed: {str(e)}")


@router.get("/stream/{session_id}")
async def stream_briefing(session_id: str):
    """SSE endpoint — stream real-time briefing events to the client."""
    from app.agents.briefing_orchestrator import briefing_orchestrator

    async def event_generator():
        async for event in briefing_orchestrator.subscribe_sse(session_id):
            yield event

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/sessions")
async def list_sessions(
    briefing_type: Optional[str] = None,
    status: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    user: AuthUser = Depends(get_current_user),
):
    """List recent briefing sessions with optional filters."""
    db = get_supabase_admin()

    query = db.table("briefing_sessions").select("*")

    if briefing_type:
        query = query.eq("briefing_type", briefing_type)
    if status:
        query = query.eq("status", status)

    query = query.order("created_at", desc=True).range(offset, offset + limit - 1)
    result = query.execute()

    return {
        "sessions": result.data or [],
        "count": len(result.data or []),
        "offset": offset,
        "limit": limit,
    }


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    user: AuthUser = Depends(get_current_user),
):
    """Get a specific briefing session."""
    from app.agents.briefing_orchestrator import briefing_orchestrator

    # Check active sessions first
    active = await briefing_orchestrator.get_session_status(session_id)
    if active:
        return active

    db = get_supabase_admin()
    result = db.table("briefing_sessions").select("*").eq(
        "id", session_id
    ).limit(1).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Session not found")

    return result.data[0]


@router.get("/schedules")
async def list_schedules(
    user: AuthUser = Depends(get_current_user),
):
    """List all briefing schedules."""
    db = get_supabase_admin()
    result = db.table("briefing_schedules").select("*").order("created_at").execute()
    return {"schedules": result.data or []}


@router.post("/schedules")
async def create_schedule(
    req: ScheduleCreate,
    user: AuthUser = Depends(get_current_user),
):
    """Create a new briefing schedule."""
    db = get_supabase_admin()

    result = db.table("briefing_schedules").insert({
        "name": req.name,
        "briefing_type": req.briefing_type,
        "cron_expression": req.cron_expression,
        "timezone": req.timezone,
        "is_active": req.is_active,
        "agents_required": req.agents_required,
        "timeout_seconds": req.timeout_seconds,
        "max_retries": req.max_retries,
        "retry_delays": req.retry_delays,
    }).execute()

    return {"schedule": result.data[0]}


@router.put("/schedules/{schedule_id}")
async def update_schedule(
    schedule_id: str,
    req: ScheduleUpdate,
    user: AuthUser = Depends(get_current_user),
):
    """Update a briefing schedule."""
    db = get_supabase_admin()

    update_data = {k: v for k, v in req.model_dump(exclude_unset=True).items()}
    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    update_data["updated_at"] = datetime.now(MYT).isoformat()

    result = db.table("briefing_schedules").update(update_data).eq(
        "id", schedule_id
    ).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Schedule not found")

    return {"schedule": result.data[0]}


@router.get("/failures")
async def list_failures(
    agent_name: Optional[str] = None,
    limit: int = Query(20, ge=1, le=100),
    user: AuthUser = Depends(get_current_user),
):
    """List recent briefing failures."""
    db = get_supabase_admin()

    query = db.table("briefing_failures").select("*")

    if agent_name:
        query = query.eq("agent_name", agent_name)

    query = query.order("created_at", desc=True).limit(limit)
    result = query.execute()

    return {"failures": result.data or []}


@router.get("/health")
async def get_health(
    user: AuthUser = Depends(get_current_user),
):
    """Get the latest deployment health check."""
    db = get_supabase_admin()

    result = db.table("deployment_health").select("*").order(
        "checked_at", desc=True
    ).limit(1).execute()

    return {
        "health": result.data[0] if result.data else None,
    }


@router.post("/subscribe")
async def subscribe(
    req: SubscriptionCreate,
    user: AuthUser = Depends(get_current_user),
):
    """Subscribe to a briefing schedule."""
    db = get_supabase_admin()

    # Check if already subscribed
    existing = db.table("briefing_subscriptions").select("id").eq(
        "user_id", user.id
    ).eq("schedule_id", req.schedule_id).limit(1).execute()

    if existing.data:
        # Update existing subscription
        result = db.table("briefing_subscriptions").update({
            "delivery_channel": req.delivery_channel,
            "preferred_language": req.preferred_language,
            "is_active": True,
            "updated_at": datetime.now(MYT).isoformat(),
        }).eq("id", existing.data[0]["id"]).execute()
        return {"subscription": result.data[0], "action": "updated"}

    # Create new subscription
    result = db.table("briefing_subscriptions").insert({
        "user_id": user.id,
        "schedule_id": req.schedule_id,
        "delivery_channel": req.delivery_channel,
        "preferred_language": req.preferred_language,
    }).execute()

    return {"subscription": result.data[0], "action": "created"}


@router.delete("/subscribe/{subscription_id}")
async def unsubscribe(
    subscription_id: str,
    user: AuthUser = Depends(get_current_user),
):
    """Unsubscribe from a briefing schedule."""
    db = get_supabase_admin()

    result = db.table("briefing_subscriptions").update({
        "is_active": False,
        "updated_at": datetime.now(MYT).isoformat(),
    }).eq("id", subscription_id).eq("user_id", user.id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Subscription not found")

    return {"status": "unsubscribed"}


@router.get("/subscriptions")
async def list_subscriptions(
    user: AuthUser = Depends(get_current_user),
):
    """List the current user's briefing subscriptions."""
    db = get_supabase_admin()

    result = db.table("briefing_subscriptions").select(
        "*, briefing_schedules!inner(name, briefing_type, cron_expression, is_active)"
    ).eq("user_id", user.id).eq("is_active", True).execute()

    return {"subscriptions": result.data or []}
