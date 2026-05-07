"""Inventory Database API — CRUD operations for user-owned inventory items.

Replaces the in-memory inventory with Supabase-backed persistence.
All operations are scoped to the authenticated user via RLS.

Endpoints:
  GET    /api/inventory              — List all inventory items for current user
  POST   /api/inventory              — Add a new inventory item
  GET    /api/inventory/{id}         — Get a specific item
  PUT    /api/inventory/{id}         — Update an item
  DELETE /api/inventory/{id}         — Remove an item
  GET    /api/inventory/summary      — Get inventory health summary
  POST   /api/inventory/bulk         — Bulk import items
"""
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import date, datetime
from app.auth import AuthUser, get_current_user
from app.middleware import sanitize_string, validate_no_injection, log_audit, get_client_ip

router = APIRouter(prefix="/inventory", tags=["inventory"])


# ═══════════════════════════════════════════════════════════════════════════════
# PYDANTIC MODELS
# ═══════════════════════════════════════════════════════════════════════════════

VALID_CATEGORIES = [
    "water", "food", "medical", "tools", "documents",
    "clothing", "communication", "lighting", "sanitation", "other",
]


class InventoryItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., pattern=f"^({'|'.join(VALID_CATEGORIES)})$")
    quantity: int = Field(1, ge=0, le=99999)
    unit: str = Field("pcs", max_length=20)
    expiry_date: Optional[date] = None
    min_quantity: int = Field(1, ge=0, le=99999)
    location: str = Field("Home", max_length=200)
    notes: Optional[str] = Field(None, max_length=1000)


class InventoryItemUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=200)
    category: Optional[str] = Field(None, pattern=f"^({'|'.join(VALID_CATEGORIES)})$")
    quantity: Optional[int] = Field(None, ge=0, le=99999)
    unit: Optional[str] = Field(None, max_length=20)
    expiry_date: Optional[date] = None
    min_quantity: Optional[int] = Field(None, ge=0, le=99999)
    location: Optional[str] = Field(None, max_length=200)
    notes: Optional[str] = Field(None, max_length=1000)


