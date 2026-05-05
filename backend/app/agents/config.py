"""Configuration for SafeSync - uses Groq SDK (sync client, thread-wrapped)."""
import os
from dotenv import load_dotenv
from groq import Groq

load_dotenv(override=True)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")
NOTIFICATION_EMAIL = os.getenv("NOTIFICATION_EMAIL", "")


def get_model() -> str:
    """Get the current model from environment variables."""
    load_dotenv(override=True)
    return os.getenv("GROQ_MODEL", "llama-3.1-8b-instant")


def get_groq_client() -> Groq:
    """Create and return a synchronous Groq client."""
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY is missing. Please add it to your .env file.")
    return Groq(api_key=GROQ_API_KEY)
