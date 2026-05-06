"""MyResilience Agents — Groq SDK with High-Precision System Prompts."""
import asyncio
import json
from typing import List, Optional
from pydantic import BaseModel
from app.agents.config import get_groq_client, get_model, get_fallback_model, mark_rate_limited, NOTIFICATION_EMAIL
from app.agents.gmail_tools import send_email


# ══════════════════════════════════════════════════════════════
# OUTPUT SCHEMAS
# ══════════════════════════════════════════════════════════════

class WeatherAssessmentResult(BaseModel):
    severity: str
    disaster_type: str
    expected_impact: str
    time_to_impact_hours: Optional[float] = None


class SurvivalResult(BaseModel):
    survival_score_days: float
    evacuation_urgency: str
    missing_critical_items: List[str]
    reasoning: str


class CoordinatorResult(BaseModel):
    action_taken: str
    subject_drafted: str
    message_drafted: str
    contacts_notified: List[str]


class InventoryAnalysisResult(BaseModel):
    survival_days_water: float
    survival_days_food: float
    overall_days: float
    readiness_score: int
    low_stock_items: List[str]
    expiring_soon_items: List[str]
    critical_gaps: List[str]
    recommendations: List[str]
    summary: str
    reasoning: str


class PACEPlanResult(BaseModel):
    primary: str
    alternate: str
    contingency: str
    emergency: str
    reasoning: str


# ══════════════════════════════════════════════════════════════
# GROQ HELPER
# ══════════════════════════════════════════════════════════════

def _call_groq_sync(system_prompt: str, user_prompt: str, max_tokens: int = 1500) -> dict:
    import time
    client = get_groq_client()

    def _do_call(model_name=None):
        model = model_name or get_model()
        # qwen3 uses a "thinking" mode by default — disable it for JSON responses
        # to prevent empty completions and json_validate_failed errors
        extra_kwargs = {}
        if "qwen" in model.lower():
            extra_kwargs["reasoning_effort"] = "none"

        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.15,
            max_tokens=max_tokens,
            response_format={"type": "json_object"},
            **extra_kwargs,
        )
        content = resp.choices[0].message.content
        if not content or not content.strip():
            raise ValueError(f"[Groq] Empty response from {model} — likely thinking-mode issue")
        print(f"[Groq] ✅ Call succeeded on model: {model}")
        return json.loads(content.strip())

    # Attempt primary model
    current_model = get_model()
    try:
        return _do_call(current_model)
    except Exception as e:
        err_str = str(e).lower()
        if "429" in err_str or "rate_limit" in err_str or "too many requests" in err_str:
            # TPD (tokens per day) = 24h cooldown; RPM = 60s cooldown
            is_tpd = "tokens per day" in err_str or "tpd" in err_str
            cooldown = 86400 if is_tpd else 60
            mark_rate_limited(model=current_model, cooldown_seconds=cooldown)
            fallback = get_fallback_model(current_model)
            print(f"[Groq] Cascading: {current_model} → {fallback} (cooldown={'24h TPD' if is_tpd else '60s RPM'})")
        elif "json_validate_failed" in err_str or "400" in err_str or "empty response" in err_str.lower():
            # Model returned malformed/empty JSON — cascade to next model
            fallback = get_fallback_model(current_model)
            print(f"[Groq] Cascading: {current_model} → {fallback} (reason: JSON validation failed)")
        else:
            raise
        time.sleep(1)
        try:
            return _do_call(fallback)
        except Exception as e2:
            err2 = str(e2).lower()
            if "429" in err2 or "rate_limit" in err2:
                is_tpd2 = "tokens per day" in err2 or "tpd" in err2
                cooldown2 = 86400 if is_tpd2 else 60
                mark_rate_limited(model=fallback, cooldown_seconds=cooldown2)
                last_resort = get_fallback_model(fallback)
                print(f"[Groq] Cascading: {fallback} → {last_resort} (cooldown={'24h TPD' if is_tpd2 else '60s RPM'})")
            elif "json_validate_failed" in str(e2).lower() or "400" in str(e2) or "empty response" in str(e2).lower():
                last_resort = get_fallback_model(fallback)
                print(f"[Groq] Cascading: {fallback} → {last_resort} (reason: JSON validation failed)")
            else:
                raise
            time.sleep(1)
            return _do_call(last_resort)




async def _call_groq(system_prompt: str, user_prompt: str, max_tokens: int = 1500) -> dict:
    return await asyncio.to_thread(_call_groq_sync, system_prompt, user_prompt, max_tokens)


# ══════════════════════════════════════════════════════════════
# AGENT SYSTEM PROMPTS
# ══════════════════════════════════════════════════════════════