class BulkImportItem(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    category: str = Field(..., pattern=f"^({'|'.join(VALID_CATEGORIES)})$")
    quantity: int = Field(1, ge=0, le=99999)
    unit: str = Field("pcs", max_length=20)
    expiry_date: Optional[date] = None
    min_quantity: int = Field(1, ge=0, le=99999)
    location: str = Field("Home", max_length=200)
    notes: Optional[str] = Field(None, max_length=1000)


class BulkImportRequest(BaseModel):
    items: List[BulkImportItem] = Field(..., min_length=1, max_length=100)


# ═══════════════════════════════════════════════════════════════════════════════
# HELPER
# ═══════════════════════════════════════════════════════════════════════════════

def _sanitize_item(data: dict) -> dict:
    """Sanitize string fields in an inventory item dict."""
    for field in ["name", "location", "notes"]:
        if data.get(field) and isinstance(data[field], str):
            if not validate_no_injection(data[field]):
                raise ValueError(f"Invalid characters in {field}")
            data[field] = sanitize_string(data[field])
    return data


def _compute_health_score(item: dict) -> float:
    """Compute a 0-100 health score for an inventory item.

    Factors:
    - Quantity vs min_quantity (stock level)
    - Expiry proximity
    """
    score = 100.0

    # Stock level factor (0-50 points)
    qty = item.get("quantity", 0)
    min_qty = item.get("min_quantity", 1)
    if min_qty > 0:
        stock_ratio = min(qty / min_qty, 2.0)  # Cap at 2x
        score -= max(0, (1.0 - stock_ratio) * 50)
    elif qty == 0:
        score -= 50

    # Expiry factor (0-50 points)
    expiry = item.get("expiry_date")
    if expiry:
        try:
            if isinstance(expiry, str):
                exp_date = date.fromisoformat(expiry)
            else:
                exp_date = expiry
            days_left = (exp_date - date.today()).days
            if days_left < 0:
                score -= 50  # Expired
            elif days_left < 30:
                score -= 30  # Expiring soon
            elif days_left < 90:
                score -= 15  # Expiring within 3 months
        except (ValueError, TypeError):
            pass

    return max(0.0, min(100.0, round(score, 1)))


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("")
async def list_inventory(
    category: Optional[str] = None,
    sort_by: str = "name",
    user: AuthUser = Depends(get_current_user),
):
    """List all inventory items for the authenticated user."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    query = db.table("inventory_items").select("*").eq("user_id", user.id)

    if category and category in VALID_CATEGORIES:
        query = query.eq("category", category)

    # Sort options
    valid_sorts = {
        "name": "name",
        "category": "category",
        "quantity": "quantity",
        "expiry": "expiry_date",
        "created": "created_at",
    }
    sort_col = valid_sorts.get(sort_by, "name")
    query = query.order(sort_col)

    result = query.execute()

    # Enrich with computed health scores
    items = []
    for item in (result.data or []):
        item["health_score"] = _compute_health_score(item)
        items.append(item)

    return {"items": items, "count": len(items)}


@router.post("")
async def create_inventory_item(
    req: InventoryItemCreate,
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Add a new inventory item."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    data = req.model_dump()
    try:
        data = _sanitize_item(data)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    data["user_id"] = user.id
    data["health_score"] = _compute_health_score(data)

    result = db.table("inventory_items").insert(data).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create inventory item")

    await log_audit(
        user_id=user.id,
        action="inventory.create",
        resource="inventory_items",
        resource_id=result.data[0]["id"],
        ip_address=get_client_ip(request),
        details={"name": data["name"], "category": data["category"]},
    )

    return {"item": result.data[0], "message": "Item added"}


@router.get("/summary")
async def inventory_summary(user: AuthUser = Depends(get_current_user)):
    """Get inventory health summary — category breakdown, low stock, expiring items."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("inventory_items").select("*").eq("user_id", user.id).execute()
    items = result.data or []

    # Category breakdown
    categories = {}
    low_stock = []
    expiring_soon = []
    expired = []
    total_items = 0

    for item in items:
        cat = item.get("category", "other")
        qty = item.get("quantity", 0)
        total_items += qty

        if cat not in categories:
            categories[cat] = {"count": 0, "total_quantity": 0}
        categories[cat]["count"] += 1
        categories[cat]["total_quantity"] += qty

        # Low stock check
        min_qty = item.get("min_quantity", 1)
        if qty < min_qty:
            low_stock.append({
                "id": item["id"],
                "name": item["name"],
                "quantity": qty,
                "min_quantity": min_qty,
            })

        # Expiry check
        expiry = item.get("expiry_date")
        if expiry:
            try:
                exp_date = date.fromisoformat(expiry) if isinstance(expiry, str) else expiry
                days_left = (exp_date - date.today()).days
                if days_left < 0:
                    expired.append({"id": item["id"], "name": item["name"], "expired_days_ago": abs(days_left)})
                elif days_left < 30:
                    expiring_soon.append({"id": item["id"], "name": item["name"], "days_left": days_left})
            except (ValueError, TypeError):
                pass

    # Overall health score
    scores = [_compute_health_score(item) for item in items]
    avg_health = round(sum(scores) / len(scores), 1) if scores else 100.0

    return {
        "total_items": len(items),
        "total_quantity": total_items,
        "overall_health": avg_health,
        "categories": categories,
        "low_stock": low_stock,
        "expiring_soon": expiring_soon,
        "expired": expired,
    }


@router.get("/{item_id}")
async def get_inventory_item(
    item_id: str,
    user: AuthUser = Depends(get_current_user),
):
    """Get a specific inventory item by ID."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("inventory_items").select("*").eq("id", item_id).eq("user_id", user.id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

    item = result.data[0]
    item["health_score"] = _compute_health_score(item)
    return {"item": item}


@router.put("/{item_id}")
async def update_inventory_item(
    item_id: str,
    updates: InventoryItemUpdate,
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Update an inventory item."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    update_data = {}
    for field, value in updates.model_dump(exclude_none=True).items():
        if isinstance(value, str):
            if not validate_no_injection(value):
                raise HTTPException(status_code=400, detail=f"Invalid characters in {field}")
            update_data[field] = sanitize_string(value)
        elif isinstance(value, date):
            update_data[field] = value.isoformat()
        else:
            update_data[field] = value

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields to update")

    # Recompute health score if quantity or expiry changed
    if "quantity" in update_data or "expiry_date" in update_data or "min_quantity" in update_data:
        # Fetch current item to merge for health computation
        current = db.table("inventory_items").select("*").eq("id", item_id).eq("user_id", user.id).execute()
        if current.data:
            merged = {**current.data[0], **update_data}
            update_data["health_score"] = _compute_health_score(merged)

    result = db.table("inventory_items").update(update_data).eq("id", item_id).eq("user_id", user.id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

    await log_audit(
        user_id=user.id,
        action="inventory.update",
        resource="inventory_items",
        resource_id=item_id,
        ip_address=get_client_ip(request),
        details={"fields": list(update_data.keys())},
    )

    return {"item": result.data[0], "message": "Item updated"}


@router.delete("/{item_id}")
async def delete_inventory_item(
    item_id: str,
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Remove an inventory item."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    result = db.table("inventory_items").delete().eq("id", item_id).eq("user_id", user.id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Item not found")

    await log_audit(
        user_id=user.id,
        action="inventory.delete",
        resource="inventory_items",
        resource_id=item_id,
        ip_address=get_client_ip(request),
    )

    return {"message": "Item removed"}


@router.post("/bulk")
async def bulk_import_inventory(
    req: BulkImportRequest,
    request: Request,
    user: AuthUser = Depends(get_current_user),
):
    """Bulk import inventory items (max 100 per request)."""
    from app.db.client import get_supabase_admin
    db = get_supabase_admin()

    created = []
    errors = []

    for i, item in enumerate(req.items):
        data = item.model_dump()
        try:
            data = _sanitize_item(data)
        except ValueError as e:
            errors.append({"index": i, "error": str(e)})
            continue

        data["user_id"] = user.id
        data["health_score"] = _compute_health_score(data)

        try:
            result = db.table("inventory_items").insert(data).execute()
            if result.data:
                created.append(result.data[0])
            else:
                errors.append({"index": i, "error": "Insert returned no data"})
        except Exception as e:
            errors.append({"index": i, "error": str(e)})

    await log_audit(
        user_id=user.id,
        action="inventory.bulk_import",
        resource="inventory_items",
        ip_address=get_client_ip(request),
        details={"created": len(created), "errors": len(errors)},
    )

    return {
        "created": created,
        "created_count": len(created),
        "errors": errors,
        "error_count": len(errors),
        "message": f"Imported {len(created)} items" + (f", {len(errors)} errors" if errors else ""),
    }
