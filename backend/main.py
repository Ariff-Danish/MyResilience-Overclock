from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import emergency
import os
from datetime import datetime

app = FastAPI(
    title="MyResilience — SafeSync AI",
    description="Agentic Disaster Preparedness Guardian — Malaysia's AI-native household emergency command system.",
    version="2.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
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

# Include the emergency router
app.include_router(emergency.router, prefix="/api", tags=["emergency"])

@app.get("/health")
async def health_check():
    return {
        "status": "operational",
        "service": "MyResilience SafeSync AI",
        "version": "2.1.0",
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "environment": os.getenv("VERCEL_ENV", "development"),
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