WATCHER_PROMPT = """ROLE: You are the Watcher — a real-time meteorological threat detection agent. Your ONLY responsibility is to parse raw weather data and classify the current threat level. You do NOT assess survival capability, generate plans, or recommend actions. You are the first node in the agent pipeline.

TASK:
1. Parse the weather payload. Note that the data may be from MET Malaysia in Malay or contain official government warnings (prefixed with 'OFFICIAL WARNING:').
2. Identify the primary disaster type from the alert list or current conditions summary.
3. Classify severity using the following thresholds:
   - critical: alert type contains 'Red' or 'Bahaya' or 'OFFICIAL WARNING' indicating severe conditions (heavy rain/strong winds) with immediate impact.
   - warning: precipitation >= 50mm/h OR wind >= 60km/h OR alert type contains 'Yellow' or 'Orange' OR summary contains 'Ribut petir' (Thunderstorm) or 'Hujan lebat' or 'Berjerebu' (Haze).
   - info: any other official advisory or summary containing 'Hujan' (Rain).
   - normal: no alerts, summary is 'Tiada hujan' (No rain), precipitation < 10mm/h.
4. Extract time_to_impact_hours from alerts[0].estimated_onset_hours. If no alerts, return null.
5. Summarize the ground-level human impact in one concise sentence. For 'Berjerebu', mention visibility issues and respiratory risks.

OUTPUT (STRICT JSON — no markdown, no extra keys):
{
  "severity": "<critical|warning|info|normal>",
  "disaster_type": "<flood|storm|heatwave|earthquake|fire|haze|none>",
  "expected_impact": "<one sentence describing what residents will experience>",
  "time_to_impact_hours": <float or null>
}

RULES:
- Return exactly these 4 keys. No additions, no omissions.
- If time_to_impact_hours cannot be determined, return null. Do NOT guess.
- If multiple alerts exist, prioritize the one with the highest severity.
- Do NOT issue evacuation orders or survival calculations.
- Do NOT return markdown, code fences, or explanatory text.
- If the payload is empty or malformed, return severity=normal, disaster_type=none.

BEHAVIOR:
- Think like an operational meteorologist reading raw telemetry.
- Ambiguity will break downstream agents — prioritize precision.
- When uncertain about severity, round UP to the more severe tier."""


ASSESSOR_PROMPT = """ROLE: You are the Assessor — a survival tactician evaluating a household's ability to survive an identified threat. You do NOT generate plans, send alerts, or evaluate inventory gaps in detail. You produce a single survival verdict with numerical precision.

TASK:
1. Calculate water survival days: Sum all Water category items (Liters). Divide by (household_size * 3).
2. Calculate food survival days: Sum all Food category items. Divide by (household_size * 2) servings/day.
3. Set survival_score_days = min(water_days, food_days).
4. Apply this EXACT decision tree for evacuation_urgency:
   - IF severity == 'critical' AND time_to_impact_hours <= 12: urgency = 'immediate'
   - ELSE IF severity == 'critical' OR (severity == 'warning' AND survival_score_days < 3): urgency = 'prepare'
   - ELSE IF severity == 'warning' OR severity == 'info': urgency = 'shelter_in_place'
   - ELSE: urgency = 'none'
   - IF time_to_impact_hours is null, treat as unknown — default to 'prepare' for critical, 'shelter_in_place' for warning.
   - MOBILITY OVERRIDE: If any team member has remarks indicating severe mobility issues (e.g. wheelchair, elderly, asthma) AND severity is 'warning' or 'critical', escalate urgency by one level (e.g. shelter_in_place -> prepare).
5. List missing_critical_items: Zero-stock items critical for the specific disaster_type (flood: flashlight, rope, waterproof bags; storm: radio, batteries; heatwave: water, electrolytes; medical issues: First Aid Kit).
6. Write one sentence of reasoning citing specific numbers from your calculation, and mention any mobility or medical constraints found in the team's remarks.

OUTPUT (STRICT JSON — no markdown, no extra keys):
{
  "survival_score_days": <float, 2 decimal places>,
  "evacuation_urgency": "<immediate|prepare|shelter_in_place|none>",
  "missing_critical_items": ["<string>"],
  "reasoning": "<one sentence citing specific numbers>"
}

RULES:
- Follow the 4-step decision tree exactly. Do NOT override it with judgment.
- survival_score_days must be computed, NOT estimated.
- Do NOT draft messages, suggest contacts, or propose plans.
- Do NOT return markdown or extra text.

BEHAVIOR:
- Think like a military logistics officer under time pressure. Be cold, numerical, precise.
- Your reasoning must cite specific values (e.g., '3.3 days water for 2 people, critical flood in 2.5h = immediate.')."""


PACE_PROMPT = """ROLE: You are the P.A.C.E. Strategist — a tactical survival planner generating a four-tier contingency doctrine tailored to this specific household. P.A.C.E. = Primary, Alternate, Contingency, Emergency. You do NOT assess threats or calculate survival days. You produce an actionable static doctrine.

TASK:
1. Assess mobility constraints from team (elderly >65 or children <12 affect evacuation complexity).
2. Assess available resources from inventory (power backup, water >= 3 days, medical supplies present?).
3. Generate P.A.C.E. plan — each tier assumes the previous tier has FAILED:
   - Primary: Optimal action using all available resources and contacts.
   - Alternate: Second-best option if Primary route or resource is blocked.
   - Contingency: Degraded fallback when infrastructure fails (no vehicle, no roads).
   - Emergency: Last-resort survival when all else has failed.
4. Each tier must be specific to the location and inventory. Reference actual item names or quantities.
5. Write reasoning explaining the strategic logic behind this specific P.A.C.E. sequence.

OUTPUT (STRICT JSON — no markdown, no extra keys):
{
  "primary": "<1-2 tactical sentences>",
  "alternate": "<1-2 tactical sentences>",
  "contingency": "<1-2 tactical sentences>",
  "emergency": "<1-2 tactical sentences>",
  "reasoning": "<2-3 sentences explaining why this sequence fits this household>"
}

RULES:
- Each tier MUST assume the previous has failed — no repeated actions across tiers.
- Reference specific inventory items (e.g., 'Deploy the 10L water reserve') or team roles.
- If elderly or children present, Primary must account for slower evacuation.
- Do NOT generate threat assessments or survival day calculations.
- Do NOT return markdown or extra text.

BEHAVIOR:
- Think like a CERT trainer briefing a household on their tailored doctrine.
- Every sentence must be actionable within 60 seconds of reading it.
- The plan must be internally consistent (if Primary needs a vehicle, Alternate must not also require one)."""


