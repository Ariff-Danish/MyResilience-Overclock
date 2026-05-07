"""Voice Command API — Process voice-transcribed text into inventory actions.

Uses Groq LLM to parse natural language voice commands and extract
structured inventory operations (add, update, search, delete).

Endpoints:
  POST   /api/voice/process    — Process transcribed voice text into an action
  GET    /api/voice/commands    — List supported voice command examples
"""
import json
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from app.auth import AuthUser, get_current_user
from app.agents.config import get_groq_client, get_model, mark_rate_limited

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/voice", tags=["voice"])


# ═══════════════════════════════════════════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class VoiceProcessRequest(BaseModel):
    """Voice command processing request."""
    transcript: str = Field(..., min_length=1, max_length=1000, description="Voice-to-text transcript")
    current_inventory: Optional[List[dict]] = Field(None, description="Current inventory for context")


class VoiceAction(BaseModel):
    """Parsed voice action."""
    action: str = Field(..., description="Action type: add, update, search, delete, query, unknown")
    item_name: Optional[str] = Field(None, description="Name of the inventory item")
    category: Optional[str] = Field(None, description="Item category")
    quantity: Optional[int] = Field(None, description="Quantity for add/update")
    unit: Optional[str] = Field(None, description="Unit of measurement")
    search_query: Optional[str] = Field(None, description="Search term for search actions")
    confidence: float = Field(0.0, description="Parsing confidence 0-1")
    raw_transcript: str = Field("", description="Original transcript")
    message: Optional[str] = Field(None, description="Human-readable action description")


# ═══════════════════════════════════════════════════════════════════════════════
# VALID CATEGORIES (matching inventory_db.py)
# ═══════════════════════════════════════════════════════════════════════════════

VALID_CATEGORIES = [
    "water", "food", "medical", "tools", "documents",
    "clothing", "communication", "lighting", "sanitation", "other",
]

CATEGORY_SYNONYMS = {
    "drink": "water", "drinks": "water", "hydration": "water",
    "meal": "food", "meals": "food", "snack": "food", "snacks": "food", "ration": "food", "rations": "food",
    "medicine": "medical", "medication": "medical", "first aid": "medical", "bandage": "medical",
    "tool": "tools", "multi-tool": "tools", "knife": "tools", "rope": "tools",
    "paper": "documents", "passport": "documents", "id": "documents", "certificate": "documents",
    "clothes": "clothing", "shirt": "clothing", "pants": "clothing", "jacket": "clothing",
    "phone": "communication", "radio": "communication", "walkie-talkie": "communication", "charger": "communication",
    "flashlight": "lighting", "torch": "lighting", "candle": "lighting", "batteries": "lighting", "battery": "lighting",
    "soap": "sanitation", "toothbrush": "sanitation", "towel": "sanitation", "tissue": "sanitation",
}


# ═══════════════════════════════════════════════════════════════════════════════
# SYSTEM PROMPT
# ═══════════════════════════════════════════════════════════════════════════════

