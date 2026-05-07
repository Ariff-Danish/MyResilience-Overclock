import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '../../lib/AuthContext'
import { authenticatedFetch } from '../../lib/api'

const API_URL = import.meta.env.VITE_API_URL || 'https://myresilience-overclock-api.vercel.app'

const PHASE_LABELS = {
  health_check: { label: 'Health Check', icon: '🏥', color: '#06b6d4' },
  refreshing_data: { label: 'Refreshing Data', icon: '🔄', color: '#8b5cf6' },
  running_agents: { label: 'Running Agents', icon: '🤖', color: '#f59e0b' },
  generating: { label: 'Generating Briefing', icon: '📝', color: '#10b981' },
  streaming: { label: 'Streaming', icon: '📡', color: '#3b82f6' },
}

const AGENT_ICONS = {
  sentinel: '🛡️',
  guardian: '📦',
  escalator: '⚡',
  briefing: '📋',
}

export default function BriefingViewer() {
  const { session: authSession } = useAuth()
  const [sessions, setSessions] = useState([])
  const [activeSession, setActiveSession] = useState(null)
  const [streamEvents, setStreamEvents] = useState([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [currentPhase, setCurrentPhase] = useState(null)
  const [agentStatuses, setAgentStatuses] = useState({})
  const [briefing, setBriefing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const eventSourceRef = useRef(null)
  const streamEndRef = useRef(null)

  // Fetch recent sessions
  const fetchSessions = useCallback(async () => {
    try {
      const res = await authenticatedFetch(`${API_URL}/api/briefing/sessions?limit=10`)
      if (res.ok) {
        const data = await res.json()
        setSessions(data.sessions || [])
      }
    } catch (e) {
      console.error('Failed to fetch sessions:', e)
    }
  }, [])

  useEffect(() => {
    fetchSessions()
  }, [fetchSessions])

  // Auto-scroll stream
  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [streamEvents])

  // Trigger a new briefing
  const triggerBriefing = async (type = 'on_demand') => {
    setLoading(true)
    setError(null)
    setStreamEvents([])
    setAgentStatuses({})
    setBriefing(null)
    setCurrentPhase(null)

    try {
      const res = await authenticatedFetch(`${API_URL}/api/briefing/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefing_type: type, timeout: 30, max_retries: 3 }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

      setActiveSession(data.session_id)
      setBriefing(data.briefing)

      // Connect to SSE stream
      if (data.session_id) {
        connectSSE(data.session_id)
      }

      fetchSessions()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // Connect to SSE stream for a session
  const connectSSE = (sessionId) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    setIsStreaming(true)
    const es = new EventSource(`${API_URL}/api/briefing/stream/${sessionId}`)
    eventSourceRef.current = es

    es.onmessage = (e) => {
      if (e.data === 'keepalive') return
      try {
        const data = JSON.parse(e.data)
        setStreamEvents(prev => [...prev, { type: 'message', data, time: new Date() }])
      } catch { /* ignore parse errors */ }
    }

    // Named events
    const eventTypes = [
      'session_started', 'phase', 'health_check', 'data_refreshed',
      'agent_start', 'agent_complete', 'agent_retry', 'agent_failed',
      'briefing_ready', 'delivery_complete', 'session_complete', 'state',
    ]

    eventTypes.forEach(type => {
      es.addEventListener(type, (e) => {
        try {
          const data = JSON.parse(e.data)
          setStreamEvents(prev => [...prev, { type, data, time: new Date() }])

          if (type === 'phase') setCurrentPhase(data.phase)
          if (type === 'health_check') {
            setStreamEvents(prev => [...prev, {
              type: 'health_result',
              data: { status: data.overall_status, endpoints: data.endpoints },
              time: new Date(),
            }])
          }
          if (type === 'agent_start') {
            setAgentStatuses(prev => ({
              ...prev,
              [data.agent]: { status: 'running', attempt: data.attempt },
            }))
          }
          if (type === 'agent_complete') {
            setAgentStatuses(prev => ({
              ...prev,
              [data.agent]: { status: 'success', attempt: data.attempt },
            }))
          }
          if (type === 'agent_retry') {
            setAgentStatuses(prev => ({
              ...prev,
              [data.agent]: { status: 'retrying', attempt: data.attempt, nextIn: data.next_attempt_in },
            }))
          }
          if (type === 'agent_failed') {
            setAgentStatuses(prev => ({
              ...prev,
              [data.agent]: { status: 'failed', attempts: data.attempts },
            }))
          }
          if (type === 'briefing_ready') setBriefing(data)
          if (type === 'session_complete') {
            setIsStreaming(false)
            es.close()
            fetchSessions()
          }
        } catch { /* ignore */ }
      })
    })

    es.onerror = () => {
      setIsStreaming(false)
      es.close()
    }
  }

  // View a past session
  const viewSession = async (sessionId) => {
    try {
      const res = await authenticatedFetch(`${API_URL}/api/briefing/sessions/${sessionId}`)
      if (res.ok) {
        const data = await res.json()
        setActiveSession(sessionId)
        setBriefing(data.briefing_content)
        setAgentStatuses({})
        setStreamEvents([])
        setCurrentPhase(null)
      }
    } catch (e) {
      setError(e.message)
    }
  }

  // Cleanup
  useEffect(() => {
    return () => {
      eventSourceRef.current?.close()
    }
  }, [])

  return (
    <div style={{ padding: '24px', maxWidth: '900px', margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.5rem', color: '#f1f5f9' }}>
            📋 Automated Briefing System
          </h2>
          <p style={{ margin: '4px 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>
            Zero-touch intelligence briefing with real-time streaming
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={() => triggerBriefing('on_demand')}
            disabled={loading || isStreaming}
            style={{
              padding: '10px 20px',
              background: loading ? '#475569' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
              fontSize: '0.9rem',
            }}
          >
            {loading ? '⏳ Starting...' : isStreaming ? '📡 Streaming...' : '🚀 Run Briefing'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: '12px 16px', background: '#451a1a', border: '1px solid #dc2626',
          borderRadius: '8px', color: '#fca5a5', marginBottom: '16px', fontSize: '0.85rem',
        }}>
          ❌ {error}
        </div>
      )}

      {/* Live Phase Indicator */}
      {isStreaming && currentPhase && (
        <div style={{
          padding: '16px', background: '#1e293b', borderRadius: '12px',
          border: `2px solid ${PHASE_LABELS[currentPhase]?.color || '#3b82f6'}`,
          marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px',
        }}>
          <span style={{ fontSize: '1.5rem' }}>{PHASE_LABELS[currentPhase]?.icon || '⏳'}</span>
          <div>
            <div style={{ color: '#f1f5f9', fontWeight: 600 }}>
              {PHASE_LABELS[currentPhase]?.label || currentPhase}
            </div>
            <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
              Briefing in progress...
            </div>
          </div>
          <div style={{
            marginLeft: 'auto', width: '8px', height: '8px', borderRadius: '50%',
            background: PHASE_LABELS[currentPhase]?.color || '#3b82f6',
            animation: 'pulse 1.5s infinite',
          }} />
        </div>
      )}

      {/* Agent Status Grid */}
      {Object.keys(agentStatuses).length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px', marginBottom: '16px',
        }}>
          {Object.entries(agentStatuses).map(([agent, status]) => (
            <div key={agent} style={{
              padding: '12px', background: '#1e293b', borderRadius: '10px',
              border: `1px solid ${
                status.status === 'success' ? '#22c55e' :
                status.status === 'failed' ? '#ef4444' :
                status.status === 'retrying' ? '#f59e0b' : '#3b82f6'
              }`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span>{AGENT_ICONS[agent] || '🤖'}</span>
                <span style={{ color: '#f1f5f9', fontWeight: 600, textTransform: 'capitalize' }}>
                  {agent}
                </span>
              </div>
              <div style={{
                marginTop: '6px', fontSize: '0.75rem',
                color: status.status === 'success' ? '#4ade80' :
                       status.status === 'failed' ? '#f87171' :
                       status.status === 'retrying' ? '#fbbf24' : '#60a5fa',
              }}>
                {status.status === 'running' && `Running (attempt ${status.attempt})...`}
                {status.status === 'success' && `✓ Completed (attempt ${status.attempt})`}
                {status.status === 'retrying' && `⟳ Retry in ${status.nextIn}s (attempt ${status.attempt})`}
                {status.status === 'failed' && `✗ Failed after ${status.attempts} attempts`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stream Log */}
      {streamEvents.length > 0 && (
        <div style={{
          background: '#0f172a', borderRadius: '12px', border: '1px solid #1e293b',
          marginBottom: '16px', maxHeight: '300px', overflow: 'auto',
          fontFamily: 'monospace', fontSize: '0.75rem',
        }}>
          <div style={{
            padding: '10px 16px', borderBottom: '1px solid #1e293b',
            color: '#94a3b8', fontWeight: 600, position: 'sticky', top: 0,
            background: '#0f172a', zIndex: 1,
          }}>
            📡 Live Event Stream ({streamEvents.length} events)
          </div>
          {streamEvents.map((ev, i) => (
            <div key={i} style={{
              padding: '6px 16px', borderBottom: '1px solid #1e293b10',
              display: 'flex', gap: '12px', alignItems: 'flex-start',
            }}>
              <span style={{ color: '#64748b', whiteSpace: 'nowrap' }}>
                {ev.time.toLocaleTimeString()}
              </span>
              <span style={{
                color: ev.type === 'agent_failed' ? '#f87171' :
                       ev.type === 'agent_complete' ? '#4ade80' :
                       ev.type === 'health_result' ? '#06b6d4' : '#94a3b8',
                minWidth: '120px',
              }}>
                [{ev.type}]
              </span>
              <span style={{ color: '#cbd5e1', wordBreak: 'break-all' }}>
                {typeof ev.data === 'object' ? JSON.stringify(ev.data).slice(0, 150) : ev.data}
              </span>
            </div>
          ))}
          <div ref={streamEndRef} />
        </div>
      )}

      {/* Briefing Content */}
      {briefing && (
        <div style={{
          background: 'linear-gradient(135deg, #1e293b, #0f172a)',
          borderRadius: '12px', border: '1px solid #334155',
          padding: '24px', marginBottom: '16px',
        }}>
          <h3 style={{ margin: '0 0 12px', color: '#f1f5f9', fontSize: '1.2rem' }}>
            {briefing.title || '📋 Briefing Report'}
          </h3>
          <div style={{
            color: '#cbd5e1', lineHeight: 1.7, fontSize: '0.9rem',
            whiteSpace: 'pre-wrap',
          }}>
            {briefing.summary || 'No content available.'}
          </div>

          {briefing.action_items?.length > 0 && (
            <div style={{ marginTop: '16px' }}>
              <h4 style={{ color: '#f59e0b', margin: '0 0 8px', fontSize: '0.9rem' }}>
                ⚡ Action Items
              </h4>
              <ul style={{ margin: 0, paddingLeft: '20px' }}>
                {briefing.action_items.map((item, i) => (
                  <li key={i} style={{ color: '#cbd5e1', marginBottom: '4px', fontSize: '0.85rem' }}>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div style={{
            marginTop: '16px', paddingTop: '12px', borderTop: '1px solid #334155',
            display: 'flex', gap: '16px', fontSize: '0.75rem', color: '#64748b',
          }}>
            <span>📅 {briefing.generated_at ? new Date(briefing.generated_at).toLocaleString() : 'N/A'}</span>
            <span>🏷️ {briefing.type || 'N/A'}</span>
            {briefing.id && <span>🆔 {briefing.id}</span>}
          </div>
        </div>
      )}

      {/* Recent Sessions */}
      <div style={{
        background: '#1e293b', borderRadius: '12px', border: '1px solid #334155',
        overflow: 'hidden',
      }}>
        <div style={{
          padding: '14px 20px', borderBottom: '1px solid #334155',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h3 style={{ margin: 0, color: '#f1f5f9', fontSize: '1rem' }}>
            📜 Recent Sessions
          </h3>
          <button
            onClick={fetchSessions}
            style={{
              padding: '4px 12px', background: '#334155', color: '#94a3b8',
              border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem',
            }}
          >
            🔄 Refresh
          </button>
        </div>

        {sessions.length === 0 ? (
          <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
            No briefing sessions yet. Click "Run Briefing" to start.
          </div>
        ) : (
          sessions.map(s => (
            <div
              key={s.id}
              onClick={() => viewSession(s.id)}
              style={{
                padding: '12px 20px', borderBottom: '1px solid #1e293b',
                cursor: 'pointer', display: 'flex', justifyContent: 'space-between',
                alignItems: 'center',
                background: activeSession === s.id ? '#334155' : 'transparent',
                transition: 'background 0.2s',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#334155'}
              onMouseLeave={e => e.currentTarget.style.background = activeSession === s.id ? '#334155' : 'transparent'}
            >
              <div>
                <span style={{
                  color: s.status === 'completed' ? '#4ade80' :
                         s.status === 'partial' ? '#fbbf24' :
                         s.status === 'failed' ? '#f87171' : '#60a5fa',
                  fontWeight: 600, fontSize: '0.85rem',
                }}>
                  {s.status === 'completed' ? '✅' :
                   s.status === 'partial' ? '⚠️' :
                   s.status === 'failed' ? '❌' : '⏳'} {s.briefing_type}
                </span>
                <span style={{ color: '#64748b', marginLeft: '12px', fontSize: '0.75rem' }}>
                  {s.created_at ? new Date(s.created_at).toLocaleString() : ''}
                </span>
              </div>
              <div style={{ display: 'flex', gap: '8px', fontSize: '0.75rem' }}>
                {s.agents_succeeded?.length > 0 && (
                  <span style={{ color: '#4ade80' }}>✓{s.agents_succeeded.length}</span>
                )}
                {s.agents_failed?.length > 0 && (
                  <span style={{ color: '#f87171' }}>✗{s.agents_failed.length}</span>
                )}
                {s.duration_ms && (
                  <span style={{ color: '#64748b' }}>{(s.duration_ms / 1000).toFixed(1)}s</span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
