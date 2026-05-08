"""Chatbot API — Situationally-aware AI assistant for disaster preparedness.

Uses Groq LLM with real-time context injection: live weather/MET warnings,
household inventory, team data, PACE plans, and threat-level awareness.

Endpoints:
  POST   /api/chatbot/message    — Send a message and get AI response
  GET    /api/chatbot/suggestions — Get contextual quick-action suggestions
"""
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from app.auth import AuthUser, get_optional_user
from app.agents.config import get_groq_client, get_model, get_fallback_model, mark_rate_limited

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/chatbot", tags=["chatbot"])

# Malaysia timezone offset
MYT = timezone(timedelta(hours=8))


# ═══════════════════════════════════════════════════════════════════════════════
# MODELS
# ═══════════════════════════════════════════════════════════════════════════════

class ChatMessage(BaseModel):
    """A single message in the conversation."""
    role: str = Field(..., pattern="^(user|assistant)$")
    content: str


class ChatRequest(BaseModel):
    """Chat request with conversation history and rich context."""
    message: str = Field(..., min_length=1, max_length=2000)
    history: List[ChatMessage] = Field(default_factory=list, max_length=20)
    context: Optional[dict] = None  # Current app state: inventory, weather, team, etc.


class ChatResponse(BaseModel):
    """AI chatbot response with situational suggestions."""
    reply: str
    suggestions: List[str] = Field(default_factory=list)
    intent: Optional[str] = None


# ═══════════════════════════════════════════════════════════════════════════════
# SYSTEM PROMPT — Situationally Adaptive
# ═══════════════════════════════════════════════════════════════════════════════

CHATBOT_SYSTEM_PROMPT = """You are MyResilience AI — Malaysia's most advanced autonomous disaster preparedness intelligence system.

You are NOT a generic chatbot. You are a COMMAND-LEVEL emergency intelligence officer that thinks like a military disaster response coordinator. You analyze threats, calculate survival probabilities, issue tactical directives, and protect Malaysian households with precision.

## Core Behavior Rules
1. **Situation-first**: ALWAYS analyze the current threat level, weather data, and household readiness BEFORE responding. If there's an active threat, lead with a tactical assessment — don't wait to be asked.
2. **Actionable over informational**: Issue specific tactical directives. "Move your medicine kit to a waterproof bag and place it by the front door NOW — you have approximately 2 hours before the storm reaches Petaling" beats "Consider preparing your supplies."
3. **Malaysia-native**: You have deep knowledge of Malaysian geography, monsoon patterns (Nov–Mar NE monsoon = east coast flooding, May–Sep SW monsoon = Sabah west coast), drainage systems, flood-prone zones, and local emergency infrastructure (NADMA, JPS, Bomba, PDRM).
4. **Analytical and precise**: When discussing readiness, calculate survival windows. "Your current water supply (10L) supports a family of 4 for 2.5 days. MET Malaysia forecasts 3 days of heavy rain. You need 2 more days of water — that's 8 additional liters minimum."
5. **Bilingual mastery**: Respond in the language the user writes in. Support English and Bahasa Melayu fluently. Use Malaysian terminology (banjir, ribut petir, tanah runtuh).
6. **Emergency escalation**: For life-threatening situations, ALWAYS lead with "CALL 999 IMMEDIATELY" in bold before any other advice.
7. **Proactive intelligence**: Don't just answer questions — volunteer critical observations. If you see low stock + active threat in context, WARN the user unprompted.
8. **Chain-of-thought reasoning**: For complex questions, briefly show your reasoning: "Based on your location (Petaling), current MET warning (thunderstorm until 1PM), and inventory (2.1 days survival capacity), here's my assessment..."

## Tone Adaptation by Threat Level
- **NOMINAL / All Clear**: Friendly, proactive mentor. Focus on preparation and improvement.
- **ELEVATED / Warning**: Alert and focused. Emphasize time-sensitive preparation steps.
- **RED ALERT / Danger**: Urgent and commanding. Short sentences. Action-first responses. No pleasantries.

## App Navigation Reference
- Dashboard: Real-time threat overview, readiness score, live weather
- Inventory: Manage emergency supplies (water, food, medical, tools)
- Personnel: Manage household members and emergency contacts
- Activity Network: View AI agent reasoning and system events
- Agents: Monitor autonomous AI agent status
- Briefing: AI-generated preparedness briefing with P.A.C.E. plan
- Threat Map: Live threat visualization with shelters and evacuation routes
- Survival Guide: Step-by-step emergency procedures
- Settings: Location tracking, email notifications, preferences

## P.A.C.E. Plan Awareness
P.A.C.E. = Primary, Alternate, Contingency, Emergency communication/evacuation plans.
If the user has an active PACE plan in context, reference it when discussing evacuation or communication.

## Key Features You Can Explain
- Voice commands: "add 5 bottles of water", "search for medical supplies"
- ID scanning: Photograph MyKad/passport to add household members
- Image scanning: Photograph items to auto-add to inventory
- Distress signal: One-tap SOS broadcast to all emergency contacts
- AI Agents: Autonomous threat monitoring, inventory analysis, and coordinator

## Malaysian Emergency References
- Police/Ambulance/Fire: 999
- NADMA (Disaster Mgmt): 1800-88-9700
- Civil Defence: 991
- Bomba (Fire & Rescue): 994
- MET Malaysia: met.gov.my
- Flood monitoring: publicinfobanjir.water.gov.my

## Advanced Capabilities
- Calculate survival windows from inventory data (water: 3L/person/day, food: 2000kcal/person/day)
- Cross-reference MET warnings with user location for proximity-based urgency
- Recommend specific evacuation routes based on disaster type and Malaysian geography
- Assess household vulnerability (children under 5, elderly over 65, mobility-limited members)
- Generate time-critical action sequences with priority ordering

## Rules
- Never fabricate inventory data — if user asks about specific items without context, say so
- Don't diagnose medical conditions — refer to emergency services
- Always err on the side of caution during active threats
- When uncertain about threat severity, assume the WORST case and advise accordingly
- Reference specific Malaysian locations, roads, and landmarks when giving evacuation advice"""


