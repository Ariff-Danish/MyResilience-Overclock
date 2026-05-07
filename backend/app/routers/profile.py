"""User Profile API — CRUD operations for authenticated user profiles.

Endpoints:
  GET    /api/profile          — Get current user's profile
  PUT    /api/profile          — Update current user's profile
  DELETE /api/profile          — Delete current user's account
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from typing import Optional
from app.auth import AuthUser, get_current_user
from app.middleware import (
    sanitize_string, validate_no_injection, log_audit, get_client_ip,
)

router = APIRouter(prefix="/profile", tags=["profile"])


class ProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=200)
    phone: Optional[str] = Field(None, max_length=20)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    location_name: Optional[str] = Field(None, max_length=200)
    state: Optional[str] = Field(None, max_length=100)
    district: Optional[str] = Field(None, max_length=100)
    language: Optional[str] = Field(None, pattern=r"^(en|ms|zh|ta)$")
    notification_email: Optional[bool] = None
    notification_sms: Optional[bool] = None
    notification_push: Optional[bool] = None


@router.get("")
async def get_profile(user: AuthUser = Depends(get_current_user)):
    """Get the authenticated user's profile."""
    from app.db.client import get_supabase_for_user
    from fastapi import Request

    db = get_supabase_for_user(user.id)  # This won't work without token
    # Use service role with user filter for reliability
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("profiles").select("*").eq("id", user.id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found")

    return {"profile": result.data[0]}


@router.put("")
async def update_profile(
    updates: ProfileUpdate,
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Update the authenticated user's profile."""
    from app.db.client import get_supabase_admin

    # Sanitize inputs
    update_data = {}
    for field, value in updates.model_dump(exclude_none=True).items():
        if isinstance(value, str):
            if not validate_no_injection(value):
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid characters in {field}",
                )
            update_data[field] = sanitize_string(value)
        else:
            update_data[field] = value

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    db = get_supabase_admin()
    result = db.table("profiles").update(update_data).eq("id", user.id).execute()

    if not result.data:
        raise HTTPException(status_code=404, detail="Profile not found")

    await log_audit(
        user_id=user.id,
        action="profile.update",
        resource="profiles",
        resource_id=user.id,
        ip_address=get_client_ip(request),
        details={"fields": list(update_data.keys())},
    )

    return {"profile": result.data[0], "message": "Profile updated"}


@router.delete("")
async def delete_account(
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Delete the authenticated user's account and all associated data.

    CASCADE deletes: dependents, inventory, evacuation plans, alerts.
    """
    from app.db.client import get_supabase_admin

    db = get_supabase_admin()

    # Log before deletion
    await log_audit(
        user_id=user.id,
        action="account.delete",
        resource="profiles",
        resource_id=user.id,
        ip_address=get_client_ip(request),
    )

    # Delete profile (CASCADE handles related data)
    db.table("profiles").delete().eq("id", user.id).execute()

    # Delete auth user
    try:
        db.auth.admin.delete_user(user.id)
    except Exception:
        pass  # Profile already deleted, auth cleanup is best-effort

    return {"message": "Account deleted successfully"}
