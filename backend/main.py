from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from app.routers import emergency
from app.routers import agent_status
import os
from datetime import datetime

# Detect serverless environment (Vercel, AWS Lambda, etc.)
IS_SERVERLESS = bool(os.getenv("VERCEL") or os.getenv("AWS_LAMBDA_FUNCTION_NAME"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: launch agents in long-running mode. Skip in serverless."""
    if not IS_SERVERLESS:
        from app.agents.autonomous.orchestrator import orchestrator
        from app.routers.agent_status import broadcast_to_ws

        # Wire WebSocket broadcaster into orchestrator
        orchestrator.set_ws_broadcaster(broadcast_to_ws)

        # Start all autonomous agents (only in long-running server)
        await orchestrator.start_all()

    yield

    if not IS_SERVERLESS:
        from app.agents.autonomous.orchestrator import orchestrator
        # Graceful shutdown
        await orchestrator.stop_all()


app = FastAPI(
    title="MyResilience — SafeSync AI",
    description="Agentic Disaster Preparedness Guardian — Malaysia's AI-native household emergency command system.",
    version="3.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS — allow production frontend + localhost dev
ALLOWED_ORIGINS = [
    "https://myresilience-overclock-web.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Accept", "Authorization"],
)

# Include routers
app.include_router(emergency.router, prefix="/api", tags=["emergency"])
app.include_router(agent_status.router, prefix="/api", tags=["agents"])


@app.get("/health")
async def health_check():
    from app.agents.autonomous.orchestrator import orchestrator
    agent_status_data = orchestrator.get_full_status()
    return {
        "status": "operational",
        "service": "MyResilience SafeSync AI",
        "version": "3.0.0",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "environment": os.getenv("VERCEL_ENV", "development"),
        "agents": {
            "orchestrator": agent_status_data["orchestrator"]["status"],
            "managed": agent_status_data["orchestrator"]["agents_managed"],
        },
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
