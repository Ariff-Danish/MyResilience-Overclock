"""Admin API — Role-based admin endpoints for user management and system analytics.

Provides admin-only functionality:
  GET    /api/admin/users              — List all users with roles
  PUT    /api/admin/users/{id}/role    — Update a user's application role
  GET    /api/admin/stats              — System-wide analytics
  GET    /api/admin/audit-log          — View audit log entries
  GET    /api/admin/health             — Detailed system health
"""
import logging
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from app.auth import AuthUser, require_admin

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["admin"])


# ═══════════════════════════════════════════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class UserRoleUpdate(BaseModel):
    """Request to update a user's application role."""
    role: str = Field(..., pattern="^(user|admin)$")


class UserListItem(BaseModel):
    """User summary for admin listing."""
    id: str
    email: str
    app_role: str
    created_at: Optional[str] = None
    last_sign_in: Optional[str] = None
    inventory_count: int = 0
    team_count: int = 0


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/users")
async def list_users(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    admin: AuthUser = Depends(require_admin),
):
    """List all registered users with their roles and activity counts.

    Requires admin role. Returns paginated user list.
    """
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    offset = (page - 1) * per_page

    # Fetch users from Supabase Auth (admin API)
    try:
        auth_users = db.auth.admin.list_users(
            page=page,
            per_page=per_page,
        )
    except Exception as e:
        logger.error(f"Failed to list users: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch users")

    users = []
    for u in (auth_users or []):
        # Extract app_role from user metadata
        user_meta = getattr(u, "user_metadata", {}) or {}
        app_meta = getattr(u, "app_metadata", {}) or {}
        app_role = app_meta.get("role") or user_meta.get("role", "user")

        # Count inventory items
        try:
            inv_result = db.table("inventory_items").select("id", count="exact").eq("user_id", u.id).execute()
            inv_count = inv_result.count or 0
        except Exception:
            inv_count = 0

        # Count team members
        try:
            team_result = db.table("team_members").select("id", count="exact").eq("user_id", u.id).execute()
            team_count = team_result.count or 0
        except Exception:
            team_count = 0

        users.append({
            "id": u.id,
            "email": u.email,
            "app_role": app_role,
            "created_at": str(u.created_at) if hasattr(u, "created_at") and u.created_at else None,
            "last_sign_in": str(u.last_sign_in_at) if hasattr(u, "last_sign_in_at") and u.last_sign_in_at else None,
            "inventory_count": inv_count,
            "team_count": team_count,
        })

    return {
        "users": users,
        "page": page,
        "per_page": per_page,
        "total": len(users),
    }


@router.put("/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    req: UserRoleUpdate,
    admin: AuthUser = Depends(require_admin),
):
    """Update a user's application role (user or admin).

    Requires admin role. Cannot demote yourself.
    """
    if user_id == admin.id:
        raise HTTPException(
            status_code=400,
            detail="Cannot change your own role",
        )

    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    try:
        # Update user metadata in Supabase Auth
        db.auth.admin.update_user_by_id(
            user_id,
            {"user_metadata": {"role": req.role}},
        )
        logger.info(f"Admin {admin.email} changed role of {user_id} to {req.role}")
        return {
            "message": f"User role updated to '{req.role}'",
            "user_id": user_id,
            "new_role": req.role,
        }
    except Exception as e:
        logger.error(f"Failed to update user role: {e}")
        raise HTTPException(status_code=500, detail="Failed to update user role")


@router.get("/stats")
async def get_system_stats(
    admin: AuthUser = Depends(require_admin),
):
    """Get system-wide analytics and statistics.

    Requires admin role. Returns user counts, inventory stats, and alert history.
    """
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    stats = {}

    # Total users
    try:
        users_result = db.table("profiles").select("id", count="exact").execute()
        stats["total_users"] = users_result.count or 0
    except Exception:
        stats["total_users"] = "unavailable"

    # Total inventory items
    try:
        inv_result = db.table("inventory_items").select("id", count="exact").execute()
        stats["total_inventory_items"] = inv_result.count or 0
    except Exception:
        stats["total_inventory_items"] = "unavailable"

    # Total team members
    try:
        team_result = db.table("team_members").select("id", count="exact").execute()
        stats["total_team_members"] = team_result.count or 0
    except Exception:
        stats["total_team_members"] = "unavailable"

    # Total alerts
    try:
        alerts_result = db.table("alerts").select("id", count="exact").execute()
        stats["total_alerts"] = alerts_result.count or 0
    except Exception:
        stats["total_alerts"] = "unavailable"

    # Category breakdown
    try:
        categories = ["water", "food", "medical", "tools", "documents",
                       "clothing", "communication", "lighting", "sanitation", "other"]
        cat_counts = {}
        for cat in categories:
            result = db.table("inventory_items").select("id", count="exact").eq("category", cat).execute()
            cat_counts[cat] = result.count or 0
        stats["inventory_by_category"] = cat_counts
    except Exception:
        stats["inventory_by_category"] = {}

    return {
        "stats": stats,
        "generated_by": admin.email,
    }


@router.get("/health")
async def admin_health_check(
    admin: AuthUser = Depends(require_admin),
):
    """Detailed system health check for admins.

    Returns database connectivity, agent status, and environment info.
    """
    import os
    from datetime import datetime

    health = {
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "environment": os.getenv("VERCEL_ENV", "development"),
        "serverless": bool(os.getenv("VERCEL")),
    }

    # Database check
    try:
        from app.db.client import get_supabase_admin
        db = get_supabase_admin()
        db.table("profiles").select("id", count="exact").limit(1).execute()
        health["database"] = "connected"
    except Exception as e:
        health["database"] = f"error: {str(e)[:100]}"

    # Agent status
    try:
        from app.agents.autonomous.orchestrator import orchestrator
        agent_data = orchestrator.get_full_status()
        health["agents"] = {
            "status": agent_data["orchestrator"]["status"],
            "managed": agent_data["orchestrator"]["agents_managed"],
        }
    except Exception:
        health["agents"] = {"status": "serverless", "managed": 0}

    # Environment variables check
    env_checks = {
        "GROQ_API_KEY": bool(os.getenv("GROQ_API_KEY")),
        "SUPABASE_URL": bool(os.getenv("SUPABASE_URL")),
        "SUPABASE_JWT_SECRET": bool(os.getenv("SUPABASE_JWT_SECRET")),
        "TWILIO_ACCOUNT_SID": bool(os.getenv("TWILIO_ACCOUNT_SID")),
        "GMAIL_ADDRESS": bool(os.getenv("GMAIL_ADDRESS")),
    }
    health["env_configured"] = env_checks

    return health
