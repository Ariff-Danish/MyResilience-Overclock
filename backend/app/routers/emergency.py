from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
import json
import requests
import asyncio
from datetime import datetime, timedelta
from app.agents.safesync_agents import (
    run_watcher_agent,
    run_assessor_agent,
    run_coordinator_agent,
    run_inventory_analysis_agent,
    run_pace_agent,
)

router = APIRouter()


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
    role: str  # family, emergency_contact, useful_contact
    email: Optional[str] = None
    phone: Optional[str] = None
    remarks: Optional[str] = None


class RiskEvaluationRequest(BaseModel):
    inventory: List[InventoryItem]
    team: List[TeamMember]
    location: str = "Kuala Lumpur, Malaysia"


class InventoryAnalysisRequest(BaseModel):
    inventory: List[InventoryItem]
    team: List[TeamMember]


async def fetch_met_weather() -> dict:
    forecast_url = "https://api.data.gov.my/weather/forecast?contains=Petaling@location__location_name"
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d %H:%M:%S")
    warning_url = f"https://api.data.gov.my/weather/warning?timestamp_start={yesterday}@warning_issue__issued"

    def _fetch(url):
        r = requests.get(url, timeout=10)
        r.raise_for_status()
        return r.json()
    
    try:
        # Fetch both concurrently
        forecast_data, warning_data = await asyncio.gather(
            asyncio.to_thread(_fetch, forecast_url),
            asyncio.to_thread(_fetch, warning_url)
        )

        # Process Forecast
        today_str = datetime.now().strftime("%Y-%m-%d")
        today_forecast = next((item for item in forecast_data if item.get('date') == today_str), None)
        if not today_forecast and len(forecast_data) > 0:
            today_forecast = forecast_data[0]
            
        alerts = []
        summary = "Tiada hujan"
        loc_name = "Petaling"

        if today_forecast:
            loc_name = today_forecast['location']['location_name']
            summary = today_forecast.get('summary_forecast', 'Tiada hujan')
            if any(k in summary for k in ['Ribut', 'Hujan', 'Berjerebu']):
                alerts.append({
                    "type": f"Forecast: {summary}",
                    "description": f"Morning: {today_forecast.get('morning_forecast')}. Afternoon: {today_forecast.get('afternoon_forecast')}. Night: {today_forecast.get('night_forecast')}.",
                    "estimated_onset_hours": 2.0
                })

        # Process Official Warnings (filter for Selangor/Petaling)
        for w in warning_data:
            text = w.get("text_en", "") or w.get("text_bm", "")
            if "Selangor" in text or "Petaling" in text:
                alerts.append({
                    "type": f"OFFICIAL WARNING: {w['warning_issue']['title_en']}",
                    "description": w.get("text_en", text),
                    "estimated_onset_hours": 1.0 # High priority
                })

        return {
            "location": f"{loc_name}, Malaysia",
            "current_conditions": {
                "temperature_celsius": today_forecast.get('max_temp', 32) if today_forecast else 32,
                "summary": summary
            },
            "alerts": alerts
        }
    except Exception as e:
        print(f"MET API Error: {e}")
        pass

    return {
        "location": "Petaling, Malaysia",
        "current_conditions": {"temperature_celsius": 32, "summary": "Tiada hujan"},
        "alerts": []
    }

async def fetch_mock_weather_data(demo: bool = False) -> str:
    if demo:
        return json.dumps({
            "location": "Petaling, Malaysia",
            "current_conditions": {"temperature_celsius": 28, "precipitation_mm_per_hour": 150, "wind_speed_kmh": 65},
            "alerts": [{"type": "Red Alert", "description": "Severe flash flood warning. Rivers exceeding danger levels.", "estimated_onset_hours": 2.5}]
        })
    data = await fetch_met_weather()
    return json.dumps(data)

@router.get("/weather/live")
async def live_weather(demo: bool = False):
    try:
        data = await fetch_mock_weather_data(demo)
        return json.loads(data)
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
        
        # Trigger Coordinator in PREPAREDNESS mode
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
        raw_weather = await fetch_mock_weather_data(demo)
        inv = [i.model_dump() for i in req.inventory]
        team = [t.model_dump() for t in req.team]

        weather = await run_watcher_agent(raw_weather)
        survival = await run_assessor_agent(weather, inv, team)
        coordinator = await run_coordinator_agent(weather=weather, survival=survival, team=team, location=req.location)

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
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
