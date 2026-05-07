/**
 * AuthPage — Login and Registration with Supabase Auth.
 *
 * Features:
 * - Email/password login
 * - Email/password registration with full_name
 * - Password reset
 * - Error handling with user-friendly messages
 * - Dark theme matching the app design
 */
import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

const STYLES = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(135deg, #0a0a0f 0%, #1a1025 50%, #0a0a0f 100%)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  card: {
    background: 'rgba(15, 15, 25, 0.9)',
    border: '1px solid rgba(139, 92, 246, 0.2)',
    borderRadius: 16,
    padding: '40px 36px',
    width: '100%',
    maxWidth: 420,
    backdropFilter: 'blur(20px)',
  },
  logo: {
    textAlign: 'center',
    marginBottom: 32,
  },
  logoEmoji: {
    fontSize: 48,
    display: 'block',
    marginBottom: 8,
  },
  logoTitle: {
    fontSize: 24,
    fontWeight: 700,
    color: '#e2e8f0',
    margin: 0,
  },
  logoSubtitle: {
    fontSize: 13,
    color: '#94a3b8',
    marginTop: 4,
  },
  tabContainer: {
    display: 'flex',
    gap: 4,
    background: 'rgba(30, 30, 50, 0.6)',
    borderRadius: 10,
    padding: 4,
    marginBottom: 28,
  },
  tab: (active) => ({
    flex: 1,
    padding: '10px 0',
    border: 'none',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    background: active ? 'rgba(139, 92, 246, 0.3)' : 'transparent',
    color: active ? '#c4b5fd' : '#64748b',
  }),
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: 500,
    color: '#94a3b8',
  },
  input: {
    padding: '12px 14px',
    background: 'rgba(30, 30, 50, 0.8)',
    border: '1px solid rgba(100, 116, 139, 0.3)',
    borderRadius: 10,
    color: '#e2e8f0',
    fontSize: 15,
    outline: 'none',
    transition: 'border-color 0.2s',
  },
  inputFocus: {
    borderColor: 'rgba(139, 92, 246, 0.5)',
  },
  button: {
    padding: '13px 0',
    background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
    border: 'none',
    borderRadius: 10,
    color: '#fff',
    fontSize: 15,
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  error: {
    background: 'rgba(239, 68, 68, 0.1)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#fca5a5',
    fontSize: 13,
  },
  success: {
    background: 'rgba(34, 197, 94, 0.1)',
    border: '1px solid rgba(34, 197, 94, 0.3)',
    borderRadius: 8,
    padding: '10px 14px',
    color: '#86efac',
    fontSize: 13,
  },
  link: {
    color: '#a78bfa',
    fontSize: 13,
    cursor: 'pointer',
    textDecoration: 'none',
    background: 'none',
    border: 'none',
    padding: 0,
  },
  footer: {
    textAlign: 'center',
    marginTop: 20,
    color: '#64748b',
    fontSize: 13,
  },
}

