"""MyResilience Autonomous Agent System.

Agents that run independently with minimal human intervention:
  - Sentinel:     Continuous weather/threat monitoring (5-min polling)
  - Guardian:     Inventory expiry & gap detection (30-min polling)
  - Escalator:    Cross-agent signal correlation & autonomous decisions (2-min eval)
  - Briefing:     Daily preparedness reports (8 AM / 8 PM MYT)
  - Orchestrator: Coordinates all agents, health checks, WebSocket broadcast

Usage:
    from app.agents.autonomous.orchestrator import orchestrator
    await orchestrator.start_all()
    status = orchestrator.get_full_status()
    await orchestrator.stop_all()
"""

from app.agents.autonomous.orchestrator import orchestrator
from app.agents.autonomous.sentinel import sentinel
from app.agents.autonomous.guardian import guardian
from app.agents.autonomous.escalator import escalator
from app.agents.autonomous.briefing import briefing

__all__ = ["orchestrator", "sentinel", "guardian", "escalator", "briefing"]