INVENTORY_PROMPT = """ROLE: Inventory Analyst. Audit emergency supply state. Do NOT assess threats or issue evacuation orders.

INPUTS: inventory (list of {name, category, unit, current_amount, target_amount, expiry_date}), team (list of {name, age, role}).

COMPUTE:
1. household_size = count of team members with role='family' (min 1).
2. survival_days_water = sum of Water category items (Liters) / (household_size * 3).
3. survival_days_food = sum of Food items / (household_size * 2).
4. overall_days = min(water_days, food_days).
5. readiness_score (start 100, subtract): -20 if water<3d, -20 if food<3d, -15 if no Medical stock, -15 if no Power stock, -10 if any item current/target < 0.30, -5 if any item expires within 30 days. Floor: 0.
6. low_stock_items = item names where current_amount/target_amount < 0.40 AND target_amount > 0.
7. expiring_soon_items = item names with expiry_date within 30 days of today.
8. critical_gaps = category names entirely absent from inventory (check: Water, Food, Medical, Power, Shelter, Tools).
9. Exactly 3 recommendations ordered by highest impact on overall_days.
10. 1-2 sentence summary of preparedness posture.
11. reasoning = step-by-step arithmetic for steps 2-5.

OUTPUT (STRICT JSON, no extra keys):
{"survival_days_water":<float>,"survival_days_food":<float>,"overall_days":<float>,"readiness_score":<int>,"low_stock_items":["<str>"],"expiring_soon_items":["<str>"],"critical_gaps":["<str>"],"recommendations":["<str>","<str>","<str>"],"summary":"<str>","reasoning":"<str>"}

RULES: recommendations = exactly 3. critical_gaps = category names only. Empty inventory = all zeros, all 6 categories in critical_gaps. No markdown."""


COORDINATOR_PROMPT = """ROLE: You are the Coordinator — the sole agent authorized to issue communications. You operate on a strict 3-mode PLAYBOOK (Preparedness, Advisory, Emergency). You receive data from the Watcher, Assessor, and Inventory Analyst.

TASK:
1. Determine your PLAYBOOK MODE:
   - If 'inventory_analysis' is provided and 'weather' is missing/normal: MODE = PREPAREDNESS.
   - If 'weather' has warning/info AND 'evacuation_urgency' is shelter_in_place/none: MODE = ADVISORY.
   - If 'evacuation_urgency' is immediate/prepare: MODE = EMERGENCY.
2. Apply this EXACT dispatch decision tree based on MODE:
   - PREPAREDNESS: action_taken = 'user_email_sent'
   - ADVISORY: action_taken = 'user_email_sent'
   - EMERGENCY: action_taken = 'emergency_email_sent'
3. Draft `subject_drafted` and `message_drafted` EXACTLY matching the following templates for your MODE. Do not deviate from the structure. Populate the {{variables}} with actual data from your context:

--- MODE: PREPAREDNESS ---
SUBJECT: ⚠️ Household Preparedness Update: {{alert_title}}

BODY:
Hi {{user_name}},

This is your automated household preparedness report.
We’ve reviewed your current inventory and identified areas that need attention.

---

📊 Key Findings:
- Water supply: {{water_days_remaining}} days remaining
- Food supply: {{food_days_remaining}} days remaining
- Medical supplies: {{medical_status}}
- Expiring items: {{expiring_items}}

---

⚠️ Risk Summary:
{{risk_summary}}

---

🛠️ Recommended Actions:
{{recommendations}}

---

💡 Suggested Purchase Plan:
{{purchase_suggestions}}

---

Maintaining these improvements will significantly increase your resilience in emergency situations.
Stay prepared.

— MyResilience System
-------------------------

--- MODE: ADVISORY ---
SUBJECT: ⚠️ Weather Alert: {{disaster_type}} Risk Detected in Your Area

BODY:
Hi {{user_name}},

A potential environmental threat has been detected near your location in {{location}}.

---

🌩️ Situation Overview:
- Disaster Type: {{disaster_type}}
- Severity: {{severity}}
- Estimated Impact Time: {{time_to_impact_hours}} hours
- Trend: {{trend}}

---

📍 Recommended Actions:
{{recommended_actions}}

---

🧭 System Guidance:
{{system_guidance}}

---

⚠️ Important:
Please stay alert for further updates. Conditions may escalate quickly.
We will notify you immediately if the situation worsens.

— MyResilience System
-------------------------

--- MODE: EMERGENCY ---
SUBJECT: 🚨 Emergency Alert: Immediate Evacuation in Progress ({{user_name}})

BODY:
This is an automated emergency notification from the Resilience System.
A critical situation has been detected involving {{user_name}}.

---

🚨 Current Situation:
- Location: {{location}}
- Event: {{disaster_type}}
- Severity: CRITICAL
- Time to impact: Immediate / {{time_to_impact_hours}} hours
- Status: Emergency evacuation initiated

---

👤 User Status:
{{user_status}}

---

🧭 Evacuation Plan:
{{evacuation_plan_summary}}
- Route: {{evacuation_route}}
- Destination: {{safe_zone}}
- Priority: Life safety and immediate evacuation

---

⚠️ Message to Contacts:
{{contact_message}}

The user has been advised to evacuate immediately. This message is sent to ensure awareness in case direct communication is not possible.
Please do not delay evacuation by attempting prolonged contact.

---

— Emergency Coordination System
-------------------------

4. contacts_notified = list of contact names IF action_taken == 'emergency_email_sent'. Otherwise, return [].

OUTPUT (STRICT JSON — no markdown, no extra keys):
{
  "action_taken": "<emergency_email_sent|user_email_sent|user_notified|none>",
  "subject_drafted": "<string>",
  "message_drafted": "<string — exact body template>",
  "contacts_notified": ["<contact name>"]
}

RULES:
- Follow the templates EXACTLY. Do NOT invent new structure.
- Replace variables like {{user_name}} with the primary family member's name.
- No markdown in the JSON response."""


