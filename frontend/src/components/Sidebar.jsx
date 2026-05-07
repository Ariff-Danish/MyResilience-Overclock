import { Link } from 'react-router-dom'
import {
  Activity, ShieldAlert, PackageSearch, Users, Radar, Map,
  BookOpen, Settings, User, LogOut, ChevronLeft, Menu
} from 'lucide-react'
import { useAuth } from '../lib/AuthContext'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: Radar },
  { id: 'inventory', label: 'Inventory', icon: PackageSearch },
  { id: 'team', label: 'Personnel', icon: Users },
  { id: 'activity', label: 'Activity Network', icon: Activity },
  { id: 'agents', label: 'Agents', icon: null, emoji: '🤖' },
  { id: 'threatmap', label: 'Threat Map', icon: Map },
  { id: 'survival', label: 'Survival Guide', icon: BookOpen },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export default function Sidebar({ activeTab, setActiveTab, isOpen, onToggle }) {
  const { user, isAuthenticated, signOut, supabaseReady } = useAuth()

  return (
    <aside className={`sidebar ${isOpen ? 'open' : 'closed'}`}>
      <div className="sidebar-logo">
        <ShieldAlert className="logo-icon" />
        {isOpen && <h1>MyResilience</h1>}
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={activeTab === item.id ? 'active' : ''}
            onClick={() => setActiveTab(item.id)}
          >
            {item.icon ? (
              <item.icon className="nav-icon" />
            ) : (
              <span className="nav-icon" style={{ display: 'inline-flex', alignItems: 'center' }}>
                {item.emoji}
              </span>
            )}
            {isOpen && item.label}
          </button>
        ))}
      </nav>

      {/* Auth User Menu */}
      {isOpen && supabaseReady && (
        <div className="sidebar-user-menu">
          {isAuthenticated ? (
            <>
              <div className="sidebar-user-info">
                <div className="sidebar-user-avatar">
                  {(user?.user_metadata?.full_name || user?.email || 'U').charAt(0).toUpperCase()}
                </div>
                <div className="sidebar-user-details">
                  <span className="sidebar-user-name">
                    {user?.user_metadata?.full_name || 'User'}
                  </span>
                  <span className="sidebar-user-email">{user?.email}</span>
                </div>
              </div>
              <div className="sidebar-user-actions">
                <Link to="/profile" className="sidebar-user-link">
                  <User className="nav-icon" /> Profile
                </Link>
                <Link to="/dependents" className="sidebar-user-link">
                  <Users className="nav-icon" /> Dependents
                </Link>
                <button className="sidebar-user-link sidebar-signout" onClick={signOut}>
                  <LogOut className="nav-icon" /> Sign Out
                </button>
              </div>
            </>
          ) : (
            <Link to="/login" className="sidebar-login-link">
              <User className="nav-icon" /> Sign In
            </Link>
          )}
        </div>
      )}

      {isOpen && (
        <div className="sidebar-status">
          <div className="sidebar-status-dot" />
          <span>SYSTEM ONLINE</span>
        </div>
      )}
      <button
        className="sidebar-toggle-btn"
        onClick={onToggle}
        title={isOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {isOpen ? <ChevronLeft className="nav-icon" /> : <Menu className="nav-icon" />}
      </button>
    </aside>
  )
}
