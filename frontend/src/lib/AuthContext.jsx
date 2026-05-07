/**
 * AuthContext — React context for authentication state management.
 *
 * Provides:
 * - Current user session
 * - Login / Register / Logout functions
 * - Loading state
 * - Auth state change listener
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { initSupabase, getSupabase } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [supabaseReady, setSupabaseReady] = useState(false)

  // Initialize Supabase and listen for auth changes
  useEffect(() => {
    let unsubscribe = null

    async function setup() {
      const client = await initSupabase()
      if (!client) {
        setLoading(false)
        return
      }

      setSupabaseReady(true)

      // Get initial session
      const { data } = await client.auth.getSession()
      setSession(data.session)
      setUser(data.session?.user || null)
      setLoading(false)

      // Listen for auth state changes
      const { data: { subscription } } = client.auth.onAuthStateChange(
        (_event, newSession) => {
          setSession(newSession)
          setUser(newSession?.user || null)
        }
      )
      unsubscribe = () => subscription.unsubscribe()
    }

    setup()

    // Listen for auth:expired events from API helper
    const handleExpired = () => {
      setUser(null)
      setSession(null)
    }
    window.addEventListener('auth:expired', handleExpired)

    return () => {
      unsubscribe?.()
      window.removeEventListener('auth:expired', handleExpired)
    }
  }, [])

  /**
   * Sign in with email and password.
   */
  const signIn = useCallback(async (email, password) => {
    const client = getSupabase()
    if (!client) throw new Error('Authentication not configured')

    const { data, error } = await client.auth.signInWithPassword({
      email,
      password,
    })

    if (error) throw error
    return data
  }, [])

  /**
   * Register a new user with email and password.
   */
  const signUp = useCallback(async (email, password, metadata = {}) => {
    const client = getSupabase()
    if (!client) throw new Error('Authentication not configured')

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: metadata, // full_name, etc.
      },
    })

    if (error) throw error
    return data
  }, [])

  /**
   * Sign out the current user.
   */
  const signOut = useCallback(async () => {
    const client = getSupabase()
    if (!client) return

    const { error } = await client.auth.signOut()
    if (error) throw error
    setUser(null)
    setSession(null)
  }, [])

  /**
   * Send password reset email.
   */
  const resetPassword = useCallback(async (email) => {
    const client = getSupabase()
    if (!client) throw new Error('Authentication not configured')

    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })

    if (error) throw error
  }, [])

  // Derive app role from user metadata
  const appRole = user?.user_metadata?.role || user?.app_metadata?.role || 'user'
  const isAdmin = appRole === 'admin'

  const value = {
    user,
    session,
    loading,
    supabaseReady,
    signIn,
    signUp,
    signOut,
    resetPassword,
    isAuthenticated: !!user,
    appRole,
    isAdmin,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}

/**
 * Hook to access authentication context.
 *
 * @returns {object} Auth context value
 * @throws {Error} If used outside AuthProvider
 */
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export default AuthContext