# ══════════════════════════════════════════════════════════════
# AGENT FUNCTIONS
# ══════════════════════════════════════════════════════════════

async def run_watcher_agent(raw_weather_json: str) -> WeatherAssessmentResult:
    try:
        result = await _call_groq(WATCHER_PROMPT, f"Weather payload:\n{raw_weather_json}")
        return WeatherAssessmentResult(**result)
    except Exception as e:
        print(f"[Watcher] Agent failed: {e}")
        return WeatherAssessmentResult(
            severity="normal",
            disaster_type="none",
            expected_impact="Weather data unavailable. Conditions assumed nominal pending retry.",
            time_to_impact_hours=None
        )


async def run_assessor_agent(weather: WeatherAssessmentResult, inventory: list, team: list) -> SurvivalResult:
    try:
        household_size = len([m for m in team if m.get("role") == "family"]) or 1
        user = f"household_size: {household_size}\nteam: {json.dumps(team)}\nweather: {weather.model_dump_json()}\ninventory: {json.dumps(inventory)}"
        result = await _call_groq(ASSESSOR_PROMPT, user)
        return SurvivalResult(**result)
    except Exception as e:
        print(f"[Assessor] Agent failed: {e}")
        return SurvivalResult(
            survival_score_days=0.0,
            evacuation_urgency="none",
            missing_critical_items=["Analysis unavailable — please retry"],
            reasoning="Assessor agent encountered an error. Survival data could not be computed."
        )


async def run_coordinator_agent(
    weather: Optional[WeatherAssessmentResult] = None, 
    survival: Optional[SurvivalResult] = None, 
    inventory_analysis: Optional[InventoryAnalysisResult] = None,
    team: list = [], 
    location: str = "Malaysia"
) -> CoordinatorResult:
    try:
        contacts = [m for m in team if m.get("role") == "emergency_contact"]
        user = f"location: {location}\ncontacts: {json.dumps([{'name': c['name'], 'email': c.get('email', '')} for c in contacts])}\n"
        if weather:
            user += f"weather: {weather.model_dump_json()}\n"
        if survival:
            user += f"survival: {survival.model_dump_json()}\n"
        if inventory_analysis:
            user += f"inventory_analysis: {inventory_analysis.model_dump_json()}\n"

        result = await _call_groq(COORDINATOR_PROMPT, user)
        coordinator = CoordinatorResult(**result)

        if coordinator.action_taken in ["emergency_email_sent", "user_email_sent"]:
            if coordinator.action_taken == "emergency_email_sent":
                for contact in contacts:
                    email = contact.get("email", "")
                    if email and "@" in email:
                        try:
                            send_email(to=email, subject=coordinator.subject_drafted, body=coordinator.message_drafted)
                        except Exception:
                            pass

                # SMS dispatch to emergency contacts with phone numbers
                try:
                    from app.agents.sms_tools import send_bulk_sms
                    phone_numbers = [
                        m.get("phone", "").strip() for m in team
                        if m.get("role") == "emergency_contact" and m.get("phone", "").strip()
                    ]
                    if phone_numbers:
                        sms_body = f"🚨 MYRESILIENCE EMERGENCY: {coordinator.subject_drafted[:80]}. Evacuate now. Call 999 immediately."
                        send_bulk_sms(phone_numbers, sms_body[:160])
                        print(f"[Coordinator] SMS dispatched to {len(phone_numbers)} contact(s).")
                except Exception as sms_err:
                    print(f"[Coordinator] SMS dispatch failed (non-critical): {sms_err}")
            
            if NOTIFICATION_EMAIL:
                try:
                    send_email(to=NOTIFICATION_EMAIL, subject=coordinator.subject_drafted, body=coordinator.message_drafted)
                except Exception:
                    pass

        return coordinator
    except Exception as e:
        print(f"[Coordinator] Agent failed: {e}")
        return CoordinatorResult(
            action_taken="none",
            subject_drafted="",
            message_drafted="Coordinator agent encountered an error. No communications were dispatched.",
            contacts_notified=[]
        )


async def run_inventory_analysis_agent(inventory: list, team: list) -> InventoryAnalysisResult:
    try:
        user = f"team: {json.dumps(team)}\ninventory: {json.dumps(inventory)}"
        result = await _call_groq(INVENTORY_PROMPT, user, max_tokens=2048)
        return InventoryAnalysisResult(**result)
    except Exception as e:
        print(f"[Inventory Analyst] Agent failed: {e}")
        return InventoryAnalysisResult(
            survival_days_water=0.0,
            survival_days_food=0.0,
            overall_days=0.0,
            readiness_score=0,
            low_stock_items=[],
            expiring_soon_items=[],
            critical_gaps=["Analysis unavailable"],
            recommendations=["Retry the analysis", "Check server logs", "Verify inventory data is complete"],
            summary="Inventory analysis failed. Please retry in a moment.",
            reasoning="Agent call failed — likely an LLM timeout or invalid response."
        )


