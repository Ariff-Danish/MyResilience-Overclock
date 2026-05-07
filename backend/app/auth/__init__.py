"""Authentication & Authorization module.

Provides JWT-based auth using Supabase Auth.
- Verifies JWT tokens from the Authorization header
- Extracts user ID and email from verified tokens
- Provides FastAPI dependencies for protected routes
"""
import os
from typing import Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")
security = HTTPBearer(auto_error=False)


class AuthUser:
    """Authenticated user context extracted from JWT."""

    def __init__(self, user_id: str, email: str, role: str = "authenticated"):
        self.id = user_id
        self.email = email
        self.role = role

    def __repr__(self):
        return f"AuthUser(id={self.id}, email={self.email})"


def _verify_jwt(token: str) -> dict:
    """Verify a Supabase JWT token and return the payload.

    Supabase JWTs use HS256 with the JWT secret from project settings.
    """
    if not SUPABASE_JWT_SECRET:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="SUPABASE_JWT_SECRET not configured",
        )

    try:
        payload = jwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            options={"verify_aud": False},  # Supabase uses 'authenticated' audience
        )
        return payload
    except JWTError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid or expired token: {str(e)}",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> AuthUser:
    """FastAPI dependency: extract authenticated user from Bearer token.

    Usage:
        @router.get("/protected")
        async def protected_route(user: AuthUser = Depends(get_current_user)):
            return {"user_id": user.id}
    """
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = _verify_jwt(credentials.credentials)

    user_id = payload.get("sub")
    email = payload.get("email", "")
    role = payload.get("role", "authenticated")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user ID (sub claim)",
        )

    return AuthUser(user_id=user_id, email=email, role=role)


async def get_optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[AuthUser]:
    """FastAPI dependency: extract user if token present, None otherwise.

    Usage:
        @router.get("/public-or-private")
        async def route(user: Optional[AuthUser] = Depends(get_optional_user)):
            if user:
                return {"msg": f"Hello {user.email}"}
            return {"msg": "Hello anonymous"}
    """
    if credentials is None:
        return None

    try:
        payload = _verify_jwt(credentials.credentials)
        user_id = payload.get("sub")
        if not user_id:
            return None
        return AuthUser(
            user_id=user_id,
            email=payload.get("email", ""),
            role=payload.get("role", "authenticated"),
        )
    except HTTPException:
        return None


async def require_admin(
    user: AuthUser = Depends(get_current_user),
) -> AuthUser:
    """FastAPI dependency: require admin role.

    Usage:
        @router.delete("/admin/resource")
        async def admin_route(user: AuthUser = Depends(require_admin)):
            ...
    """
    if user.role != "service_role":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return user
