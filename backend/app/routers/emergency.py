from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import json
import math
import requests
import asyncio
from datetime import datetime, timedelta
from app.agents.safesync_agents import (
    run_coordinator_agent,
    run_evacuation_advisor_agent,
    run_threat_assessor_agent,
    run_preparedness_briefing_agent,
    WeatherAssessmentResult,
    SurvivalResult,
    PreparednessBriefingResult,
)
from app.agents.sms_tools import send_bulk_sms
from app.agents.gmail_tools import send_email
from app.utils.geo import (
    haversine_km,
    parse_location_from_warning_text,
    get_coords_for_location,
    MALAYSIA_LOCATION_COORDS,
)


# ── Nominatim reverse-geocode ──────────────────────────────────────────────────
def reverse_geocode(lat: float, lng: float) -> dict:
    """Return { display_name, state, district, city } for a coordinate pair."""
    try:
        r = requests.get(
            "https://nominatim.openstreetmap.org/reverse",
            params={"lat": lat, "lon": lng, "format": "json", "accept-language": "en"},
            headers={"User-Agent": "MyResilience-SafeSync/2.0"},
            timeout=8
        )
        r.raise_for_status()
        data = r.json()
        addr = data.get("address", {})
        return {
            "display_name": data.get("display_name", ""),
            "city":    addr.get("city") or addr.get("town") or addr.get("municipality") or addr.get("village") or addr.get("suburb") or addr.get("county", ""),
            "state":   addr.get("state", ""),
            "country": addr.get("country", ""),
        }
    except Exception as e:
        print(f"[Nominatim] Reverse geocode failed: {e}")
        return {"display_name": "", "city": "", "state": "", "country": ""}


# ── MET Malaysia weather fetch (location-aware) ────────────────────────────────
async def fetch_met_weather(user_location_name: str = "Petaling") -> dict:
    """
    Fetch MET Malaysia forecast + ALL national warnings.
    Forecast is filtered to the user's actual district/city.
    Warnings are fetched nationally — proximity filtering happens in evaluate_risk.
    """
    # Use just the first word of the location for MET search (e.g. "Kota Kinabalu" → "Kota Kinabalu")
    search_term = user_location_name.strip().split(",")[0].strip() if user_location_name else "Petaling"

    forecast_url = f"https://api.data.gov.my/weather/forecast?contains={search_term}@location__location_name"
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    # Fetch ALL warnings nationally — we'll filter by proximity later
    warning_url = f"https://api.data.gov.my/weather/warning?timestamp_start={yesterday}@warning_issue__issued"

    def _fetch(url):
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        return r.json()

    try:
        forecast_data, warning_data = await asyncio.gather(
            asyncio.to_thread(_fetch, forecast_url),
            asyncio.to_thread(_fetch, warning_url)
        )

        # If no forecast for user's location, fall back to a broader search
        if not forecast_data:
            fallback_url = "https://api.data.gov.my/weather/forecast?contains=Malaysia@location__location_name&limit=5"
            try:
                forecast_data = await asyncio.to_thread(_fetch, fallback_url)
            except Exception:
                forecast_data = []

        today_str = datetime.now().strftime("%Y-%m-%d")
        today_forecast = next((item for item in forecast_data if item.get("date") == today_str), None)
        if not today_forecast and len(forecast_data) > 0:
            today_forecast = forecast_data[0]

        alerts = []
        summary = "Tiada hujan"
        loc_name = search_term

        if today_forecast:
            loc_name = today_forecast["location"]["location_name"]
            summary = today_forecast.get("summary_forecast", "Tiada hujan")
            if any(k in summary for k in ["Ribut", "Hujan", "Berjerebu"]):
                alerts.append({
                    "type": f"Forecast: {summary}",
                    "description": (
                        f"Morning: {today_forecast.get('morning_forecast')}. "
                        f"Afternoon: {today_forecast.get('afternoon_forecast')}. "
                        f"Night: {today_forecast.get('night_forecast')}."
                    ),
                    "estimated_onset_hours": 2.0,
                    "location": loc_name,  # ← tag with location for proximity check
                })

        # Include ALL national warnings — tag each with its location text
        for w in warning_data:
            text_en = w.get("text_en", "") or ""
            text_bm = w.get("text_bm", "") or ""
            combined_text = text_en or text_bm
            if combined_text:
                alerts.append({
                    "type": f"OFFICIAL WARNING: {w['warning_issue']['title_en']}",
                    "description": combined_text,
                    "estimated_onset_hours": 1.0,
                    "location": combined_text,  # ← full text for location parsing
                })

        return {
            "location": f"{loc_name}, Malaysia",
            "current_conditions": {
                "temperature_celsius": today_forecast.get("max_temp", 32) if today_forecast else 32,
                "min_temp": today_forecast.get("min_temp", 25) if today_forecast else 25,
                "summary": summary,
                "morning": today_forecast.get("morning_forecast", "") if today_forecast else "",
                "afternoon": today_forecast.get("afternoon_forecast", "") if today_forecast else "",
                "night": today_forecast.get("night_forecast", "") if today_forecast else "",
            },
            "alerts": alerts,
            "official_warnings_count": sum(1 for a in alerts if "OFFICIAL WARNING" in a.get("type", "")),
        }

    except Exception as e:
        print(f"[MET API Error]: {e}")

    return {
        "location": f"{search_term}, Malaysia",
        "current_conditions": {
            "temperature_celsius": 32, "min_temp": 25,
            "summary": "Tiada hujan",
            "morning": "", "afternoon": "", "night": ""
        },
        "alerts": [],
        "official_warnings_count": 0,
    }


