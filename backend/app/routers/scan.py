"""Scan API — OCR ID scanning and inventory asset recognition via Groq Vision.

Uses Groq's multimodal LLM to extract structured data from camera-captured images.
"""

import base64
import json
import logging
import os
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel

from app.auth import AuthUser, get_current_user
from app.agents.config import get_groq_client

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/scan", tags=["scan"])

# ─── Response Models ───────────────────────────────────────────────────────────

class IDScanResult(BaseModel):
    """Extracted ID card data."""
    full_name: Optional[str] = None
    id_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    gender: Optional[str] = None
    nationality: Optional[str] = None
    address: Optional[str] = None
    expiry_date: Optional[str] = None
    id_type: Optional[str] = None  # MyKad, passport, driver license, etc.
    confidence: Optional[float] = None
    raw_text: Optional[str] = None
    error: Optional[str] = None


class AssetScanResult(BaseModel):
    """Extracted inventory asset data."""
    asset_name: Optional[str] = None
    asset_type: Optional[str] = None  # electronics, medical, food, tool, etc.
    brand: Optional[str] = None
    model: Optional[str] = None
    serial_number: Optional[str] = None
    condition: Optional[str] = None  # new, good, fair, poor, damaged
    color: Optional[str] = None
    estimated_value: Optional[str] = None
    expiry_date: Optional[str] = None
    quantity: Optional[int] = None
    category: Optional[str] = None
    description: Optional[str] = None
    confidence: Optional[float] = None
    error: Optional[str] = None


# ─── Vision Analysis Helpers ──────────────────────────────────────────────────

def _analyze_image_with_groq(image_base64: str, system_prompt: str, user_prompt: str) -> dict:
    """Send an image to Groq's vision model and return parsed JSON response."""
    client = get_groq_client()

    # Try vision-capable models in order of preference
    vision_models = [
        "meta-llama/llama-4-maverick-17b-128e-instruct",
        "llama-3.2-90b-vision-preview",
        "llama-3.2-11b-vision-preview",
    ]

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": [
                {"type": "text", "text": user_prompt},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{image_base64}",
                    },
                },
            ],
        },
    ]

    last_error = None
    for model in vision_models:
        try:
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.1,
                max_tokens=1500,
                response_format={"type": "json_object"},
            )
            content = response.choices[0].message.content
            return json.loads(content)
        except Exception as e:
            last_error = e
            logger.warning(f"Vision model {model} failed: {e}")
            continue

    raise last_error or RuntimeError("All vision models failed")


# ─── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/id", response_model=IDScanResult)
async def scan_id_card(
    image: UploadFile = File(...),
    user: AuthUser = Depends(get_current_user),
):
    """Scan an ID card image and extract structured data using OCR.

    Accepts a JPEG/PNG image captured from camera.
    Extracts: name, ID number, DOB, gender, nationality, address, expiry, ID type.
    """
    try:
        # Read and encode image
        contents = await image.read()
        if len(contents) > 10 * 1024 * 1024:  # 10MB limit
            raise HTTPException(status_code=413, detail="Image too large (max 10MB)")

        image_b64 = base64.b64encode(contents).decode("utf-8")

        system_prompt = """You are an expert OCR system specializing in identity documents.
Analyze the provided ID card image and extract all visible text fields.

Return a JSON object with these fields (use null for any field not found):
{
  "full_name": "extracted full name",
  "id_number": "extracted ID/passport number",
  "date_of_birth": "YYYY-MM-DD format if found",
  "gender": "Male/Female/Other",
  "nationality": "country of nationality",
  "address": "full address if visible",
  "expiry_date": "YYYY-MM-DD format if found",
  "id_type": "type of document (MyKad, Passport, Driver License, Student ID, etc.)",
  "confidence": 0.0 to 1.0,
  "raw_text": "all visible text on the document"
}

Important:
- Be precise with numbers (ID numbers, dates)
- For Malaysian MyKad: IC number format is YYMMDD-SS-GGGG
- If the image is unclear, set confidence lower
- Extract ALL visible text into raw_text
- Return ONLY valid JSON, no markdown or explanation"""

        user_prompt = "Analyze this ID card image and extract all visible information. Return structured JSON."

        result = _analyze_image_with_groq(image_b64, system_prompt, user_prompt)

        return IDScanResult(
            full_name=result.get("full_name"),
            id_number=result.get("id_number"),
            date_of_birth=result.get("date_of_birth"),
            gender=result.get("gender"),
            nationality=result.get("nationality"),
            address=result.get("address"),
            expiry_date=result.get("expiry_date"),
            id_type=result.get("id_type"),
            confidence=result.get("confidence", 0.0),
            raw_text=result.get("raw_text"),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"ID scan failed: {e}")
        return IDScanResult(error=str(e), confidence=0.0)


@router.post("/asset", response_model=AssetScanResult)
async def scan_asset(
    image: UploadFile = File(...),
    user: AuthUser = Depends(get_current_user),
):
    """Scan an inventory asset image and extract structured data using image recognition.

    Accepts a JPEG/PNG image of any physical item.
    Extracts: name, type, brand, model, serial number, condition, value, etc.
    """
    try:
        contents = await image.read()
        if len(contents) > 10 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Image too large (max 10MB)")

        image_b64 = base64.b64encode(contents).decode("utf-8")

        system_prompt = """You are an expert inventory analyst and image recognition system.
Analyze the provided image of a physical item/asset and extract all identifiable information.

Return a JSON object with these fields (use null for any field not identifiable):
{
  "asset_name": "descriptive name of the item",
  "asset_type": "category: electronics, medical, food, tool, clothing, supply, furniture, vehicle, other",
  "brand": "brand/manufacturer if visible",
  "model": "model number/name if visible",
  "serial_number": "serial number if visible on the item",
  "condition": "assess: new, good, fair, poor, damaged",
  "color": "primary color(s)",
  "estimated_value": "rough estimated value in MYR if assessable",
  "expiry_date": "YYYY-MM-DD if expiry date is visible (food, medicine, etc.)",
  "quantity": 1,
  "category": "more specific subcategory",
  "description": "brief description of the item and its apparent purpose",
  "confidence": 0.0 to 1.0
}

Important:
- Assess condition based on visible wear, damage, rust, stains
- For food/medicine: look for expiry dates, packaging condition
- For electronics: look for brand logos, model numbers, screen condition
- Be conservative with estimated value
- Return ONLY valid JSON, no markdown or explanation"""

        user_prompt = "Analyze this image of an inventory item and extract all identifiable information. Return structured JSON."

        result = _analyze_image_with_groq(image_b64, system_prompt, user_prompt)

        return AssetScanResult(
            asset_name=result.get("asset_name"),
            asset_type=result.get("asset_type"),
            brand=result.get("brand"),
            model=result.get("model"),
            serial_number=result.get("serial_number"),
            condition=result.get("condition"),
            color=result.get("color"),
            estimated_value=result.get("estimated_value"),
            expiry_date=result.get("expiry_date"),
            quantity=result.get("quantity", 1),
            category=result.get("category"),
            description=result.get("description"),
            confidence=result.get("confidence", 0.0),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Asset scan failed: {e}")
        return AssetScanResult(error=str(e), confidence=0.0)
