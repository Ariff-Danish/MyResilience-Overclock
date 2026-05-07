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

    def __init__(self, user_id: str, email: str, role: str = "authenticated", app_role: str = "user"):
        self.id = user_id
        self.email = email
        self.role = role  # Supabase JWT role (authenticated, service_role)
        self.app_role = app_role  # Application role (user, admin)

    @property
    def is_admin(self) -> bool:
        """Check if user has admin application role."""
        return self.app_role == "admin"

    def __repr__(self):
        return f"AuthUser(id={self.id}, email={self.email}, app_role={self.app_role})"


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

    # Extract app_role from Supabase user metadata (app_metadata.role or user_metadata.role)
    app_metadata = payload.get("app_metadata", {})
    user_metadata = payload.get("user_metadata", {})
    app_role = app_metadata.get("role") or user_metadata.get("role", "user")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing user ID (sub claim)",
        )

    return AuthUser(user_id=user_id, email=email, role=role, app_role=app_role)


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
    """FastAPI dependency: require admin application role.

    Checks both Supabase service_role AND application-level admin role.
    Admin role is stored in Supabase user_metadata or app_metadata as 'role: admin'.

    Usage:
        @router.delete("/admin/resource")
        async def admin_route(user: AuthUser = Depends(require_admin)):
            ...
    """
    # Allow service_role (backend-to-backend) OR app_role=admin
    if user.role == "service_role" or user.is_admin:
        return user
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Admin access required. Your account does not have admin privileges.",
    )


async def get_user_role(
    user: AuthUser = Depends(get_current_user),
) -> str:
    """FastAPI dependency: return the user's application role string.

    Usage:
        @router.get("/role-aware-endpoint")
        async def endpoint(role: str = Depends(get_user_role)):
            if role == "admin":
                ...
    """
    return user.app_role
