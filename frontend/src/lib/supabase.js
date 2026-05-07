/**
 * Supabase Client — Frontend authentication and database access.
 *
 * Uses the Supabase JS client for:
 * - Email/password authentication
 * - Session management (auto-refresh tokens)
 * - Real-time subscriptions (future)
 *
 * Configuration is loaded from environment variables or the /api/config endpoint.
 */
import { createClient } from '@supabase/supabase-js'

// These will be populated from /api/config on first load
let supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
let supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

let supabase = null

/**
 * Initialize or get the Supabase client.
 * Fetches config from backend if env vars are not set.
 */
export async function initSupabase() {
  if (supabase) return supabase

  // If env vars are set, use them directly
  if (supabaseUrl && supabaseAnonKey) {
    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
    return supabase
  }

  // Otherwise, fetch from backend config endpoint
  try {
    const API_URL = import.meta.env.VITE_API_URL || 'https://backend-delta-ivory-13.vercel.app'
    const res = await fetch(`${API_URL}/api/config`)
    const config = await res.json()

    supabaseUrl = config.supabase_url
    supabaseAnonKey = config.supabase_anon_key

    if (!supabaseUrl || !supabaseAnonKey) {
      console.warn('[Supabase] Configuration not available — auth disabled')
      return null
    }

    supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
    return supabase
  } catch (err) {
    console.error('[Supabase] Failed to fetch config:', err)
    return null
  }
}

/**
 * Get the initialized Supabase client (may be null if not configured).
 */
export function getSupabase() {
  return supabase
}

/**
 * Get the current user's JWT access token for API calls.
 */
export async function getAccessToken() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data?.session?.access_token || null
}

export default { initSupabase, getSupabase, getAccessToken }