async def fetch_mock_weather_data(
    demo: bool = False,
    user_location_name: str = "Petaling"
) -> str:
    if demo:
        return json.dumps({
            "location": f"{user_location_name}, Malaysia",
            "current_conditions": {
                "temperature_celsius": 34,
                "min_temp": 27,
                "precipitation_mm_per_hour": 150,
                "wind_speed_kmh": 65,
                "summary": "Hujan lebat",
                "morning": "Hujan lebat",
                "afternoon": "Ribut petir",
                "night": "Hujan ringan",
            },
            "alerts": [{
                "type": "Red Alert",
                "description": "Severe flash flood warning. Rivers exceeding danger levels.",
                "estimated_onset_hours": 2.5,
                "location": user_location_name,
            }],
            "official_warnings_count": 1,
        })
    data = await fetch_met_weather(user_location_name)
    return json.dumps(data)


# ── Routes ─────────────────────────────────────────────────────────────────────

router = APIRouter()

PROXIMITY_ALERT_KM = 150.0


# ── Proximity filter for alerts (uses geo utility for accurate parsing) ────────
def filter_alerts_by_proximity(alerts: list, user_lat: float, user_lng: float) -> tuple[list, list]:
    """
    Split alerts into (nearby_alerts, distant_alerts).
    Uses parse_location_from_warning_text for long official warning strings,
    so state names inside paragraphs are correctly extracted.
    An alert is 'nearby' if its disaster location is within PROXIMITY_ALERT_KM of the user.
    Alerts with no parseable location are included conservatively.
    """
    nearby, distant = [], []
    for alert in alerts:
        loc_text = alert.get("location", "")
        # Use parse_location_from_warning_text for long warning paragraphs
        location_key = parse_location_from_warning_text(loc_text)
        disaster_coords = MALAYSIA_LOCATION_COORDS.get(location_key) if location_key else None
        if disaster_coords is None:
            # Can't determine location → include conservatively
            nearby.append({**alert, "proximity_km": None, "proximity_status": "unknown"})
        else:
            dist = haversine_km(user_lat, user_lng, disaster_coords[0], disaster_coords[1])
            if dist <= PROXIMITY_ALERT_KM:
                nearby.append({**alert, "proximity_km": round(dist, 1), "proximity_status": "nearby"})
            else:
                distant.append({**alert, "proximity_km": round(dist, 1), "proximity_status": "distant"})
    return nearby, distant


# ── Models ─────────────────────────────────────────────────────────────────────
class InventoryItem(BaseModel):
    id: str
    name: str
    category: str
    unit: str
    current_amount: float
    target_amount: float
    expiry_date: Optional[str] = None
    notes: Optional[str] = None


class TeamMember(BaseModel):
    id: str
    name: str
    age: int
    role: str
    email: Optional[str] = None
    phone: Optional[str] = None
    remarks: Optional[str] = None


class RiskEvaluationRequest(BaseModel):
    inventory: List[InventoryItem]
    team: List[TeamMember]
    location: str = "Kuala Lumpur, Malaysia"
    user_lat: Optional[float] = None
    user_lng: Optional[float] = None


class InventoryAnalysisRequest(BaseModel):
    inventory: List[InventoryItem]
    team: List[TeamMember]


