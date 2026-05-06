from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import emergency
import os

app = FastAPI(
    title="MyResilience",
    description="Agentic Disaster Preparedness Guardian — Malaysia's AI-native household emergency command system.",
    version="2.0.0",
)

# CORS setup — reads from .env ALLOWED_ORIGINS, falls back to local dev defaults
_origins_env = os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173,http://localhost:3000")
ALLOWED_ORIGINS = [o.strip() for o in _origins_env.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include the emergency router
app.include_router(emergency.router, prefix="/api", tags=["emergency"])

@app.get("/health")
async def health_check():
    return {
        "status": "operational",
        "service": "SafeSync AI",
        "version": "2.0.0",
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
