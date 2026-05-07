from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional
from pydantic import BaseModel
from ..database import get_db
from .. import models
from datetime import datetime

router = APIRouter()

# For the hackathon demo, we assume user_id=1
DEFAULT_USER_ID = 1

# --- Pydantic Schemas ---

class InventoryItemBase(BaseModel):
    name: str
    category: str
    current_amount: float
    target_amount: float
    unit: Optional[str] = ""
    expiry_date: Optional[str] = ""

class InventoryItem(InventoryItemBase):
    id: str 
    user_id: Optional[int] = DEFAULT_USER_ID

    class Config:
        from_attributes = True

class TeamMemberBase(BaseModel):
    name: str
    role: str
    email: Optional[str] = ""
    phone: Optional[str] = ""
    age: Optional[int] = 0

class TeamMember(TeamMemberBase):
    id: str 
    user_id: Optional[int] = DEFAULT_USER_ID

    class Config:
        from_attributes = True

# --- API Endpoints ---

@router.get("/inventory", response_model=List[InventoryItem])
def get_inventory(db: Session = Depends(get_db)):
    return db.query(models.InventoryItem).filter(models.InventoryItem.user_id == DEFAULT_USER_ID).all()

@router.post("/inventory", response_model=InventoryItem)
def create_inventory_item(item: InventoryItem, db: Session = Depends(get_db)):
    # Create user if not exists for demo
    user = db.query(models.User).filter(models.User.id == DEFAULT_USER_ID).first()
    if not user:
        user = models.User(id=DEFAULT_USER_ID, email="demo@example.com", password_hash="demo")
        db.add(user)
        db.commit()

    # Create or update
    db_item = db.query(models.InventoryItem).filter(models.InventoryItem.id == item.id).first()
    if db_item:
        for key, value in item.model_dump(exclude={"id", "user_id"}).items():
            setattr(db_item, key, value)
    else:
        db_item = models.InventoryItem(**item.model_dump(exclude={"user_id"}), user_id=DEFAULT_USER_ID)
        db.add(db_item)
    
    db.commit()
    db.refresh(db_item)
    return db_item

@router.delete("/inventory")
def clear_inventory(db: Session = Depends(get_db)):
    db.query(models.InventoryItem).filter(models.InventoryItem.user_id == DEFAULT_USER_ID).delete()
    db.commit()
    return {"status": "success"}

@router.get("/team", response_model=List[TeamMember])
def get_team(db: Session = Depends(get_db)):
    return db.query(models.TeamMember).filter(models.TeamMember.user_id == DEFAULT_USER_ID).all()

@router.post("/team", response_model=TeamMember)
def create_team_member(member: TeamMember, db: Session = Depends(get_db)):
    # Create or update
    db_member = db.query(models.TeamMember).filter(models.TeamMember.id == member.id).first()
    if db_member:
        for key, value in member.model_dump(exclude={"id", "user_id"}).items():
            setattr(db_member, key, value)
    else:
        db_member = models.TeamMember(**member.model_dump(exclude={"user_id"}), user_id=DEFAULT_USER_ID)
        db.add(db_member)
        
    db.commit()
    db.refresh(db_member)
    return db_member

@router.delete("/team")
def clear_team(db: Session = Depends(get_db)):
    db.query(models.TeamMember).filter(models.TeamMember.user_id == DEFAULT_USER_ID).delete()
    db.commit()
    return {"status": "success"}