VOICE_SYSTEM_PROMPT = f"""You are a voice command parser for a disaster preparedness inventory app.
Parse the user's voice transcript into a structured inventory action.

Valid actions: add, update, search, delete, query, unknown
Valid categories: {', '.join(VALID_CATEGORIES)}

Return a JSON object with these fields:
{{
  "action": "add|update|search|delete|query|unknown",
  "item_name": "name of the item (or null)",
  "category": "one of the valid categories (or null)",
  "quantity": number_or_null,
  "unit": "unit like pcs, liters, cans, kits (or null)",
  "search_query": "search term if action is search (or null)",
  "confidence": 0.0_to_1.0,
  "message": "Brief human-readable description of what will happen"
}}

Examples:
- "add 5 bottles of water" → {{"action": "add", "item_name": "Bottled Water", "category": "water", "quantity": 5, "unit": "bottles", "confidence": 0.95, "message": "Adding 5 bottles of water to inventory"}}
- "update first aid kit to 3" → {{"action": "update", "item_name": "First Aid Kit", "category": "medical", "quantity": 3, "confidence": 0.9, "message": "Updating First Aid Kit quantity to 3"}}
- "search for medical supplies" → {{"action": "search", "search_query": "medical supplies", "category": "medical", "confidence": 0.85, "message": "Searching for medical supplies"}}
- "delete canned beans" → {{"action": "delete", "item_name": "Canned Beans", "category": "food", "confidence": 0.9, "message": "Removing Canned Beans from inventory"}}
- "how much water do I have" → {{"action": "query", "item_name": "water", "category": "water", "confidence": 0.8, "message": "Checking water stock levels"}}
- "what's the weather like" → {{"action": "unknown", "confidence": 0.3, "message": "This doesn't seem to be an inventory command"}}

Rules:
- Infer category from item name when not explicit
- Default unit to "pcs" if not specified
- Default quantity to 1 for add commands if not specified
- Set confidence based on how clear the command is
- Return ONLY valid JSON"""


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/process", response_model=VoiceAction)
async def process_voice_command(
    req: VoiceProcessRequest,
    user: AuthUser = Depends(get_current_user),
):
    """Process a voice-transcribed text into a structured inventory action.

    Uses Groq LLM to parse natural language commands like:
    - "Add 5 bottles of water"
    - "Update first aid kit quantity to 3"
    - "Search for medical supplies"
    - "How much food do I have left"
    """
    client = get_groq_client()
    model = get_model()

    # Build context with current inventory for better parsing
    system_prompt = VOICE_SYSTEM_PROMPT
    if req.current_inventory:
        inv_names = [item.get("name", "") for item in req.current_inventory[:20]]
        system_prompt += f"\n\nUser's current inventory items: {', '.join(inv_names)}"

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": f"Parse this voice command: \"{req.transcript}\""},
    ]

    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.1,
            max_tokens=300,
            response_format={"type": "json_object"},
        )
        content = response.choices[0].message.content.strip()
        result = json.loads(content)

        # Validate and normalize the result
        action = result.get("action", "unknown")
        if action not in ["add", "update", "search", "delete", "query", "unknown"]:
            action = "unknown"

        # Normalize category
        category = result.get("category")
        if category:
            category = category.lower()
            category = CATEGORY_SYNONYMS.get(category, category)
            if category not in VALID_CATEGORIES:
                category = None

        return VoiceAction(
            action=action,
            item_name=result.get("item_name"),
            category=category,
            quantity=result.get("quantity"),
            unit=result.get("unit", "pcs"),
            search_query=result.get("search_query"),
            confidence=float(result.get("confidence", 0.5)),
            raw_transcript=req.transcript,
            message=result.get("message", f"Processed: {req.transcript}"),
        )

    except json.JSONDecodeError:
        logger.warning(f"Failed to parse voice command JSON: {content}")
        return VoiceAction(
            action="unknown",
            raw_transcript=req.transcript,
            confidence=0.1,
            message="Could not understand the command. Please try again.",
        )
    except Exception as e:
        logger.error(f"Voice processing error: {e}")
        if "429" in str(e) or "rate" in str(e).lower():
            mark_rate_limited(model)
            raise HTTPException(status_code=429, detail="AI service busy. Please try again.")
        raise HTTPException(status_code=500, detail="Voice processing temporarily unavailable")


@router.get("/commands")
async def list_voice_commands(
    user: AuthUser = Depends(get_current_user),
):
    """List supported voice command examples and patterns.

    Returns categorized examples for user reference.
    """
    return {
        "commands": {
            "add": {
                "description": "Add a new item to inventory",
                "examples": [
                    "Add 5 bottles of water",
                    "Add a first aid kit",
                    "Add 10 cans of food",
                    "Put 3 flashlights in inventory",
                ],
            },
            "update": {
                "description": "Update an existing item's quantity",
                "examples": [
                    "Update water to 20 liters",
                    "Change first aid kit quantity to 3",
                    "Set canned beans to 15",
                ],
            },
            "search": {
                "description": "Search for items in inventory",
                "examples": [
                    "Search for medical supplies",
                    "Find all food items",
                    "Look for tools",
                ],
            },
            "delete": {
                "description": "Remove an item from inventory",
                "examples": [
                    "Delete canned beans",
                    "Remove expired food",
                    "Remove the old flashlight",
                ],
            },
            "query": {
                "description": "Ask about inventory status",
                "examples": [
                    "How much water do I have?",
                    "What food is expiring soon?",
                    "Check my medical supplies",
                    "What's my readiness score?",
                ],
            },
        },
        "tips": [
            "Speak clearly and at a normal pace",
            "Include quantities when adding items",
            "Use item names that match your inventory",
            "Say the action first (add, update, search, delete)",
        ],
    }