class EvacuationAdvisoryRequest(BaseModel):
    disaster_type: str = "flood"
    severity: str = "warning"
    location: str = "Petaling Jaya, Malaysia"
    team: List[TeamMember] = []
    send_sms_alerts: bool = False
    user_lat: Optional[float] = None
    user_lng: Optional[float] = None


# ── Routes ─────────────────────────────────────────────────────────────────────
@router.get("/weather/live")
async def live_weather(demo: bool = False, user_lat: Optional[float] = None, user_lng: Optional[float] = None):
    """
    Returns live MET Malaysia weather for the user's actual location.
    If user_lat/lng provided: reverse-geocodes to find their district, fetches local MET data.
    Includes proximity_context for each alert (nearby vs distant).
    """
    try:
        # Step 1: Determine user's location name
        user_location_name = "Petaling"
        user_location_display = "Petaling, Malaysia"
        geocode_result = {}

        if user_lat is not None and user_lng is not None:
            geocode_result = await asyncio.to_thread(reverse_geocode, user_lat, user_lng)
            city = geocode_result.get("city", "")
            state = geocode_result.get("state", "")
            user_location_name = city or state or "Petaling"
            user_location_display = f"{city}, {state}, Malaysia" if city and state else f"{state}, Malaysia"

        # Step 2: Fetch MET weather for user's location
        data = json.loads(await fetch_mock_weather_data(demo, user_location_name))

        # Step 3: Proximity-filter alerts if user location is known
        if user_lat is not None and user_lng is not None:
            nearby_alerts, distant_alerts = filter_alerts_by_proximity(
                data.get("alerts", []), user_lat, user_lng
            )
            data["alerts"] = nearby_alerts          # Only nearby alerts shown as active
            data["distant_alerts"] = distant_alerts  # Distant ones reported separately
            data["user_location"] = {
                "lat": user_lat,
                "lng": user_lng,
                "display": user_location_display,
                "city": geocode_result.get("city", ""),
                "state": geocode_result.get("state", ""),
            }
            data["proximity_threshold_km"] = PROXIMITY_ALERT_KM
            data["location"] = user_location_display

        return data
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/generate_pace")
async def generate_pace(req: RiskEvaluationRequest):
    """
    P.A.C.E. Strategic Plan — always returns a valid plan.

    Tier 1: Deterministic engine computes plan from inventory data (no LLM, always works).
    Tier 2: LLM enhances plan if Groq quota available. Falls back silently if not.
    """
    inv = [i.model_dump() for i in req.inventory]
    team = [t.model_dump() for t in req.team]
    loc = (req.location or "your area").split(",")[0].strip()

    # ── Deterministic P.A.C.E. from inventory ──────────────────────────────────
    household_size = max(1, sum(1 for m in team if m.get("role") == "family"))
    has_elderly    = any(m.get("age", 0) > 65 for m in team)
    has_children   = any(0 < m.get("age", 99) < 12 for m in team)

    water_liters   = sum(i["current_amount"] for i in inv if i.get("category") == "Water")
    food_units     = sum(i["current_amount"] for i in inv if i.get("category") == "Food")
    has_medical    = any(i.get("category") == "Medical" for i in inv)
    has_power      = any(i.get("category") == "Power" for i in inv)
    has_tools      = any(i.get("category") == "Tools" for i in inv)

    water_days = round(water_liters / (household_size * 3), 1) if water_liters > 0 else 0
    food_days  = round(food_units  / (household_size * 2), 1) if food_units > 0  else 0
    overall    = min(water_days, food_days)

    # Mobility note for vulnerable members
    mobility_note = ""
    if has_elderly and has_children:
        mobility_note = " Allow extra time — elderly and children in household require assisted movement."
    elif has_elderly:
        mobility_note = " Elderly member(s) present — ensure assisted evacuation and wheelchair/transport access."
    elif has_children:
        mobility_note = " Children present — designate a responsible adult per child during movement."

    # Water/food resource line
    if overall >= 7:
        resource_line = f"Supplies sufficient for {overall:.0f} days ({water_liters:.0f}L water, {food_units:.0f} food units). Shelter-in-place is viable."
    elif overall >= 3:
        resource_line = f"Supplies last approximately {overall:.0f} days. Prioritise topping up water ({water_liters:.0f}L remaining) and food ({food_units:.0f} units) before evacuating."
    else:
        resource_line = f"Critical shortage — only {overall:.0f} days of combined supplies. Immediate resupply or evacuation to a welfare shelter is required."

    # Support kit notes
    kit_notes = []
    if has_medical:
        kit_notes.append("medical kit secured")
    else:
        kit_notes.append("NO medical kit — grab any medication first")
    if has_power:
        kit_notes.append("power backup available")
    if has_tools:
        kit_notes.append("tools/equipment staged")
    kit_str = "; ".join(kit_notes)

    computed_pace = {
        "primary": (
            f"Evacuate via designated safe route to nearest government evacuation centre (PPS) in {loc}. "
            f"{resource_line} Pack go-bag with: {kit_str}.{mobility_note}"
        ),
        "alternate": (
            f"If primary route is blocked: shelter with trusted neighbour or community building on high ground in {loc}. "
            f"Ration remaining water ({water_liters:.0f}L) at 3L/person/day — sustains household of {household_size} for {water_days:.1f} days. "
            f"Monitor NADMA portalbencana.nadma.gov.my and RTM for route updates."
        ),
        "contingency": (
            f"Infrastructure failure mode — no route, no power. "
            f"{'Deploy power backup for communication. ' if has_power else 'No power backup — use battery radio or phone sparingly. '}"
            f"{'Use medical kit for first aid. ' if has_medical else 'No medical kit — improvise with available materials. '}"
            f"Signal for help using whistle, mirror, or bright cloth from highest accessible point. "
            f"Conserve food ({food_units:.0f} units) — reduce to 1 meal/day."
        ),
        "emergency": (
            f"Last resort — all options exhausted. "
            f"Move entire household to highest structural point of building or nearest elevated ground. "
            f"{'Assist elderly/children first. ' if (has_elderly or has_children) else ''}"
            f"Call 999 (Police/Rescue) or 994 (Bomba) — stay on line. "
            f"Signal rescuers with any available means. Do not attempt water crossing on foot."
        ),
        "reasoning": (
            f"P.A.C.E. computed from live inventory: {water_liters:.0f}L water ({water_days:.1f}d), "
            f"{food_units:.0f} food units ({food_days:.1f}d), household of {household_size}. "
            f"Each tier assumes the previous has failed. Medical={'Yes' if has_medical else 'No'}, "
            f"Power={'Yes' if has_power else 'No'}. Sourced from: portalbencana.nadma.gov.my."
        ),
    }

    # ── LLM Enhancement (optional — silently skipped if quota exhausted) ────────
    try:
        briefing = await run_preparedness_briefing_agent(inv, team, loc)
        # Only use LLM result if it's not the generic fallback text
        is_fallback = "unavailable" in briefing.pace_primary.lower() or "retry" in briefing.pace_primary.lower()
        if not is_fallback:
            return {
                "primary":     briefing.pace_primary,
                "alternate":   briefing.pace_alternate,
                "contingency": briefing.pace_contingency,
                "emergency":   briefing.pace_emergency,
                "reasoning":   briefing.pace_reasoning,
                "source":      "llm",
            }
    except Exception as llm_err:
        print(f"[PACE] LLM enhancement skipped (non-critical): {llm_err}")

    # Return deterministic plan
    return {**computed_pace, "source": "computed"}


