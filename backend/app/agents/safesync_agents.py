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
    location: str = "Malaysia",
    settings_pref=None
) -> CoordinatorResult:
    try:
        # Normalize team to dicts (some callers pass Pydantic objects, some pass dicts)
        team_dicts = []
        for m in team:
            if hasattr(m, "model_dump"):
                team_dicts.append(m.model_dump())
            elif isinstance(m, dict):
                team_dicts.append(m)
            else:
                # Fallback for generic objects
                team_dicts.append(vars(m) if hasattr(m, "__dict__") else m)

        contacts = [m for m in team_dicts if m.get("role") == "emergency_contact"]
        user = f"location: {location}\n"
        user += f"team: {json.dumps([{'name': m.get('name'), 'role': m.get('role')} for m in team_dicts])}\n"
        user += f"contacts: {json.dumps([{'name': c.get('name'), 'email': c.get('email', '')} for c in contacts])}\n"
        if weather:
            user += f"weather: {weather.model_dump_json()}\n"
        if survival:
            user += f"survival: {survival.model_dump_json()}\n"
        if inventory_analysis:
            user += f"inventory_analysis: {inventory_analysis.model_dump_json()}\n"

        result = await _call_groq(COORDINATOR_PROMPT, user)
        coordinator = CoordinatorResult(**result)

        mode = "UNKNOWN"
        if inventory_analysis and (not weather or weather.severity == "normal"):
            mode = "PREPAREDNESS"
        elif weather and weather.severity in ["warning", "info"] and (not survival or survival.evacuation_urgency in ["shelter_in_place", "none"]):
            mode = "ADVISORY"
        elif survival and survival.evacuation_urgency in ["immediate", "prepare"]:
            mode = "EMERGENCY"

        send_email_enabled = False
        if settings_pref:
            if mode == "PREPAREDNESS" and getattr(settings_pref, 'emailPreparedness', False):
                send_email_enabled = True
            elif mode == "ADVISORY" and getattr(settings_pref, 'emailAdvisories', False):
                send_email_enabled = True
            elif mode == "EMERGENCY" and getattr(settings_pref, 'emailEmergency', False):
                send_email_enabled = True

        if coordinator.action_taken in ["emergency_email_sent", "user_email_sent"]:
            if send_email_enabled:
                if coordinator.action_taken == "emergency_email_sent":
                    for contact in contacts:
                        email = contact.get("email", "")
                        if email and "@" in email:
                            try:
                                send_email(to=email, subject=coordinator.subject_drafted, body=coordinator.message_drafted)
                            except Exception:
                                pass
                if NOTIFICATION_EMAIL:
                    try:
                        send_email(to=NOTIFICATION_EMAIL, subject=coordinator.subject_drafted, body=coordinator.message_drafted)
                    except Exception:
                        pass

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
EVAC_CONTEXT_PROMPT = """ROLE: You are the Malaysian National Evacuation Advisor, operating under NADMA (National Disaster Management Agency) protocols. You generate location-specific evacuation guidance for Malaysian disasters. You do NOT produce GPS coordinates — those come from OpenStreetMap.

INPUTS: disaster_type, severity, location, shelter_names (list of real nearby shelters from OSM), agency_names (list of real nearby agencies from OSM), team_size.

SECTION 1 — areas_to_avoid (EXACTLY 5 entries):
Name real, specific locations to avoid for the given disaster_type at this location.
Regional rules:
- Sabah: reference Sungai Moyog, Sungai Tuaran, Jalan Tuaran, Jalan Sulaman, coastal lowlands, Teluk Likas reclaimed areas.
- Sarawak: reference Sungai Sarawak, Jalan Kuching-Samarahan, Batu Kawa lowlands, Jalan Matang, Pending Industrial Area.
- Selangor/KL: reference Sungai Klang, Sungai Gombak, Jalan Masjid India, Kampung Baru low-lying areas, LDP underpass sections.
- Penang: reference Sungai Pinang, Jalan Penang low-lying zones, Butterworth waterfront.
- Johor: reference Sungai Segamat, Jalan Genuang, Muar riverside areas.
- Other states: use the most relevant flood-prone rivers and low-lying roads.

SECTION 2 — routes_to_take (EXACTLY 3 distinct evacuation routes):
Name actual roads leading away from the threat toward higher ground or the nearest shelter.
- Each route must be DIFFERENT — not the same road in different directions.
- Format: "[Route name/number] toward [destination or landmark] — [brief reason]".

SECTION 3 — sms_alert_text (MAXIMUM 160 characters including spaces):
Template: "🚨 MYRESILIENCE: [disaster] at [location]. Evacuate via [road]. Shelter: [shelter_names[0]]. Call 999/994."
If shelter_names is empty, use 'nearest PPS'.

SECTION 4 — reasoning (2-3 sentences):
Cite NADMA, JPS (Jabatan Pengairan & Saliran), or local DID (Department of Irrigation and Drainage) context. Explain WHY these specific routes/zones were chosen for this location and disaster type.

OUTPUT (STRICT JSON — no markdown, no coordinates, no extra keys):
{
  "areas_to_avoid": ["<str>", "<str>", "<str>", "<str>", "<str>"],
  "routes_to_take": ["<str>", "<str>", "<str>"],
  "sms_alert_text": "<str max 160 chars>",
  "reasoning": "<2-3 sentences citing NADMA/JPS/DID>"
}

NEVER: use generic placeholders like '[road name]', repeat the same road in routes_to_take, exceed 160 chars in SMS, output GPS coordinates, use markdown."""


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


