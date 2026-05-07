"""Inventory Guardian Agent — Autonomous Inventory Health Monitoring.

Runs on a schedule (every 30 minutes) without human intervention.
- Detects items expiring within 7/30 days
- Identifies critical stock gaps
- Tracks inventory health trends over time
- Proactively recommends restocking actions
"""
import asyncio
import json
from typing import Optional, List
from datetime import datetime, timedelta

from app.agents.autonomous.state import (
    log_event, update_agent_status, get_decision, save_decision,
    log_escalation, update_shared_state, get_shared_state,
)


class GuardianAgent:
    """Continuously monitors inventory health and proactively alerts on gaps."""

    AGENT_NAME = "guardian"
    CHECK_INTERVAL_SECONDS = 1800  # 30 minutes
    EXPIRY_WARNING_DAYS = 7
    EXPIRY_ALERT_DAYS = 30
    LOW_STOCK_THRESHOLD = 0.3  # 30% of target

    def __init__(self):
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._last_health_hash = ""

    async def start(self):
        """Start the guardian monitoring loop."""
        if self._running:
            return
        self._running = True
        self._task = asyncio.create_task(self._monitor_loop())
        update_agent_status(self.AGENT_NAME, "active", {"message": "Inventory guardian started"})
        log_event(self.AGENT_NAME, "agent_started", {"check_interval": self.CHECK_INTERVAL_SECONDS})

    async def stop(self):
        """Stop the guardian monitoring loop."""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        update_agent_status(self.AGENT_NAME, "stopped")
        log_event(self.AGENT_NAME, "agent_stopped", {})

    async def _monitor_loop(self):
        """Main monitoring loop — runs indefinitely."""
        while self._running:
            try:
                await self._check_inventory_health()
            except asyncio.CancelledError:
                break
            except Exception as e:
                log_event(self.AGENT_NAME, "error", {"error": str(e)}, severity="warning")
                update_agent_status(self.AGENT_NAME, "error", {"error": str(e)})
            await asyncio.sleep(self.CHECK_INTERVAL_SECONDS)

    async def _check_inventory_health(self):
        """Analyze inventory for expiry, low stock, and critical gaps."""
        update_agent_status(self.AGENT_NAME, "scanning")

        inventory = get_shared_state("inventory", [])
        team = get_shared_state("team", [])

        if not inventory:
            update_agent_status(self.AGENT_NAME, "idle", {"reason": "No inventory data"})
            return

        now = datetime.utcnow()
        warning_date = now + timedelta(days=self.EXPIRY_WARNING_DAYS)
        alert_date = now + timedelta(days=self.EXPIRY_ALERT_DAYS)

        # ── Expiry Analysis ───────────────────────────────────────────────
        expired_items = []
        expiring_soon = []  # within 7 days
        expiring_month = []  # within 30 days

        for item in inventory:
            expiry = item.get("expiry_date", "")
            if not expiry:
                continue
            try:
                exp_date = datetime.strptime(expiry, "%Y-%m-%d")
            except ValueError:
                continue

            if exp_date < now:
                expired_items.append({"name": item["name"], "expired_on": expiry, "category": item.get("category", "")})
            elif exp_date < warning_date:
                days_left = (exp_date - now).days
                expiring_soon.append({"name": item["name"], "days_left": days_left, "category": item.get("category", "")})
            elif exp_date < alert_date:
                days_left = (exp_date - now).days
                expiring_month.append({"name": item["name"], "days_left": days_left, "category": item.get("category", "")})

        # ── Stock Level Analysis ──────────────────────────────────────────
        low_stock_items = []
        critical_stock = []
        category_totals = {}

        for item in inventory:
            cat = item.get("category", "Misc")
            current = item.get("current_amount", 0)
            target = item.get("target_amount", 0)

            if cat not in category_totals:
                category_totals[cat] = {"current": 0, "target": 0}
            category_totals[cat]["current"] += current
            category_totals[cat]["target"] += target

            if target > 0:
                ratio = current / target
                if ratio < self.LOW_STOCK_THRESHOLD:
                    low_stock_items.append({
                        "name": item["name"],
                        "current": current,
                        "target": target,
                        "ratio": round(ratio * 100),
                        "category": cat,
                    })
                if current == 0 and target > 0:
                    critical_stock.append({"name": item["name"], "category": cat})

        # ── Household Vulnerability Check ─────────────────────────────────
        has_elderly = any(m.get("age", 0) > 65 for m in team)
        has_children = any(0 < m.get("age", 99) < 12 for m in team)
        has_medical_condition = any(m.get("remarks", "") for m in team)

        # ── Compute Health Score ──────────────────────────────────────────
        health_score = 100
        deductions = []

        if expired_items:
            deduction = min(20, len(expired_items) * 5)
            health_score -= deduction
            deductions.append(f"-{deduction} for {len(expired_items)} expired item(s)")

        if critical_stock:
            deduction = min(25, len(critical_stock) * 8)
            health_score -= deduction
            deductions.append(f"-{deduction} for {len(critical_stock)} out-of-stock item(s)")

        if low_stock_items:
            deduction = min(15, len(low_stock_items) * 3)
            health_score -= deduction
            deductions.append(f"-{deduction} for {len(low_stock_items)} low-stock item(s)")

        if expiring_soon:
            deduction = min(10, len(expiring_soon) * 3)
            health_score -= deduction
            deductions.append(f"-{deduction} for {len(expiring_soon)} expiring within 7 days")

        # Check critical categories
        critical_categories = ["Water", "Food", "Medical"]
        for cat in critical_categories:
            totals = category_totals.get(cat, {"current": 0, "target": 0})
            if totals["target"] > 0 and totals["current"] / totals["target"] < 0.5:
                health_score -= 5
                deductions.append(f"-5 for {cat} below 50%")

        health_score = max(0, health_score)

        # ── Build Health Report ───────────────────────────────────────────
        health_report = {
            "health_score": health_score,
            "deductions": deductions,
            "expired_items": expired_items,
            "expiring_soon": expiring_soon,
            "expiring_within_month": expiring_month,
            "low_stock_items": low_stock_items,
            "critical_stock": critical_stock,
            "category_totals": category_totals,
            "household": {
                "has_elderly": has_elderly,
                "has_children": has_children,
                "has_medical_condition": has_medical_condition,
                "team_size": len(team),
            },
            "checked_at": datetime.utcnow().isoformat() + "Z",
        }

        # Update shared state
        update_shared_state("inventory_health", health_report)

        # ── Escalation Logic ──────────────────────────────────────────────
        if health_score < 40:
            log_escalation(
                self.AGENT_NAME,
                level="critical",
                action="inventory_critical",
                context={"health_score": health_score, "critical_stock": len(critical_stock), "expired": len(expired_items)},
            )
            log_event(self.AGENT_NAME, "health_critical", {
                "score": health_score,
                "deductions": deductions,
            }, severity="critical")
        elif health_score < 60:
            log_escalation(
                self.AGENT_NAME,
                level="warning",
                action="inventory_degraded",
                context={"health_score": health_score, "low_stock": len(low_stock_items)},
            )
            log_event(self.AGENT_NAME, "health_degraded", {
                "score": health_score,
                "deductions": deductions,
            }, severity="warning")
        else:
            log_event(self.AGENT_NAME, "health_check_passed", {
                "score": health_score,
                "items_checked": len(inventory),
            })

        # ── Generate Proactive Recommendations ────────────────────────────
        recommendations = self._generate_recommendations(health_report)
        update_shared_state("guardian_recommendations", recommendations)

        update_agent_status(self.AGENT_NAME, "monitoring", {
            "health_score": health_score,
            "expired": len(expired_items),
            "expiring_soon": len(expiring_soon),
            "low_stock": len(low_stock_items),
            "critical_stock": len(critical_stock),
            "last_check": datetime.utcnow().isoformat() + "Z",
        })

    def _generate_recommendations(self, report: dict) -> list:
        """Generate actionable recommendations based on health report."""
        recs = []

        # Expired items — immediate action
        for item in report["expired_items"]:
            recs.append({
                "priority": "critical",
                "action": f"Replace expired {item['name']} (expired {item['expired_on']})",
                "category": item["category"],
                "type": "expiry",
            })

        # Expiring soon — plan replacement
        for item in report["expiring_soon"]:
            recs.append({
                "priority": "high",
                "action": f"Replace {item['name']} — expires in {item['days_left']} day(s)",
                "category": item["category"],
                "type": "expiry_warning",
            })

        # Critical stock — restock immediately
        for item in report["critical_stock"]:
            recs.append({
                "priority": "critical",
                "action": f"OUT OF STOCK: {item['name']} — restock immediately",
                "category": item["category"],
                "type": "stockout",
            })

        # Low stock — plan restocking
        for item in report["low_stock_items"]:
            recs.append({
                "priority": "high",
                "action": f"Low stock: {item['name']} at {item['ratio']}% ({item['current']}/{item['target']})",
                "category": item["category"],
                "type": "low_stock",
            })

        # Household-specific recommendations
        household = report.get("household", {})
        if household.get("has_elderly"):
            recs.append({
                "priority": "info",
                "action": "Elderly member present — ensure extra medication and mobility aids are stocked",
                "category": "Medical",
                "type": "household",
            })
        if household.get("has_children"):
            recs.append({
                "priority": "info",
                "action": "Children present — ensure infant formula, diapers, and child-safe medications if applicable",
                "category": "Medical",
                "type": "household",
            })

        # Sort by priority
        priority_order = {"critical": 0, "high": 1, "medium": 2, "info": 3}
        recs.sort(key=lambda r: priority_order.get(r["priority"], 99))

        return recs


# Singleton instance
guardian = GuardianAgent()
