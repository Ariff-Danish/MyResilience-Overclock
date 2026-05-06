"""MyResilience Agents — Groq SDK with High-Precision System Prompts."""
import asyncio
import json
from typing import List, Optional
from pydantic import BaseModel
from app.agents.config import get_groq_client, get_model, NOTIFICATION_EMAIL
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
    client = get_groq_client()
    resp = client.chat.completions.create(
        model=get_model(),
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        temperature=0.15,
        max_tokens=max_tokens,
        response_format={"type": "json_object"},
    )
    return json.loads(resp.choices[0].message.content.strip())


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


EVACUATION_ADVISOR_PROMPT = """ROLE: You are the Malaysian National Evacuation Advisor covering ALL Malaysian states including Sabah and Sarawak. You are integrated with NADMA, PDRM, Bomba, JKM, JPS, and KKM.

CRITICAL: Generate shelter/agency locations for the ACTUAL location in the user prompt. NEVER default to Klang Valley unless explicitly stated.

STATE COORDINATE REFERENCE (use nearest state for GPS):
- KL/PJ: lat~3.14, lng~101.68 | Selangor: lat~3.07, lng~101.52
- Johor Bahru: lat~1.49, lng~103.74 | Penang: lat~5.41, lng~100.33
- Ipoh: lat~4.60, lng~101.09 | Kota Bharu: lat~6.12, lng~102.24
- Kuantan: lat~3.81, lng~103.33 | Alor Setar: lat~6.12, lng~100.37
- Kota Kinabalu: lat~5.98, lng~116.07 | Sandakan: lat~5.84, lng~118.12
- Tawau: lat~4.24, lng~117.89 | Kuching: lat~1.55, lng~110.36
- Miri: lat~4.40, lng~113.99 | Sibu: lat~2.30, lng~111.82
- Melaka: lat~2.19, lng~102.25 | Seremban: lat~2.73, lng~101.94

OFFICIAL DATA SOURCES (reference these in reasoning):
- NADMA portalbencana: https://portalbencana.nadma.gov.my
- JPS flood data: https://water.jps.gov.my
- data.gov.my API: https://api.data.gov.my
- JKM shelters: https://www.jkm.gov.my
- DOSM/Banci: https://www.dosm.gov.my
- KDN: https://www.kdn.gov.my

TASK: Given disaster_type, location, severity, team — produce a LOCATION-SPECIFIC plan.

SECTION 1 — shelter_locations (exactly 3 PPS near the given location):
Name format: "Dewan/SK/Padang [local name], [district]"

SECTION 2 — enforcement_agencies (exactly 5: 1 PDRM, 1 Bomba, 1 Hospital, 1 JKM, 1 NADMA/PBT — all near given location)

SECTION 3 — areas_to_avoid (exactly 5, use local road names for that state/city)

SECTION 4 — routes_to_take (exactly 3, use roads appropriate to that state):
- Sabah: Pan Borneo, Jalan Tuaran, Jalan Penampang etc.
- Sarawak: Pan Borneo Sarawak, Jalan Kuching-Samarahan etc.
- Peninsula: Federal/State roads for that specific state

SECTION 5 — sms_alert_text (max 160 chars):
"🚨 MYRESILIENCE: [threat] at [location]. Evacuate via [road]. Shelter: [name]. Call 999."

OUTPUT (STRICT JSON — no markdown):
{
  "shelter_locations": [{"name":"<str>","address":"<str>","lat":<float>,"lng":<float>,"type":"shelter"}],
  "enforcement_agencies": [{"name":"<str>","address":"<str>","lat":<float>,"lng":<float>,"type":"<police|fire|hospital|nadma>"}],
  "areas_to_avoid": ["<str>"],
  "routes_to_take": ["<str>"],
  "sms_alert_text": "<str ≤160 chars>",
  "reasoning": "<2-3 sentences citing NADMA/JPS sources>"
}

RULES: Exactly 3 shelters, 5 agencies, 5 avoid zones, 3 routes. GPS within 30km of stated location. No markdown."""


async def run_evacuation_advisor_agent(
    disaster_type: str,
    severity: str,
    location: str,
    team: list
) -> EvacuationAdvisoryResult:
    try:
        user = (
            f"disaster_type: {disaster_type}\n"
            f"severity: {severity}\n"
            f"location: {location}\n"
            f"team_size: {len(team)}\n"
            f"team: {json.dumps(team)}"
        )
        result = await _call_groq(EVACUATION_ADVISOR_PROMPT, user, max_tokens=2000)
        shelters = [ShelterLocation(**s) for s in result.get("shelter_locations", [])]
        agencies = [ShelterLocation(**a) for a in result.get("enforcement_agencies", [])]
        return EvacuationAdvisoryResult(
            shelter_locations=shelters,
            enforcement_agencies=agencies,
            areas_to_avoid=result.get("areas_to_avoid", []),
            routes_to_take=result.get("routes_to_take", []),
            sms_alert_text=result.get("sms_alert_text", "🚨 MYRESILIENCE: Threat detected. Call 999. Move to nearest evacuation centre immediately."),
            reasoning=result.get("reasoning", "")
        )
    except Exception as e:
        print(f"[Evacuation Advisor] Agent failed: {e}")
        return EvacuationAdvisoryResult(
            shelter_locations=[
                ShelterLocation(name="Dewan Olahraga MBPJ", address="Jalan Belia, PJ", lat=3.1073, lng=101.6297, type="shelter"),
                ShelterLocation(name="SK Seksyen 10 PJ", address="Seksyen 10, PJ", lat=3.1020, lng=101.6310, type="shelter"),
                ShelterLocation(name="Dewan Komuniti Seksyen 14", address="Seksyen 14, PJ", lat=3.1073, lng=101.6067, type="shelter"),
            ],
            enforcement_agencies=[
                ShelterLocation(name="IPD Petaling Jaya (PDRM)", address="Jalan Othman, PJ", lat=3.1103, lng=101.6378, type="police"),
                ShelterLocation(name="Balai Bomba PJ", address="Jalan Kemajuan, PJ", lat=3.1013, lng=101.6343, type="fire"),
                ShelterLocation(name="Hospital Tengku Ampuan Rahimah", address="Jalan Langat, Klang", lat=3.0444, lng=101.4510, type="hospital"),
                ShelterLocation(name="Balai Polis Damansara", address="Persiaran Damansara, PJ", lat=3.1522, lng=101.6216, type="police"),
                ShelterLocation(name="Pejabat JKM Petaling", address="Kompleks Pentadbiran PJ", lat=3.1073, lng=101.6067, type="nadma"),
            ],
            areas_to_avoid=["Jalan Klang Lama (flood-prone low-lying sections)", "Kawasan Sungai Penchala", "Kesas Highway underpass sections", "Jalan Templer near river", "Shah Alam Section 25 low areas"],
            routes_to_take=["Route 1: NKVE northbound → exit Damansara → DUKE highway to high ground", "Route 2: Federal Highway → Kesas eastbound → LDP interchange (avoid low underpasses)", "Route 3: Jalan Ipoh → MRR2 → shelter at Kepong"],
            sms_alert_text="🚨 MYRESILIENCE: Flood threat. Evacuate via NKVE/DUKE. Shelter: Dewan Olahraga MBPJ. Avoid Jln Klang Lama. Call 999.",
            reasoning="Default evacuation plan applied due to agent error. Petaling Jaya standard flood protocol used."
        )

