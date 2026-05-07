"""Alert Dispatcher — Personalized multi-channel alert delivery.

Sends alerts to all subscribed users based on:
- Proximity to threat location
- Notification preferences (email, SMS, push)
- Language preference (en, ms, zh, ta)
- Vulnerability-aware content (elderly, children, medical conditions)
- Records delivery to alert_history table
"""
import os
from typing import Optional
from datetime import datetime

from app.db.client import get_supabase_admin
from app.agents.user_profile_service import user_profile_service


# ── Language Templates ────────────────────────────────────────────────────────

ALERT_TEMPLATES = {
    "en": {
        "subject_prefix": "🚨 MyResilience Alert",
        "threat_header": "THREAT ASSESSMENT",
        "score_label": "Threat Score",
        "factors_label": "Contributing Factors",
        "actions_label": "Recommended Actions",
        "actions": [
            "Open MyResilience app for real-time status",
            "Review evacuation advisory if issued",
            "Ensure all family members are accounted for",
            "Follow P.A.C.E. plan if situation worsens",
        ],
        "vulnerability_note": "⚠️ Your household includes vulnerable members — prioritize their safety.",
        "footer": "Stay safe. MyResilience SafeSync AI is monitoring 24/7.",
    },
    "ms": {
        "subject_prefix": "🚨 Amaran MyResilience",
        "threat_header": "PENILAIAN ANCAMAN",
        "score_label": "Skor Ancaman",
        "factors_label": "Faktor Penyumbang",
        "actions_label": "Tindakan Disyorkan",
        "actions": [
            "Buka aplikasi MyResilience untuk status masa nyata",
            "Semak nasihat evakuasi jika dikeluarkan",
            "Pastikan semua ahli keluarga dikira",
            "Ikut pelan P.A.C.E. jika keadaan bertambah buruk",
        ],
        "vulnerability_note": "⚠️ Isi rumah anda termasuk ahli yang terdedah — utamakan keselamatan mereka.",
        "footer": "Kekal selamat. MyResilience SafeSync AI memantau 24/7.",
    },
    "zh": {
        "subject_prefix": "🚨 MyResilience 警报",
        "threat_header": "威胁评估",
        "score_label": "威胁评分",
        "factors_label": "影响因素",
        "actions_label": "建议行动",
        "actions": [
            "打开 MyResilience 应用查看实时状态",
            "查看疏散建议（如已发布）",
            "确保所有家庭成员安全",
            "如情况恶化，执行 P.A.C.E. 计划",
        ],
        "vulnerability_note": "⚠️ 您的家庭包括弱势成员 — 请优先确保他们的安全。",
        "footer": "保持安全。MyResilience SafeSync AI 24/7 全天候监控。",
    },
    "ta": {
        "subject_prefix": "🚨 MyResilience எச்சரிக்கை",
        "threat_header": "அச்சுறுத்தல் மதிப்பீடு",
        "score_label": "அச்சுறுத்தல் மதிப்பெண்",
        "factors_label": "பங்களிக்கும் காரணிகள்",
        "actions_label": "பரிந்துரைக்கப்படும் நடவடிக்கைகள்",
        "actions": [
            "நிகழ்நேல நிலைக்கு MyResilience பயன்பாட்டைத் திறக்கவும்",
            "வெளியேற்ற ஆலோசனையை மதிப்பாய்வு செய்யவும்",
            "அனைத்து குடும்ப உறுப்பினர்களும் கணக்கிடப்பட்டுள்ளனர் என்பதை உறுதிசெய்யவும்",
            "நிலைமை மோசமடைந்தால் P.A.C.E. திட்டத்தைப் பின்பற்றவும்",
        ],
        "vulnerability_note": "⚠️ உங்கள் வீட்டில் பாதிக்கப்படக்கூடிய உறுப்பினர்கள் உள்ளனர் — அவர்களின் பாதுகாப்பை முன்னுரிமையாக்குங்கள்.",
        "footer": "பாதுகாப்பாக இருங்கள். MyResilience SafeSync AI 24/7 கண்காணிக்கிறது.",
    },
}


def _get_template(language: str) -> dict:
    """Get alert template for language, fallback to English."""
    return ALERT_TEMPLATES.get(language, ALERT_TEMPLATES["en"])


def _build_email_body(
    user: dict,
    level: str,
    score: float,
    factors: list[str],
    weather_summary: Optional[str] = None,
) -> tuple[str, str]:
    """Build personalized email subject and body for a user."""
    lang = user.get("language", "en")
    tmpl = _get_template(lang)
    name = user.get("full_name", "User")

    subject = f"{tmpl['subject_prefix']} — {level.upper()} ({tmpl['score_label']}: {score:.0f}/100)"

    body_lines = [
        f"Dear {name},",
        "",
        f"{'=' * 50}",
        f"  {tmpl['threat_header']}",
        f"{'=' * 50}",
        "",
        f"{tmpl['score_label']}: {level.upper()} ({score:.0f}/100)",
        f"Time: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}",
    ]

    if weather_summary:
        body_lines.append(f"Weather: {weather_summary}")

    body_lines.extend([
        "",
        f"{tmpl['factors_label']}:",
    ])
    for f in factors:
        body_lines.append(f"  • {f}")

    # Vulnerability-aware note
    vuln = user.get("vulnerability_flags", {})
    if any(vuln.values()):
        body_lines.extend(["", tmpl["vulnerability_note"]])
        dep_notes = []
        for dep in user.get("dependents", []):
            parts = []
            if dep.get("age_group") in ("elderly", "infant", "toddler"):
                parts.append(dep["age_group"])
            if dep.get("mobility_level") in ("limited", "wheelchair", "bedridden"):
                parts.append(dep["mobility_level"])
            if dep.get("medical_conditions"):
                parts.append(f"medical: {', '.join(dep['medical_conditions'])}")
            if parts:
                dep_notes.append(f"  - {dep['full_name']} ({', '.join(parts)})")
        if dep_notes:
            body_lines.extend(["", "Vulnerable members:"] + dep_notes)

    body_lines.extend([
        "",
        f"{tmpl['actions_label']}:",
    ])
    for i, action in enumerate(tmpl["actions"], 1):
        body_lines.append(f"  {i}. {action}")

    body_lines.extend([
        "",
        "─" * 50,
        tmpl["footer"],
        "",
        "— MyResilience SafeSync AI",
    ])

    return subject, "\n".join(body_lines)