def _build_situational_context(context: Optional[dict]) -> str:
    """Build a rich situational context block from the frontend's app state."""
    if not context:
        return ""

    parts = []
    now_myt = datetime.now(MYT)
    parts.append(f"Current time: {now_myt.strftime('%Y-%m-%d %H:%M MYT')} ({now_myt.strftime('%A')})")

    # Monsoon season awareness
    month = now_myt.month
    if month in (11, 12, 1, 2, 3):
        parts.append("Season: Northeast Monsoon (Nov–Mar) — PEAK FLOOD RISK PERIOD for east coast Peninsular Malaysia, Sabah, Sarawak")
    elif month in (5, 6, 7, 8, 9):
        parts.append("Season: Southwest Monsoon (May–Sep) — drier for most of Peninsular Malaysia, but Sabah west coast can see heavy rain")
    else:
        parts.append("Season: Inter-monsoon transition — scattered thunderstorms and localized heavy rain possible")

    # Threat level
    threat = context.get("threat_status", "")
    if threat:
        parts.append(f"⚠️ CURRENT THREAT LEVEL: {threat.upper()}")

    # Readiness score
    score = context.get("readiness_score")
    if score is not None:
        label = "CRITICAL" if score < 30 else "LOW" if score < 50 else "MODERATE" if score < 75 else "GOOD"
        parts.append(f"Household readiness: {score}% ({label})")

    # Live weather data
    weather = context.get("weather")
    if weather:
        if isinstance(weather, dict):
            loc = weather.get("location", "Unknown")
            condition = weather.get("condition", "Unknown")
            temp = weather.get("temperature", "")
            parts.append(f"Current weather at {loc}: {condition}, {temp}")
        elif isinstance(weather, str):
            parts.append(f"Current weather: {weather}")

    # MET warnings
    warnings = context.get("met_warnings")
    if warnings:
        if isinstance(warnings, list):
            for w in warnings[:3]:
                if isinstance(w, dict):
                    parts.append(f"🚨 MET WARNING: {w.get('heading', w.get('title', 'Active warning'))}")
                else:
                    parts.append(f"🚨 MET WARNING: {w}")
        elif isinstance(warnings, str):
            parts.append(f"🚨 MET WARNING: {warnings}")

    # Inventory summary
    inventory = context.get("inventory")
    if inventory and isinstance(inventory, list):
        total_items = len(inventory)
        low_stock = [i for i in inventory if isinstance(i, dict) and
                     i.get("current_amount", 0) < i.get("target_amount", 1) * 0.3]
        inv_summary = ", ".join(
            f"{i.get('name', '?')} ({i.get('current_amount', 0)}/{i.get('target_amount', 0)} {i.get('unit', '')})"
            for i in inventory[:12]
        )
        parts.append(f"Inventory ({total_items} items): {inv_summary}")
        if low_stock:
            low_names = ", ".join(i.get("name", "?") for i in low_stock[:5])
            parts.append(f"⚠️ LOW STOCK items: {low_names}")

    # Team/household data
    team = context.get("team")
    if team and isinstance(team, list):
        members = []
        for m in team[:8]:
            if isinstance(m, dict):
                name = m.get("name", "Unknown")
                role = m.get("role", "member")
                age = m.get("age")
                age_str = f", age {age}" if age else ""
                members.append(f"{name} ({role}{age_str})")
        if members:
            parts.append(f"Household ({len(team)} members): {', '.join(members)}")
            # Flag vulnerable members
            vulnerable = [m for m in team if isinstance(m, dict) and
                          (m.get("age") and (m.get("age", 30) < 5 or m.get("age", 30) > 65))]
            if vulnerable:
                v_names = ", ".join(m.get("name", "?") for m in vulnerable)
                parts.append(f"⚠️ Vulnerable members (children/elderly): {v_names}")

    # PACE plan
    pace = context.get("pace")
    if pace and isinstance(pace, dict):
        parts.append(f"Active PACE Plan — Primary: {pace.get('primary', 'Not set')}, "
                     f"Alternate: {pace.get('alternate', 'Not set')}, "
                     f"Emergency: {pace.get('emergency', 'Not set')}")

    # Location
    location = context.get("location")
    if location:
        parts.append(f"User location: {location}")

    if not parts:
        return ""

    return "\n\n--- CURRENT SITUATION (LIVE DATA) ---\n" + "\n".join(parts)