async def run_pace_agent(inventory: list, team: list, location: str = "Malaysia") -> PACEPlanResult:
    try:
        user = f"location: {location}\nteam: {json.dumps(team)}\ninventory: {json.dumps(inventory)}"
        result = await _call_groq(PACE_PROMPT, user)
        return PACEPlanResult(**result)
    except Exception as e:
        print(f"[P.A.C.E. Strategist] Agent failed: {e}")
        return PACEPlanResult(
            primary="P.A.C.E. plan unavailable. Please retry when the AI service is responsive.",
            alternate="Fallback: Shelter in place, conserve resources, and monitor official broadcasts.",
            contingency="Contact emergency services via phone (999) if situation escalates.",
            emergency="Last resort: Signal for help and move to the nearest evacuation centre.",
            reasoning="P.A.C.E. agent encountered an error. Default survival guidance provided."
        )


# ══════════════════════════════════════════════════════════════
# EVACUATION ADVISOR AGENT
# ══════════════════════════════════════════════════════════════

class ShelterLocation(BaseModel):
    name: str
    address: str
    lat: float
    lng: float
    type: str  # shelter | police | fire | hospital | nadma


class EvacuationAdvisoryResult(BaseModel):
    shelter_locations: List[ShelterLocation]
    enforcement_agencies: List[ShelterLocation]
    areas_to_avoid: List[str]
    routes_to_take: List[str]
    sms_alert_text: str
    reasoning: str


# ── NEW: LLM only generates contextual text — NO GPS coordinates ─────────────
EVAC_CONTEXT_PROMPT = """ROLE: You are the Malaysian National Evacuation Advisor. You provide CONTEXTUAL guidance only — roads, avoidance zones, and SMS text. GPS coordinates are provided separately from official sources.

INPUTS: disaster_type, severity, location, shelter_names (list of real nearby shelters), agency_names (list of real nearby agencies).

TASK:

SECTION 1 — areas_to_avoid (exactly 5 specific local areas/roads to avoid for the given disaster_type and location):
- Use real road names, low-lying areas, river basins, or industrial zones relevant to this location.
- Sabah: reference Jalan Tuaran, Sungai Moyog, coastal areas etc.
- Sarawak: reference Sungai Sarawak, low-lying Jalan Kuching-Samarahan etc.
- Peninsula: reference specific state roads and flood-prone rivers.

SECTION 2 — routes_to_take (exactly 3 evacuation routes specific to this location and disaster):
- Name actual roads that lead away from the threat toward higher ground or the shelters listed.
- Each route should be distinct (not the same road repeated).

SECTION 3 — sms_alert_text (max 160 chars):
"🚨 MYRESILIENCE: [threat] at [location]. Evacuate via [primary road]. Shelter: [first shelter name]. Call 999."

SECTION 4 — reasoning (2-3 sentences citing NADMA/JPS sources explaining why these routes/avoidance zones were chosen).

OUTPUT (STRICT JSON — no markdown, no coordinates):
{
  "areas_to_avoid": ["<str>", "<str>", "<str>", "<str>", "<str>"],
  "routes_to_take": ["<str>", "<str>", "<str>"],
  "sms_alert_text": "<str ≤160 chars>",
  "reasoning": "<2-3 sentences>"
}

RULES: Exactly 5 avoid zones, 3 routes. Use location-specific road names — never use generic placeholders. No GPS coordinates in output. No markdown."""


