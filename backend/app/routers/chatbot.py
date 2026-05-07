"""Chatbot API — AI-powered assistant for inventory queries and app navigation.

Uses Groq LLM to provide contextual help about the user's inventory,
threat status, and general disaster preparedness guidance.

Endpoints:
  POST   /api/chatbot/message    — Send a message and get AI response
  GET    /api/chatbot/suggestions — Get contextual quick-action suggestions
"""
import json
import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from app.auth import AuthUser, get_current_user
from app.agents.config import get_groq_client, get_model, mark_rate_limited

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chatbot", tags=["chatbot"])


# ═══════════════════════════════════════════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class ChatMessage(BaseModel):
    """A single message in the conversation."""
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    """Chat request with conversation history."""
    message: str = Field(..., min_length=1, max_length=2000)
    history: List[ChatMessage] = Field(default_factory=list, max_length=20)
    context: Optional[dict] = None  # Optional: current inventory, threat status, etc.


class ChatResponse(BaseModel):
    """AI chatbot response."""
    reply: str
    suggestions: List[str] = Field(default_factory=list)
    intent: Optional[str] = None  # inventory_query, navigation, emergency, general


# ═══════════════════════════════════════════════════════════════════════════════
# SYSTEM PROMPT
# ═══════════════════════════════════════════════════════════════════════════════

CHATBOT_SYSTEM_PROMPT = """You are MyResilience AI Assistant — a friendly, knowledgeable chatbot for the MyResilience disaster preparedness app in Malaysia.

Your role:
- Help users navigate the app (Dashboard, Inventory, Personnel, Threat Map, Briefing, etc.)
- Answer questions about their emergency inventory (stock levels, expiry dates, recommendations)
- Provide disaster preparedness advice specific to Malaysia (floods, storms, haze)
- Explain app features and how to use them
- Guide users through emergency procedures

App Navigation Reference:
- Dashboard: Real-time threat overview, readiness score, live weather
- Inventory: Manage emergency supplies (water, food, medical, tools, etc.)
- Personnel: Manage family/household members and emergency contacts
- Activity Network: View AI agent reasoning and system events
- Agents: Monitor autonomous AI agent status
- Briefing: AI-generated preparedness briefing
- Threat Map: Live threat visualization with shelters and routes
- Survival Guide: Emergency procedures and tips
- Settings: App configuration, location tracking, notifications

Key Features:
- Voice commands: Users can say things like "add 5 bottles of water" or "search for medical supplies"
- Image scanning: Users can photograph items to add to inventory
- Role-based access: Admin users have additional management capabilities

Rules:
- Be concise and helpful
- Use emojis sparingly (1-2 max)
- For emergency situations, always recommend calling 999 first
- If unsure, suggest the user check the Survival Guide tab
- Respond in the same language the user writes in
- Never make up inventory data — if the user asks about their specific items, note that you don't have real-time access to their inventory unless provided in context"""


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/message", response_model=ChatResponse)
async def chat_message(
    req: ChatRequest,
    user: AuthUser = Depends(get_current_user),
):
    """Send a message to the AI chatbot and receive a contextual response.

    Accepts conversation history for multi-turn dialogue.
    Optionally includes current inventory/threat context for more relevant answers.
    """
    client = get_groq_client()
    model = get_model()

    # Build messages array
    system_prompt = CHATBOT_SYSTEM_PROMPT

    # Inject user context if provided
    if req.context:
        context_parts = []
        if "inventory" in req.context:
            items = req.context["inventory"]
            if items:
                inv_summary = ", ".join(
                    f"{i.get('name', '?')} ({i.get('current_amount', 0)}/{i.get('target_amount', 0)})"
                    for i in items[:15]
                )
                context_parts.append(f"User's current inventory: {inv_summary}")
        if "threat_status" in req.context:
            context_parts.append(f"Current threat status: {req.context['threat_status']}")
        if "readiness_score" in req.context:
            context_parts.append(f"Readiness score: {req.context['readiness_score']}%")
        if "location" in req.context:
            context_parts.append(f"User location: {req.context['location']}")

        if context_parts:
            system_prompt += "\n\n--- CURRENT USER CONTEXT ---\n" + "\n".join(context_parts)

    messages = [{"role": "system", "content": system_prompt}]

    # Add conversation history (last 10 messages max)
    for msg in req.history[-10:]:
        messages.append({"role": msg.role, "content": msg.content})

    # Add current user message
    messages.append({"role": "user", "content": req.message})

    try:
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            temperature=0.7,
            max_tokens=500,
        )
        reply = response.choices[0].message.content.strip()

        # Detect intent for frontend quick-actions
        intent = _detect_intent(req.message)

        # Generate contextual suggestions
        suggestions = _generate_suggestions(intent, req.context)

        return ChatResponse(
            reply=reply,
            suggestions=suggestions,
            intent=intent,
        )

    except Exception as e:
        logger.error(f"Chatbot error: {e}")
        if "429" in str(e) or "rate" in str(e).lower():
            mark_rate_limited(model)
            raise HTTPException(status_code=429, detail="AI service busy. Please try again.")
        raise HTTPException(status_code=500, detail="Chatbot temporarily unavailable")