def _build_sms_body(level: str, score: float, language: str = "en") -> str:
    """Build short SMS alert body."""
    if language == "ms":
        return (
            f"🚨 MyResilience AMARAN {level.upper()}\n"
            f"Skor: {score:.0f}/100\n"
            f"Buka aplikasi sekarang. Ikut nasihat evakuasi."
        )
    elif language == "zh":
        return (
            f"🚨 MyResilience {level.upper()}警报\n"
            f"评分: {score:.0f}/100\n"
            f"立即打开应用。遵循疏散建议。"
        )
    elif language == "ta":
        return (
            f"🚨 MyResilience {level.upper()} எச்சரிக்கை\n"
            f"மதிப்பெண்: {score:.0f}/100\n"
            f"இப்போது பயன்பாட்டைத் திறக்கவும். வெளியேற்ற ஆலோசனையைப் பின்பற்றவும்."
        )
    return (
        f"🚨 MyResilience {level.upper()} ALERT\n"
        f"Score: {score:.0f}/100\n"
        f"Open app now. Follow evacuation advisory."
    )


async def dispatch_personalized_alerts(
    level: str,
    score: float,
    factors: list[str],
    threat_lat: Optional[float] = None,
    threat_lng: Optional[float] = None,
    radius_km: float = 150,
    weather_summary: Optional[str] = None,
    alert_type: str = "weather",
) -> dict:
    """Dispatch personalized alerts to all affected subscribed users.

    Returns: { "email_sent": int, "sms_sent": int, "push_sent": int, "total_users": int, "errors": list }
    """
    from app.agents.autonomous.state import log_event

    stats = {"email_sent": 0, "sms_sent": 0, "push_sent": 0, "total_users": 0, "errors": []}

    try:
        # Get affected users
        if threat_lat is not None and threat_lng is not None:
            users = await user_profile_service.get_users_near_location(
                threat_lat, threat_lng, radius_km
            )
        else:
            users = await user_profile_service.get_all_subscribed_users()

        stats["total_users"] = len(users)

        if not users:
            log_event("alert_dispatcher", "no_subscribers", {"level": level})
            return stats

        supabase = get_supabase_admin()

        for user in users:
            uid = user["user_id"]
            email = user.get("email", "").strip()
            phone = user.get("phone", "").strip()
            lang = user.get("language", "en")

            # ── Email ────────────────────────────────────────────────────
            if user.get("notify_email") and email:
                try:
                    from app.agents.gmail_tools import send_email
                    subject, body = _build_email_body(user, level, score, factors, weather_summary)
                    result = send_email(email, subject, body)
                    if result.get("status") == "sent":
                        stats["email_sent"] += 1

                        # Record in alert_history
                        supabase.table("alert_history").insert({
                            "user_id": uid,
                            "alert_type": alert_type,
                            "severity": level,
                            "title": subject,
                            "description": body[:500],
                            "source": "agent_escalator",
                            "latitude": threat_lat,
                            "longitude": threat_lng,
                            "radius_km": radius_km,
                            "delivered_email": True,
                        }).execute()
                except Exception as e:
                    stats["errors"].append(f"email:{email}:{str(e)[:80]}")

            # ── SMS ──────────────────────────────────────────────────────
            if user.get("notify_sms") and phone:
                try:
                    from app.agents.sms_tools import send_sms
                    sms_body = _build_sms_body(level, score, lang)
                    result = send_sms(phone, sms_body)
                    if result.get("status") == "sent":
                        stats["sms_sent"] += 1
                except Exception as e:
                    stats["errors"].append(f"sms:{phone}:{str(e)[:80]}")

            # ── Push (record for future push notification service) ───────
            if user.get("notify_push"):
                stats["push_sent"] += 1
                # Push notifications require a service worker / FCM setup
                # For now, record the intent in alert_history
                try:
                    supabase.table("alert_history").insert({
                        "user_id": uid,
                        "alert_type": alert_type,
                        "severity": level,
                        "title": f"MyResilience {level.upper()} Alert",
                        "description": f"Threat score: {score:.0f}/100",
                        "source": "agent_escalator",
                        "latitude": threat_lat,
                        "longitude": threat_lng,
                        "delivered_push": True,
                    }).execute()
                except Exception:
                    pass

        log_event("alert_dispatcher", "dispatch_complete", {
            "level": level,
            "score": round(score),
            "total_users": stats["total_users"],
            "email_sent": stats["email_sent"],
            "sms_sent": stats["sms_sent"],
            "push_sent": stats["push_sent"],
            "errors": len(stats["errors"]),
        })

    except Exception as e:
        stats["errors"].append(f"dispatch_failed:{str(e)[:200]}")
        log_event("alert_dispatcher", "dispatch_failed", {"error": str(e)}, severity="warning")

    return stats


# Singleton
alert_dispatcher = dispatch_personalized_alerts