def _haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Inline haversine — avoids circular import with emergency.py."""
    import math
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _validate_marker_coords(
    markers: list,
    anchor_lat: float,
    anchor_lng: float,
    max_radius_km: float = 60.0
) -> list:
    """
    Post-process AI-generated shelter/agency coordinates.
    Any marker whose GPS is more than max_radius_km from the anchor is zeroed out (lat=0, lng=0).
    The frontend already filters zero-coord markers from the Leaflet map.
    """
    validated = []
    for m in markers:
        if m.lat == 0.0 and m.lng == 0.0:
            validated.append(m)  # Already a known fallback — keep as-is
            continue
        dist = _haversine_km(anchor_lat, anchor_lng, m.lat, m.lng)
        if dist <= max_radius_km:
            validated.append(m)
        else:
            print(f"[Evacuation Advisor] ⚠️  Marker '{m.name}' is {dist:.1f} km from anchor — GPS drift detected, zeroing out.")
            validated.append(ShelterLocation(
                name=m.name,
                address=m.address + " [GPS unverified — check portalbencana.nadma.gov.my]",
                lat=0.0,
                lng=0.0,
                type=m.type
            ))
    return validated


# Malaysian state anchor coordinates for location-string matching
_MY_STATE_ANCHORS = {
    "kota kinabalu": (5.9804, 116.0735), "sabah": (5.9804, 116.0735),
    "sandakan": (5.8402, 118.1179), "tawau": (4.2449, 117.8912),
    "keningau": (5.3363, 116.1637), "ranau": (5.9614, 116.6694),
    "kuching": (1.5497, 110.3625), "sarawak": (1.5497, 110.3625),
    "miri": (4.3995, 113.9914), "sibu": (2.3000, 111.8167),
    "bintulu": (3.1667, 113.0333), "lahad datu": (5.0279, 118.3291),
    "johor bahru": (1.4927, 103.7414), "johor": (1.9344, 103.3587),
    "penang": (5.4141, 100.3288), "georgetown": (5.4141, 100.3288),
    "ipoh": (4.5975, 101.0901), "perak": (4.5975, 101.0901),
    "kota bharu": (6.1254, 102.2381), "kelantan": (5.4000, 102.0000),
    "kuantan": (3.8077, 103.3260), "pahang": (3.8077, 103.3260),
    "alor setar": (6.1184, 100.3679), "kedah": (6.1184, 100.3679),
    "kuala terengganu": (5.3296, 103.1370), "terengganu": (5.3296, 103.1370),
    "seremban": (2.7297, 101.9381), "negeri sembilan": (2.7297, 101.9381),
    "melaka": (2.1896, 102.2501),
    "petaling jaya": (3.1073, 101.6297), "petaling": (3.1073, 101.6297),
    "kuala lumpur": (3.1390, 101.6869), "selangor": (3.0738, 101.5183),
    "putrajaya": (2.9264, 101.6964), "labuan": (5.2831, 115.2308),
    "perlis": (6.4449, 100.2048), "kangar": (6.4449, 100.2048),
}


def _resolve_anchor(location: str, user_lat: Optional[float] = None, user_lng: Optional[float] = None):
    """Return (lat, lng) anchor for coordinate validation. Prefers user GPS over location string."""
    if user_lat is not None and user_lng is not None:
        return user_lat, user_lng
    loc_lower = location.lower()
    for key, coords in _MY_STATE_ANCHORS.items():
        if key in loc_lower:
            return coords
    return None  # Unknown location — skip validation


async def run_evacuation_advisor_agent(
    disaster_type: str,
    severity: str,
    location: str,
    team: list,
    user_lat: Optional[float] = None,
    user_lng: Optional[float] = None,
) -> EvacuationAdvisoryResult:
    """
    Two-tier evacuation advisory:
    Tier 1 — Real GPS positions from OpenStreetMap (Overpass API)
    Tier 2 — LLM generates routes, avoidance zones, SMS text, reasoning

    If OSM returns empty results (no network / no data), falls back to
    LLM-generated positions with coordinate validation.
    """
    import asyncio
    from app.agents.overpass_tools import fetch_real_facilities

    anchor = _resolve_anchor(location, user_lat, user_lng)
    loc = location.split(",")[0].strip() if location else "your area"

    # ── TIER 1: Fetch real positions from OSM ────────────────────────────────
    osm_shelters = []
    osm_agencies = []
    osm_source = "none"

    if anchor:
        try:
            osm_data = await asyncio.to_thread(
                fetch_real_facilities,
                anchor[0], anchor[1],
                n_shelters=3, n_agencies=5, radius_m=15000
            )
            osm_shelters = osm_data["shelter_locations"]
            osm_agencies = osm_data["enforcement_agencies"]
            osm_source = osm_data["source"]
            print(f"[Evacuation Advisor] OSM: {len(osm_shelters)} shelters, {len(osm_agencies)} agencies near {location}")
        except Exception as e:
            print(f"[Evacuation Advisor] OSM fetch failed (non-critical): {e}")

    # ── TIER 2: LLM generates contextual text only (no coordinates) ──────────
    try:
        # Tell LLM which real facilities were found so it can reference them
        shelter_names = [s["name"] for s in osm_shelters] if osm_shelters else [f"PPS {loc}"]
        agency_names = [a["name"] for a in osm_agencies] if osm_agencies else []

        user_prompt = (
            f"disaster_type: {disaster_type}\n"
            f"severity: {severity}\n"
            f"location: {location}\n"
            f"shelter_names: {json.dumps(shelter_names)}\n"
            f"agency_names: {json.dumps(agency_names)}\n"
            f"team_size: {len(team)}"
        )
        context_result = await _call_groq(EVAC_CONTEXT_PROMPT, user_prompt, max_tokens=800)

        areas_to_avoid = context_result.get("areas_to_avoid", [])
        routes_to_take = context_result.get("routes_to_take", [])
        sms_text = context_result.get("sms_alert_text",
            f"🚨 MYRESILIENCE: {disaster_type.capitalize()} at {loc}. Evacuate to nearest PPS. Call 999. portalbencana.nadma.gov.my")
        reasoning = context_result.get("reasoning",
            f"Advisory generated for {location}. Facility positions sourced from OpenStreetMap. Visit portalbencana.nadma.gov.my for live PPS status.")

    except Exception as e:
        print(f"[Evacuation Advisor] LLM context call failed: {e}")
        areas_to_avoid = [
            f"Kawasan rendah berhampiran sungai di {loc}",
            "Jalan yang banjir atau dinaiki air",
            "Kawasan pembinaan semasa hujan lebat",
            "Laluan bawah tanah / underpass semasa banjir",
            "Pantai atau kawasan pesisir semasa ribut"
        ]
        routes_to_take = [
            f"Ikut jalan utama ke kawasan tinggi berhampiran {loc}",
            "Gunakan laluan alternatif yang disyorkan oleh pihak berkuasa tempatan",
            "Hubungi 999 atau 991 (Bomba) untuk bantuan pemindahan"
        ]
        sms_text = f"🚨 MYRESILIENCE: {disaster_type.capitalize()} at {loc}. Evacuate to nearest PPS. Call 999. portalbencana.nadma.gov.my"
        reasoning = f"Context agent unavailable. Facility positions sourced from OpenStreetMap. Visit portalbencana.nadma.gov.my or call 999 for live shelter info."

    # ── Build final shelter/agency lists ─────────────────────────────────────
    if osm_shelters:
        # Use real OSM positions
        shelters = [ShelterLocation(**s) for s in osm_shelters]
    else:
        # OSM empty — use named fallbacks with lat=0/lng=0 (frontend shows address-only cards)
        shelters = [
            ShelterLocation(name=f"Pusat Pemindahan Sementara (PPS) {loc}", address="Semak: portalbencana.nadma.gov.my", lat=0.0, lng=0.0, type="shelter"),
            ShelterLocation(name=f"Dewan Olahraga / Balai Raya {loc}", address=f"Hubungi PBT tempatan di {loc}", lat=0.0, lng=0.0, type="shelter"),
            ShelterLocation(name=f"Sekolah Kebangsaan Terdekat, {loc}", address=f"Semak dengan JKM {loc}", lat=0.0, lng=0.0, type="shelter"),
        ]
        print(f"[Evacuation Advisor] ⚠️  OSM returned 0 shelters for {location} — using named fallbacks")

    if osm_agencies:
        agencies = [ShelterLocation(**a) for a in osm_agencies]
    else:
        agencies = [
            ShelterLocation(name=f"Balai Polis {loc}", address=f"{loc}", lat=0.0, lng=0.0, type="police"),
            ShelterLocation(name=f"Balai Bomba dan Penyelamat {loc}", address=f"{loc}", lat=0.0, lng=0.0, type="fire"),
            ShelterLocation(name=f"Hospital Kerajaan {loc}", address=f"{loc}", lat=0.0, lng=0.0, type="hospital"),
            ShelterLocation(name=f"Pejabat JKM {loc}", address=f"{loc}", lat=0.0, lng=0.0, type="nadma"),
            ShelterLocation(name="NADMA Negeri", address="portalbencana.nadma.gov.my", lat=0.0, lng=0.0, type="nadma"),
        ]

    reasoning_with_source = (
        f"[OSM: {osm_source.upper()}] " + reasoning
        if osm_source == "osm" else reasoning
    )

    return EvacuationAdvisoryResult(
        shelter_locations=shelters,
        enforcement_agencies=agencies,
        areas_to_avoid=areas_to_avoid,
        routes_to_take=routes_to_take,
        sms_alert_text=sms_text,
        reasoning=reasoning_with_source
    )


# ══════════════════════════════════════════════════════════════
# MERGED AGENT 1: THREAT ASSESSOR (Watcher + Assessor in 1 call)
# Replaces: run_watcher_agent + run_assessor_agent
# Token savings: ~750 tokens per poll cycle (~65% reduction)
# ══════════════════════════════════════════════════════════════

class ThreatAssessmentResult(BaseModel):
    # Weather fields (from Watcher)
    severity: str
    disaster_type: str
    expected_impact: str
    time_to_impact_hours: Optional[float] = None
    # Survival fields (from Assessor)
    survival_score_days: float
    evacuation_urgency: str
    missing_critical_items: List[str]
    reasoning: str


THREAT_ASSESSOR_PROMPT = """ROLE: You are the ThreatAssessor — a combined meteorological and survival analyst. You parse weather data AND evaluate household survival in a single step. This replaces two separate agents to save API quota.

