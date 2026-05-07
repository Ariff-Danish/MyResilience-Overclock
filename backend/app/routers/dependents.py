"""Dependents API — CRUD for family members and dependents.

Endpoints:
  GET    /api/dependents           — List all dependents for current user
  POST   /api/dependents           — Add a dependent
  GET    /api/dependents/{id}      — Get a specific dependent
  PUT    /api/dependents/{id}      — Update a dependent
  DELETE /api/dependents/{id}      — Remove a dependent
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from typing import Optional, List
from app.auth import AuthUser, get_current_user
from app.middleware import sanitize_string, validate_no_injection, log_audit, get_client_ip

router = APIRouter(prefix="/dependents", tags=["dependents"])


class DependentCreate(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=200)
    relationship: str = Field(..., pattern=r"^(spouse|child|parent|sibling|grandparent|grandchild|relative|caregiver|other)$")
    age: Optional[int] = Field(None, ge=0, le=150)
    age_group: Optional[str] = Field(None, pattern=r"^(infant|toddler|child|teen|adult|elderly)$")
    medical_conditions: Optional[List[str]] = None
    medications: Optional[List[str]] = None
    mobility_level: Optional[str] = Field("full", pattern=r"^(full|limited|wheelchair|bedridden)$")
    dietary_restrictions: Optional[List[str]] = None
    priority: Optional[int] = Field(1, ge=1, le=10)
    notes: Optional[str] = Field(None, max_length=1000)


class DependentUpdate(BaseModel):
    full_name: Optional[str] = Field(None, min_length=1, max_length=200)
    relationship: Optional[str] = Field(None, pattern=r"^(spouse|child|parent|sibling|grandparent|grandchild|relative|caregiver|other)$")
    age: Optional[int] = Field(None, ge=0, le=150)
    age_group: Optional[str] = Field(None, pattern=r"^(infant|toddler|child|teen|adult|elderly)$")
    medical_conditions: Optional[List[str]] = None
    medications: Optional[List[str]] = None
    mobility_level: Optional[str] = Field(None, pattern=r"^(full|limited|wheelchair|bedridden)$")
    dietary_restrictions: Optional[List[str]] = None
    priority: Optional[int] = Field(None, ge=1, le=10)
    notes: Optional[str] = Field(None, max_length=1000)


@router.get("")
async def list_dependents(user: AuthUser = Depends(get_current_user)):
    """List all dependents for the authenticated user."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("dependents").select("*").eq("user_id", user.id).order("priority").execute()
    return {"dependents": result.data, "count": len(result.data)}


@router.post("")
async def create_dependent(
    req: DependentCreate,
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Add a new dependent."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    # Sanitize string fields
    data = req.model_dump()
    for field in ["full_name", "notes"]:
        if data.get(field):
            if not validate_no_injection(data[field]):
                raise HTTPException(status_code=400, detail=f"Invalid characters in {field}")
            data[field] = sanitize_string(data[field])

    data["user_id"] = user.id

    result = db.table("dependents").insert(data).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create dependent")

    await log_audit(
        user_id=user.id,
        action="dependent.create",
        resource="dependents",
        resource_id=result.data[0]["id"],
        ip_address=get_client_ip(request),
    )

    return {"dependent": result.data[0], "message": "Dependent added"}


@router.get("/{dependent_id}")
async def get_dependent(
    dependent_id: str,
    user: AuthUser = Depends(get_current_user),
):
    """Get a specific dependent by ID."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("dependents").select("*").eq("id", dependent_id).eq("user_id", user.id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Dependent not found")

    return {"dependent": result.data[0]}


@router.put("/{dependent_id}")
async def update_dependent(
    dependent_id: str,
    updates: DependentUpdate,
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Update a dependent."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    update_data = {}
    for field, value in updates.model_dump(exclude_none=True).items():
        if isinstance(value, str):
            if not validate_no_injection(value):
                raise HTTPException(status_code=400, detail=f"Invalid characters in {field}")
            update_data[field] = sanitize_string(value)
        else:
            update_data[field] = value

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    result = db.table("dependents").update(update_data).eq("id", dependent_id).eq("user_id", user.id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Dependent not found")

    await log_audit(
        user_id=user.id,
        action="dependent.update",
        resource="dependents",
        resource_id=dependent_id,
        ip_address=get_client_ip(request),
        details={"fields": list(update_data.keys())},
    )

    return {"dependent": result.data[0], "message": "Dependent updated"}


@router.delete("/{dependent_id}")
async def delete_dependent(
    dependent_id: str,
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Remove a dependent."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("dependents").delete().eq("id", dependent_id).eq("user_id", user.id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Dependent not found")

    await log_audit(
        user_id=user.id,
        action="dependent.delete",
        resource="dependents",
        resource_id=dependent_id,
        ip_address=get_client_ip(request),
    )

    return {"message": "Dependent removed"}