THREAT_ASSESSOR_PROMPT = """ROLE: You are the ThreatAssessor — a combined meteorological and survival analyst for Malaysia. You parse MET Malaysia weather data AND evaluate household survival capacity in a single, token-efficient step.

PHASE 1 — WEATHER CLASSIFICATION (MET Malaysia / Malay-aware):
1. Identify primary disaster_type from alerts or summary. Map using:
   - flood: Banjir, Banjir kilat, hujan lebat berterusan
   - storm: Ribut petir, Ribut, angin kencang, OFFICIAL WARNING (thunderstorm/wind)
   - haze: Berjerebu, jerebu, asap
   - heatwave: Panas terik, suhu tinggi, gelombang haba
   - none: Tiada hujan, cerah, berawan sahaja
2. Classify severity using this EXACT priority order:
   - critical → alert type contains 'OFFICIAL WARNING' OR 'Bahaya' OR 'Merah (Red)' OR estimated_onset_hours ≤ 2
   - warning → 'Ribut petir' OR 'Hujan lebat' OR 'Berjerebu' OR 'Kuning (Yellow)' OR 'Oren (Orange)' OR any OFFICIAL WARNING with onset > 2h
   - info → any alert present but none of the above keywords; OR 'Hujan' (light rain) without warnings
   - normal → no alerts AND summary is 'Tiada hujan' or 'Cerah' or 'Berawan'
3. time_to_impact_hours: use alerts[0].estimated_onset_hours if present, else null. NEVER guess.
4. expected_impact: one sentence describing ground-level human experience. For haze mention AQI/respiratory risk.

PHASE 2 — SURVIVAL ASSESSMENT:
1. household_size = count of team members where role='family' (minimum 1).
2. water_days = SUM of all Water-category item current_amount (Liters) ÷ (household_size × 3). Show arithmetic.
3. food_days = SUM of all Food-category item current_amount ÷ (household_size × 2). Show arithmetic.
4. survival_score_days = min(water_days, food_days), rounded to 2 decimal places.
5. EVACUATION DECISION TREE — apply in order, stop at first match:
   RULE A: severity='critical' AND time_to_impact_hours ≤ 12 → urgency='immediate'
   RULE B: severity='critical' OR (severity='warning' AND survival_score_days < 3) → urgency='prepare'
   RULE C: severity='warning' OR severity='info' → urgency='shelter_in_place'
   RULE D: (else) → urgency='none'
   MOBILITY OVERRIDE: If any team member remarks mention 'wheelchair'/'kerusi roda'/'elderly'/'warga emas'/'asthma' AND severity is 'warning' or 'critical' → escalate urgency one level (shelter_in_place→prepare, prepare→immediate).
6. missing_critical_items: items with current_amount=0 that are critical for this disaster_type:
   flood → flashlight, rope, waterproof bags, life jacket
   storm → portable radio, batteries, raincoat
   haze → N95 mask, air purifier, sealed windows
   heatwave → bottled water, oral rehydration salts, cooling towel
7. reasoning: cite your actual arithmetic (e.g. '10L water ÷ (2×3)=1.67d, food=4.5d, min=1.67d; warning+<3d → prepare.').

OUTPUT (STRICT JSON — exactly 8 keys, no markdown, no extra text):
{
  "severity": "<critical|warning|info|normal>",
  "disaster_type": "<flood|storm|heatwave|earthquake|fire|haze|none>",
  "expected_impact": "<one sentence>",
  "time_to_impact_hours": <float or null>,
  "survival_score_days": <float 2dp>,
  "evacuation_urgency": "<immediate|prepare|shelter_in_place|none>",
  "missing_critical_items": ["<string>"],
  "reasoning": "<one sentence showing arithmetic and rule applied>"
}

NEVER: add extra keys, use markdown, guess time_to_impact, skip arithmetic. If payload empty → severity=normal, disaster_type=none, urgency=none, survival_score_days=0.00."""


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
        result = await _call_groq(THREAT_ASSESSOR_PROMPT, user, max_tokens=900)
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


