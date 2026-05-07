"""Daily Briefing Agent — Autonomous Preparedness Reports.

Generates scheduled reports without human intervention:
- Morning briefing (8 AM MYT): Weather forecast + inventory status + recommendations
- Evening summary (8 PM MYT): Day's events + escalations + action items
- On-demand briefing via API endpoint
- Stores briefings in state for frontend consumption
"""
import asyncio
import json
from typing import Optional
from datetime import datetime, timezone, timedelta

from app.agents.autonomous.state import (
    log_event, update_agent_status, get_shared_state, update_shared_state,
    get_recent_events, get_escalation_history,
)

# Malaysia timezone (UTC+8)
MYT = timezone(timedelta(hours=8))


class BriefingAgent:
    """Generates daily preparedness briefings on schedule."""

    AGENT_NAME = "briefing"
    CHECK_INTERVAL_SECONDS = 300  # Check every 5 minutes if it's time to brief
    MORNING_HOUR = 8  # 8 AM MYT
    EVENING_HOUR = 20  # 8 PM MYT

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._last_morning_date: Optional[str] = None
        self._last_evening_date: Optional[str] = None

    async def start(self):
        """Start the briefing scheduler loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._scheduler_loop())
        update_agent_status(self.AGENT_NAME, "active", {"message": "Briefing agent started"})
        log_event(self.AGENT_NAME, "agent_started", {
            "morning_hour": self.MORNING_HOUR,
            "evening_hour": self.EVENING_HOUR,
        })

    async def stop(self):
        """Stop the briefing scheduler loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        update_agent_status(self.AGENT_NAME, "stopped")
        log_event(self.AGENT_NAME, "agent_stopped", {})

    async def _scheduler_loop(self):
        """Check every 5 minutes if it's time for a briefing."""
        while self._running:
            try:
                now = datetime.now(MYT)
                today_str = now.strftime("%Y-%m-%d")

                # Morning briefing at 8 AM MYT
                if (now.hour == self.MORNING_HOUR and
                        now.minute < 5 and
                        self._last_morning_date != today_str):
                    self._last_morning_date = today_str
                    await self._generate_briefing("morning")

                # Evening briefing at 8 PM MYT
                if (now.hour == self.EVENING_HOUR and
                        now.minute < 5 and
                        self._last_evening_date != today_str):
                    self._last_evening_date = today_str
                    await self._generate_briefing("evening")

            except asyncio.CancelledError:
                break
            except Exception as e:
                log_event(self.AGENT_NAME, "error", {"error": str(e)}, severity="warning")
                update_agent_status(self.AGENT_NAME, "error", {"error": str(e)})

            await asyncio.sleep(self.CHECK_INTERVAL_SECONDS)

    async def generate_on_demand(self, briefing_type: str = "on_demand") -> dict:
        """Generate a briefing on demand (triggered by API call)."""
        return await self._generate_briefing(briefing_type)

    async def _generate_briefing(self, briefing_type: str) -> dict:
        """Generate a comprehensive briefing using LLM + agent data."""
        update_agent_status(self.AGENT_NAME, "generating", {"type": briefing_type})

        now = datetime.now(MYT)

        # ── Gather Data from All Agents ───────────────────────────────────
        weather = get_shared_state("last_weather", {})
        inventory_health = get_shared_state("inventory_health", {})
        recommendations = get_shared_state("guardian_recommendations", [])
        evacuation = get_shared_state("autonomous_evacuation", None)
        recent_events = get_recent_events(limit=20)
        escalations = get_escalation_history(limit=10)

        # ── Build Briefing Context ───────────────────────────────────────
        context = {
            "type": briefing_type,
            "generated_at": now.isoformat(),
            "weather": {
                "summary": weather.get("summary", "No data"),
                "temp": weather.get("temp_celsius", "N/A"),
                "nearby_alerts": weather.get("nearby_alerts", 0),
                "location": weather.get("location", "Unknown"),
            },
            "inventory": {
                "health_score": inventory_health.get("health_score", "N/A"),
                "expired": len(inventory_health.get("expired_items", [])),
                "expiring_soon": len(inventory_health.get("expiring_soon", [])),
                "critical_stock": len(inventory_health.get("critical_stock", [])),
                "low_stock": len(inventory_health.get("low_stock_items", [])),
            },
            "recommendations_count": len(recommendations),
            "top_recommendations": recommendations[:5],
            "recent_escalations": len(escalations),
            "has_active_evacuation": evacuation is not None,
            "events_today": len([
                e for e in recent_events
                if e.get("timestamp", "").startswith(now.strftime("%Y-%m-%d"))
            ]),
        }

        # ── Generate LLM Briefing Text ───────────────────────────────────
        try:
            briefing_text = await self._generate_llm_briefing(context, briefing_type)
        except Exception as e:
            briefing_text = self._generate_fallback_briefing(context, briefing_type)
            log_event(self.AGENT_NAME, "llm_fallback", {"error": str(e)}, severity="warning")

        # ── Build Final Briefing ─────────────────────────────────────────
        briefing = {
            "id": f"brief_{briefing_type}_{int(now.timestamp())}",
            "type": briefing_type,
            "generated_at": now.isoformat(),
            "title": self._get_title(briefing_type, now),
            "summary": briefing_text,
            "context": context,
            "action_items": self._extract_action_items(context),
        }

        # Store in shared state for frontend
        update_shared_state(f"briefing_{briefing_type}", briefing)
        update_shared_state("latest_briefing", briefing)

        log_event(self.AGENT_NAME, "briefing_generated", {
            "type": briefing_type,
            "health_score": context["inventory"]["health_score"],
            "alerts": context["weather"]["nearby_alerts"],
        })

        update_agent_status(self.AGENT_NAME, "idle", {
            "last_briefing": briefing_type,
            "generated_at": now.isoformat(),
        })

        return briefing

    async def _generate_llm_briefing(self, context: dict, briefing_type: str) -> str:
        """Use Groq LLM to generate a natural-language briefing."""
        from app.agents.config import get_groq_client, get_model

        client = get_groq_client()
        model = get_model()

        time_greeting = "Good morning" if briefing_type == "morning" else "Good evening"

        system_prompt = (
            "You are MyResilience AI — a disaster preparedness briefing officer for Malaysian households. "
            "Generate a concise, actionable briefing in English with occasional Malay terms. "
            "Be direct, use bullet points, and prioritize actionable information. "
            "Keep it under 200 words. Use emoji sparingly for visual scanning."
        )

        user_prompt = f"""Generate a {briefing_type} briefing for a Malaysian household.

Current Status:
- Weather: {context['weather']['summary']}, {context['weather']['temp']}°C
- Location: {context['weather']['location']}
- Active weather alerts nearby: {context['weather']['nearby_alerts']}
- Inventory health score: {context['inventory']['health_score']}/100
- Expired items: {context['inventory']['expired']}
- Expiring within 7 days: {context['inventory']['expiring_soon']}
- Out of stock: {context['inventory']['critical_stock']}
- Low stock items: {context['inventory']['low_stock']}
- Active evacuation advisory: {'Yes' if context['has_active_evacuation'] else 'No'}
- Recent escalations: {context['recent_escalations']}
- Events today: {context['events_today']}

Top recommendations:
{json.dumps(context['top_recommendations'][:3], indent=2) if context['top_recommendations'] else 'None'}

Format: Start with a one-line status summary, then bullet points for key items, end with priority actions."""

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=400,
                temperature=0.3,
            )
            return response.choices[0].message.content.strip()
        except Exception:
            # Try fallback model
            from app.agents.config import get_fallback_model
            fallback = get_fallback_model(model)
            response = client.chat.completions.create(
                model=fallback,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                max_tokens=400,
                temperature=0.3,
            )
            return response.choices[0].message.content.strip()

    def _generate_fallback_briefing(self, context: dict, briefing_type: str) -> str:
        """Generate a structured briefing without LLM (fallback)."""
        w = context["weather"]
        inv = context["inventory"]
        lines = []

        if briefing_type == "morning":
            lines.append(f"☀️ Good morning, Lord Hasif. Here's your daily preparedness briefing.")
        elif briefing_type == "evening":
            lines.append(f"🌙 Good evening. Here's your end-of-day summary.")
        else:
            lines.append(f"📋 On-demand briefing — {datetime.now(MYT).strftime('%H:%M MYT')}")

        lines.append("")
        lines.append(f"**Status:** {'⚠️ Alerts active' if w['nearby_alerts'] > 0 else '✅ All clear'}")
        lines.append(f"**Weather:** {w['summary']}, {w['temp']}°C at {w['location']}")
        lines.append(f"**Inventory Health:** {inv['health_score']}/100")
        lines.append("")

        if inv["expired"] > 0:
            lines.append(f"🔴 {inv['expired']} expired item(s) — replace immediately")
        if inv["critical_stock"] > 0:
            lines.append(f"🔴 {inv['critical_stock']} item(s) out of stock")
        if inv["expiring_soon"] > 0:
            lines.append(f"🟡 {inv['expiring_soon']} item(s) expiring within 7 days")
        if inv["low_stock"] > 0:
            lines.append(f"🟡 {inv['low_stock']} item(s) running low")

        if w["nearby_alerts"] > 0:
            lines.append(f"⚠️ {w['nearby_alerts']} weather alert(s) in your area")

        if context["has_active_evacuation"]:
            lines.append("🚨 Active evacuation advisory — review immediately")

        if not any([inv["expired"], inv["critical_stock"], inv["expiring_soon"],
                    inv["low_stock"], w["nearby_alerts"], context["has_active_evacuation"]]):
            lines.append("✅ All systems nominal. Stay prepared.")

        return "\n".join(lines)

    def _get_title(self, briefing_type: str, now: datetime) -> str:
        """Generate briefing title."""
        date_str = now.strftime("%d %B %Y")
        if briefing_type == "morning":
            return f"☀️ Morning Briefing — {date_str}"
        elif briefing_type == "evening":
            return f"🌙 Evening Summary — {date_str}"
        else:
            return f"📋 Preparedness Briefing — {now.strftime('%H:%M MYT')}"

    def _extract_action_items(self, context: dict) -> list:
        """Extract prioritized action items from context."""
        items = []
        inv = context["inventory"]

        if inv["expired"] > 0:
            items.append({"priority": "critical", "action": f"Replace {inv['expired']} expired item(s)"})
        if inv["critical_stock"] > 0:
            items.append({"priority": "critical", "action": f"Restock {inv['critical_stock']} out-of-stock item(s)"})
        if inv["expiring_soon"] > 0:
            items.append({"priority": "high", "action": f"Plan replacement for {inv['expiring_soon']} item(s) expiring soon"})
        if context["weather"]["nearby_alerts"] > 0:
            items.append({"priority": "high", "action": "Review weather alerts and evacuation advisory"})
        if context["has_active_evacuation"]:
            items.append({"priority": "critical", "action": "Review active evacuation advisory"})

        if not items:
            items.append({"priority": "info", "action": "No urgent actions — maintain readiness"})

        return items


# Singleton instance
briefing = BriefingAgent()
