import { useState, useEffect } from 'react'
import { Users, BarChart3, Shield, Activity, Loader2, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react'
import { api } from '../../lib/api'

/**
 * AdminDashboard — Admin-only panel for user management and system analytics.
 * Only visible to users with admin role.
 */
export default function AdminDashboard() {
  const [activeSection, setActiveSection] = useState('overview')
  const [stats, setStats] = useState(null)
  const [users, setUsers] = useState([])
  const [health, setHealth] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [updatingRole, setUpdatingRole] = useState(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [statsRes, usersRes, healthRes] = await Promise.allSettled([
        api.get('/api/admin/stats'),
        api.get('/api/admin/users'),
        api.get('/api/admin/health'),
      ])

      if (statsRes.status === 'fulfilled') setStats(statsRes.value.stats)
      if (usersRes.status === 'fulfilled') setUsers(usersRes.value.users || [])
      if (healthRes.status === 'fulfilled') setHealth(healthRes.value)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleRoleChange = async (userId, newRole) => {
    setUpdatingRole(userId)
    try {
      await api.put(`/api/admin/users/${userId}/role`, { role: newRole })
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, app_role: newRole } : u))
    } catch (err) {
      setError(`Failed to update role: ${err.message}`)
    } finally {
      setUpdatingRole(null)
    }
  }

  if (loading) {
    return (
      <div className="admin-loading">
        <Loader2 className="admin-spinner" size={32} />
        <p>Loading admin dashboard...</p>
      </div>
    )
  }

  return (
    <div className="admin-dashboard">
      <div className="admin-header">
        <h2>🛡️ Admin Dashboard</h2>
        <button className="admin-refresh" onClick={loadData} title="Refresh data">
          <RefreshCw size={16} />
        </button>
      </div>

      {error && (
        <div className="admin-error">
          <p>{error}</p>
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      {/* Section Tabs */}
      <div className="admin-tabs">
        <button
          className={activeSection === 'overview' ? 'active' : ''}
          onClick={() => setActiveSection('overview')}
        >
          <BarChart3 size={16} /> Overview
        </button>
        <button
          className={activeSection === 'users' ? 'active' : ''}
          onClick={() => setActiveSection('users')}
        >
          <Users size={16} /> Users
        </button>
        <button
          className={activeSection === 'health' ? 'active' : ''}
          onClick={() => setActiveSection('health')}
        >
          <Activity size={16} /> System Health
        </button>
      </div>

      {/* Overview Section */}
      {activeSection === 'overview' && stats && (
        <div className="admin-overview">
          <div className="admin-stat-grid">
            <div className="admin-stat-card">
              <Users size={24} />
              <div>
                <span className="admin-stat-value">{stats.total_users}</span>
                <span className="admin-stat-label">Total Users</span>
              </div>
            </div>
            <div className="admin-stat-card">
              <Shield size={24} />
              <div>
                <span className="admin-stat-value">{stats.total_inventory_items}</span>
                <span className="admin-stat-label">Inventory Items</span>
              </div>
            </div>
            <div className="admin-stat-card">
              <Users size={24} />
              <div>
                <span className="admin-stat-value">{stats.total_team_members}</span>
                <span className="admin-stat-label">Team Members</span>
              </div>
            </div>
            <div className="admin-stat-card">
              <Activity size={24} />
              <div>
                <span className="admin-stat-value">{stats.total_alerts}</span>
                <span className="admin-stat-label">Alerts Sent</span>
              </div>
            </div>
          </div>

          {/* Category Breakdown */}
          {stats.inventory_by_category && (
            <div className="admin-categories">
              <h3>Inventory by Category</h3>
              <div className="admin-category-bars">
                {Object.entries(stats.inventory_by_category)
                  .filter(([_, count]) => count > 0)
                  .sort((a, b) => b[1] - a[1])
                  .map(([cat, count]) => (
                    <div key={cat} className="admin-category-bar">
                      <span className="admin-cat-name">{cat}</span>
                      <div className="admin-cat-bar-track">
                        <div
                          className="admin-cat-bar-fill"
                          style={{ width: `${Math.min(100, (count / Math.max(...Object.values(stats.inventory_by_category))) * 100)}%` }}
                        />
                      </div>
                      <span className="admin-cat-count">{count}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Users Section */}
      {activeSection === 'users' && (
        <div className="admin-users">
          <div className="admin-users-header">
            <h3>Registered Users ({users.length})</h3>
          </div>
          <div className="admin-users-table">
            <div className="admin-users-row header">
              <span>Email</span>
              <span>Role</span>
              <span>Inventory</span>
              <span>Team</span>
              <span>Joined</span>
              <span>Actions</span>
            </div>
            {users.map(user => (
              <div key={user.id} className="admin-users-row">
                <span className="admin-user-email">{user.email}</span>
                <span className={`admin-role-badge ${user.app_role}`}>
                  {user.app_role}
                </span>
                <span>{user.inventory_count}</span>
                <span>{user.team_count}</span>
                <span className="admin-user-date">
                  {user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}
                </span>
                <span className="admin-user-actions">
                  {user.app_role === 'user' ? (
                    <button
                      className="admin-role-btn promote"
                      onClick={() => handleRoleChange(user.id, 'admin')}
                      disabled={updatingRole === user.id}
                    >
                      {updatingRole === user.id ? <Loader2 size={14} className="admin-spinner" /> : 'Promote'}
                    </button>
                  ) : (
                    <button
                      className="admin-role-btn demote"
                      onClick={() => handleRoleChange(user.id, 'user')}
                      disabled={updatingRole === user.id}
                    >
                      {updatingRole === user.id ? <Loader2 size={14} className="admin-spinner" /> : 'Demote'}
                    </button>
                  )}
                </span>
              </div>
            ))}
            {users.length === 0 && (
              <div className="admin-users-empty">
                <p>No users found</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Health Section */}
      {activeSection === 'health' && health && (
        <div className="admin-health">
          <div className="admin-health-grid">
            <div className={`admin-health-card ${health.database === 'connected' ? 'ok' : 'error'}`}>
              <h4>Database</h4>
              <span className="admin-health-status">{health.database}</span>
            </div>
            <div className={`admin-health-card ${health.agents?.status === 'running' ? 'ok' : 'warn'}`}>
              <h4>AI Agents</h4>
              <span className="admin-health-status">{health.agents?.status || 'unknown'}</span>
              <span className="admin-health-detail">{health.agents?.managed || 0} managed</span>
            </div>
            <div className="admin-health-card">
              <h4>Environment</h4>
              <span className="admin-health-status">{health.environment}</span>
              <span className="admin-health-detail">
                {health.serverless ? 'Serverless' : 'Long-running'}
              </span>
            </div>
          </div>

          {/* Environment Variables */}
          {health.env_configured && (
            <div className="admin-env-vars">
              <h4>Environment Configuration</h4>
              <div className="admin-env-grid">
                {Object.entries(health.env_configured).map(([key, configured]) => (
                  <div key={key} className={`admin-env-item ${configured ? 'configured' : 'missing'}`}>
                    <span className="admin-env-key">{key}</span>
                    <span className="admin-env-status">{configured ? '✅' : '❌'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="admin-health-meta">
            <p>Last checked: {new Date(health.timestamp).toLocaleString()}</p>
          </div>
        </div>
      )}
    </div>
  )
}