# ═══════════════════════════════════════════════════════════════════════════════
# ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/message", response_model=ChatResponse)
async def chat_message(
    req: ChatRequest,
    user: Optional[AuthUser] = Depends(get_optional_user),
):
    """Send a message to the AI chatbot and receive a situationally-aware response.

    Works for both authenticated and unauthenticated users.
    Authenticated users get personalized context; anonymous users get general guidance.
    """
    client = get_groq_client()
    model = get_model()

    # Build adaptive system prompt
    system_prompt = CHATBOT_SYSTEM_PROMPT

    # Inject situational context
    situational_block = _build_situational_context(req.context)
    if situational_block:
        system_prompt += situational_block

    # Add auth status context
    if user:
        system_prompt += f"\n\nUser: {user.email} (authenticated, role: {user.app_role})"
    else:
        system_prompt += "\n\nUser: Anonymous (not signed in). They can still use the dashboard in demo mode."

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
            max_tokens=1200,
        )
        reply = response.choices[0].message.content.strip()

        # Detect intent for frontend quick-actions
        intent = _detect_intent(req.message)

        # Generate situational suggestions
        suggestions = _generate_situational_suggestions(intent, req.context)

        return ChatResponse(
            reply=reply,
            suggestions=suggestions,
            intent=intent,
        )

    except Exception as e:
        logger.error(f"Chatbot error: {e}")
        error_str = str(e).lower()

        if "429" in str(e) or "rate" in error_str:
            mark_rate_limited(model)
            # Try fallback model
            fallback = get_fallback_model(model)
            try:
                response = client.chat.completions.create(
                    model=fallback,
                    messages=messages,
                    temperature=0.6,
                    max_tokens=600,
                )
                reply = response.choices[0].message.content.strip()
                intent = _detect_intent(req.message)
                return ChatResponse(
                    reply=reply,
                    suggestions=_generate_situational_suggestions(intent, req.context),
                    intent=intent,
                )
            except Exception:
                raise HTTPException(status_code=429, detail="AI service busy. Please try again in a moment.")

        raise HTTPException(status_code=500, detail="Chatbot temporarily unavailable. Please try again.")


@router.get("/suggestions")
async def get_suggestions(
    user: Optional[AuthUser] = Depends(get_optional_user),
):
    """Get contextual quick-action suggestions. Works without auth."""
    base_suggestions = [
        "What's my current threat level?",
        "How prepared am I for a flood?",
        "What supplies should I stock up on?",
        "How do I use the voice commands?",
        "Explain the P.A.C.E. plan",
    ]

    if user and user.is_admin:
        base_suggestions.extend([
            "How do I manage user roles?",
            "Show system health status",
        ])

    return {"suggestions": base_suggestions}


