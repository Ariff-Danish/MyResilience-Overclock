"""Data Source Aggregation — Multi-source intelligence gathering.

Aggregates data from Malaysian government and public sources:
- MetMalaysia (Jabatan Meteorologi Malaysia) — weather forecasts & warnings
- NADMA (Agensi Pengurusan Bencana Negara) — disaster management alerts
- DOSM (Department of Statistics Malaysia) — population vulnerability data
- Public APIs — earthquake, air quality, river levels

Provides a unified threat intelligence feed for agents.
"""
import asyncio
import json
from typing import Optional
from datetime import datetime

import httpx

from app.agents.autonomous.state import log_event, update_shared_state


# ── Source URLs ───────────────────────────────────────────────────────────────

MET_MALAYSIA_FORECAST = "https://api.data.gov.my/weather/forecast"
MET_MALAYSIA_WARNINGS = "https://api.data.gov.my/weather/warning"
MET_MALAYSIA_GENERAL = "https://api.data.gov.my/weather/general"

# NADMA public disaster feed (if available)
NADMA_ALERTS_URL = "https://www.nadma.gov.my/api/alerts"

# USGS earthquake API (covers SEA region)
USGS_EARTHQUAKE_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"

# Malaysia DOE air quality (open data)
DOE_AQI_URL = "https://api.data.gov.my/aqms/aqi"


