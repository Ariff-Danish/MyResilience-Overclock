"""Configuration for SafeSync - uses Groq SDK (sync client, thread-wrapped).

Tiered model fallback system:
  Primary   → llama-3.3-70b-versatile   (best quality, ~1K RPD)
  Fallback1 → qwen/qwen3-32b           (strong reasoning, separate quota)
  Fallback2 → llama-4-scout-17b         (newer arch, separate quota)
  LastResort→ llama-3.1-8b-instant      (fastest, ~14K RPD)

When any model hits a 429 rate limit, the system automatically cascades
to the next model in the chain. Each model has its own independent
daily quota on Groq's free tier.
"""
import os
import time
from dotenv import load_dotenv
from groq import Groq

load_dotenv(override=True)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
NOTIFICATION_EMAIL = os.getenv("NOTIFICATION_EMAIL", "")

# ── Tiered Model Chain ────────────────────────────────────────────────────────
# Order matters: first model is primary, each subsequent is a fallback.
# Each model on Groq has its OWN independent rate limit pool.
MODEL_CHAIN = [
    os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
    "qwen/qwen3-32b",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "llama-3.1-8b-instant",
]

# Track rate-limited models: { model_name: unix_timestamp_when_limit_expires }
_rate_limited_models: dict[str, float] = {}


def get_model() -> str:
    """Get the best available model, skipping any that are rate-limited."""
    now = time.time()
    for model in MODEL_CHAIN:
        expires = _rate_limited_models.get(model, 0)
        if now >= expires:
            return model
    # All models rate-limited — return the last resort (shortest cooldown)
    print("[Config] ⚠️ All models rate-limited. Using last resort.")
    return MODEL_CHAIN[-1]


def get_fallback_model(current_model: str = "") -> str:
    """Get the next available model after the current one in the chain."""
    now = time.time()
    found_current = False
    for model in MODEL_CHAIN:
        if model == current_model:
            found_current = True
            continue
        if found_current and now >= _rate_limited_models.get(model, 0):
            return model
    # If current wasn't found or no fallback available, return last resort
    return MODEL_CHAIN[-1]


def mark_rate_limited(model: str = "", cooldown_seconds: int = 300):
    """Mark a specific model as rate-limited for N seconds."""
    if not model:
        model = MODEL_CHAIN[0]
    _rate_limited_models[model] = time.time() + cooldown_seconds
    fallback = get_fallback_model(model)
    print(f"[Config] ⚠️ {model} rate-limited for {cooldown_seconds}s. Next: {fallback}")


def get_groq_client() -> Groq:
    """Create and return a synchronous Groq client."""
    if not GROQ_API_KEY:
        raise ValueError("GROQ_API_KEY is missing. Please add it to your .env file.")
    return Groq(api_key=GROQ_API_KEY)