# ═══════════════════════════════════════════════════════════════════════════════
# INTENT DETECTION — Enhanced
# ═══════════════════════════════════════════════════════════════════════════════

def _detect_intent(message: str) -> str:
    """Enhanced keyword-based intent detection with priority ordering."""
    lower = message.lower()

    # Emergency intent takes priority
    if any(w in lower for w in ["emergency", "flood", "banjir", "evacuate", "danger",
                                 "alert", "999", "sos", "tsunami", "landslide", "tanah runtuh"]):
        return "emergency"

    # Weather/threat queries
    if any(w in lower for w in ["weather", "cuaca", "rain", "hujan", "storm", "ribut",
                                 "threat", "warning", "met", "monsoon"]):
        return "weather"

    # Inventory management
    if any(w in lower for w in ["inventory", "stock", "supply", "supplies", "add", "remove",
                                 "water", "food", "medical", "expir", "stok", "bekalan"]):
        return "inventory_query"

    # Team/household
    if any(w in lower for w in ["family", "keluarga", "member", "household", "team",
                                 "dependent", "child", "elderly", "contact"]):
        return "team"

    # PACE plan
    if any(w in lower for w in ["pace", "evacuation", "plan", "route", "shelter",
                                 "contingency", "primary", "alternate"]):
        return "pace"

    # Navigation/features
    if any(w in lower for w in ["navigate", "where", "how to", "find", "page", "tab",
                                 "menu", "feature", "bagaimana"]):
        return "navigation"

    # Voice/scan features
    if any(w in lower for w in ["voice", "speak", "command", "microphone", "mic",
                                 "scan", "camera", "photo", "image"]):
        return "feature_help"

    # Admin
    if any(w in lower for w in ["admin", "role", "user management", "permission"]):
        return "admin_help"

    return "general"


def _generate_situational_suggestions(intent: str, context: Optional[dict] = None) -> List[str]:
    """Generate suggestions that adapt to the current threat level and situation."""
    # Check threat level from context
    threat = ""
    readiness = None
    if context:
        threat = (context.get("threat_status") or "").lower()
        readiness = context.get("readiness_score")

    # During active threats, prioritize safety actions
    if threat in ("red alert", "danger", "severe", "critical"):
        return [
            "What should I do RIGHT NOW?",
            "Show evacuation routes near me",
            "How do I send an SOS to my contacts?",
        ]

    if threat in ("elevated", "warning", "moderate"):
        return [
            "What should I prepare before it gets worse?",
            "Are my supplies enough for 3 days?",
            "How do I activate emergency alerts?",
        ]

    # Low readiness — push preparation
    if readiness is not None and readiness < 50:
        return [
            "What am I missing in my supplies?",
            "What's the minimum I need to survive 3 days?",
            "How do I quickly improve my readiness?",
        ]

    # Intent-specific suggestions for calm periods
    suggestions_map = {
        "emergency": [
            "What are the emergency numbers in Malaysia?",
            "How do I send an SOS to all contacts?",
            "What should I do during a flash flood?",
        ],
        "weather": [
            "Is there a flood warning in my area?",
            "When is the next monsoon season?",
            "How does MET Malaysia data work in the app?",
        ],
        "inventory_query": [
            "What items are running low?",
            "How do I scan items with my camera?",
            "What's the minimum supply for a family of 4?",
        ],
        "team": [
            "How do I add family members?",
            "How do I set emergency contacts?",
            "Can I scan a MyKad to add someone?",
        ],
        "pace": [
            "Explain the P.A.C.E. plan in simple terms",
            "How do I update my evacuation routes?",
            "Where are the nearest shelters?",
        ],
        "navigation": [
            "Take me to the Threat Map",
            "How do I access the Survival Guide?",
            "Where can I see my readiness score?",
        ],
        "feature_help": [
            "What voice commands are supported?",
            "How do I scan my MyKad?",
            "Can I scan multiple items at once?",
        ],
        "admin_help": [
            "How do I promote a user to admin?",
            "Where is the system health dashboard?",
            "How do I view the audit log?",
        ],
        "general": [
            "What can you help me with?",
            "How prepared am I for an emergency?",
            "What's happening with the weather?",
        ],
    }
    return suggestions_map.get(intent, suggestions_map["general"])
