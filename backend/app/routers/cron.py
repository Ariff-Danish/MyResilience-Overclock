"""Cron API — Vercel Cron Job endpoints for autonomous agent execution.

Vercel Cron Jobs trigger these endpoints on a schedule.
Each endpoint runs the agent in single-shot mode (one cycle, then return).

Endpoints:
  GET /api/cron/sentinel    — Every 5 minutes: weather + threat monitoring
  GET /api/cron/guardian    — Every 30 minutes: inventory health check
  GET /api/cron/escalator   — Every 2 minutes: cross-agent evaluation
  GET /api/cron/briefing    — Daily at 8 AM + 8 PM MYT: preparedness reports
  GET /api/cron/health      — Every 15 minutes: agent health check
"""
import os
from fastapi import APIRouter, Request, HTTPException
from datetime import datetime

router = APIRouter(prefix="/cron", tags=["cron"])

CRON_SECRET = os.getenv("CRON_SECRET", "")


def _verify_cron(request: Request):
    """Verify the request comes from Vercel Cron (or allow in dev)."""
    if not CRON_SECRET:
        return  # No secret configured — allow all (dev mode)
    auth = request.headers.get("authorization", "")
    if auth != f"Bearer {CRON_SECRET}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.get("/sentinel")
async def cron_sentinel(request: Request):
    """Run Sentinel agent once — weather monitoring + threat detection."""
    _verify_cron(request)

    from app.agents.autonomous.sentinel import sentinel
    from app.agents.autonomous.state import log_event, update_agent_status

    try:
        update_agent_status("sentinel", "scanning", {"trigger": "cron"})
        await sentinel._check_weather()
        log_event("sentinel", "cron_executed", {"status": "success"})
        return {"agent": "sentinel", "status": "executed", "timestamp": datetime.utcnow().isoformat() + "Z"}
    except Exception as e:
        log_event("sentinel", "cron_error", {"error": str(e)}, severity="warning")
        return {"agent": "sentinel", "status": "error", "error": str(e)}


@router.get("/guardian")
async def cron_guardian(request: Request):
    """Run Guardian agent once — inventory health check."""
    _verify_cron(request)

    from app.agents.autonomous.guardian import guardian
    from app.agents.autonomous.state import log_event, update_agent_status

    try:
        update_agent_status("guardian", "scanning", {"trigger": "cron"})
        await guardian._check_inventory_health()
        log_event("guardian", "cron_executed", {"status": "success"})
        return {"agent": "guardian", "status": "executed", "timestamp": datetime.utcnow().isoformat() + "Z"}
    except Exception as e:
        log_event("guardian", "cron_error", {"error": str(e)}, severity="warning")
        return {"agent": "guardian", "status": "error", "error": str(e)}


@router.get("/escalator")
async def cron_escalator(request: Request):
    """Run Escalator agent once — cross-agent signal evaluation."""
    _verify_cron(request)

    from app.agents.autonomous.escalator import escalator
    from app.agents.autonomous.state import log_event, update_agent_status

    try:
        update_agent_status("escalator", "evaluating", {"trigger": "cron"})
        await escalator._evaluate_situation()
        log_event("escalator", "cron_executed", {"status": "success"})
        return {"agent": "escalator", "status": "executed", "timestamp": datetime.utcnow().isoformat() + "Z"}
    except Exception as e:
        log_event("escalator", "cron_error", {"error": str(e)}, severity="warning")
        return {"agent": "escalator", "status": "error", "error": str(e)}


@router.get("/briefing")
async def cron_briefing(request: Request):
    """Run Briefing agent once — generate daily report."""
    _verify_cron(request)

    from app.agents.autonomous.briefing import briefing
    from app.agents.autonomous.state import log_event, update_agent_status
    from datetime import timezone, timedelta

    MYT = timezone(timedelta(hours=8))
    now = datetime.now(MYT)
    briefing_type = "morning" if now.hour < 14 else "evening"

    try:
        update_agent_status("briefing", "generating", {"trigger": "cron", "type": briefing_type})
        result = await briefing.generate_on_demand(briefing_type)
        log_event("briefing", "cron_executed", {"status": "success", "type": briefing_type})
        return {"agent": "briefing", "status": "executed", "type": briefing_type, "timestamp": datetime.utcnow().isoformat() + "Z"}
    except Exception as e:
        log_event("briefing", "cron_error", {"error": str(e)}, severity="warning")
        return {"agent": "briefing", "status": "error", "error": str(e)}


@router.get("/health")
async def cron_health(request: Request):
    """Run health check — verify all agents are responsive."""
    _verify_cron(request)

    from app.agents.autonomous.state import log_event, get_all_agent_status

    status = get_all_agent_status()
    log_event("orchestrator", "health_check", {"agents": len(status)})

    return {
        "status": "healthy",
        "agents": status,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@router.get("/run-all")
async def cron_run_all(request: Request):
    """Run ALL agents in sequence — single consolidated cron invocation.

    Designed for Vercel Hobby plan (max 2 cron jobs).
    Runs: sentinel → guardian → escalator → health check.
    """
    _verify_cron(request)

    from app.agents.autonomous.sentinel import sentinel
    from app.agents.autonomous.guardian import guardian
    from app.agents.autonomous.escalator import escalator
    from app.agents.autonomous.state import (
        log_event, update_agent_status, get_all_agent_status,
    )

    results = {}

    # 1. Sentinel — weather + threat monitoring
    try:
        update_agent_status("sentinel", "scanning", {"trigger": "cron"})
        await sentinel._check_weather()
        results["sentinel"] = "success"
        log_event("sentinel", "cron_executed", {"status": "success"})
    except Exception as e:
        results["sentinel"] = f"error: {e}"
        log_event("sentinel", "cron_error", {"error": str(e)}, severity="warning")

    # 2. Guardian — inventory health
    try:
        update_agent_status("guardian", "scanning", {"trigger": "cron"})
        await guardian._check_inventory_health()
        results["guardian"] = "success"
        log_event("guardian", "cron_executed", {"status": "success"})
    except Exception as e:
        results["guardian"] = f"error: {e}"
        log_event("guardian", "cron_error", {"error": str(e)}, severity="warning")

    # 3. Escalator — cross-agent evaluation
    try:
        update_agent_status("escalator", "evaluating", {"trigger": "cron"})
        await escalator._evaluate_situation()
        results["escalator"] = "success"
        log_event("escalator", "cron_executed", {"status": "success"})
    except Exception as e:
        results["escalator"] = f"error: {e}"
        log_event("escalator", "cron_error", {"error": str(e)}, severity="warning")

    # 4. Health snapshot
    agent_status_data = get_all_agent_status()
    log_event("orchestrator", "health_check", {"agents": len(agent_status_data)})

    return {
        "status": "completed",
        "results": results,
        "agents": agent_status_data,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }
