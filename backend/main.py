from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import emergency
import os

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
