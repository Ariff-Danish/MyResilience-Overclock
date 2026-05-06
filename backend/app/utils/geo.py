"""Shared geographic utilities for MyResilience.

Single-source-of-truth for:
  - haversine_km: great-circle distance between two GPS points
  - parse_location_from_warning_text: extract state/district from MET warning text

Import from here — do NOT define haversine in multiple modules.
"""
import math
import re
from typing import Optional


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Return great-circle distance in km between two GPS coordinates."""
    R = 6371.0
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dlng / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


# ── Malaysian state/district → approx centre coordinates ──────────────────────
# Covers all 13 states + 3 Federal Territories + major Sabah/Sarawak districts
MALAYSIA_LOCATION_COORDS: dict[str, tuple[float, float]] = {
    # Klang Valley / Selangor
    "petaling":       (3.1073, 101.6297),
    "selangor":       (3.0738, 101.5183),
    "kuala lumpur":   (3.1390, 101.6869),
    "klang":          (3.0448, 101.4453),
    "ampang":         (3.1478, 101.7470),
    "hulu langat":    (3.0000, 101.8333),
    "sepang":         (2.7297, 101.7054),
    "gombak":         (3.2427, 101.7289),
    "kuala selangor": (3.3400, 101.2500),
    "sabak bernam":   (3.7667, 100.9833),
    # Johor
    "johor bahru":    (1.4927, 103.7414),
    "johor":          (1.9344, 103.3587),
    "kluang":         (2.0259, 103.3189),
    "muar":           (2.0442, 102.5689),
    "pontian":        (1.4833, 103.3833),
    "kulai":          (1.6667, 103.6000),
    "kota tinggi":    (1.7167, 103.9167),
    # Kedah
    "alor setar":     (6.1184, 100.3679),
    "kedah":          (6.1184, 100.3679),
    "langkawi":       (6.3500, 99.8000),
    "kuala muda":     (5.7333, 100.4167),
    # Kelantan
    "kota bharu":     (6.1248, 102.2379),
    "kelantan":       (5.5000, 102.0000),
    # Melaka
    "melaka":         (2.1896, 102.2501),
    # Negeri Sembilan
    "seremban":       (2.7297, 101.9381),
    "negeri sembilan": (2.7297, 101.9381),
    "port dickson":   (2.5220, 101.7964),
    # Pahang
    "kuantan":        (3.8077, 103.3260),
    "pahang":         (3.8077, 103.3260),
    # Penang
    "penang":         (5.4164, 100.3327),
    "george town":    (5.4141, 100.3288),
    # Perak
    "ipoh":           (4.5975, 101.0901),
    "perak":          (4.5975, 101.0901),
    "kerian":         (5.0667, 100.6000),
    "larut":          (4.8500, 100.7833),
    "hulu perak":     (5.2833, 101.1333),
    # Perlis
    "kangar":         (6.4449, 100.1986),
    "perlis":         (6.4449, 100.1986),
    # Putrajaya
    "putrajaya":      (2.9264, 101.6964),
    # Sabah
    "kota kinabalu":  (5.9804, 116.0735),
    "sabah":          (5.9804, 116.0735),
    "sandakan":       (5.8402, 118.1179),
    "tawau":          (4.2415, 117.8892),
    "lahad datu":     (5.0297, 118.3280),
    "kudat":          (6.8827, 116.8448),
    "sipitang":       (5.0897, 115.5605),
    "beaufort":       (5.3647, 115.7461),
    "papar":          (5.7381, 116.0000),
    "penampang":      (5.9000, 116.1000),
    "tuaran":         (6.1859, 116.2439),
    "kota belud":     (6.3487, 116.4357),
    "kuala penyu":    (5.6127, 115.6000),
    "putatan":        (5.8917, 116.0733),
    # Sarawak
    "kuching":        (1.5497, 110.3626),
    "sarawak":        (1.5497, 110.3626),
    "miri":           (4.3995, 113.9914),
    "sibu":           (2.3000, 111.8167),
    "bintulu":        (3.1696, 113.0394),
    "limbang":        (4.7441, 115.0040),
    "sri aman":       (1.2358, 111.4683),
    "betong":         (1.4000, 111.5167),
    "sarikei":        (2.1286, 111.5217),
    "mukah":          (2.9011, 112.0865),
    "kapit":          (2.0167, 112.9333),
    "serian":         (1.1779, 110.5697),
    "samarahan":      (1.4572, 110.4760),
    # Terengganu
    "kuala terengganu": (5.3302, 103.1408),
    "terengganu":     (5.3302, 103.1408),
    # FT Labuan
    "labuan":         (5.2831, 115.2308),
}


def parse_location_from_warning_text(warning_text: str) -> Optional[str]:
    """
    Extract the first recognisable Malaysian location from a MET warning string.
    Returns the lowercase matched key from MALAYSIA_LOCATION_COORDS, or None.

    Example:
      "Thunderstorms over Selangor (Gombak, Petaling) and Johor Bahru until..."
      → "selangor"
    """
    if not warning_text:
        return None
    text_lower = warning_text.lower()
    # Try longest keys first (e.g. "johor bahru" before "johor")
    for key in sorted(MALAYSIA_LOCATION_COORDS.keys(), key=len, reverse=True):
        if key in text_lower:
            return key
    return None


def get_coords_for_location(location_name: str) -> Optional[tuple[float, float]]:
    """
    Return (lat, lng) for a Malaysian location name string.
    Searches all known keys as substrings of the normalised input.
    """
    if not location_name:
        return None
    name_lower = location_name.lower().strip()
    # Exact match first
    if name_lower in MALAYSIA_LOCATION_COORDS:
        return MALAYSIA_LOCATION_COORDS[name_lower]
    # Substring match — longest key first
    for key in sorted(MALAYSIA_LOCATION_COORDS.keys(), key=len, reverse=True):
        if key in name_lower:
            return MALAYSIA_LOCATION_COORDS[key]
    return None
