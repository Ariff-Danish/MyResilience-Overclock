from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import json
import math
import requests
import asyncio
from datetime import datetime, timedelta
from app.agents.safesync_agents import (
    run_watcher_agent,
    run_assessor_agent,
    run_coordinator_agent,
    run_inventory_analysis_agent,
    run_pace_agent,
    run_evacuation_advisor_agent,
)
from app.agents.sms_tools import send_bulk_sms

router = APIRouter()

# ── Proximity threshold: alerts are suppressed if disaster is further than this ─
PROXIMITY_ALERT_KM = 150.0


# ── Haversine ──────────────────────────────────────────────────────────────────
def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng/2)**2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── Known Malaysian district/state → approx centre coordinates ────────────────
# Used to compute distance between user and disaster location
MALAYSIA_LOCATION_COORDS = {
    # Klang Valley / Selangor
    "petaling":      (3.1073, 101.6297),
    "selangor":      (3.0738, 101.5183),
    "kuala lumpur":  (3.1390, 101.6869),
    "klang":         (3.0448, 101.4453),
    "ampang":        (3.1478, 101.7470),
    "hulu langat":   (3.0000, 101.8333),
    "sepang":        (2.7297, 101.7054),
    "gombak":        (3.2427, 101.7289),
    "kuala selangor":(3.3400, 101.2500),
    "sabak bernam":  (3.7667, 100.9833),
    # Johor
    "johor bahru":   (1.4927, 103.7414),
    "johor":         (1.9344, 103.3587),
    "kluang":        (2.0259, 103.3189),
    "muar":          (2.0442, 102.5689),
    # Kedah
    "alor setar":    (6.1184, 100.3679),
    "kedah":         (6.1184, 100.3679),
    "langkawi":      (6.3500, 99.8000),
    # Kelantan
    "kota bharu":    (6.1254, 102.2381),
    "kelantan":      (5.4000, 102.0000),
    # Melaka
    "melaka":        (2.1896, 102.2501),
    # Negeri Sembilan
    "seremban":      (2.7297, 101.9381),
    "negeri sembilan":(2.7297, 101.9381),
    # Pahang
    "kuantan":       (3.8077, 103.3260),
    "pahang":        (3.8077, 103.3260),
    "cameron":       (4.4714, 101.3800),
    # Penang
    "penang":        (5.4141, 100.3288),
    "georgetown":    (5.4141, 100.3288),
    # Perak
    "ipoh":          (4.5975, 101.0901),
    "perak":         (4.5975, 101.0901),
    # Perlis
    "perlis":        (6.4449, 100.2048),
    "kangar":        (6.4449, 100.2048),
    # Putrajaya / Labuan
    "putrajaya":     (2.9264, 101.6964),
    "labuan":        (5.2831, 115.2308),
    # Sabah
    "kota kinabalu": (5.9804, 116.0735),
    "sabah":         (5.9804, 116.0735),
    "sandakan":      (5.8402, 118.1179),
    "tawau":         (4.2449, 117.8912),
    "lahad datu":    (5.0279, 118.3291),
    "keningau":      (5.3363, 116.1637),
    "ranau":         (5.9614, 116.6694),
    # Sarawak
    "kuching":       (1.5497, 110.3625),
    "sarawak":       (1.5497, 110.3625),
    "miri":          (4.3995, 113.9914),
    "sibu":          (2.3000, 111.8167),
    "bintulu":       (3.1667, 113.0333),
    # Terengganu
    "kuala terengganu": (5.3296, 103.1370),
    "terengganu":    (5.3296, 103.1370),
}

def lookup_location_coords(location_text: str):
    """Return (lat, lng) for a location string by fuzzy-matching our table."""
    text = location_text.lower()
    for key, coords in MALAYSIA_LOCATION_COORDS.items():
        if key in text:
            return coords
    return None


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
            "city":    addr.get("city") or addr.get("town") or addr.get("village") or addr.get("county", ""),
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
            "current_conditions": {"temperature_celsius": 28, "precipitation_mm_per_hour": 150, "wind_speed_kmh": 65},
            "alerts": [{
                "type": "Red Alert",
                "description": "Severe flash flood warning. Rivers exceeding danger levels.",
                "estimated_onset_hours": 2.5,
                "location": user_location_name,
            }]
        })
    data = await fetch_met_weather(user_location_name)
    return json.dumps(data)


# ── Proximity filter for alerts ────────────────────────────────────────────────
def filter_alerts_by_proximity(alerts: list, user_lat: float, user_lng: float) -> tuple[list, list]:
    """
    Split alerts into (nearby_alerts, distant_alerts).
    An alert is 'nearby' if its disaster location is within PROXIMITY_ALERT_KM of the user.
    Alerts with no parseable location are included by default.
    """
    nearby, distant = [], []
    for alert in alerts:
        loc_text = alert.get("location", "")
        disaster_coords = lookup_location_coords(loc_text)
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
    try:
        inv = [i.model_dump() for i in req.inventory]
        team = [t.model_dump() for t in req.team]
        result = await run_pace_agent(inv, team, req.location)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analyze_inventory")
async def analyze_inventory(req: InventoryAnalysisRequest):
    try:
        inv = [i.model_dump() for i in req.inventory]
        team = [t.model_dump() for t in req.team]
        analysis = await run_inventory_analysis_agent(inv, team)
        coordinator = await run_coordinator_agent(inventory_analysis=analysis, team=team)
        return {
            "analysis": analysis.model_dump(),
            "coordinator_message": coordinator.message_drafted
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

        weather = await run_watcher_agent(raw_weather)
        survival = await run_assessor_agent(weather, inv, team)
        coordinator = await run_coordinator_agent(
            weather=weather, survival=survival, team=team, location=user_location_display
        )

        # Autonomous dispatch — only if user is actually in an affected area
        evac_data = None
        sms_auto_results = []
        if survival.evacuation_urgency in ["immediate", "prepare"] and nearby_alerts:
            try:
                evac_result = await run_evacuation_advisor_agent(
                    disaster_type=weather.disaster_type,
                    severity=weather.severity,
                    location=user_location_display,
                    team=team
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
            team=team_data
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