PHASE 1 — WEATHER CLASSIFICATION:
Parse the weather payload (may be in Malay from MET Malaysia or contain 'OFFICIAL WARNING:' prefixes).
1. Identify primary disaster type.
2. Classify severity:
   - critical: 'Red'/'Bahaya'/'OFFICIAL WARNING' with severe conditions or immediate impact.
   - warning: precip ≥50mm/h OR wind ≥60km/h OR 'Yellow'/'Orange' OR 'Ribut petir'/'Hujan lebat'/'Berjerebu'.
   - info: any other advisory or 'Hujan' mention.
   - normal: 'Tiada hujan', no alerts, precip <10mm/h.
3. Extract time_to_impact_hours from alerts[0].estimated_onset_hours (null if absent).
4. Write one sentence describing human-level impact.

PHASE 2 — SURVIVAL ASSESSMENT:
Using the inventory and team provided:
1. household_size = count of team members with role='family' (min 1).
2. water_days = sum of Water items (Liters) / (household_size × 3).
3. food_days = sum of Food items / (household_size × 2).
4. survival_score_days = min(water_days, food_days), 2 decimal places.
5. evacuation_urgency decision tree (follow EXACTLY):
   - IF severity == 'critical' AND time_to_impact_hours ≤ 12 → 'immediate'
   - ELSE IF severity == 'critical' OR (severity == 'warning' AND survival_score_days < 3) → 'prepare'
   - ELSE IF severity == 'warning' OR severity == 'info' → 'shelter_in_place'
   - ELSE → 'none'
   - MOBILITY OVERRIDE: If any team member has severe mobility issues AND severity is warning/critical → escalate urgency one level.
6. missing_critical_items: zero-stock critical items for the disaster_type (flood→flashlight/rope/waterproof bags; storm→radio/batteries; heatwave→water/electrolytes).
7. reasoning: one sentence citing specific numbers (e.g. '2.1 days water for 3 people, warning flood → prepare.').

OUTPUT (STRICT JSON — no markdown, no extra keys):
{
  "severity": "<critical|warning|info|normal>",
  "disaster_type": "<flood|storm|heatwave|earthquake|fire|haze|none>",
  "expected_impact": "<one sentence>",
  "time_to_impact_hours": <float or null>,
  "survival_score_days": <float 2dp>,
  "evacuation_urgency": "<immediate|prepare|shelter_in_place|none>",
  "missing_critical_items": ["<string>"],
  "reasoning": "<one sentence with numbers>"
}

