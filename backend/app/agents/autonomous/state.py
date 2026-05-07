"""Agent State Persistence Layer.

Stores agent state, decisions, and event history in JSON files.
All state is additive — never overwrites, always appends.

On Vercel/serverless: uses /tmp (ephemeral, per-invocation).
On local/standalone: uses agent_state/ alongside the backend.
"""
import json
import os
import time
from pathlib import Path
from typing import Any, Optional
from datetime import datetime

# Detect serverless environment
IS_SERVERLESS = bool(os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"))

# State directory — /tmp on serverless, local dir on standalone
if IS_SERVERLESS:
    STATE_DIR = Path("/tmp/agent_state")
else:
    STATE_DIR = Path(__file__).parent.parent.parent.parent / "agent_state"

# Lazy directory creation — only create when actually needed
_dirs_created = False


def _ensure_dirs():
    """Create state directories on first use."""
    global _dirs_created
    if _dirs_created:
        return
    _dirs_created = True
    try:
        STATE_DIR.mkdir(exist_ok=True)
        (STATE_DIR / "events").mkdir(exist_ok=True)
        (STATE_DIR / "decisions").mkdir(exist_ok=True)
        (STATE_DIR / "snapshots").mkdir(exist_ok=True)
    except OSError:
        pass  # Read-only filesystem — state will be in-memory only


EVENTS_DIR = STATE_DIR / "events"
DECISIONS_DIR = STATE_DIR / "decisions"
SNAPSHOTS_DIR = STATE_DIR / "snapshots"


def _timestamp() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _read_json(path: Path) -> Any:
    """Read JSON file, return None if missing or corrupt."""
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def _write_json(path: Path, data: Any) -> None:
    """Atomic write — write to temp then rename."""
    _ensure_dirs()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False, default=str), encoding="utf-8")
        tmp.replace(path)
    except OSError:
        pass  # Read-only filesystem — skip persistence


# ── Event Log (append-only) ──────────────────────────────────────────────────

def log_event(agent: str, event_type: str, payload: dict, severity: str = "info") -> dict:
    """Append an event to the agent event log. Returns the event dict."""
    event = {
        "id": f"{agent}_{int(time.time() * 1000)}",
        "timestamp": _timestamp(),
        "agent": agent,
        "type": event_type,
        "severity": severity,
        "payload": payload,
    }
    _ensure_dirs()
    try:
        log_file = EVENTS_DIR / f"{datetime.utcnow().strftime('%Y-%m-%d')}.jsonl"
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(event, ensure_ascii=False, default=str) + "\n")
    except OSError:
        pass  # Read-only filesystem — skip persistence
    return event


def get_recent_events(limit: int = 50, agent: Optional[str] = None) -> list:
    """Read the most recent events across all log files."""
    events = []
    log_files = sorted(EVENTS_DIR.glob("*.jsonl"), reverse=True)
    for log_file in log_files:
        try:
            for line in log_file.read_text(encoding="utf-8").strip().split("\n"):
                if not line.strip():
                    continue
                ev = json.loads(line)
                if agent and ev.get("agent") != agent:
                    continue
                events.append(ev)
                if len(events) >= limit:
                    return events
        except (json.JSONDecodeError, OSError):
            continue
    return events


# ── Decision Cache ───────────────────────────────────────────────────────────

def save_decision(agent: str, decision_key: str, decision: dict) -> None:
    """Save an agent decision with TTL awareness."""
    path = DECISIONS_DIR / f"{agent}_{decision_key}.json"
    _write_json(path, {
        "agent": agent,
        "key": decision_key,
        "decision": decision,
        "timestamp": _timestamp(),
    })


def get_decision(agent: str, decision_key: str) -> Optional[dict]:
    """Retrieve a cached decision."""
    path = DECISIONS_DIR / f"{agent}_{decision_key}.json"
    data = _read_json(path)
    return data.get("decision") if data else None


# ── Agent Status (live heartbeat) ────────────────────────────────────────────

_STATUS_FILE = STATE_DIR / "agent_status.json"


def update_agent_status(agent: str, status: str, details: Optional[dict] = None) -> None:
    """Update the live status of an agent."""
    all_status = _read_json(_STATUS_FILE) or {}
    all_status[agent] = {
        "status": status,
        "details": details or {},
        "last_heartbeat": _timestamp(),
    }
    _write_json(_STATUS_FILE, all_status)


def get_all_agent_status() -> dict:
    """Get live status of all agents."""
    return _read_json(_STATUS_FILE) or {}


# ── Shared State (inventory/team snapshots for agents) ───────────────────────

_SHARED_FILE = STATE_DIR / "shared_state.json"


def update_shared_state(key: str, value: Any) -> None:
    """Update shared state that agents can read."""
    state = _read_json(_SHARED_FILE) or {}
    state[key] = {"value": value, "updated": _timestamp()}
    _write_json(_SHARED_FILE, state)


def get_shared_state(key: str, default: Any = None) -> Any:
    """Read shared state."""
    state = _read_json(_SHARED_FILE) or {}
    entry = state.get(key)
    return entry["value"] if entry else default


# ── Escalation History ───────────────────────────────────────────────────────

def log_escalation(agent: str, level: str, action: str, context: dict) -> dict:
    """Log an autonomous escalation decision."""
    escalation = {
        "id": f"esc_{int(time.time() * 1000)}",
        "timestamp": _timestamp(),
        "agent": agent,
        "level": level,  # info, warning, critical, emergency
        "action": action,
        "context": context,
    }
    _ensure_dirs()
    try:
        path = DECISIONS_DIR / "escalation_history.jsonl"
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(escalation, ensure_ascii=False, default=str) + "\n")
    except OSError:
        pass  # Read-only filesystem — skip persistence
    log_event(agent, "escalation", escalation, severity=level)
    return escalation


def get_escalation_history(limit: int = 20) -> list:
    """Read recent escalation history."""
    path = DECISIONS_DIR / "escalation_history.jsonl"
    if not path.exists():
        return []
    lines = path.read_text(encoding="utf-8").strip().split("\n")
    escalations = []
    for line in reversed(lines):
        if not line.strip():
            continue
        try:
            escalations.append(json.loads(line))
        except json.JSONDecodeError:
            continue
        if len(escalations) >= limit:
            break
    return escalations
