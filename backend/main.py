from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import emergency, user_data
import os
from app.database import engine
from app import models

# Create database tables (Safe for Serverless)
try:
    models.Base.metadata.create_all(bind=engine)
except Exception as e:
    print(f"Warning: Could not initialize database tables on startup: {e}")

app = FastAPI(
    title="SafeSync AI",
    description="Agentic Emergency Preparedness System API",
    version="2.0.0",
)

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(emergency.router, prefix="/api", tags=["emergency"])
app.include_router(user_data.router, prefix="/api/data", tags=["data"])

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
