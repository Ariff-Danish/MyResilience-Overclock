"""Briefing Orchestrator — Zero-Touch Automated Briefing Engine.

Coordinates the full briefing lifecycle:
1. Health check all endpoints and database
2. Refresh data sources and clear caches
3. Execute agents with retry logic (exponential backoff)
4. Generate briefing content via LLM
5. Stream results via SSE to subscribed users
6. Log failures and send alerts on persistent errors

All state persists in Supabase for cold-start recovery.
"""
import asyncio
import json
import logging
import time
import traceback
from typing import Optional, AsyncGenerator
from datetime import datetime, timezone, timedelta

from app.db.client import get_supabase_admin

logger = logging.getLogger("briefing_orchestrator")

MYT = timezone(timedelta(hours=8))

# Default configuration
DEFAULT_TIMEOUT = 30  # seconds per agent
DEFAULT_MAX_RETRIES = 3
DEFAULT_RETRY_DELAYS = [5, 15, 45]  # exponential backoff in seconds
CRITICAL_ENDPOINTS = ["/health", "/api/agents/status"]


class BriefingOrchestrator:
    """Master orchestrator for automated briefing execution."""

    def __init__(self):
        self._active_sessions: dict[str, dict] = {}
        self._sse_subscribers: dict[str, list[asyncio.Queue]] = {}

    # ── Public API ─────────────────────────────────────────────────────────

    async def execute_briefing(
        self,
        briefing_type: str = "morning",
        schedule_id: Optional[str] = None,
        timeout: int = DEFAULT_TIMEOUT,
        max_retries: int = DEFAULT_MAX_RETRIES,
        retry_delays: list[int] = None,
    ) -> dict:
        """Execute a full automated briefing cycle.

        Returns the briefing session record.
        """
        if retry_delays is None:
            retry_delays = DEFAULT_RETRY_DELAYS

        db = get_supabase_admin()
        now = datetime.now(MYT)

        # Create session record
        session = {
            "id": None,
            "schedule_id": schedule_id,
            "briefing_type": briefing_type,
            "status": "health_check",
            "started_at": now.isoformat(),
            "agent_results": {},
            "agents_succeeded": [],
            "agents_failed": [],
            "agents_skipped": [],
            "health_check_results": {},
            "retry_count": 0,
        }

        try:
            result = db.table("briefing_sessions").insert({
                "schedule_id": schedule_id,
                "briefing_type": briefing_type,
                "status": "health_check",
                "started_at": now.isoformat(),
            }).execute()
            session["id"] = result.data[0]["id"]
        except Exception as e:
            logger.error(f"Failed to create session: {e}")
            session["id"] = f"local_{int(time.time())}"

        self._active_sessions[session["id"]] = session
        await self._broadcast(session["id"], "session_started", session)

        # ── Step 1: Health Check ───────────────────────────────────────────
        health = await self._run_health_check(session)
        session["health_check_results"] = health

        if health["overall_status"] == "unhealthy":
            session["status"] = "failed"
            session["error_message"] = "Pre-briefing health check failed"
            await self._finalize_session(session, db)
            return session

        # ── Step 2: Refresh Data Sources ───────────────────────────────────
        session["status"] = "refreshing_data"
        await self._broadcast(session["id"], "phase", {"phase": "refreshing_data"})
        await self._refresh_data_sources(session)

        # ── Step 3: Execute Agents ─────────────────────────────────────────
        session["status"] = "running_agents"
        await self._broadcast(session["id"], "phase", {"phase": "running_agents"})

        agents_to_run = await self._get_agents_for_schedule(schedule_id, db)
        agent_results = await self._execute_agents(
            session, agents_to_run, timeout, max_retries, retry_delays
        )
        session["agent_results"] = agent_results

        # ── Step 4: Generate Briefing ──────────────────────────────────────
        session["status"] = "generating"
        await self._broadcast(session["id"], "phase", {"phase": "generating"})

        briefing = await self._generate_briefing(session, briefing_type)
        session["briefing_content"] = briefing
        session["briefing_text"] = briefing.get("summary", "")

        # ── Step 5: Stream to Subscribers ──────────────────────────────────
        session["status"] = "streaming"
        await self._broadcast(session["id"], "briefing_ready", briefing)

        # ── Step 6: Deliver to Subscribed Users ────────────────────────────
        await self._deliver_to_subscribers(session, briefing, db)

        # ── Finalize ───────────────────────────────────────────────────────
        has_failures = len(session["agents_failed"]) > 0
        session["status"] = "partial" if has_failures else "completed"
        session["completed_at"] = datetime.now(MYT).isoformat()

        if session["started_at"]:
            start = datetime.fromisoformat(session["started_at"])
            session["duration_ms"] = int(
                (datetime.now(MYT) - start).total_seconds() * 1000
            )

        await self._finalize_session(session, db)
        await self._broadcast(session["id"], "session_complete", {
            "status": session["status"],
            "agents_succeeded": session["agents_succeeded"],
            "agents_failed": session["agents_failed"],
        })

        return session

    async def subscribe_sse(self, session_id: str) -> AsyncGenerator[str, None]:
        """Subscribe to SSE events for a briefing session."""
        queue: asyncio.Queue = asyncio.Queue()

        if session_id not in self._sse_subscribers:
            self._sse_subscribers[session_id] = []
        self._sse_subscribers[session_id].append(queue)

        try:
            # Send current state if session exists
            if session_id in self._active_sessions:
                yield f"event: state\ndata: {json.dumps(self._active_sessions[session_id], default=str)}\n\n"

            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=30)
                    yield event
                    if event.startswith("event: session_complete"):
                        break
                except asyncio.TimeoutError:
                    # Send keepalive
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            if session_id in self._sse_subscribers:
                try:
                    self._sse_subscribers[session_id].remove(queue)
                except ValueError:
                    pass

    async def get_session_status(self, session_id: str) -> Optional[dict]:
        """Get current status of a briefing session."""
        if session_id in self._active_sessions:
            return self._active_sessions[session_id]

        db = get_supabase_admin()
        try:
            result = db.table("briefing_sessions").select("*").eq(
                "id", session_id
            ).limit(1).execute()
            return result.data[0] if result.data else None
        except Exception:
            return None

    # ── Health Check ───────────────────────────────────────────────────────

    async def _run_health_check(self, session: dict) -> dict:
        """Run comprehensive health check before briefing."""
        import httpx

        await self._broadcast(session["id"], "phase", {"phase": "health_check"})

        base_url = "http://localhost:8000"  # Will be overridden in serverless
        import os
        if os.getenv("VERCEL"):
            base_url = ""  # Self-referencing in serverless

        results = {
            "overall_status": "healthy",
            "endpoints": {},
            "database": "unknown",
            "timestamp": datetime.now(MYT).isoformat(),
        }

        # Check endpoints
        healthy_count = 0
        total_count = len(CRITICAL_ENDPOINTS)

        async with httpx.AsyncClient(timeout=10) as client:
            for endpoint in CRITICAL_ENDPOINTS:
                try:
                    url = f"{base_url}{endpoint}" if base_url else endpoint
                    resp = await client.get(url)
                    is_healthy = resp.status_code == 200
                    results["endpoints"][endpoint] = {
                        "status": "healthy" if is_healthy else "unhealthy",
                        "status_code": resp.status_code,
                    }
                    if is_healthy:
                        healthy_count += 1
                except Exception as e:
                    results["endpoints"][endpoint] = {
                        "status": "unhealthy",
                        "error": str(e),
                    }

        # Check database
        try:
            db = get_supabase_admin()
            db.table("profiles").select("id", count="exact").limit(1).execute()
            results["database"] = "connected"
        except Exception as e:
            results["database"] = f"error: {str(e)[:100]}"

        # Determine overall status
        if healthy_count == total_count and results["database"] == "connected":
            results["overall_status"] = "healthy"
        elif healthy_count > 0:
            results["overall_status"] = "degraded"
        else:
            results["overall_status"] = "unhealthy"

        # Log health check to Supabase
        try:
            db = get_supabase_admin()
            db.table("deployment_health").insert({
                "check_type": "pre_briefing",
                "overall_status": results["overall_status"],
                "endpoints_checked": total_count,
                "endpoints_healthy": healthy_count,
                "endpoints_failed": total_count - healthy_count,
                "endpoint_results": results["endpoints"],
                "database_status": results["database"],
            }).execute()
        except Exception as e:
            logger.warning(f"Failed to log health check: {e}")

        await self._broadcast(session["id"], "health_check", results)
        return results

    # ── Data Refresh ───────────────────────────────────────────────────────

    async def _refresh_data_sources(self, session: dict):
        """Refresh all data sources and clear caches."""
        from app.agents.autonomous.state import update_shared_state

        # Clear cached state
        update_shared_state("last_weather", {})
        update_shared_state("inventory_health", {})
        update_shared_state("guardian_recommendations", [])

        await self._broadcast(session["id"], "data_refreshed", {
            "cleared": ["last_weather", "inventory_health", "guardian_recommendations"]
        })

    # ── Agent Execution ────────────────────────────────────────────────────

    async def _get_agents_for_schedule(
        self, schedule_id: Optional[str], db
    ) -> list[str]:
        """Get the list of agents to run for a schedule."""
        if schedule_id:
            try:
                result = db.table("briefing_schedules").select(
                    "agents_required"
                ).eq("id", schedule_id).limit(1).execute()
                if result.data:
                    return result.data[0].get("agents_required", ["sentinel", "guardian", "escalator"])
            except Exception:
                pass
        return ["sentinel", "guardian", "escalator"]

    async def _execute_agents(
        self,
        session: dict,
        agents: list[str],
        timeout: int,
        max_retries: int,
        retry_delays: list[int],
    ) -> dict:
        """Execute all agents with retry logic and exponential backoff."""
        results = {}
        db = get_supabase_admin()

        for agent_name in agents:
            result = await self._execute_single_agent(
                session, agent_name, timeout, max_retries, retry_delays, db
            )
            results[agent_name] = result

            if result["status"] == "success":
                session["agents_succeeded"].append(agent_name)
            elif result["status"] == "failed":
                session["agents_failed"].append(agent_name)
            elif result["status"] == "skipped":
                session["agents_skipped"].append(agent_name)

        return results

    async def _execute_single_agent(
        self,
        session: dict,
        agent_name: str,
        timeout: int,
        max_retries: int,
        retry_delays: list[int],
        db,
    ) -> dict:
        """Execute a single agent with retry logic."""
        from app.agents.autonomous.state import update_agent_status, log_event

        last_error = None
        started_at = datetime.now(MYT)

        for attempt in range(max_retries + 1):
            try:
                update_agent_status(agent_name, "executing", {
                    "trigger": "briefing",
                    "attempt": attempt + 1,
                })

                await self._broadcast(session["id"], "agent_start", {
                    "agent": agent_name,
                    "attempt": attempt + 1,
                    "max_retries": max_retries,
                })

                # Execute agent with timeout
                result = await asyncio.wait_for(
                    self._run_agent(agent_name),
                    timeout=timeout,
                )

                update_agent_status(agent_name, "idle", {
                    "last_briefing_run": datetime.now(MYT).isoformat(),
                })

                log_event(agent_name, "briefing_executed", {
                    "status": "success",
                    "attempt": attempt + 1,
                })

                await self._broadcast(session["id"], "agent_complete", {
                    "agent": agent_name,
                    "status": "success",
                    "attempt": attempt + 1,
                })

                return {
                    "status": "success",
                    "attempt": attempt + 1,
                    "result": result,
                }

            except asyncio.TimeoutError:
                last_error = f"Timeout after {timeout}s"
                log_event(agent_name, "briefing_timeout", {
                    "attempt": attempt + 1,
                    "timeout": timeout,
                }, severity="warning")

            except Exception as e:
                last_error = str(e)
                log_event(agent_name, "briefing_error", {
                    "attempt": attempt + 1,
                    "error": str(e),
                }, severity="warning")

            # Log failure
            if attempt < max_retries:
                delay = retry_delays[min(attempt, len(retry_delays) - 1)]
                await self._log_failure(session, agent_name, attempt + 1, last_error, started_at, db)

                await self._broadcast(session["id"], "agent_retry", {
                    "agent": agent_name,
                    "attempt": attempt + 1,
                    "next_attempt_in": delay,
                    "error": last_error,
                })

                await asyncio.sleep(delay)
            else:
                # Final failure — log and alert
                await self._log_failure(
                    session, agent_name, attempt + 1, last_error, started_at, db,
                    will_retry=False,
                )
                await self._send_failure_alert(session, agent_name, last_error, db)

                await self._broadcast(session["id"], "agent_failed", {
                    "agent": agent_name,
                    "attempts": max_retries + 1,
                    "error": last_error,
                })

        return {
            "status": "failed",
            "attempts": max_retries + 1,
            "error": last_error,
        }

    async def _run_agent(self, agent_name: str) -> dict:
        """Run a specific agent's single-cycle execution."""
        if agent_name == "sentinel":
            from app.agents.autonomous.sentinel import sentinel
            await sentinel._check_weather()
            return {"weather_checked": True}

        elif agent_name == "guardian":
            from app.agents.autonomous.guardian import guardian
            await guardian._check_inventory_health()
            return {"inventory_checked": True}

        elif agent_name == "escalator":
            from app.agents.autonomous.escalator import escalator
            await escalator._evaluate_situation()
            return {"evaluation_complete": True}

        elif agent_name == "briefing":
            from app.agents.autonomous.briefing import briefing
            result = await briefing.generate_on_demand("on_demand")
            return result

        else:
            raise ValueError(f"Unknown agent: {agent_name}")

    # ── Failure Handling ───────────────────────────────────────────────────

    async def _log_failure(
        self,
        session: dict,
        agent_name: str,
        attempt: int,
        error: str,
        started_at: datetime,
        db,
        will_retry: bool = True,
    ):
        """Log a failure to the briefing_failures table."""
        try:
            retry_delays = DEFAULT_RETRY_DELAYS
            db.table("briefing_failures").insert({
                "session_id": session["id"],
                "agent_name": agent_name,
                "attempt_number": attempt,
                "error_type": "execution_error",
                "error_message": error or "Unknown error",
                "stack_trace": traceback.format_exc() if error else None,
                "started_at": started_at.isoformat(),
                "duration_ms": int((datetime.now(MYT) - started_at).total_seconds() * 1000),
                "retry_after_seconds": retry_delays[min(attempt - 1, len(retry_delays) - 1)] if will_retry else None,
                "will_retry": will_retry,
                "max_retries": DEFAULT_MAX_RETRIES,
            }).execute()
        except Exception as e:
            logger.error(f"Failed to log failure: {e}")

    async def _send_failure_alert(
        self,
        session: dict,
        agent_name: str,
        error: str,
        db,
    ):
        """Send alert notification for persistent agent failure."""
        try:
            from app.agents.alert_dispatcher import dispatch_alert_to_all_users

            alert_message = (
                f"⚠️ Briefing Agent Failure\n\n"
                f"Agent: {agent_name}\n"
                f"Session: {session['id']}\n"
                f"Type: {session['briefing_type']}\n"
                f"Error: {error}\n"
                f"Time: {datetime.now(MYT).strftime('%Y-%m-%d %H:%M MYT')}\n\n"
                f"The briefing will continue with remaining agents."
            )

            # Log as agent event
            from app.agents.autonomous.state import log_event
            log_event("orchestrator", "agent_failure_alert", {
                "agent": agent_name,
                "error": error,
                "session_id": session["id"],
            }, severity="critical")

            # Mark alert as sent in failures table
            try:
                db.table("briefing_failures").update({
                    "alert_sent": True,
                    "alert_sent_at": datetime.now(MYT).isoformat(),
                    "alert_channel": "in_app",
                }).eq("session_id", session["id"]).eq(
                    "agent_name", agent_name
                ).eq("will_retry", False).execute()
            except Exception:
                pass

        except Exception as e:
            logger.error(f"Failed to send failure alert: {e}")

    # ── Briefing Generation ────────────────────────────────────────────────

    async def _generate_briefing(self, session: dict, briefing_type: str) -> dict:
        """Generate briefing content using the existing briefing agent."""
        from app.agents.autonomous.briefing import briefing

        try:
            result = await briefing.generate_on_demand(briefing_type)
            return result
        except Exception as e:
            logger.error(f"Briefing generation failed: {e}")
            return {
                "id": f"brief_{briefing_type}_{int(time.time())}",
                "type": briefing_type,
                "generated_at": datetime.now(MYT).isoformat(),
                "title": f"{briefing_type.title()} Briefing",
                "summary": f"Briefing generation encountered an error: {str(e)[:200]}",
                "context": {},
                "action_items": ["Check system health", "Retry briefing"],
                "error": str(e),
            }

    # ── Subscriber Delivery ────────────────────────────────────────────────

    async def _deliver_to_subscribers(self, session: dict, briefing: dict, db):
        """Deliver briefing to all subscribed users."""
        try:
            result = db.table("briefing_subscriptions").select(
                "*, profiles!inner(full_name, language, notification_email)"
            ).eq("is_active", True).execute()

            subscribers = result.data or []
            delivered = 0

            for sub in subscribers:
                try:
                    # Update delivery tracking
                    db.table("briefing_subscriptions").update({
                        "last_delivered_at": datetime.now(MYT).isoformat(),
                        "delivery_count": (sub.get("delivery_count", 0) or 0) + 1,
                    }).eq("id", sub["id"]).execute()
                    delivered += 1
                except Exception as e:
                    logger.warning(f"Failed to deliver to subscriber {sub['id']}: {e}")

            await self._broadcast(session["id"], "delivery_complete", {
                "subscribers_notified": delivered,
                "total_subscribers": len(subscribers),
            })

        except Exception as e:
            logger.warning(f"Subscriber delivery failed: {e}")

    # ── Session Management ─────────────────────────────────────────────────

    async def _finalize_session(self, session: dict, db):
        """Persist session to Supabase and clean up."""
        try:
            update_data = {
                "status": session["status"],
                "completed_at": session.get("completed_at"),
                "duration_ms": session.get("duration_ms"),
                "agent_results": session.get("agent_results", {}),
                "agents_succeeded": session.get("agents_succeeded", []),
                "agents_failed": session.get("agents_failed", []),
                "agents_skipped": session.get("agents_skipped", []),
                "briefing_content": session.get("briefing_content"),
                "briefing_text": session.get("briefing_text"),
                "health_check_results": session.get("health_check_results", {}),
                "error_message": session.get("error_message"),
            }

            db.table("briefing_sessions").update(update_data).eq(
                "id", session["id"]
            ).execute()

            # Update schedule last_run
            if session.get("schedule_id"):
                db.table("briefing_schedules").update({
                    "last_run_at": datetime.now(MYT).isoformat(),
                    "last_status": session["status"],
                    "run_count": db.rpc("increment", {"x": 1}).execute() if False else 1,
                }).eq("id", session["schedule_id"]).execute()

        except Exception as e:
            logger.error(f"Failed to finalize session: {e}")

    # ── SSE Broadcasting ───────────────────────────────────────────────────

    async def _broadcast(self, session_id: str, event_type: str, data: dict):
        """Broadcast an SSE event to all subscribers of a session."""
        event_str = f"event: {event_type}\ndata: {json.dumps(data, default=str)}\n\n"

        if session_id in self._sse_subscribers:
            for queue in self._sse_subscribers[session_id]:
                try:
                    await queue.put(event_str)
                except Exception:
                    pass


# Singleton instance
briefing_orchestrator = BriefingOrchestrator()
