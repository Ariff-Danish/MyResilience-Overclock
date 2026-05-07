/**
 * ProfilePage — User profile management with location, preferences, and dependents.
 *
 * Features:
 * - View/edit personal profile
 * - Manage notification preferences
 * - Location settings for personalized alerts
 * - Account deletion with confirmation
 */
import { useState, useEffect } from 'react'
import { useAuth } from '../lib/AuthContext'
import api from '../lib/api'

const STYLES = {
  container: {
    minHeight: '100vh',
    background: '#0a0a0f',
    color: '#e2e8f0',
    fontFamily: 'Inter, system-ui, sans-serif',
    padding: '24px 20px',
    maxWidth: 800,
    margin: '0 auto',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 32,
    paddingBottom: 16,
    borderBottom: '1px solid rgba(100, 116, 139, 0.2)',
  },
  title: {
    fontSize: 24,
    fontWeight: 700,
    margin: 0,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  backButton: {
    background: 'rgba(100, 116, 139, 0.2)',
    border: '1px solid rgba(100, 116, 139, 0.3)',
    borderRadius: 8,
    color: '#94a3b8',
    padding: '8px 16px',
    fontSize: 13,
    cursor: 'pointer',
    textDecoration: 'none',
  },
  section: {
    background: 'rgba(15, 15, 25, 0.8)',
    border: '1px solid rgba(100, 116, 139, 0.15)',
    borderRadius: 12,
    padding: 24,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#c4b5fd',
    marginBottom: 16,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  fieldGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
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
    padding: '10px 12px',
    background: 'rgba(30, 30, 50, 0.8)',
    border: '1px solid rgba(100, 116, 139, 0.3)',
    borderRadius: 8,
    color: '#e2e8f0',
    fontSize: 14,
    outline: 'none',
  },
  select: {
    padding: '10px 12px',
    background: 'rgba(30, 30, 50, 0.8)',
    border: '1px solid rgba(100, 116, 139, 0.3)',
    borderRadius: 8,
    color: '#e2e8f0',
    fontSize: 14,
    outline: 'none',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 0',
    borderBottom: '1px solid rgba(100, 116, 139, 0.1)',
  },
  toggleLabel: {
    fontSize: 14,
    color: '#cbd5e1',
  },
  toggleDesc: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  toggle: (active) => ({
    width: 44,
    height: 24,
    borderRadius: 12,
    background: active ? '#7c3aed' : 'rgba(100, 116, 139, 0.3)',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    transition: 'background 0.2s',
    flexShrink: 0,
  }),
  toggleDot: (active) => ({
    width: 18,
    height: 18,
    borderRadius: '50%',
    background: '#fff',
    position: 'absolute',
    top: 3,
    left: active ? 23 : 3,
    transition: 'left 0.2s',
  }),
  button: {
    padding: '11px 24px',
    borderRadius: 8,
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    border: 'none',
    transition: 'all 0.2s',
  },
  primaryButton: {
    background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
    color: '#fff',
  },
  dangerButton: {
    background: 'rgba(239, 68, 68, 0.15)',
    border: '1px solid rgba(239, 68, 68, 0.3)',
    color: '#fca5a5',
  },
  buttonRow: {
    display: 'flex',
    gap: 12,
    marginTop: 16,
  },
  message: (type) => ({
    padding: '10px 14px',
    borderRadius: 8,
    fontSize: 13,
    marginBottom: 16,
    background: type === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(34, 197, 94, 0.1)',
    border: `1px solid ${type === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(34, 197, 94, 0.3)'}`,
    color: type === 'error' ? '#fca5a5' : '#86efac',
  }),
  avatar: {
    width: 64,
    height: 64,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #7c3aed, #3b82f6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 28,
    fontWeight: 700,
    color: '#fff',
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    marginBottom: 24,
  },
  userName: {
    fontSize: 20,
    fontWeight: 600,
    margin: 0,
  },
  userEmail: {
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  loading: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '50vh',
    color: '#94a3b8',
  },
}

function Toggle({ active, onToggle, label, description }) {
  return (
    <div style={STYLES.toggleRow}>
      <div>
        <div style={STYLES.toggleLabel}>{label}</div>
        {description && <div style={STYLES.toggleDesc}>{description}</div>}
      </div>
      <button style={STYLES.toggle(active)} onClick={onToggle} type="button">
        <div style={STYLES.toggleDot(active)} />
      </button>
    </div>
  )
}

export default function ProfilePage() {
  const { user, signOut } = useAuth()
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  // Form state
  const [form, setForm] = useState({
    full_name: '',
    phone: '',
    location_name: '',
    state: '',
    district: '',
    latitude: '',
    longitude: '',
    language: 'en',
    notification_email: true,
    notification_sms: false,
    notification_push: true,
  })

  // Load profile
  useEffect(() => {
    async function loadProfile() {
      try {
        const data = await api.get('/api/profile')
        const p = data.profile
        setProfile(p)
        setForm({
          full_name: p.full_name || '',
          phone: p.phone || '',
          location_name: p.location_name || '',
          state: p.state || '',
          district: p.district || '',
          latitude: p.latitude?.toString() || '',
          longitude: p.longitude?.toString() || '',
          language: p.language || 'en',
          notification_email: p.notification_email ?? true,
          notification_sms: p.notification_sms ?? false,
          notification_push: p.notification_push ?? true,
        })
      } catch (err) {
        // Profile might not exist yet — that's OK
        if (err.message?.includes('404') || err.message?.includes('not found')) {
          setForm(prev => ({
            ...prev,
            full_name: user?.user_metadata?.full_name || '',
          }))
        } else {
          setError(err.message)
        }
      } finally {
        setLoading(false)
      }
    }
    loadProfile()
  }, [user])

  const handleSave = async () => {
    setError('')
    setSuccess('')
    setSaving(true)

    try {
      const updateData = {
        ...form,
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
      }

      const data = await api.put('/api/profile', updateData)
      setProfile(data.profile)
      setSuccess('Profile saved successfully!')
      setTimeout(() => setSuccess(''), 3000)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteAccount = async () => {
    try {
      await api.delete('/api/profile')
      await signOut()
      window.location.href = '/'
    } catch (err) {
      setError(err.message)
    }
  }

  const handleLocateMe = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm(prev => ({
          ...prev,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }))
      },
      () => setError('Could not get your location. Please enter manually.')
    )
  }

  if (loading) {
    return (
      <div style={STYLES.loading}>
        <p>Loading profile...</p>
      </div>
    )
  }

  const initials = (form.full_name || user?.email || 'U')
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div style={STYLES.container}>
      {/* Header */}
      <div style={STYLES.header}>
        <h1 style={STYLES.title}>👤 Profile</h1>
        <a href="/" style={STYLES.backButton}>← Back to Dashboard</a>
      </div>

      {/* Messages */}
      {error && <div style={STYLES.message('error')}>⚠️ {error}</div>}
      {success && <div style={STYLES.message('success')}>✅ {success}</div>}

      {/* User Info */}
      <div style={STYLES.userInfo}>
        <div style={STYLES.avatar}>{initials}</div>
        <div>
          <h2 style={STYLES.userName}>{form.full_name || 'User'}</h2>
          <p style={STYLES.userEmail}>{user?.email}</p>
        </div>
      </div>

      {/* Personal Information */}
      <div style={STYLES.section}>
        <h3 style={STYLES.sectionTitle}>📋 Personal Information</h3>
        <div style={STYLES.fieldGrid}>
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Full Name</label>
            <input
              style={STYLES.input}
              value={form.full_name}
              onChange={(e) => setForm(prev => ({ ...prev, full_name: e.target.value }))}
              placeholder="Ahmad bin Ali"
            />
          </div>
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Phone Number</label>
            <input
              style={STYLES.input}
              value={form.phone}
              onChange={(e) => setForm(prev => ({ ...prev, phone: e.target.value }))}
              placeholder="+60 12-345 6789"
            />
          </div>
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Language</label>
            <select
              style={STYLES.select}
              value={form.language}
              onChange={(e) => setForm(prev => ({ ...prev, language: e.target.value }))}
            >
              <option value="en">English</option>
              <option value="ms">Bahasa Melayu</option>
              <option value="zh">中文</option>
              <option value="ta">தமிழ்</option>
            </select>
          </div>
        </div>
      </div>

      {/* Location Settings */}
      <div style={STYLES.section}>
        <h3 style={STYLES.sectionTitle}>📍 Location for Alerts</h3>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 16 }}>
          Your location is used to provide personalized disaster alerts and nearby shelter recommendations.
        </p>
        <div style={STYLES.fieldGrid}>
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Location Name</label>
            <input
              style={STYLES.input}
              value={form.location_name}
              onChange={(e) => setForm(prev => ({ ...prev, location_name: e.target.value }))}
              placeholder="Petaling Jaya"
            />
          </div>
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>State</label>
            <input
              style={STYLES.input}
              value={form.state}
              onChange={(e) => setForm(prev => ({ ...prev, state: e.target.value }))}
              placeholder="Selangor"
            />
          </div>
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>District</label>
            <input
              style={STYLES.input}
              value={form.district}
              onChange={(e) => setForm(prev => ({ ...prev, district: e.target.value }))}
              placeholder="Petaling"
            />
          </div>
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Latitude</label>
            <input
              style={STYLES.input}
              value={form.latitude}
              onChange={(e) => setForm(prev => ({ ...prev, latitude: e.target.value }))}
              placeholder="3.1073"
              type="number"
              step="any"
            />
          </div>
          <div style={STYLES.fieldGroup}>
            <label style={STYLES.label}>Longitude</label>
            <input
              style={STYLES.input}
              value={form.longitude}
              onChange={(e) => setForm(prev => ({ ...prev, longitude: e.target.value }))}
              placeholder="101.6068"
              type="number"
              step="any"
            />
          </div>
          <div style={{ ...STYLES.fieldGroup, justifyContent: 'flex-end' }}>
            <button
              style={{ ...STYLES.button, ...STYLES.primaryButton, fontSize: 13, padding: '10px 16px' }}
              onClick={handleLocateMe}
              type="button"
            >
              📍 Use My Location
            </button>
          </div>
        </div>
      </div>

      {/* Notification Preferences */}
      <div style={STYLES.section}>
        <h3 style={STYLES.sectionTitle}>🔔 Notification Preferences</h3>
        <Toggle
          active={form.notification_email}
          onToggle={() => setForm(prev => ({ ...prev, notification_email: !prev.notification_email }))}
          label="Email Alerts"
          description="Receive disaster alerts and daily briefings via email"
        />
        <Toggle
          active={form.notification_sms}
          onToggle={() => setForm(prev => ({ ...prev, notification_sms: !prev.notification_sms }))}
          label="SMS Alerts"
          description="Receive critical emergency alerts via SMS"
        />
        <Toggle
          active={form.notification_push}
          onToggle={() => setForm(prev => ({ ...prev, notification_push: !prev.notification_push }))}
          label="Push Notifications"
          description="Receive browser push notifications for urgent alerts"
        />
      </div>

      {/* Save Button */}
      <div style={STYLES.buttonRow}>
        <button
          style={{ ...STYLES.button, ...STYLES.primaryButton, opacity: saving ? 0.6 : 1 }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '⏳ Saving...' : '💾 Save Profile'}
        </button>
      </div>

      {/* Danger Zone */}
      <div style={{ ...STYLES.section, borderColor: 'rgba(239, 68, 68, 0.2)', marginTop: 32 }}>
        <h3 style={{ ...STYLES.sectionTitle, color: '#f87171' }}>⚠️ Danger Zone</h3>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
          Deleting your account will permanently remove all your data including inventory, dependents, and alert history.
        </p>
        {!showDeleteConfirm ? (
          <button
            style={{ ...STYLES.button, ...STYLES.dangerButton }}
            onClick={() => setShowDeleteConfirm(true)}
          >
            🗑️ Delete Account
          </button>
        ) : (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 13, color: '#fca5a5' }}>Are you sure? This cannot be undone.</span>
            <button
              style={{ ...STYLES.button, background: '#dc2626', color: '#fff', fontSize: 13, padding: '8px 16px' }}
              onClick={handleDeleteAccount}
            >
              Yes, Delete
            </button>
            <button
              style={{ ...STYLES.button, ...STYLES.dangerButton, fontSize: 13, padding: '8px 16px' }}
              onClick={() => setShowDeleteConfirm(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
