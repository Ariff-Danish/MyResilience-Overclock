"""Supabase client configuration.

Uses the Supabase Python client for database operations and auth.
Service role key is used for admin operations (bypasses RLS).
Anon key is used for user-scoped operations (respects RLS).
"""
import os
from supabase import create_client, Client

SUPABASE_URL = os.getenv("SUPABASE_URL", "")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY", "")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")


def get_supabase() -> Client:
    """Get Supabase client with anon key (respects RLS)."""
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_ANON_KEY must be set. "
            "Add them to your .env or Vercel environment variables."
        )
    return create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


def get_supabase_admin() -> Client:
    """Get Supabase client with service role key (bypasses RLS).

    Use ONLY for server-side operations that need elevated access:
    - Agent event logging
    - System-wide alert creation
    - Audit log writes
    """
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise RuntimeError(
            "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. "
            "Add them to your .env or Vercel environment variables."
        )
    return create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


def get_supabase_for_user(access_token: str) -> Client:
    """Get Supabase client scoped to a specific user via their JWT.

    This ensures RLS policies are enforced for the authenticated user.
    """
    if not SUPABASE_URL or not SUPABASE_ANON_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_ANON_KEY must be set.")
    client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
    client.postgrest.auth(access_token)
    return client
