"""Escalation Engine — Autonomous Decision-Making.

Continuously evaluates cross-agent signals and makes escalation decisions:
- Correlates weather threats + inventory health + team vulnerability
- Determines escalation level (info → warning → critical → emergency)
- Triggers autonomous actions: SMS alerts, email broadcasts, evacuation advisories
- Maintains decision audit trail for accountability
"""
import asyncio
import json
from typing import Optional
from datetime import datetime, timedelta

from app.agents.autonomous.state import (
    log_event, update_agent_status, get_decision, save_decision,
    log_escalation, get_shared_state, update_shared_state,
    get_recent_events,
)


class EscalationEngine:
    """Correlates signals from all agents and makes autonomous escalation decisions."""

    AGENT_NAME = "escalator"
    EVALUATION_INTERVAL_SECONDS = 120  # 2 minutes
    ESCALATION_COOLDOWN_SECONDS = 900  # 15 min between same-level escalations

    # Escalation thresholds
    THREAT_LEVELS = {
        "info": {"min_score": 0, "max_score": 25},
        "warning": {"min_score": 25, "max_score": 50},
        "critical": {"min_score": 50, "max_score": 75},
        "emergency": {"min_score": 75, "max_score": 100},
    }

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._last_escalation_level = "info"

    async def start(self):
        """Start the escalation evaluation loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._evaluation_loop())
        update_agent_status(self.AGENT_NAME, "active", {"message": "Escalation engine started"})
        log_event(self.AGENT_NAME, "agent_started", {"interval": self.EVALUATION_INTERVAL_SECONDS})

    async def stop(self):
        """Stop the escalation evaluation loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        update_agent_status(self.AGENT_NAME, "stopped")
        log_event(self.AGENT_NAME, "agent_stopped", {})

    async def _evaluation_loop(self):
        """Main evaluation loop — correlates signals every 2 minutes."""
        while self._running:
            try:
                await self._evaluate_situation()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log_event(self.AGENT_NAME, "error", {"error": str(e)}, severity="warning")
                update_agent_status(self.AGENT_NAME, "error", {"error": str(e)})
            await asyncio.sleep(self.EVALUATION_INTERVAL_SECONDS)

    async def _evaluate_situation(self):
        """Correlate all agent signals into a unified threat score."""
        update_agent_status(self.AGENT_NAME, "evaluating")

        # ── Gather Signals ────────────────────────────────────────────────
        weather = get_shared_state("last_weather", {})
        inventory_health = get_shared_state("inventory_health", {})
        recommendations = get_shared_state("guardian_recommendations", [])
        recent_events = get_recent_events(limit=30)

        # ── Compute Composite Threat Score (0–100) ───────────────────────
        score = 0
        factors = []

        # Weather threat contribution (0–40 points)
        nearby_alerts = weather.get("nearby_alerts", 0)
        if nearby_alerts > 0:
            weather_score = min(40, nearby_alerts * 15)
            score += weather_score
            factors.append(f"Weather: +{weather_score} ({nearby_alerts} nearby alert(s))")

        # Inventory health contribution (0–30 points)
        health_score = inventory_health.get("health_score", 100)
        if health_score < 100:
            inv_penalty = min(30, (100 - health_score) * 0.5)
            score += inv_penalty
            factors.append(f"Inventory: +{inv_penalty:.0f} (health {health_score}/100)")

        # Critical stock contribution (0–15 points)
        critical_stock = inventory_health.get("critical_stock", [])
        if critical_stock:
            stock_penalty = min(15, len(critical_stock) * 5)
            score += stock_penalty
            factors.append(f"Stockout: +{stock_penalty} ({len(critical_stock)} items)")

        # Household vulnerability bonus (0–15 points)
        household = inventory_health.get("household", {})
        vuln_bonus = 0
        if household.get("has_elderly"):
            vuln_bonus += 5
        if household.get("has_children"):
            vuln_bonus += 5
        if household.get("has_medical_condition"):
            vuln_bonus += 5
        if vuln_bonus > 0:
            score += vuln_bonus
            factors.append(f"Vulnerability: +{vuln_bonus} (elderly/children/medical)")

        score = min(100, score)

        # ── Determine Escalation Level ───────────────────────────────────
        level = "info"
        for lvl, thresholds in self.THREAT_LEVELS.items():
            if thresholds["min_score"] <= score < thresholds["max_score"]:
                level = lvl
                break
        if score >= 75:
            level = "emergency"

        # ── Cooldown Check ───────────────────────────────────────────────
        last_decision = get_decision(self.AGENT_NAME, "last_escalation")
        now_ts = datetime.utcnow().timestamp()
        if last_decision:
            last_ts = datetime.fromisoformat(
                last_decision.get("timestamp", "2000-01-01T00:00:00Z").rstrip("Z")
            ).timestamp()
            last_level = last_decision.get("level", "info")
            level_order = {"info": 0, "warning": 1, "critical": 2, "emergency": 3}
            # Only escalate if level increased or cooldown expired
            if (level_order.get(level, 0) <= level_order.get(last_level, 0) and
                    now_ts - last_ts < self.ESCALATION_COOLDOWN_SECONDS):
                update_agent_status(self.AGENT_NAME, "monitoring", {
                    "score": round(score),
                    "level": level,
                    "cooldown": True,
                    "factors": factors,
                })
                return

        # ── Take Autonomous Action Based on Level ────────────────────────
        actions_taken = []

        if level in ("critical", "emergency"):
            # Auto-generate evacuation advisory
            evacuation = get_shared_state("autonomous_evacuation", None)
            if not evacuation:
                actions_taken.append("triggered_evacuation_generation")
                await self._trigger_evacuation(weather)

            # Auto-SMS for emergency
            if level == "emergency":
                sms_sent = await self._send_emergency_sms(score, factors)
                if sms_sent:
                    actions_taken.append("emergency_sms_sent")

            # Auto-email for critical+
            email_sent = await self._send_emergency_email(score, factors, level)
            if email_sent:
                actions_taken.append("emergency_email_sent")

        elif level == "warning":
            # Log warning, no external action
            actions_taken.append("warning_logged")

        # ── Record Decision ──────────────────────────────────────────────
        decision = {
            "score": round(score),
            "level": level,
            "factors": factors,
            "actions_taken": actions_taken,
            "timestamp": datetime.utcnow().isoformat() + "Z",
        }
        save_decision(self.AGENT_NAME, "last_escalation", decision)

        if level != "info":
            log_escalation(
                self.AGENT_NAME,
                level=level,
                action="situation_evaluated",
                context=decision,
            )

        self._last_escalation_level = level

        update_agent_status(self.AGENT_NAME, "monitoring", {
            "score": round(score),
            "level": level,
            "factors": factors,
            "actions": actions_taken,
            "last_eval": datetime.utcnow().isoformat() + "Z",
        })

        log_event(self.AGENT_NAME, "evaluation_complete", {
            "score": round(score),
            "level": level,
            "actions": actions_taken,
        })

    async def _trigger_evacuation(self, weather: dict):
        """Generate evacuation advisory autonomously."""
        try:
            from app.agents.safesync_agents import run_evacuation_advisor_agent

            alerts = weather.get("alerts", [])
            if not alerts:
                return

            primary = alerts[0]
            alert_text = primary.get("type", "").lower()
            disaster_type = "flood"
            for dtype in ["flood", "storm", "haze", "fire", "earthquake", "tsunami", "landslide"]:
                if dtype in alert_text:
                    disaster_type = dtype
                    break

            team = get_shared_state("team", [])
            location = get_shared_state("user_location_display", "Malaysia")
            user_lat = get_shared_state("user_lat")
            user_lng = get_shared_state("user_lng")

            result = await run_evacuation_advisor_agent(
                disaster_type=disaster_type,
                severity="critical",
                location=location,
                team=team,
                user_lat=user_lat,
                user_lng=user_lng,
            )

            update_shared_state("autonomous_evacuation", {
                "advisory": result.model_dump(),
                "generated_at": datetime.utcnow().isoformat() + "Z",
                "trigger": "escalator_autonomous",
                "alert_type": primary.get("type", ""),
            })

            log_event(self.AGENT_NAME, "evacuation_triggered", {
                "disaster_type": disaster_type,
            })

        except Exception as e:
            log_event(self.AGENT_NAME, "evacuation_failed", {"error": str(e)}, severity="warning")

    async def _send_emergency_sms(self, score: float, factors: list) -> bool:
        """Send emergency SMS to all team members with phone numbers."""
        try:
            team = get_shared_state("team", [])
            phone_numbers = [m.get("phone", "").strip() for m in team if m.get("phone", "").strip()]
            if not phone_numbers:
                return False

            from app.agents.sms_tools import send_bulk_sms

            msg = (
                f"🚨 MyResilience EMERGENCY ALERT\n"
                f"Threat Level: {score:.0f}/100\n"
                f"Action: Check MyResilience app immediately.\n"
                f"Follow evacuation advisory if issued."
            )
            results = send_bulk_sms(phone_numbers, msg)
            sent = sum(1 for r in results if r.get("status") == "sent")

            log_event(self.AGENT_NAME, "emergency_sms", {
                "sent": sent,
                "total": len(phone_numbers),
            })
            return sent > 0

        except Exception as e:
            log_event(self.AGENT_NAME, "sms_failed", {"error": str(e)}, severity="warning")
            return False

    async def _send_emergency_email(self, score: float, factors: list, level: str) -> bool:
        """Send emergency email broadcast."""
        try:
            from app.agents.gmail_tools import send_email

            team = get_shared_state("team", [])
            emails = [m.get("email", "").strip() for m in team if m.get("email", "").strip()]
            if not emails:
                return False

            subject = f"🚨 MyResilience {level.upper()} Alert — Threat Score {score:.0f}/100"
            body = (
                f"MyResilience Autonomous Alert\n"
                f"{'=' * 40}\n\n"
                f"Threat Level: {level.upper()} ({score:.0f}/100)\n"
                f"Time: {datetime.utcnow().strftime('%Y-%m-%d %H:%M UTC')}\n\n"
                f"Contributing Factors:\n"
            )
            for f in factors:
                body += f"  • {f}\n"
            body += (
                f"\nAction Required:\n"
                f"  1. Open MyResilience app for real-time status\n"
                f"  2. Review evacuation advisory if issued\n"
                f"  3. Ensure all family members are accounted for\n"
                f"  4. Follow P.A.C.E. plan if situation worsens\n"
            )

            sent_count = 0
            for email in emails:
                try:
                    send_email(email, subject, body)
                    sent_count += 1
                except Exception:
                    pass

            log_event(self.AGENT_NAME, "emergency_email", {
                "sent": sent_count,
                "total": len(emails),
            })
            return sent_count > 0

        except Exception as e:
            log_event(self.AGENT_NAME, "email_failed", {"error": str(e)}, severity="warning")
            return False


# Singleton instance
escalator = EscalationEngine()