@router.post("/analyze_inventory")
async def analyze_inventory(req: InventoryAnalysisRequest):
    """
    One Groq call replacing: Inventory Analyst + Coordinator.
    Returns full inventory audit AND P.A.C.E. plan in a single response.
    """
    try:
        inv = [i.model_dump() for i in req.inventory]
        team = [t.model_dump() for t in req.team]
        briefing = await run_preparedness_briefing_agent(inv, team)
        b = briefing.model_dump()
        return {
            "analysis": {
                "survival_days_water":  b["survival_days_water"],
                "survival_days_food":   b["survival_days_food"],
                "overall_days":         b["overall_days"],
                "readiness_score":      b["readiness_score"],
                "low_stock_items":      b["low_stock_items"],
                "expiring_soon_items":  b["expiring_soon_items"],
                "critical_gaps":        b["critical_gaps"],
                "recommendations":      b["recommendations"],
                "summary":              b["summary"],
                "reasoning":            b["reasoning"],
            },
            "pace": {
                "primary":     b["pace_primary"],
                "alternate":   b["pace_alternate"],
                "contingency": b["pace_contingency"],
                "emergency":   b["pace_emergency"],
                "reasoning":   b["pace_reasoning"],
            },
            # Legacy: coordinator_message kept for backward compatibility
            "coordinator_message": b["summary"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/evaluate_risk")
async def evaluate_risk(req: RiskEvaluationRequest, demo: bool = False):
    try:
        # Resolve user location
        user_location_name = "Petaling"
        user_location_display = req.location

        if req.user_lat is not None and req.user_lng is not None:
            geocode_result = await asyncio.to_thread(reverse_geocode, req.user_lat, req.user_lng)
            city = geocode_result.get("city", "")
            state = geocode_result.get("state", "")
            user_location_name = city or state or "Petaling"
            user_location_display = f"{city}, {state}, Malaysia" if city and state else req.location

        raw_weather = await fetch_mock_weather_data(demo, user_location_name)
        weather_dict = json.loads(raw_weather)

        # Proximity filter: suppress distant alerts
        nearby_alerts, distant_alerts = [], []
        if req.user_lat is not None and req.user_lng is not None:
            nearby_alerts, distant_alerts = filter_alerts_by_proximity(
                weather_dict.get("alerts", []), req.user_lat, req.user_lng
            )
            # Replace alerts with proximity-filtered ones before passing to agents
            weather_dict["alerts"] = nearby_alerts
            raw_weather = json.dumps(weather_dict)

        inv = [i.model_dump() for i in req.inventory]
        team = [t.model_dump() for t in req.team]

        # ── MERGED: Single ThreatAssessor call replaces Watcher + Assessor (saves ~50% tokens)
        threat = await run_threat_assessor_agent(raw_weather, inv, team)

        # Unpack into legacy Watcher/Assessor shapes for Coordinator compatibility
        weather = WeatherAssessmentResult(
            severity=threat.severity,
            disaster_type=threat.disaster_type,
            expected_impact=threat.expected_impact,
            time_to_impact_hours=threat.time_to_impact_hours,
        )
        survival = SurvivalResult(
            survival_score_days=threat.survival_score_days,
            evacuation_urgency=threat.evacuation_urgency,
            missing_critical_items=threat.missing_critical_items,
            reasoning=threat.reasoning,
        )

        coordinator = await run_coordinator_agent(
            weather=weather, survival=survival, team=team, location=user_location_display
        )

        # Autonomous dispatch — automatically trigger if there are ANY MET weather threats nearby, regardless of user inventory.
        evac_data = None
        sms_auto_results = []
        if nearby_alerts:
            try:
                evac_result = await run_evacuation_advisor_agent(
                    disaster_type=weather.disaster_type,
                    severity=weather.severity,
                    location=user_location_display,
                    team=team,
                    user_lat=req.user_lat,
                    user_lng=req.user_lng,
                )
                evac_data = evac_result.model_dump()
                phone_numbers = [m.get("phone", "").strip() for m in team if m.get("phone", "").strip()]
                if phone_numbers:
                    sms_auto_results = send_bulk_sms(phone_numbers, evac_result.sms_alert_text)
                else:
                    sms_auto_results = [{"status": "skipped", "reason": "No phone numbers in team roster"}]
            except Exception as evac_err:
                print(f"[AUTO-EVAC] Advisory failed (non-critical): {evac_err}")

        return {
            "weather_severity": weather.severity,
            "weather_disaster_type": weather.disaster_type,
            "expected_impact": weather.expected_impact,
            "time_to_impact_hours": weather.time_to_impact_hours,
            "survival_score_days": survival.survival_score_days,
            "evacuation_urgency": survival.evacuation_urgency,
            "missing_critical_items": survival.missing_critical_items,
            "action_taken": coordinator.action_taken,
            "message_drafted": coordinator.message_drafted,
            "contacts_notified": coordinator.contacts_notified,
            "evacuation_advisory": evac_data,
            "sms_auto_results": sms_auto_results,
            # Location context for frontend display
            "user_location": user_location_display,
            "nearby_alert_count": len(nearby_alerts),
            "distant_alert_count": len(distant_alerts),
            "distant_alerts": distant_alerts,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/evacuation_advisory")
async def evacuation_advisory(req: EvacuationAdvisoryRequest):
    """
    Run Groq Evacuation Advisor for the user's actual location.
    If user_lat/lng provided, uses reverse-geocoded location name.
    """
    try:
        location = req.location
        if req.user_lat is not None and req.user_lng is not None:
            geocode_result = await asyncio.to_thread(reverse_geocode, req.user_lat, req.user_lng)
            city = geocode_result.get("city", "")
            state = geocode_result.get("state", "")
            if city or state:
                location = f"{city}, {state}, Malaysia" if city and state else f"{state}, Malaysia"

        team_data = [t.model_dump() for t in req.team]
        result = await run_evacuation_advisor_agent(
            disaster_type=req.disaster_type,
            severity=req.severity,
            location=location,
            team=team_data,
            user_lat=req.user_lat,
            user_lng=req.user_lng,
        )

        sms_results = []
        if req.send_sms_alerts:
            phone_numbers = [m.phone for m in req.team if m.phone and m.phone.strip()]
            if phone_numbers:
                sms_results = send_bulk_sms(phone_numbers, result.sms_alert_text)
            else:
                sms_results = [{"status": "skipped", "reason": "No phone numbers found in team roster"}]

        return {
            **result.model_dump(),
            "sms_results": sms_results,
            "resolved_location": location,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Request schema for inventory + PACE ───────────────────────────────────────
class PreparednessBriefingRequest(BaseModel):
    inventory: list = []
    team: list = []
    location: str = "Malaysia"


# ──────────────────────────────────────────────────────────────────────────────
# /api/analyze_inventory
# Called by frontend on every inventory/team change (debounced 1.5s).
# Returns full inventory audit + readiness score + PACE plan in one Groq call.
# ──────────────────────────────────────────────────────────────────────────────
@router.post("/analyze_inventory")
async def analyze_inventory(req: PreparednessBriefingRequest):
    """
    Run the merged Preparedness Briefing agent.
    Returns inventory analysis AND P.A.C.E. plan in a single Groq call.
    Frontend consumes: analysis.readiness_score, analysis.recommendations, etc.
    """
    try:
        result: PreparednessBriefingResult = await run_preparedness_briefing_agent(
            inventory=req.inventory,
            team=req.team,
            location=req.location,
        )
        r = result.model_dump()
        return {
            "analysis": {
                "survival_days_water":  r["survival_days_water"],
                "survival_days_food":   r["survival_days_food"],
                "overall_days":         r["overall_days"],
                "readiness_score":      r["readiness_score"],
                "low_stock_items":      r["low_stock_items"],
                "expiring_soon_items":  r["expiring_soon_items"],
                "critical_gaps":        r["critical_gaps"],
                "recommendations":      r["recommendations"],
                "summary":              r["summary"],
                "reasoning":            r["reasoning"],
            },
            # Also include PACE in same response so frontend can cache it
            "pace": {
                "primary":     r["pace_primary"],
                "alternate":   r["pace_alternate"],
                "contingency": r["pace_contingency"],
                "emergency":   r["pace_emergency"],
                "reasoning":   r["pace_reasoning"],
            },
            "coordinator_message": r["summary"],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# /api/generate_pace
# Called separately by frontend — returns just the P.A.C.E. plan object.
# Uses the same merged briefing agent to avoid extra token cost.
# ──────────────────────────────────────────────────────────────────────────────
@router.post("/generate_pace")
async def generate_pace(req: PreparednessBriefingRequest):
    """
    Generate the P.A.C.E. contingency doctrine for the household.
    Returns: { primary, alternate, contingency, emergency, reasoning }
    """
    try:
        result: PreparednessBriefingResult = await run_preparedness_briefing_agent(
            inventory=req.inventory,
            team=req.team,
            location=req.location,
        )
        return {
            "primary":     result.pace_primary,
            "alternate":   result.pace_alternate,
            "contingency": result.pace_contingency,
            "emergency":   result.pace_emergency,
            "reasoning":   result.pace_reasoning,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ──────────────────────────────────────────────────────────────────────────────
# /api/distress_signal
# One-tap emergency broadcast. Sends SMS + Email to ALL team contacts
# with GPS coordinates, Google Maps link, and disaster context.
# ──────────────────────────────────────────────────────────────────────────────
class DistressSignalRequest(BaseModel):
    team: List[TeamMember] = []
    user_lat: Optional[float] = None
    user_lng: Optional[float] = None
    location_name: str = "Unknown Location"
    disaster_type: str = "emergency"
    custom_message: Optional[str] = None


@router.post("/distress_signal")
async def distress_signal(req: DistressSignalRequest):
    """
    Broadcast a distress signal to all team contacts.
    Sends SMS (Twilio) + Email (Gmail) with GPS coordinates and Google Maps link.
    Returns per-contact delivery report.
    """
    from datetime import datetime
    import pytz

    # ── Resolve location display ───────────────────────────────────────────
    has_coords = req.user_lat is not None and req.user_lng is not None
    coords_str = f"{req.user_lat:.6f}, {req.user_lng:.6f}" if has_coords else "Coordinates unavailable"
    maps_url   = f"https://maps.google.com/?q={req.user_lat},{req.user_lng}" if has_coords else "https://maps.google.com"
    waze_url   = f"https://waze.com/ul?ll={req.user_lat},{req.user_lng}&navigate=yes" if has_coords else ""

    try:
        myt = pytz.timezone("Asia/Kuala_Lumpur")
        timestamp_myt = datetime.now(myt).strftime("%d %b %Y %H:%M:%S MYT")
    except Exception:
        timestamp_myt = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ (UTC)")

    disaster_label = req.disaster_type.replace("_", " ").upper()
    household_names = ", ".join(m.name for m in req.team) if req.team else "Unknown"

    # ── Compose SMS (160 chars max per segment, keep tight) ─────────────────────
    sms_body = (
        f"🆘 DISTRESS SIGNAL | {timestamp_myt}\n"
        f"DISASTER: {disaster_label}\n"
        f"LOCATION: {req.location_name}\n"
        f"COORDS: {coords_str}\n"
        f"MAP: {maps_url}\n"
        f"HOUSEHOLD: {household_names[:40]}\n"
        f"CALL 999 (Police) | 994 (Bomba) | 1800-88-2000 (NADMA)"
    )
    if req.custom_message:
        sms_body += f"\nMSG: {req.custom_message[:80]}"

    # ── Compose Email (full detail) ──────────────────────────────────────────
    email_subject = f"🆘 DISTRESS SIGNAL — {req.location_name} — {disaster_label}"
    email_body = f"""══════════════════════════════════════════════════
🆘  MYRESILIENCE DISTRESS SIGNAL — EMERGENCY
══════════════════════════════════════════════════

TIME (MYT)   : {timestamp_myt}
DISASTER     : {disaster_label}
LOCATION     : {req.location_name}
COORDINATES  : {coords_str}
HOUSEHOLD    : {household_names}

► GOOGLE MAPS  : {maps_url}
► WAZE         : {waze_url}

──────────────────────────────────────────────────
TEAM MEMBERS:
{chr(10).join(f'  - {m.name} (Age {m.age}) | {m.role} | 📱 {m.phone or "N/A"} | 📧 {m.email or "N/A"}' for m in req.team)}
──────────────────────────────────────────────────
{f'CUSTOM MESSAGE: {req.custom_message}' if req.custom_message else ''}
══════════════════════════════════════════════════
EMERGENCY CONTACTS (MALAYSIA):
  • Police / Rescue : 999
  • Bomba (Fire)    : 994
  • Ambulans        : 991  
  • NADMA           : 1800-88-2000
  • JPS Flood       : 03-8090 8571
══════════════════════════════════════════════════
This signal was sent automatically by MyResilience SafeSync AI.
If this is a mistake, please disregard and contact the household.
══════════════════════════════════════════════════"""

    # ── Dispatch SMS to all phone numbers ─────────────────────────────────────
    phone_numbers = [m.phone.strip() for m in req.team if m.phone and m.phone.strip()]
    sms_results = send_bulk_sms(phone_numbers, sms_body) if phone_numbers else []

    # ── Dispatch Email to all email addresses ──────────────────────────────
    email_addresses = [m.email.strip() for m in req.team if m.email and m.email.strip()]
    email_results = []
    for addr in email_addresses:
        result = send_email(addr, email_subject, email_body)
        email_results.append({"email": addr, **result})

    sms_sent    = sum(1 for r in sms_results   if r.get("status") == "sent")
    email_sent  = sum(1 for r in email_results if r.get("status") == "sent")
    total_contacts = len(phone_numbers) + len(email_addresses)

    return {
        "status": "dispatched",
        "timestamp": timestamp_myt,
        "location_name": req.location_name,
        "coords": coords_str,
        "maps_url": maps_url,
        "waze_url": waze_url,
        "sms_results": sms_results,
        "email_results": email_results,
        "sms_sent": sms_sent,
        "email_sent": email_sent,
        "total_contacts": total_contacts,
        "message_preview": sms_body[:200],
    }
