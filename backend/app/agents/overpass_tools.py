"""
overpass_tools.py
─────────────────
Queries OpenStreetMap (Overpass API) for real Malaysian emergency facility
positions. No AI-generated coordinates — only actual OSM data.

Returned dicts are ShelterLocation-compatible:
    { name, address, lat, lng, type }
"""

import requests
import math
from typing import List, Optional

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
_HEADERS = {"User-Agent": "MyResilience-SafeSync/2.0"}


# ── Haversine (inline to avoid import cycles) ─────────────────────────────────
def _km(lat1, lng1, lat2, lng2):
    R = 6371
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _overpass_query(lat: float, lng: float, radius_m: int = 15000) -> list:
    """
    Run a single Overpass query fetching hospitals, police, fire stations,
    community centres, and schools near (lat, lng) within radius_m metres.
    Returns raw Overpass element list.
    """
    query = f"""
[out:json][timeout:20];
(
  node["amenity"="hospital"](around:{radius_m},{lat},{lng});
  way["amenity"="hospital"](around:{radius_m},{lat},{lng});
  node["amenity"="police"](around:{radius_m},{lat},{lng});
  way["amenity"="police"](around:{radius_m},{lat},{lng});
  node["amenity"="fire_station"](around:{radius_m},{lat},{lng});
  way["amenity"="fire_station"](around:{radius_m},{lat},{lng});
  node["amenity"="community_centre"](around:{radius_m},{lat},{lng});
  way["amenity"="community_centre"](around:{radius_m},{lat},{lng});
  node["amenity"="school"](around:10000,{lat},{lng});
  way["amenity"="school"](around:10000,{lat},{lng});
);
out center tags;
""".strip()

    try:
        r = requests.post(OVERPASS_URL, data={"data": query}, headers=_HEADERS, timeout=22)
        r.raise_for_status()
        return r.json().get("elements", [])
    except Exception as e:
        print(f"[Overpass] Query failed: {e}")
        return []


def _extract_coord(el: dict) -> Optional[tuple]:
    """Extract (lat, lng) from a node or way element."""
    if el.get("type") == "node":
        return el.get("lat"), el.get("lon")
    # way — use center if available
    center = el.get("center", {})
    if center.get("lat") and center.get("lon"):
        return center["lat"], center["lon"]
    return None


def _make_address(tags: dict, fallback_name: str = "") -> str:
    """Build a readable address from OSM tags."""
    parts = []
    for key in ("addr:houseno", "addr:street", "addr:suburb", "addr:city", "addr:state"):
        val = tags.get(key, "")
        if val:
            parts.append(val)
    return ", ".join(parts) if parts else (tags.get("operator", "") or fallback_name)


def _facility_type(amenity: str) -> str:
    """Map OSM amenity to our internal type string."""
    return {
        "hospital":          "hospital",
        "police":            "police",
        "fire_station":      "fire",
        "community_centre":  "shelter",
        "school":            "shelter",
    }.get(amenity, "shelter")


def _facility_sort_key(amenity: str) -> int:
    """Priority ordering: hospital > police > fire > shelter types."""
    return {"hospital": 0, "police": 1, "fire_station": 2, "community_centre": 3, "school": 4}.get(amenity, 5)


def fetch_real_facilities(
    lat: float,
    lng: float,
    n_shelters: int = 3,
    n_agencies: int = 5,
    radius_m: int = 15000,
) -> dict:
    """
    Query Overpass for real Malaysian emergency facilities near (lat, lng).

    Returns:
        {
            "shelter_locations": [ {name, address, lat, lng, type}, ... ],  # n_shelters items
            "enforcement_agencies": [ {name, address, lat, lng, type}, ... ],  # n_agencies items
            "source": "osm" | "empty"
        }
    """
    elements = _overpass_query(lat, lng, radius_m)

    shelters_raw = []
    agencies_raw = []

    seen_coords = set()  # De-duplicate by (lat, lng) rounded to 4dp

    for el in elements:
        tags = el.get("tags", {})
        amenity = tags.get("amenity", "")
        if not amenity:
            continue

        coord = _extract_coord(el)
        if not coord or coord[0] is None or coord[1] is None:
            continue

        elat, elng = round(float(coord[0]), 4), round(float(coord[1]), 4)
        key = (elat, elng)
        if key in seen_coords:
            continue
        seen_coords.add(key)

        # Build name — prefer official Malay/English name
        name = (
            tags.get("name:ms") or
            tags.get("name:en") or
            tags.get("name") or
            f"{amenity.replace('_', ' ').title()} (OSM)"
        )
        address = _make_address(tags, name)
        dist = _km(lat, lng, elat, elng)
        ftype = _facility_type(amenity)
        priority = _facility_sort_key(amenity)

        rec = {
            "name": name,
            "address": address,
            "lat": elat,
            "lng": elng,
            "type": ftype,
            "dist_km": dist,
            "priority": priority,
            "amenity": amenity,
        }

        if amenity in ("community_centre", "school"):
            shelters_raw.append(rec)
        else:
            agencies_raw.append(rec)

    # Sort shelters: nearest first
    shelters_raw.sort(key=lambda x: x["dist_km"])

    # Sort agencies: by type priority, then distance
    agencies_raw.sort(key=lambda x: (x["priority"], x["dist_km"]))

    # Deduplicate agencies by type — take 1 closest per type, then fill rest by distance
    type_seen = {}
    agencies_deduped = []
    for a in agencies_raw:
        t = a["type"]
        if t not in type_seen:
            type_seen[t] = True
            agencies_deduped.append(a)
    # Fill remaining slots with next-closest regardless of type
    for a in agencies_raw:
        if len(agencies_deduped) >= n_agencies:
            break
        if a not in agencies_deduped:
            agencies_deduped.append(a)

    # Strip internal fields before returning
    def _clean(rec):
        return {k: rec[k] for k in ("name", "address", "lat", "lng", "type")}

    return {
        "shelter_locations": [_clean(s) for s in shelters_raw[:n_shelters]],
        "enforcement_agencies": [_clean(a) for a in agencies_deduped[:n_agencies]],
        "source": "osm" if (shelters_raw or agencies_raw) else "empty",
    }
