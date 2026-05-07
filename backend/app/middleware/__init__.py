"""Security middleware — input sanitization, rate limiting, security headers.

Provides:
- InputSanitizer: strips XSS payloads, SQL injection patterns
- RateLimiter: per-IP rate limiting via slowapi
- SecurityHeaders: adds security headers to all responses
- AuditLogger: logs security-relevant actions to database
"""
import re
import html
import logging
from typing import Optional
from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("myresilience.security")

# ═══════════════════════════════════════════════════════════════════════════════
# INPUT SANITIZATION
# ═══════════════════════════════════════════════════════════════════════════════

# Patterns that should never appear in user input
SQL_INJECTION_PATTERNS = [
    r"(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|EXEC|EXECUTE)\b)",
    r"(--|;|/\*|\*/|@@|@\w+)",
    r"(\b(OR|AND)\b\s+\d+\s*=\s*\d+)",
    r"('|\"|\\\\)",
]

XSS_PATTERNS = [
    r"<script[^>]*>.*?</script>",
    r"javascript:",
    r"on\w+\s*=",
    r"<iframe",
    r"<object",
    r"<embed",
    r"<form",
]


def sanitize_string(value: str, max_length: int = 1000) -> str:
    """Sanitize a string input — strip HTML, limit length."""
    if not isinstance(value, str):
        return value
    # HTML entity encode
    value = html.escape(value, quote=True)
    # Strip null bytes
    value = value.replace("\x00", "")
    # Limit length
    value = value[:max_length]
    return value.strip()


def validate_no_injection(value: str) -> bool:
    """Check if a string contains SQL injection or XSS patterns."""
    if not isinstance(value, str):
        return True
    for pattern in SQL_INJECTION_PATTERNS + XSS_PATTERNS:
        if re.search(pattern, value, re.IGNORECASE):
            return False
    return True


def sanitize_dict(data: dict, max_depth: int = 5) -> dict:
    """Recursively sanitize all string values in a dict."""
    if max_depth <= 0:
        return data
    sanitized = {}
    for key, value in data.items():
        if isinstance(value, str):
            sanitized[key] = sanitize_string(value)
        elif isinstance(value, dict):
            sanitized[key] = sanitize_dict(value, max_depth - 1)
        elif isinstance(value, list):
            sanitized[key] = [
                sanitize_string(v) if isinstance(v, str)
                else sanitize_dict(v, max_depth - 1) if isinstance(v, dict)
                else v
                for v in value
            ]
        else:
            sanitized[key] = value
    return sanitized


# ═══════════════════════════════════════════════════════════════════════════════
# SECURITY HEADERS MIDDLEWARE
# ═══════════════════════════════════════════════════════════════════════════════

class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next):
        response: Response = await call_next(request)

        # Prevent clickjacking
        response.headers["X-Frame-Options"] = "DENY"
        # Prevent MIME sniffing
        response.headers["X-Content-Type-Options"] = "nosniff"
        # XSS protection (legacy browsers)
        response.headers["X-XSS-Protection"] = "1; mode=block"
        # Referrer policy
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        # Permissions policy
        response.headers["Permissions-Policy"] = (
            "geolocation=(self), camera=(), microphone=(), payment=()"
        )
        # Content Security Policy
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data: https:; "
            "connect-src 'self' https://*.supabase.co https://api.data.gov.my https://api.groq.com "
            "https://earthquake.usgs.gov https://www.nadma.gov.my; "
            "font-src 'self' data:; "
            "frame-ancestors 'none'"
        )
        # Strict Transport Security (1 year)
        response.headers["Strict-Transport-Security"] = (
            "max-age=31536000; includeSubDomains"
        )

        return response


# ═══════════════════════════════════════════════════════════════════════════════
# CSRF PROTECTION (Origin/Referer Validation)
# ═══════════════════════════════════════════════════════════════════════════════

# Allowed origins for CSRF validation (must match CORS origins)
CSRF_ALLOWED_ORIGINS = {
    "https://myresilience-overclock-web.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
}

# Methods that require CSRF validation
CSRF_METHODS = {"POST", "PUT", "DELETE", "PATCH"}

# Paths exempt from CSRF (webhooks, cron, health checks)
CSRF_EXEMPT_PATHS = {
    "/health",
    "/api/config",
    "/api/cron/sentinel",
    "/api/cron/guardian",
    "/api/cron/escalator",
    "/api/cron/briefing",
    "/api/cron/health",
    "/api/cron/run-all",
}


class CSRFProtectionMiddleware(BaseHTTPMiddleware):
    """CSRF protection via Origin/Referer header validation.

    Since the API uses JWT Bearer tokens (not cookies), CSRF is inherently
    mitigated. This middleware adds defense-in-depth by validating that
    state-changing requests (POST/PUT/DELETE) originate from allowed origins.
    """

    async def dispatch(self, request: Request, call_next):
        # Only validate state-changing methods
        if request.method not in CSRF_METHODS:
            return await call_next(request)

        # Skip exempt paths
        path = request.url.path
        if any(path.startswith(exempt) for exempt in CSRF_EXEMPT_PATHS):
            return await call_next(request)

        # Skip WebSocket upgrades
        if request.headers.get("upgrade", "").lower() == "websocket":
            return await call_next(request)

        # Validate Origin header
        origin = request.headers.get("origin", "")
        referer = request.headers.get("referer", "")

        # Extract origin from referer if origin header missing
        if not origin and referer:
            try:
                from urllib.parse import urlparse
                parsed = urlparse(referer)
                origin = f"{parsed.scheme}://{parsed.netloc}"
            except Exception:
                pass

        if origin:
            # Normalize: remove trailing slash
            origin = origin.rstrip("/")
            if origin not in CSRF_ALLOWED_ORIGINS:
                logger.warning(f"CSRF blocked: origin={origin} path={path}")
                return JSONResponse(
                    status_code=403,
                    content={"detail": "CSRF validation failed: invalid origin"},
                )
        else:
            # No origin/referer — allow if Authorization header present (API clients)
            # Block if no auth header (likely a form submission)
            if not request.headers.get("authorization"):
                logger.warning(f"CSRF blocked: no origin and no auth header path={path}")
                return JSONResponse(
                    status_code=403,
                    content={"detail": "CSRF validation failed: missing origin"},
                )

        return await call_next(request)


# ═══════════════════════════════════════════════════════════════════════════════
# AUDIT LOGGING
# ═══════════════════════════════════════════════════════════════════════════════

async def log_audit(
    user_id: Optional[str],
    action: str,
    resource: str,
    resource_id: Optional[str] = None,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    details: Optional[dict] = None,
):
    """Log a security-relevant action to the audit_log table.

    Uses the service role client to bypass RLS.
    """
    try:
        from app.db.client import get_supabase_admin
        db = get_supabase_admin()
        db.table("audit_log").insert({
            "user_id": user_id,
            "action": action,
            "resource": resource,
            "resource_id": resource_id,
            "ip_address": ip_address,
            "user_agent": user_agent,
            "details": details or {},
        }).execute()
    except Exception as e:
        logger.warning(f"Failed to write audit log: {e}")


def get_client_ip(request: Request) -> str:
    """Extract client IP from request, handling proxies."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    real_ip = request.headers.get("x-real-ip")
    if real_ip:
        return real_ip
    return request.client.host if request.client else "unknown"
