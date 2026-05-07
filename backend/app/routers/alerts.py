"""Alert History API — Read and manage user-scoped disaster alerts.

Endpoints:
  GET    /api/alerts              — List alerts for current user (with filters)
  GET    /api/alerts/{id}         — Get a specific alert
  PUT    /api/alerts/{id}/read    — Mark alert as read
  GET    /api/alerts/unread       — Get unread alert count
  DELETE /api/alerts/{id}         — Delete an alert
  GET    /api/alerts/stats        — Alert statistics for current user
"""
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime
from app.auth import AuthUser, get_current_user
from app.middleware import log_audit, get_client_ip

router = APIRouter(prefix="/alerts", tags=["alerts"])


VALID_ALERT_TYPES = [
    "weather", "flood", "earthquake", "tsunami", "fire",
    "landslide", "storm", "haze", "health", "security", "other",
]
VALID_SEVERITIES = ["info", "warning", "critical", "emergency"]


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("")
async def list_alerts(
    alert_type: Optional[str] = None,
    severity: Optional[str] = None,
    unread_only: bool = False,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    user: AuthUser = Depends(get_current_user),
):
    """List alerts for the authenticated user with optional filters."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    query = db.table("alert_history").select("*").eq("user_id", user.id)

    if alert_type and alert_type in VALID_ALERT_TYPES:
        query = query.eq("alert_type", alert_type)
    if severity and severity in VALID_SEVERITIES:
        query = query.eq("severity", severity)
    if unread_only:
        query = query.is_("read_at", "null")

    query = query.order("created_at", desc=True).range(offset, offset + limit - 1)

    result = query.execute()

    return {
        "alerts": result.data or [],
        "count": len(result.data or []),
        "offset": offset,
        "limit": limit,
    }


@router.get("/unread")
async def unread_count(user: AuthUser = Depends(get_current_user)):
    """Get count of unread alerts for the authenticated user."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("alert_history").select("id", count="exact").eq("user_id", user.id).is_("read_at", "null").execute()

    return {"unread": result.count or 0}


@router.get("/stats")
async def alert_stats(user: AuthUser = Depends(get_current_user)):
    """Get alert statistics for the authenticated user."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("alert_history").select("alert_type, severity, read_at, created_at").eq("user_id", user.id).execute()
    alerts = result.data or []

    # Type breakdown
    by_type = {}
    for a in alerts:
        t = a.get("alert_type", "other")
        by_type[t] = by_type.get(t, 0) + 1

    # Severity breakdown
    by_severity = {}
    for a in alerts:
        s = a.get("severity", "info")
        by_severity[s] = by_severity.get(s, 0) + 1

    # Unread count
    unread = sum(1 for a in alerts if not a.get("read_at"))

    # Recent activity (last 7 days)
    from datetime import timedelta
    week_ago = (datetime.utcnow() - timedelta(days=7)).isoformat()
    recent = sum(1 for a in alerts if a.get("created_at", "") >= week_ago)

    return {
        "total": len(alerts),
        "unread": unread,
        "recent_7_days": recent,
        "by_type": by_type,
        "by_severity": by_severity,
    }


@router.get("/{alert_id}")
async def get_alert(
    alert_id: str,
    user: AuthUser = Depends(get_current_user),
):
    """Get a specific alert by ID."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("alert_history").select("*").eq("id", alert_id).eq("user_id", user.id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {"alert": result.data[0]}


@router.put("/{alert_id}/read")
async def mark_alert_read(
    alert_id: str,
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Mark an alert as read."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("alert_history").update({
        "read_at": datetime.utcnow().isoformat() + "Z",
    }).eq("id", alert_id).eq("user_id", user.id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Alert not found")

    return {"message": "Alert marked as read"}


@router.put("/read-all")
async def mark_all_alerts_read(
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Mark all unread alerts as read."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("alert_history").update({
        "read_at": datetime.utcnow().isoformat() + "Z",
    }).eq("user_id", user.id).is_("read_at", "null").execute()

    await log_audit(
        user_id=user.id,
        action="alerts.mark_all_read",
        resource="alert_history",
        ip_address=get_client_ip(request),
    )

    return {"message": "All alerts marked as read"}


@router.delete("/{alert_id}")
async def delete_alert(
    alert_id: str,
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Delete an alert."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("alert_history").delete().eq("id", alert_id).eq("user_id", user.id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Alert not found")

    await log_audit(
        user_id=user.id,
        action="alert.delete",
        resource="alert_history",
        resource_id=alert_id,
        ip_address=get_client_ip(request),
    )

    return {"message": "Alert deleted"}
