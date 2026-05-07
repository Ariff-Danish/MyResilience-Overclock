"""User Profile Service — Bridge between Supabase user data and autonomous agents.

Provides agents with user context for personalized alerting:
- User locations for proximity-based alert filtering
- Dependents data for vulnerability-aware advisories
- Notification preferences for delivery channel selection
- Language preferences for multi-language alert content
"""
import os
from typing import Optional
from datetime import datetime

from app.db.client import get_supabase_admin


class UserProfileService:
    """Fetches and caches user profile data for agent consumption."""

    def __init__(self):
        self._cache: dict = {}
        self._cache_ttl_seconds = 300  # 5 minutes
        self._last_fetch: Optional[datetime] = None

    def _is_cache_valid(self) -> bool:
        if not self._last_fetch:
            return False
        elapsed = (datetime.utcnow() - self._last_fetch).total_seconds()
        return elapsed < self._cache_ttl_seconds

    async def get_all_subscribed_users(self) -> list[dict]:
        """Fetch all users with notification enabled, including their dependents.

        Returns list of dicts:
        {
            "user_id": str,
            "full_name": str,
            "email": str,
            "phone": str | None,
            "latitude": float | None,
            "longitude": float | None,
            "location_name": str,
            "state": str | None,
            "district": str | None,
            "language": str,
            "notify_email": bool,
            "notify_sms": bool,
            "notify_push": bool,
            "dependents": [
                {
                    "full_name": str,
                    "relationship": str,
                    "age_group": str,
                    "mobility_level": str,
                    "medical_conditions": list[str],
                    "medications": list[str],
                    "dietary_restrictions": list[str],
                }
            ],
            "vulnerability_flags": {
                "has_elderly": bool,
                "has_children": bool,
                "has_medical_condition": bool,
                "has_limited_mobility": bool,
                "has_infant": bool,
            }
        }
        """
        if self._is_cache_valid() and "subscribed_users" in self._cache:
            return self._cache["subscribed_users"]

        try:
            supabase = get_supabase_admin()

            # Fetch profiles with at least one notification channel enabled
            profiles_res = (
                supabase.table("profiles")
                .select("id, full_name, email, phone, latitude, longitude, "
                        "location_name, state, district, language, "
                        "notification_email, notification_sms, notification_push")
                .or_("notification_email.eq.true,notification_sms.eq.true,notification_push.eq.true")
                .execute()
            )

            if not profiles_res.data:
                self._cache["subscribed_users"] = []
                self._last_fetch = datetime.utcnow()
                return []

            # Fetch all dependents in one query
            user_ids = [p["id"] for p in profiles_res.data]
            dependents_res = (
                supabase.table("dependents")
                .select("user_id, full_name, relationship, age_group, mobility_level, "
                        "medical_conditions, medications, dietary_restrictions")
                .in_("user_id", user_ids)
                .execute()
            )

            # Group dependents by user_id
            dependents_by_user: dict[str, list] = {}
            for dep in (dependents_res.data or []):
                uid = dep["user_id"]
                if uid not in dependents_by_user:
                    dependents_by_user[uid] = []
                dependents_by_user[uid].append(dep)

            # Build enriched user list
            users = []
            for profile in profiles_res.data:
                uid = profile["id"]
                deps = dependents_by_user.get(uid, [])

                # Compute vulnerability flags from dependents
                vuln = {
                    "has_elderly": False,
                    "has_children": False,
                    "has_medical_condition": False,
                    "has_limited_mobility": False,
                    "has_infant": False,
                }
                for dep in deps:
                    ag = (dep.get("age_group") or "").lower()
                    if ag in ("elderly",):
                        vuln["has_elderly"] = True
                    if ag in ("infant", "toddler", "child"):
                        vuln["has_children"] = True
                    if ag == "infant":
                        vuln["has_infant"] = True
                    mob = (dep.get("mobility_level") or "full").lower()
                    if mob in ("limited", "wheelchair", "bedridden"):
                        vuln["has_limited_mobility"] = True
                    if dep.get("medical_conditions"):
                        vuln["has_medical_condition"] = True

                users.append({
                    "user_id": uid,
                    "full_name": profile.get("full_name", "User"),
                    "email": profile.get("email", ""),
                    "phone": profile.get("phone"),
                    "latitude": profile.get("latitude"),
                    "longitude": profile.get("longitude"),
                    "location_name": profile.get("location_name", "Malaysia"),
                    "state": profile.get("state"),
                    "district": profile.get("district"),
                    "language": profile.get("language", "en"),
                    "notify_email": profile.get("notification_email", True),
                    "notify_sms": profile.get("notification_sms", False),
                    "notify_push": profile.get("notification_push", True),
                    "dependents": [
                        {
                            "full_name": d.get("full_name", ""),
                            "relationship": d.get("relationship", "other"),
                            "age_group": d.get("age_group", "adult"),
                            "mobility_level": d.get("mobility_level", "full"),
                            "medical_conditions": d.get("medical_conditions") or [],
                            "medications": d.get("medications") or [],
                            "dietary_restrictions": d.get("dietary_restrictions") or [],
                        }
                        for d in deps
                    ],
                    "vulnerability_flags": vuln,
                })

            self._cache["subscribed_users"] = users
            self._last_fetch = datetime.utcnow()
            return users

        except Exception as e:
            print(f"[UserProfileService] Error fetching users: {e}")
            return self._cache.get("subscribed_users", [])

    async def get_users_near_location(
        self, lat: float, lng: float, radius_km: float = 100
    ) -> list[dict]:
        """Filter subscribed users within radius_km of a threat location."""
        from app.utils.geo import haversine_km

        all_users = await self.get_all_subscribed_users()
        nearby = []
        for user in all_users:
            u_lat = user.get("latitude")
            u_lng = user.get("longitude")
            if u_lat is None or u_lng is None:
                # Users without coordinates get all national alerts
                nearby.append(user)
                continue
            dist = haversine_km(lat, lng, u_lat, u_lng)
            if dist <= radius_km:
                user["_distance_km"] = round(dist, 1)
                nearby.append(user)
        return nearby

    async def get_users_by_state(self, state: str) -> list[dict]:
        """Filter subscribed users by Malaysian state."""
        all_users = await self.get_all_subscribed_users()
        return [u for u in all_users if (u.get("state") or "").lower() == state.lower()]

    def invalidate_cache(self):
        """Force cache refresh on next fetch."""
        self._cache.clear()
        self._last_fetch = None


# Singleton
user_profile_service = UserProfileService()