PREPAREDNESS_BRIEFING_PROMPT = """ROLE: You are the Preparedness Briefing Officer for a Malaysian household emergency system. You combine inventory audit and P.A.C.E. tactical planning in one response.

PART A — INVENTORY AUDIT:
INPUTS: inventory [{name, category, unit, current_amount, target_amount, expiry_date}], team, today's date (provided in user message).

COMPUTE STEP BY STEP:
1. household_size = count team members where role='family' (minimum 1).
2. water_days = SUM Water-category current_amount (Liters) ÷ (household_size × 3). Show arithmetic.
3. food_days = SUM Food-category current_amount ÷ (household_size × 2). Show arithmetic.
4. overall_days = min(water_days, food_days), 2 decimal places.
5. readiness_score starts at 100. Subtract ONLY these penalties (floor at 0):
   -20 if water_days < 3
   -20 if food_days < 3
   -15 if no Medical-category item has current_amount > 0
   -15 if no Power-category item has current_amount > 0
   -10 if ANY item has current_amount/target_amount < 0.30 (and target_amount > 0)
   -5 if ANY item's expiry_date is within 30 days of TODAY'S DATE (use the date provided)
6. low_stock_items: item names where current_amount/target_amount < 0.40 AND target_amount > 0.
7. expiring_soon_items: item names where expiry_date is within 30 days of TODAY'S DATE. If expiry_date is empty, skip it.
8. critical_gaps: category names ENTIRELY absent from inventory. Check only: Water, Food, Medical, Power, Shelter, Tools.
9. recommendations: EXACTLY 3 items, ordered by highest positive impact on overall_days.
10. summary: 1-2 sentences on current preparedness posture.
11. reasoning: show your arithmetic for steps 2-5 explicitly.

PART B — P.A.C.E. TACTICAL DOCTRINE:
Generate 4-tier contingency plan for this specific household. Each tier ASSUMES the previous tier has FAILED.
- pace_primary: Optimal action using all current resources and contacts. Must name actual inventory items.
- pace_alternate: Second-best option if Primary is blocked. Must NOT repeat the same route/resource as Primary.
- pace_contingency: Degraded fallback when infrastructure fails (no vehicle, no power, roads blocked).
- pace_emergency: Absolute last resort when all systems have failed. Include Malaysian emergency numbers: 999 (police/ambulance), 994 (fire/bomba).
- pace_reasoning: 2-3 sentences explaining why this sequence fits THIS household specifically.

Special rules for PACE:
- If team has members age > 65 or < 12, Primary MUST account for slower movement speed.
- Reference actual item names (e.g. 'Use the 10L water reserve').
- Each tier must be independently executable without relying on a previous tier's resources.

OUTPUT (STRICT JSON — no markdown, no extra keys):
{
  "survival_days_water": <float 2dp>,
  "survival_days_food": <float 2dp>,
  "overall_days": <float 2dp>,
  "readiness_score": <int 0-100>,
  "low_stock_items": ["<str>"],
  "expiring_soon_items": ["<str>"],
  "critical_gaps": ["<str>"],
  "recommendations": ["<str>", "<str>", "<str>"],
  "summary": "<str>",
  "reasoning": "<str showing arithmetic>",
  "pace_primary": "<1-2 sentences>",
  "pace_alternate": "<1-2 sentences>",
  "pace_contingency": "<1-2 sentences>",
  "pace_emergency": "<1-2 sentences>",
  "pace_reasoning": "<2-3 sentences>"
}

NEVER: guess expiry dates, skip arithmetic, use markdown, return fewer/more than 3 recommendations."""


async def run_preparedness_briefing_agent(
    inventory: list,
    team: list,
    location: str = "Malaysia"
) -> PreparednessBriefingResult:
    """Single Groq call replacing run_inventory_analysis_agent + run_pace_agent."""
    try:
        from datetime import date
        today_str = date.today().strftime("%Y-%m-%d")
        user = f"today_date: {today_str}\nlocation: {location}\nteam: {json.dumps(team)}\ninventory: {json.dumps(inventory)}"
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