RULES: Return exactly these 8 keys. No markdown. If payload empty/malformed → severity=normal, disaster_type=none, urgency=none."""


async def run_threat_assessor_agent(
    raw_weather_json: str,
    inventory: list,
    team: list
) -> ThreatAssessmentResult:
    """Single Groq call replacing run_watcher_agent + run_assessor_agent."""
    try:
        household_size = len([m for m in team if m.get("role") == "family"]) or 1
        user = (
            f"Weather payload:\n{raw_weather_json}\n\n"
            f"household_size: {household_size}\n"
            f"team: {json.dumps(team)}\n"
            f"inventory: {json.dumps(inventory)}"
        )
        result = await _call_groq(THREAT_ASSESSOR_PROMPT, user, max_tokens=600)
        return ThreatAssessmentResult(**result)
    except Exception as e:
        print(f"[ThreatAssessor] Agent failed: {e}")
        return ThreatAssessmentResult(
            severity="normal",
            disaster_type="none",
            expected_impact="Assessment unavailable. Conditions assumed nominal pending retry.",
            time_to_impact_hours=None,
            survival_score_days=0.0,
            evacuation_urgency="none",
            missing_critical_items=["Analysis unavailable — please retry"],
            reasoning="ThreatAssessor encountered an error. Check Groq quota."
        )


# ══════════════════════════════════════════════════════════════
# MERGED AGENT 2: PREPAREDNESS BRIEFING (Inventory + PACE in 1 call)
# Replaces: run_inventory_analysis_agent + run_pace_agent
# Token savings: ~1000 tokens per on-demand trigger
# ══════════════════════════════════════════════════════════════

class PreparednessBriefingResult(BaseModel):
    # Inventory fields
    survival_days_water: float
    survival_days_food: float
    overall_days: float
    readiness_score: int
    low_stock_items: List[str]
    expiring_soon_items: List[str]
    critical_gaps: List[str]
    recommendations: List[str]
    summary: str
    reasoning: str
    # PACE fields
    pace_primary: str
    pace_alternate: str
    pace_contingency: str
    pace_emergency: str
    pace_reasoning: str


PREPAREDNESS_BRIEFING_PROMPT = """ROLE: You are the Preparedness Briefing Officer — combining inventory audit and P.A.C.E. tactical planning in a single response to save API quota.

PART A — INVENTORY AUDIT:
INPUTS: inventory (list of {name, category, unit, current_amount, target_amount, expiry_date}), team.
1. household_size = count of team members with role='family' (min 1).
2. survival_days_water = sum of Water items (Liters) / (household_size × 3).
3. survival_days_food = sum of Food items / (household_size × 2).
4. overall_days = min(water_days, food_days).
5. readiness_score (start 100): -20 if water<3d, -20 if food<3d, -15 if no Medical, -15 if no Power, -10 if any item current/target <0.30, -5 if any item expires within 30 days. Floor: 0.
6. low_stock_items = names where current_amount/target_amount < 0.40 AND target_amount > 0.
7. expiring_soon_items = names with expiry_date within 30 days of today.
8. critical_gaps = category names entirely absent (check: Water, Food, Medical, Power, Shelter, Tools).
9. Exactly 3 recommendations ordered by highest impact on overall_days.
10. 1-2 sentence summary of preparedness posture.
11. reasoning = step-by-step arithmetic for steps 2-5.

PART B — P.A.C.E. PLAN:
Using the same inventory and team, generate a 4-tier contingency doctrine.
P.A.C.E. = Primary, Alternate, Contingency, Emergency. Each tier assumes the previous has FAILED.
- primary: optimal action using all available resources.
- alternate: second-best if Primary route/resource is blocked.
- contingency: degraded fallback when infrastructure fails.
- emergency: last-resort survival when all else has failed.
- pace_reasoning: 2-3 sentences explaining the strategic logic.
Reference actual inventory item names/quantities. If elderly >65 or children <12 in team, Primary must account for slower evacuation.

OUTPUT (STRICT JSON — no markdown):
{
  "survival_days_water": <float>,
  "survival_days_food": <float>,
  "overall_days": <float>,
  "readiness_score": <int>,
  "low_stock_items": ["<str>"],
  "expiring_soon_items": ["<str>"],
  "critical_gaps": ["<str>"],
  "recommendations": ["<str>", "<str>", "<str>"],
  "summary": "<str>",
  "reasoning": "<str>",
  "pace_primary": "<1-2 tactical sentences>",
  "pace_alternate": "<1-2 tactical sentences>",
  "pace_contingency": "<1-2 tactical sentences>",
  "pace_emergency": "<1-2 tactical sentences>",
  "pace_reasoning": "<2-3 sentences>"
}

RULES: recommendations = exactly 3. critical_gaps = category names only. Each PACE tier assumes the previous failed. No markdown."""


async def run_preparedness_briefing_agent(
    inventory: list,
    team: list,
    location: str = "Malaysia"
) -> PreparednessBriefingResult:
    """Single Groq call replacing run_inventory_analysis_agent + run_pace_agent."""
    try:
        user = f"location: {location}\nteam: {json.dumps(team)}\ninventory: {json.dumps(inventory)}"
        result = await _call_groq(PREPAREDNESS_BRIEFING_PROMPT, user, max_tokens=2000)
        return PreparednessBriefingResult(**result)
    except Exception as e:
        print(f"[PreparednessBriefing] Agent failed: {e}")
        return PreparednessBriefingResult(
            survival_days_water=0.0, survival_days_food=0.0, overall_days=0.0,
            readiness_score=0, low_stock_items=[], expiring_soon_items=[],
            critical_gaps=["Analysis unavailable"],
            recommendations=["Retry the analysis", "Check server logs", "Verify inventory data"],
            summary="Preparedness briefing failed. Please retry.",
            reasoning="Agent call failed — likely Groq quota exhaustion.",
            pace_primary="Retry briefing when AI service is available.",
            pace_alternate="Shelter in place, conserve resources, monitor official broadcasts.",
            pace_contingency="Contact emergency services via 999 if situation escalates.",
            pace_emergency="Signal for help and move to the nearest evacuation centre.",
            pace_reasoning="Default guidance provided due to agent error."
        )
