"""MyResilience — SafeSync AI Backend.

Production-grade disaster preparedness platform for Malaysia.
Integrates autonomous AI agents, Supabase database, and secure user management.
"""
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import os
import logging
from datetime import datetime

# Detect serverless environment (Vercel, AWS Lambda, etc.)
IS_SERVERLESS = bool(os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"))

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("myresilience")


# ═══════════════════════════════════════════════════════════════════════════════
# RATE LIMITER
# ═══════════════════════════════════════════════════════════════════════════════

limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])


# ═══════════════════════════════════════════════════════════════════════════════
# LIFESPAN
# ═══════════════════════════════════════════════════════════════════════════════

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: launch agents in long-running mode. Skip in serverless."""
    if not IS_SERVERLESS:
        try:
            from app.agents.autonomous.orchestrator import orchestrator
            from app.routers.agent_status import broadcast_to_ws

            # Wire WebSocket broadcaster into orchestrator
            orchestrator.set_ws_broadcaster(broadcast_to_ws)

            # Start all autonomous agents (only in long-running server)
            await orchestrator.start_all()
            logger.info("Autonomous agents started (long-running mode)")
        except Exception as e:
            logger.warning(f"Failed to start agents: {e}")
    else:
        logger.info("Serverless mode — agents run via cron jobs")

    yield

    if not IS_SERVERLESS:
        try:
            from app.agents.autonomous.orchestrator import orchestrator
            await orchestrator.stop_all()
            logger.info("Autonomous agents stopped")
        except Exception as e:
            logger.warning(f"Error stopping agents: {e}")


# ═══════════════════════════════════════════════════════════════════════════════
# APP INITIALIZATION
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="MyResilience — SafeSync AI",
    description=(
        "Agentic Disaster Preparedness Guardian — "
        "Malaysia's AI-native household emergency command system."
    ),
    version="4.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# Attach rate limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ═══════════════════════════════════════════════════════════════════════════════
# CORS
# ═══════════════════════════════════════════════════════════════════════════════

ALLOWED_ORIGINS = [
    "https://myresilience-overclock-web.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "Authorization"],
)


# ═══════════════════════════════════════════════════════════════════════════════
# SECURITY HEADERS MIDDLEWARE
# ═══════════════════════════════════════════════════════════════════════════════

from app.middleware import SecurityHeadersMiddleware, CSRFProtectionMiddleware
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(CSRFProtectionMiddleware)


# ═══════════════════════════════════════════════════════════════════════════════
# ROUTER REGISTRATION
# ═══════════════════════════════════════════════════════════════════════════════

# Core emergency endpoints (weather, evacuation, risk assessment)
# emergency.router has no prefix, so /api/weather, /api/evaluate_risk, etc.
from app.routers import emergency
app.include_router(emergency.router, prefix="/api", tags=["emergency"])

# Autonomous agent monitoring
# agent_status.router has prefix="/agents", so /api/agents/status, /api/agents/events, etc.
from app.routers import agent_status
app.include_router(agent_status.router, prefix="/api", tags=["agents"])

# Vercel cron job endpoints
# cron.router has prefix="/cron", so /api/cron/run-all, /api/cron/briefing, etc.
from app.routers import cron
app.include_router(cron.router, prefix="/api", tags=["cron"])

# User profile management (authenticated)
# profile.router has prefix="/profile", so /api/profile
from app.routers import profile
app.include_router(profile.router, prefix="/api", tags=["profile"])

# Family & dependents management (authenticated)
# dependents.router has prefix="/dependents", so /api/dependents
from app.routers import dependents
app.include_router(dependents.router, prefix="/api", tags=["dependents"])

# Inventory management with database persistence (authenticated)
# inventory_db.router has prefix="/inventory", so /api/inventory
from app.routers import inventory_db
app.include_router(inventory_db.router, prefix="/api", tags=["inventory"])

# Alert history and notifications (authenticated)
# alerts.router has prefix="/alerts", so /api/alerts
from app.routers import alerts
app.include_router(alerts.router, prefix="/api", tags=["alerts"])

# Automated briefing system (authenticated)
# briefing.router has prefix="/briefing", so /api/briefing
from app.routers import briefing
app.include_router(briefing.router, prefix="/api", tags=["briefing"])

# OCR ID scanning & asset recognition (authenticated)
# scan.router has prefix="/scan", so /api/scan/id, /api/scan/asset
from app.routers import scan
app.include_router(scan.router, prefix="/api", tags=["scan"])

# Admin management (admin role required)
# admin.router has prefix="/admin", so /api/admin/users, /api/admin/stats, etc.
from app.routers import admin
app.include_router(admin.router, prefix="/api", tags=["admin"])

# AI Chatbot (authenticated)
# chatbot.router has prefix="/chatbot", so /api/chatbot/message
from app.routers import chatbot
app.include_router(chatbot.router, prefix="/api", tags=["chatbot"])

# Voice command processing (authenticated)
# voice.router has prefix="/voice", so /api/voice/process
from app.routers import voice
app.include_router(voice.router, prefix="/api", tags=["voice"])


# ═══════════════════════════════════════════════════════════════════════════════
# GLOBAL ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════════════

@app.get("/health")
async def health_check():
    """System health check — returns agent status and environment info."""
    agent_info = {"status": "serverless", "agents_managed": 0}

    if not IS_SERVERLESS:
        try:
            from app.agents.autonomous.orchestrator import orchestrator
            agent_status_data = orchestrator.get_full_status()
            agent_info = {
                "orchestrator": agent_status_data["orchestrator"]["status"],
                "managed": agent_status_data["orchestrator"]["agents_managed"],
            }
        except Exception:
            pass

    # Check Supabase connectivity via lightweight HTTP (avoids SDK WebSocket issues in serverless)
    db_status = "not_configured"
    try:
        supabase_url = os.getenv("SUPABASE_URL", "")
        supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")
        if supabase_url and supabase_key:
            import requests as req_lib
            resp = req_lib.get(
                f"{supabase_url}/rest/v1/profiles?select=id&limit=1",
                headers={
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {supabase_key}",
                },
                timeout=5,
            )
            if resp.status_code == 200:
                db_status = "connected"
            else:
                db_status = f"error: HTTP {resp.status_code} — {resp.text[:80]}"
        else:
            db_status = "not_configured"
    except Exception as e:
        db_status = f"error: {type(e).__name__}: {str(e)[:80]}"

    return {
        "status": "operational",
        "service": "MyResilience SafeSync AI",
        "version": "4.0.0",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "environment": os.getenv("VERCEL_ENV", "development"),
        "serverless": IS_SERVERLESS,
        "agents": agent_info,
        "database": db_status,
    }


@app.get("/api/config")
async def get_public_config():
    """Public configuration for the frontend (non-sensitive)."""
    return {
        "supabase_url": os.getenv("SUPABASE_URL", ""),
        "supabase_anon_key": os.getenv("SUPABASE_ANON_KEY", ""),
        "version": "4.0.0",
        "features": {
            "auth_enabled": bool(os.getenv("SUPABASE_URL")),
            "agents_enabled": True,
            "email_alerts": bool(os.getenv("GMAIL_ADDRESS")),
            "sms_alerts": bool(os.getenv("TWILIO_ACCOUNT_SID")),
        },
    }


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch-all exception handler — log and return safe error."""
    logger.error(f"Unhandled exception: {exc}", exc_info=True)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Please try again later."},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