@router.get("/suggestions")
async def get_suggestions(
    user: AuthUser = Depends(get_current_user),
):
    """Get contextual quick-action suggestions based on user role.

    Returns different suggestions for admin vs regular users.
    """
    base_suggestions = [
        "How do I add inventory items?",
        "What supplies should I prepare for floods?",
        "Show me the nearest emergency shelters",
        "How does the voice command work?",
        "What is the P.A.C.E. plan?",
    ]

    if user.is_admin:
        base_suggestions.extend([
            "How do I manage user roles?",
            "Show system health status",
            "How do I view the audit log?",
        ])

    return {"suggestions": base_suggestions}


# ═══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _detect_intent(message: str) -> str:
    """Simple keyword-based intent detection."""
    lower = message.lower()

    if any(w in lower for w in ["inventory", "stock", "supply", "supplies", "add", "remove", "water", "food", "medical"]):
        return "inventory_query"
    if any(w in lower for w in ["navigate", "where", "how to", "find", "page", "tab", "menu", "feature"]):
        return "navigation"
    if any(w in lower for w in ["emergency", "flood", "storm", "threat", "danger", "evacuate", "alert", "999"]):
        return "emergency"
    if any(w in lower for w in ["voice", "speak", "command", "microphone", "mic"]):
        return "voice_help"
    if any(w in lower for w in ["scan", "camera", "photo", "image", "picture"]):
        return "scan_help"
    if any(w in lower for w in ["admin", "role", "user management", "permission"]):
        return "admin_help"
    return "general"


def _generate_suggestions(intent: str, context: Optional[dict] = None) -> List[str]:
    """Generate contextual follow-up suggestions based on detected intent."""
    suggestions_map = {
        "inventory_query": [
            "How do I scan items with my camera?",
            "What's the minimum stock I should keep?",
            "Show me items expiring soon",
        ],
        "navigation": [
            "Take me to the Threat Map",
            "How do I access the Survival Guide?",
            "Where can I see my readiness score?",
        ],
        "emergency": [
            "What should I do during a flood?",
            "How do I send emergency alerts?",
            "Show evacuation routes",
        ],
        "voice_help": [
            "What voice commands are supported?",
            "How do I enable the microphone?",
            "Can I search inventory by voice?",
        ],
        "scan_help": [
            "How do I scan my ID card?",
            "Can I scan multiple items at once?",
            "What types of items can I scan?",
        ],
        "admin_help": [
            "How do I promote a user to admin?",
            "Where is the system health dashboard?",
            "How do I view user activity?",
        ],
        "general": [
            "What can you help me with?",
            "Tell me about MyResilience features",
            "How do I get started?",
        ],
    }
    return suggestions_map.get(intent, suggestions_map["general"])
