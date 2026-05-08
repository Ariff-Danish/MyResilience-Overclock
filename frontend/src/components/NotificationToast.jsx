import { useState, useEffect, useCallback } from 'react'
import { AlertTriangle, ShieldCheck, Info, X } from 'lucide-react'

const SEVERITY_CONFIG = {
  emergency: { icon: AlertTriangle, color: '#f43f5e', bg: 'rgba(244,63,94,0.15)', border: 'rgba(244,63,94,0.5)', label: 'EMERGENCY' },
  critical:  { icon: AlertTriangle, color: '#f43f5e', bg: 'rgba(244,63,94,0.12)', border: 'rgba(244,63,94,0.4)', label: 'CRITICAL' },
  warning:   { icon: AlertTriangle, color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)', label: 'WARNING' },
  info:      { icon: Info,           color: '#38bdf8', bg: 'rgba(56,189,248,0.12)', border: 'rgba(56,189,248,0.3)', label: 'INFO' },
  success:   { icon: ShieldCheck,    color: '#22c55e', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.3)', label: 'OK' },
}

function Toast({ id, severity, title, message, onDismiss, autoDismissMs = 5000 }) {
  const config = SEVERITY_CONFIG[severity] || SEVERITY_CONFIG.info
  const Icon = config.icon

  useEffect(() => {
    const timer = setTimeout(() => onDismiss(id), autoDismissMs)
    return () => clearTimeout(timer)
  }, [id, autoDismissMs, onDismiss])

  return (
    <div
      className="notification-toast"
      style={{
        background: config.bg,
        border: `1px solid ${config.border}`,
        borderLeft: `3px solid ${config.color}`,
        backdropFilter: 'blur(12px)',
      }}
    >
      <div className="toast-icon" style={{ color: config.color }}>
        <Icon size={18} />
      </div>
      <div className="toast-content">
        <div className="toast-header">
          <span className="toast-severity" style={{ color: config.color }}>{config.label}</span>
          <span className="toast-title">{title}</span>
        </div>
        {message && <p className="toast-message">{message}</p>}
      </div>
      <button className="toast-dismiss" onClick={() => onDismiss(id)} aria-label="Dismiss">
        <X size={14} />
      </button>
    </div>
  )
}

export default function NotificationToastContainer({ toasts, onDismiss }) {
  if (!toasts || toasts.length === 0) return null

  return (
    <div className="toast-container">
      {toasts.map(toast => (
        <Toast key={toast.id} {...toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

/**
 * Hook to manage notification toasts.
 * Returns { toasts, addToast, dismissToast }
 */
export function useNotifications() {
  const [toasts, setToasts] = useState([])

  const addToast = useCallback((severity, title, message = '') => {
    const id = Date.now() + Math.random()
    setToasts(prev => {
      // Keep max 3 toasts to prevent screen clutter
      const next = [...prev, { id, severity, title, message }]
      return next.slice(-3)
    })
    return id
  }, [])

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return { toasts, addToast, dismissToast }
}