class DataSourceAggregator:
    """Fetches and normalizes data from multiple Malaysian government sources."""

    def __init__(self):
        self._cache: dict = {}
        self._cache_ttl = 300  # 5 minutes
        self._last_fetch: dict = {}

    def _is_cache_valid(self, key: str) -> bool:
        last = self._last_fetch.get(key)
        if not last:
            return False
        return (datetime.utcnow() - last).total_seconds() < self._cache_ttl

    async def fetch_metmalaysia_forecast(self, location: str = "Petaling") -> dict:
        """Fetch weather forecast from MetMalaysia open data API.

        Returns normalized: { location, summary, temp_c, humidity, wind_kph, alerts[] }
        """
        cache_key = f"met_forecast_{location}"
        if self._is_cache_valid(cache_key):
            return self._cache[cache_key]

        result = {
            "source": "metmalaysia",
            "location": location,
            "summary": "No data",
            "temp_c": None,
            "humidity": None,
            "wind_kph": None,
            "alerts": [],
            "raw": None,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                # Try primary forecast endpoint
                params = {
                    "contains": f"Malaysia@location__location_name",
                    "limit": 10,
                }
                resp = await client.get(MET_MALAYSIA_FORECAST, params=params)

                if resp.status_code == 200:
                    data = resp.json()
                    records = data.get("data", [])
                    result["raw"] = records

                    # Find matching location
                    for record in records:
                        loc = record.get("location", {})
                        loc_name = loc.get("location_name", "").lower()
                        if location.lower() in loc_name or loc_name in location.lower():
                            result["summary"] = record.get("summary", "No data")
                            result["temp_c"] = record.get("temperature", {}).get("value")
                            result["humidity"] = record.get("humidity", {}).get("value")
                            result["wind_kph"] = record.get("wind", {}).get("speed", {}).get("value")
                            break

                    # If no match, use first record
                    if result["summary"] == "No data" and records:
                        first = records[0]
                        result["summary"] = first.get("summary", "No data")
                        result["temp_c"] = first.get("temperature", {}).get("value")

                # Try warnings endpoint
                try:
                    warn_resp = await client.get(MET_MALAYSIA_WARNINGS)
                    if warn_resp.status_code == 200:
                        warnings = warn_resp.json().get("data", [])
                        for w in warnings:
                            result["alerts"].append({
                                "type": w.get("warning_type", "weather"),
                                "description": w.get("description", ""),
                                "severity": w.get("severity", "warning"),
                                "areas": w.get("affected_areas", []),
                                "source": "metmalaysia",
                            })
                except Exception:
                    pass

        except Exception as e:
            log_event("data_aggregator", "met_fetch_failed", {"error": str(e)}, severity="warning")

        self._cache[cache_key] = result
        self._last_fetch[cache_key] = datetime.utcnow()
        return result

    async def fetch_earthquakes(self, lat: float = 4.0, lng: float = 109.0,
                                 radius_km: float = 500) -> list[dict]:
        """Fetch recent earthquakes near Malaysia from USGS.

        Returns list of: { magnitude, location, depth_km, lat, lng, time, tsunami_risk }
        """
        cache_key = "earthquakes"
        if self._is_cache_valid(cache_key):
            return self._cache[cache_key]

        earthquakes = []
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                # USGS circle search — radius in degrees (rough)
                radius_deg = radius_km / 111.0
                params = {
                    "format": "geojson",
                    "starttime": (datetime.utcnow().strftime("%Y-%m-%d")),
                    "minmagnitude": 3.0,
                    "latitude": lat,
                    "longitude": lng,
                    "maxradiuskm": radius_km,
                    "limit": 20,
                }
                resp = await client.get(USGS_EARTHQUAKE_URL, params=params)

                if resp.status_code == 200:
                    data = resp.json()
                    for feature in data.get("features", []):
                        props = feature.get("properties", {})
                        coords = feature.get("geometry", {}).get("coordinates", [0, 0, 0])
                        mag = props.get("mag", 0)
                        earthquakes.append({
                            "magnitude": mag,
                            "location": props.get("place", "Unknown"),
                            "depth_km": coords[2] if len(coords) > 2 else 0,
                            "lat": coords[1] if len(coords) > 1 else 0,
                            "lng": coords[0] if len(coords) > 0 else 0,
                            "time": props.get("time"),
                            "tsunami_risk": mag >= 6.0 and (coords[2] or 0) < 100,
                            "source": "usgs",
                        })

        except Exception as e:
            log_event("data_aggregator", "earthquake_fetch_failed", {"error": str(e)}, severity="warning")

        self._cache[cache_key] = earthquakes
        self._last_fetch[cache_key] = datetime.utcnow()
        return earthquakes

    async def fetch_air_quality(self) -> dict:
        """Fetch air quality data from Malaysia DOE.

        Returns: { aqi: int, status: str, location: str, pm25: float, source: str }
        """
        cache_key = "air_quality"
        if self._is_cache_valid(cache_key):
            return self._cache[cache_key]

        result = {
            "source": "doe_malaysia",
            "aqi": None,
            "status": "unknown",
            "location": "Malaysia",
            "pm25": None,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                resp = await client.get(DOE_AQI_URL)
                if resp.status_code == 200:
                    data = resp.json()
                    records = data.get("data", [])
                    if records:
                        # Use the worst AQI reading
                        worst = max(records, key=lambda r: r.get("aqi", 0))
                        aqi = worst.get("aqi", 0)
                        result["aqi"] = aqi
                        result["location"] = worst.get("station_name", "Malaysia")
                        result["pm25"] = worst.get("pm25")

                        if aqi <= 50:
                            result["status"] = "good"
                        elif aqi <= 100:
                            result["status"] = "moderate"
                        elif aqi <= 200:
                            result["status"] = "unhealthy"
                        elif aqi <= 300:
                            result["status"] = "very_unhealthy"
                        else:
                            result["status"] = "hazardous"

                        # Add haze alert if unhealthy
                        if aqi > 100:
                            result["alert"] = {
                                "type": "haze",
                                "severity": "warning" if aqi <= 200 else "critical",
                                "description": f"Air quality {result['status'].upper()} — AQI {aqi} at {result['location']}",
                                "source": "doe_malaysia",
                            }

        except Exception as e:
            log_event("data_aggregator", "aqi_fetch_failed", {"error": str(e)}, severity="warning")

        self._cache[cache_key] = result
        self._last_fetch[cache_key] = datetime.utcnow()
        return result

    async def fetch_nadma_alerts(self) -> list[dict]:
        """Attempt to fetch NADMA disaster alerts.

        NADMA may not have a public API — falls back to scraping or returns empty.
        Returns list of: { type, description, severity, areas[], source }
        """
        cache_key = "nadma"
        if self._is_cache_valid(cache_key):
            return self._cache[cache_key]

        alerts = []
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(NADMA_ALERTS_URL)
                if resp.status_code == 200:
                    data = resp.json()
                    for item in data.get("alerts", data.get("data", [])):
                        alerts.append({
                            "type": item.get("type", "disaster"),
                            "description": item.get("description", item.get("title", "")),
                            "severity": item.get("severity", "warning"),
                            "areas": item.get("areas", item.get("affected_states", [])),
                            "source": "nadma",
                        })
        except Exception:
            # NADMA API may not be publicly available — this is expected
            pass

        self._cache[cache_key] = alerts
        self._last_fetch[cache_key] = datetime.utcnow()
        return alerts

    async def aggregate_all(self, location: str = "Petaling",
                             user_lat: float = 3.0, user_lng: float = 101.5) -> dict:
        """Fetch all sources in parallel and return unified intelligence.

        Returns: {
            weather: dict,
            earthquakes: list,
            air_quality: dict,
            nadma_alerts: list,
            combined_alerts: list,
            summary: str,
            fetched_at: str,
        }
        """
        weather_task = self.fetch_metmalaysia_forecast(location)
        earthquake_task = self.fetch_earthquakes(user_lat, user_lng)
        aqi_task = self.fetch_air_quality()
        nadma_task = self.fetch_nadma_alerts()

        weather, earthquakes, air_quality, nadma_alerts = await asyncio.gather(
            weather_task, earthquake_task, aqi_task, nadma_task,
            return_exceptions=True,
        )

        # Handle exceptions gracefully
        if isinstance(weather, Exception):
            weather = {"source": "metmalaysia", "summary": "Unavailable", "alerts": []}
        if isinstance(earthquakes, Exception):
            earthquakes = []
        if isinstance(air_quality, Exception):
            air_quality = {"source": "doe", "aqi": None, "status": "unknown"}
        if isinstance(nadma_alerts, Exception):
            nadma_alerts = []

        # Combine all alerts into unified feed
        combined_alerts = []
        combined_alerts.extend(weather.get("alerts", []))
        combined_alerts.extend(nadma_alerts)

        # Add earthquake alerts
        for eq in earthquakes:
            if eq.get("magnitude", 0) >= 4.0:
                combined_alerts.append({
                    "type": "earthquake",
                    "description": f"M{eq['magnitude']} earthquake — {eq['location']}",
                    "severity": "critical" if eq.get("tsunami_risk") else "warning",
                    "areas": [eq["location"]],
                    "source": "usgs",
                })

        # Add air quality alert
        if air_quality.get("alert"):
            combined_alerts.append(air_quality["alert"])

        # Build summary
        alert_count = len(combined_alerts)
        if alert_count == 0:
            summary = f"All clear — no active threats for {location}"
        else:
            types = set(a.get("type", "unknown") for a in combined_alerts)
            summary = f"{alert_count} active alert(s): {', '.join(types)}"

        result = {
            "weather": weather,
            "earthquakes": earthquakes,
            "air_quality": air_quality,
            "nadma_alerts": nadma_alerts,
            "combined_alerts": combined_alerts,
            "summary": summary,
            "fetched_at": datetime.utcnow().isoformat() + "Z",
        }

        # Update shared state for agents
        update_shared_state("aggregated_intelligence", result)

        log_event("data_aggregator", "aggregation_complete", {
            "weather_ok": weather.get("summary") != "Unavailable",
            "earthquakes": len(earthquakes),
            "aqi": air_quality.get("aqi"),
            "nadma_alerts": len(nadma_alerts),
            "combined_alerts": alert_count,
        })

        return result


# Singleton
data_aggregator = DataSourceAggregator()
