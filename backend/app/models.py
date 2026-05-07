from sqlalchemy import Column, Integer, String, Float, Boolean, ForeignKey, DateTime
from sqlalchemy.orm import relationship
from datetime import datetime
from .database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password_hash = Column(String(255), nullable=False)
    location_lat = Column(Float, nullable=True)
    location_lng = Column(Float, nullable=True)
    region_display = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    settings = relationship("UserSettings", back_populates="user", uselist=False)
    team_members = relationship("TeamMember", back_populates="user")
    inventory_items = relationship("InventoryItem", back_populates="user")

class UserSettings(Base):
    __tablename__ = "user_settings"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), unique=True)
    email_preparedness = Column(Boolean, default=False)
    email_advisories = Column(Boolean, default=False)
    email_emergency = Column(Boolean, default=False)
    location_tracking = Column(Boolean, default=False)

    user = relationship("User", back_populates="settings")

class TeamMember(Base):
    __tablename__ = "team_members"

    id = Column(String(50), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    name = Column(String(255), nullable=False)
    role = Column(String(100), nullable=False)
    email = Column(String(255), nullable=True)
    phone = Column(String(50), nullable=True)
    age = Column(Integer, default=0)

    user = relationship("User", back_populates="team_members")

class InventoryItem(Base):
    __tablename__ = "inventory_items"

    id = Column(String(50), primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    category = Column(String(100), nullable=False)
    name = Column(String(255), nullable=False)
    current_amount = Column(Float, default=0.0)
    target_amount = Column(Float, default=0.0)
    unit = Column(String(50), nullable=True)
    expiry_date = Column(String(50), nullable=True)

    user = relationship("User", back_populates="inventory_items")