export default function AuthPage() {
  const { isAuthenticated, signIn, signUp, resetPassword, supabaseReady } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const [mode, setMode] = useState('login') // 'login' | 'register' | 'reset'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [focusedField, setFocusedField] = useState(null)

  // Redirect if already authenticated
  if (isAuthenticated) {
    const from = location.state?.from?.pathname || '/'
    return <Navigate to={from} replace />
  }

  // If Supabase is not configured, redirect to main app
  if (!supabaseReady && !loading) {
    return <Navigate to="/" replace />
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    try {
      if (mode === 'login') {
        await signIn(email, password)
        const from = location.state?.from?.pathname || '/'
        navigate(from, { replace: true })
      } else if (mode === 'register') {
        if (!fullName.trim()) {
          setError('Full name is required')
          setLoading(false)
          return
        }
        const data = await signUp(email, password, { full_name: fullName.trim() })
        if (data?.user && !data?.session) {
          setSuccess('Check your email for a verification link to complete registration.')
        } else {
          const from = location.state?.from?.pathname || '/'
          navigate(from, { replace: true })
        }
      } else if (mode === 'reset') {
        await resetPassword(email)
        setSuccess('Password reset email sent. Check your inbox.')
      }
    } catch (err) {
      // User-friendly error messages
      const msg = err.message || 'An error occurred'
      if (msg.includes('Invalid login credentials')) {
        setError('Invalid email or password. Please try again.')
      } else if (msg.includes('already registered')) {
        setError('An account with this email already exists. Try logging in.')
      } else if (msg.includes('Password should be')) {
        setError('Password must be at least 6 characters long.')
      } else if (msg.includes('Unable to validate email')) {
        setError('Please enter a valid email address.')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const getInputStyle = (field) => ({
    ...STYLES.input,
    ...(focusedField === field ? STYLES.inputFocus : {}),
  })

  return (
    <div style={STYLES.container}>
      <div style={STYLES.card}>
        {/* Logo */}
        <div style={STYLES.logo}>
          <span style={STYLES.logoEmoji}>🛡️</span>
          <h1 style={STYLES.logoTitle}>MyResilience</h1>
          <p style={STYLES.logoSubtitle}>SafeSync AI — Disaster Preparedness Guardian</p>
        </div>

        {/* Mode Tabs (not shown in reset mode) */}
        {mode !== 'reset' && (
          <div style={STYLES.tabContainer}>
            <button
              style={STYLES.tab(mode === 'login')}
              onClick={() => { setMode('login'); setError(''); setSuccess('') }}
            >
              Sign In
            </button>
            <button
              style={STYLES.tab(mode === 'register')}
              onClick={() => { setMode('register'); setError(''); setSuccess('') }}
            >
              Register
            </button>
          </div>
        )}

        {/* Error / Success Messages */}
        {error && <div style={STYLES.error}>⚠️ {error}</div>}
        {success && <div style={STYLES.success}>✅ {success}</div>}

        {/* Form */}
        <form style={STYLES.form} onSubmit={handleSubmit}>
          {/* Full Name (register only) */}
          {mode === 'register' && (
            <div style={STYLES.fieldGroup}>
              <label style={STYLES.label}>Full Name</label>
              <input
                type="text"
                style={getInputStyle('fullName')}
                placeholder="Ahmad bin Ali"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                onFocus={() => setFocusedField('fullName')}
                onBlur={() => setFocusedField(null)}
                required
                autoComplete="name"
              />
            </div>
          )}

          {/* Email */}
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Email</label>
            <input
              type="email"
              style={getInputStyle('email')}
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              required
              autoComplete="email"
            />
          </div>

          {/* Password (not shown in reset mode) */}
          {mode !== 'reset' && (
            <div style={STYLES.fieldGroup}>
              <label style={STYLES.label}>Password</label>
              <input
                type="password"
                style={getInputStyle('password')}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
                required
                minLength={6}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            style={{
              ...STYLES.button,
              ...(loading ? STYLES.buttonDisabled : {}),
            }}
            disabled={loading}
          >
            {loading
              ? '⏳ Processing...'
              : mode === 'login'
                ? '🔐 Sign In'
                : mode === 'register'
                  ? '🚀 Create Account'
                  : '📧 Send Reset Link'
            }
          </button>
        </form>

        {/* Footer Links */}
        <div style={STYLES.footer}>
          {mode === 'login' && (
            <button
              style={STYLES.link}
              onClick={() => { setMode('reset'); setError(''); setSuccess('') }}
            >
              Forgot your password?
            </button>
          )}
          {mode === 'reset' && (
            <button
              style={STYLES.link}
              onClick={() => { setMode('login'); setError(''); setSuccess('') }}
            >
              ← Back to sign in
            </button>
          )}
          {mode === 'register' && (
            <p style={{ margin: '12px 0 0', fontSize: 12, color: '#475569' }}>
              By registering, you agree to receive disaster preparedness alerts for your area.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
