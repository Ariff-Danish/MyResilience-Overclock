import { useState, useEffect, useRef } from 'react'
import { Activity, ShieldAlert, PackageSearch, Users, Radar, AlertTriangle, ShieldCheck, ChevronDown, ChevronRight, Filter, Map, Phone, Copy, Navigation, FileDown, ChevronUp, Edit2, X, Settings, BookOpen } from 'lucide-react'
import { Radar as RechartsRadar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import Sidebar from './components/Sidebar'
import NotificationToastContainer, { useNotifications } from './components/NotificationToast'
import BriefingViewer from './components/briefing/BriefingViewer'
import IDScanner from './components/scan/IDScanner'
import AssetScanner from './components/scan/AssetScanner'
import ChatbotWidget from './components/chatbot/ChatbotWidget'
import VoiceCommand from './components/voice/VoiceCommand'
import AdminDashboard from './components/admin/AdminDashboard'
import { useAuth } from './lib/AuthContext'
import './App.css'

// Haversine great-circle distance (km)
const haversineKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const API_URL = import.meta.env.VITE_API_URL || 'https://backend-delta-ivory-13.vercel.app'

function App() {
  const { toasts, addToast, dismissToast } = useNotifications()
  const { isAdmin } = useAuth()
  const [activeTab, setActiveTab] = useState('dashboard')
  const [demoMode, setDemoMode] = useState(true)
  const [isSidebarOpen, setSidebarOpen] = useState(true)
  const [trendExpanded, setTrendExpanded] = useState(false)
  // Inventory UI
  const [showAddForm, setShowAddForm] = useState(false)
  const [filterMode, setFilterMode] = useState('all') // all | low_stock | expiring
  const [showAddMember, setShowAddMember] = useState(false)
  // Distress Signal
  const [distressModal, setDistressModal] = useState(false)
  const [distressCountdown, setDistressCountdown] = useState(5)
  const [distressLoading, setDistressLoading] = useState(false)
  const [distressReport, setDistressReport] = useState(null)
  const [distressCustomMsg, setDistressCustomMsg] = useState('')
  const distressCountdownRef = useRef(null)

  // ── Demo Scenario Presets ──────────────────────────────────────────────────────
  const DEMO_SCENARIOS = [
    {
      id: 1, label: 'Prepared + Danger',
      badge: '🔴', badgeClass: 'scenario-danger',
      desc: 'Full supplies · Active Red Alert',
      inventory: [
        { id: 'd1', name: 'Bottled Water', category: 'Water', unit: 'Liters', current_amount: 60, target_amount: 60, expiry_date: '2028-01-01' },
        { id: 'd2', name: 'Emergency Rations', category: 'Food', unit: 'Servings', current_amount: 40, target_amount: 40, expiry_date: '2027-06-01' },
        { id: 'd3', name: 'First Aid Kit', category: 'Medical', unit: 'Kits', current_amount: 2, target_amount: 2, expiry_date: '2028-01-01' },
        { id: 'd4', name: 'Portable Generator', category: 'Power', unit: 'Units', current_amount: 1, target_amount: 1, expiry_date: '' },
        { id: 'd5', name: 'Emergency Tent', category: 'Shelter', unit: 'Units', current_amount: 1, target_amount: 1, expiry_date: '' },
        { id: 'd6', name: 'Satellite Phone', category: 'Communication', unit: 'Units', current_amount: 1, target_amount: 1, expiry_date: '' },
        { id: 'd7', name: 'Multi-Tool Kit', category: 'Tools', unit: 'Sets', current_amount: 1, target_amount: 1, expiry_date: '' },
        { id: 'd8', name: 'Hygiene Kit', category: 'Hygiene', unit: 'Kits', current_amount: 3, target_amount: 3, expiry_date: '2027-01-01' },
      ]
    },
    {
      id: 2, label: 'Prepared + No Danger',
      badge: '🟢', badgeClass: 'scenario-safe',
      desc: 'Full supplies · Clear weather',
      inventory: [
        { id: 'd1', name: 'Bottled Water', category: 'Water', unit: 'Liters', current_amount: 60, target_amount: 60, expiry_date: '2028-01-01' },
        { id: 'd2', name: 'Emergency Rations', category: 'Food', unit: 'Servings', current_amount: 40, target_amount: 40, expiry_date: '2027-06-01' },
        { id: 'd3', name: 'First Aid Kit', category: 'Medical', unit: 'Kits', current_amount: 2, target_amount: 2, expiry_date: '2028-01-01' },
        { id: 'd4', name: 'Portable Generator', category: 'Power', unit: 'Units', current_amount: 1, target_amount: 1, expiry_date: '' },
        { id: 'd5', name: 'Emergency Tent', category: 'Shelter', unit: 'Units', current_amount: 1, target_amount: 1, expiry_date: '' },
        { id: 'd6', name: 'Satellite Phone', category: 'Communication', unit: 'Units', current_amount: 1, target_amount: 1, expiry_date: '' },
        { id: 'd7', name: 'Multi-Tool Kit', category: 'Tools', unit: 'Sets', current_amount: 1, target_amount: 1, expiry_date: '' },
        { id: 'd8', name: 'Hygiene Kit', category: 'Hygiene', unit: 'Kits', current_amount: 3, target_amount: 3, expiry_date: '2027-01-01' },
      ]
    },
    {
      id: 3, label: 'Not Prepared + Danger',
      badge: '🚨', badgeClass: 'scenario-critical',
      desc: 'Critical gaps · Active Red Alert',
      inventory: [
        { id: 'd1', name: 'Bottled Water', category: 'Water', unit: 'Liters', current_amount: 2, target_amount: 30, expiry_date: '2027-01-01' },
        { id: 'd2', name: 'Canned Food', category: 'Food', unit: 'Cans', current_amount: 1, target_amount: 20, expiry_date: '2025-06-01' },
      ]
    },
    {
      id: 4, label: 'Not Prepared + No Danger',
      badge: '🟡', badgeClass: 'scenario-warn',
      desc: 'Critical gaps · Clear weather',
      inventory: [
        { id: 'd1', name: 'Bottled Water', category: 'Water', unit: 'Liters', current_amount: 2, target_amount: 30, expiry_date: '2027-01-01' },
        { id: 'd2', name: 'Canned Food', category: 'Food', unit: 'Cans', current_amount: 1, target_amount: 20, expiry_date: '2025-06-01' },
      ]
    },
  ]

  // Load a demo scenario — sets inventory and triggers re-analysis
  const loadScenario = (scenario) => {
    setInventory(scenario.inventory)
    setDemoMode(true)
    logEvent(
      `🎬 Scenario: ${scenario.label}`,
      'Demo Control',
      ['Watcher', 'Assessor', 'Coordinator', 'P.A.C.E'],
      scenario.desc,
      scenario.badgeClass === 'scenario-critical' ? 'error' : 'info'
    )
    addToast('info', 'Scenario Loaded', `${scenario.badge} ${scenario.label} — ${scenario.desc}`)
  }

  // Core State
  const DEFAULT_INVENTORY = [
    { id: '1', name: 'Bottled Water', category: 'Water', unit: 'Liters', current_amount: 10, target_amount: 30, expiry_date: '2027-01-01' },
    { id: '2', name: 'Canned Beans', category: 'Food', unit: 'Cans', current_amount: 5, target_amount: 20, expiry_date: '2026-05-01' },
    { id: '3', name: 'First Aid Kit', category: 'Medical', unit: 'Kits', current_amount: 1, target_amount: 1, expiry_date: '2028-01-01' },
    { id: '4', name: 'Power Bank', category: 'Power', unit: 'Units', current_amount: 1, target_amount: 3, expiry_date: '' },
  ]

  const DEFAULT_TEAM = [
    { id: '1', name: 'John Doe', age: 35, role: 'family', email: '', phone: '' },
    { id: '2', name: 'Jane Doe', age: 32, role: 'family', email: '', phone: '' }
  ]

  const [inventory, setInventory] = useState(() => {
    try { const s = localStorage.getItem('myresilience_inventory'); return s ? JSON.parse(s) : DEFAULT_INVENTORY } catch { return DEFAULT_INVENTORY }
  })

  const [team, setTeam] = useState(() => {
    try { const s = localStorage.getItem('myresilience_team'); return s ? JSON.parse(s) : DEFAULT_TEAM } catch { return DEFAULT_TEAM }
  })

  const [settings, setSettings] = useState(() => {
    try {
      const s = localStorage.getItem('myresilience_settings')
      return s ? JSON.parse(s) : { locationTracking: false, emailPreparedness: false, emailAdvisories: false, emailEmergency: false }
    } catch {
      return { locationTracking: false, emailPreparedness: false, emailAdvisories: false, emailEmergency: false }
    }
  })

  useEffect(() => { localStorage.setItem('myresilience_settings', JSON.stringify(settings)) }, [settings])



  // Persist to localStorage
  useEffect(() => { localStorage.setItem('myresilience_inventory', JSON.stringify(inventory)) }, [inventory])
  useEffect(() => { localStorage.setItem('myresilience_team', JSON.stringify(team)) }, [team])

  // Sorting State
  const [sortBy, setSortBy] = useState('category') // category, stock, expiry

  // AI Results
  const [inventoryAnalysis, setInventoryAnalysis] = useState(null)
  const [analysisLoading, setAnalysisLoading] = useState(true) // true on first load
  const [pacePlan, setPacePlan] = useState(null)
  const [recentAlert, setRecentAlert] = useState(null)
  const [liveWeather, setLiveWeather] = useState(null)
  const [lastAlertHash, setLastAlertHash] = useState('') // For change detection
  const [weatherSyncTime, setWeatherSyncTime] = useState(null)
  const [evacAdvisory, setEvacAdvisory] = useState(null)
  const [evacLoading, setEvacLoading] = useState(false)
  const leafletInstanceRef = useRef(null)
  // B2 — Readiness Score Trend
  const [scoreHistory, setScoreHistory] = useState(() => {
    try { const s = localStorage.getItem('myresilience_score_history'); return s ? JSON.parse(s) : [] } catch { return [] }
  })
  // B4 — Disaster Type Selector
  const [selectedDisasterType, setSelectedDisasterType] = useState('auto')
  // B1 — Shelter expand state
  const [expandedShelter, setExpandedShelter] = useState(null)
  // B3 — Copy SMS feedback
  const [smsCopied, setSmsCopied] = useState(false)
  // Geolocation
  const [activeSgDisaster, setActiveSgDisaster] = useState('flood')
  const [userLocation, setUserLocation] = useState(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationError, setLocationError] = useState(null)

  // Agent System State
  const [agentStatus, setAgentStatus] = useState(null)
  const [agentEvents, setAgentEvents] = useState([])
  const [agentBriefing, setAgentBriefing] = useState(null)
  const [agentConnected, setAgentConnected] = useState(false)
  const [briefingLoading, setBriefingLoading] = useState(false)

  // Scanner State
  const [showIDScanner, setShowIDScanner] = useState(false)
  const [showAssetScanner, setShowAssetScanner] = useState(false)

  // Handle ID scan result — add to team
  const handleIDScanResult = (result) => {
    setShowIDScanner(false)
    if (result.full_name) {
      const newMember = {
        id: Date.now().toString(),
        name: result.full_name,
        age: null,
        role: 'family',
        email: '',
        phone: '',
        id_number: result.id_number || '',
        id_type: result.id_type || '',
      }
      setTeam(prev => [...prev, newMember])
      logEvent('🪪 ID Scanned', 'Camera OCR', ['ID Scanner'], `Added ${result.full_name} (${result.id_type || 'ID'}) via camera scan`, 'info')
      addToast('success', 'ID Scanned', `Added ${result.full_name} from ID scan`)
    }
  }

  // Handle asset scan result — add to inventory
  const handleAssetScanResult = (result) => {
    setShowAssetScanner(false)
    if (result.asset_name) {
      const newItem = {
        id: Date.now().toString(),
        name: result.asset_name,
        category: result.asset_type || result.category || 'other',
        current_amount: result.quantity || 1,
        target_amount: result.quantity || 1,
        unit: 'pcs',
        expiry_date: result.expiry_date || '',
        notes: result.description || '',
        brand: result.brand || '',
        model: result.model || '',
        serial_number: result.serial_number || '',
        condition: result.condition || '',
        estimated_value: result.estimated_value || '',
      }
      setInventory(prev => [...prev, newItem])
      logEvent('📦 Asset Scanned', 'Camera Recognition', ['Asset Scanner'], `Added ${result.asset_name} (${result.asset_type || 'item'}) via camera scan`, 'info')
      addToast('success', 'Asset Scanned', `Added ${result.asset_name} to inventory`)
    }
  }

  // REST polling for agent status (works on Vercel serverless — no WebSocket needed)
  useEffect(() => {
    let interval = null
    let active = true

    const pollStatus = async () => {
      try {
        const res = await fetch(`${API_URL}/api/agents/status`)
        if (!res.ok) throw new Error('status fetch failed')
        const data = await res.json()
        if (active) {
          setAgentStatus(data)
          setAgentConnected(true)
        }
      } catch {
        if (active) setAgentConnected(false)
      }
    }

    // Initial fetch
    pollStatus()
    // Poll every 30 seconds
    interval = setInterval(pollStatus, 30000)

    return () => {
      active = false
      clearInterval(interval)
    }
  }, [])

  // Fetch agent events when Agents tab is active
  useEffect(() => {
    if (activeTab !== 'agents') return
    fetch(`${API_URL}/api/agents/events`)
      .then(r => r.json())
      .then(data => {
        const events = data?.events || data
        if (Array.isArray(events)) setAgentEvents(events.slice(0, 50))
      })
      .catch(() => {})
  }, [activeTab])

  useEffect(() => {
    if (settings.locationTracking && !userLocation && !locationError && !locationLoading) {
      if (navigator.geolocation) {
        setLocationLoading(true)
        navigator.geolocation.getCurrentPosition(
          pos => { setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocationLoading(false) },
          () => { setLocationError('Location access denied. Please allow it in your browser.'); setLocationLoading(false) },
          { enableHighAccuracy: true, timeout: 10000 }
        )
      } else {
        setLocationError('Geolocation not supported.')
      }
    } else if (!settings.locationTracking && userLocation) {
      setUserLocation(null)
      setLocationError(null)
    }
  }, [settings.locationTracking, userLocation, locationLoading, locationError])
  // Distant alerts (threats in other regions, not affecting user)
  const [distantAlerts, setDistantAlerts] = useState([])
  const [userRegionDisplay, setUserRegionDisplay] = useState(null)
  // Live clock
  const [liveTime, setLiveTime] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setLiveTime(new Date()), 1000); return () => clearInterval(t) }, [])

  // Backend health monitoring
  const [backendOnline, setBackendOnline] = useState(true)
  useEffect(() => {
    const checkHealth = async (timeout = 15000) => {
      try {
        const r = await fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(timeout) })
        setBackendOnline(r.ok)
      } catch {
        setBackendOnline(false)
      }
    }
    // First check uses longer timeout (Vercel cold start can take 10-15s)
    checkHealth(15000)
    const healthInterval = setInterval(() => checkHealth(8000), 30000)
    return () => clearInterval(healthInterval)
  }, [])

  // Grouped Activity Log
  const [activityEvents, setActivityEvents] = useState([
    {
      id: 'init',
      time: new Date().toLocaleTimeString(),
      title: 'System Initialized',
      userAction: 'App Boot Sequence',
      agentsTriggered: ['Core System'],
      reasoning: 'Initializing all sub-routines. Awaiting user input or scheduled MET sync.',
      expanded: false,
      type: 'info'
    }
  ])

  const logEvent = (title, userAction, agentsTriggered, reasoning, type = 'info') => {
    setActivityEvents(prev => [
      { id: Date.now().toString(), time: new Date().toLocaleTimeString(), title, userAction, agentsTriggered, reasoning, expanded: false, type },
      ...prev
    ].slice(0, 50))
  }

  const toggleEvent = (id) => {
    setActivityEvents(prev => prev.map(ev => ev.id === id ? { ...ev, expanded: !ev.expanded } : ev))
  }

  // --- AUTO ANALYSIS (Debounced) ---
  useEffect(() => {
    const timer = setTimeout(() => {
      runAutoAnalysis()
    }, 1500)
    return () => clearTimeout(timer)
  }, [inventory, team])

  const runAutoAnalysis = async () => {
    // Single Groq call: analyze_inventory returns both inventory audit AND pace plan
    // This eliminates the duplicate token burn from calling generate_pace separately
    const location = userRegionDisplay || 'Malaysia'
    setAnalysisLoading(true)
    try {
      const invRes = await fetch(`${API_URL}/api/analyze_inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory, team, location, settings })
      })

      let invData = null
      let paceData = null
      let reasonString = ''

      if (invRes.ok) {
        const payload = await invRes.json()
        invData = payload.analysis
        setInventoryAnalysis(invData)

        // Track readiness score history (keep last 10)
        setScoreHistory(prev => {
          const entry = { t: new Date().toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' }), score: invData.readiness_score }
          const next = [...prev, entry].slice(-10)
          localStorage.setItem('myresilience_score_history', JSON.stringify(next))
          return next
        })
        reasonString += `[Assessor Agent] ${invData.reasoning}\n\n`

        // Extract PACE from the same response — no second API call needed
        if (payload.pace) {
          paceData = payload.pace
          setPacePlan(paceData)
          reasonString += `[P.A.C.E Strategist] ${paceData.reasoning}`
        }
        if (payload.coordinator_message) {
          reasonString += `\n\n[Coordinator Agent] ${payload.coordinator_message}`
        }
      } else {
        const errBody = await invRes.json().catch(() => ({}))
        reasonString += `[Assessor Agent] Analysis degraded — ${errBody.detail || `HTTP ${invRes.status}`}. Displaying last known state.`
        // Retain previous PACE plan if one exists
        setPacePlan(prev => prev ?? {
          primary: 'Service temporarily unavailable. Shelter in place and conserve resources.',
          alternate: 'Monitor official MET Malaysia broadcasts for updates.',
          contingency: 'Contact emergency services (999) if situation worsens.',
          emergency: 'Evacuate to nearest community shelter if life is at risk.',
          reasoning: 'P.A.C.E. Strategist could not be reached. Default guidance applied.'
        })
      }

      logEvent(
        'Asset Readiness Re-calculated',
        'Updated Inventory or Personnel Database',
        ['Assessor', 'Coordinator', 'P.A.C.E'],
        reasonString || 'Analysis completed.',
        invRes.ok ? 'success' : 'warning'
      )

      // Sync inventory/team to autonomous agents
      fetch(`${API_URL}/api/agents/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inventory: inventory,
          team: team,
          location_name: settings.location || 'Petaling',
          demo: demoMode,
        })
      }).catch(() => {})
    } catch (err) {
      logEvent('Agent Unreachable', 'Auto Analysis Trigger', ['System'], `Could not connect to backend: ${err.message}.`, 'error')
    } finally {
      setAnalysisLoading(false)
    }
  }

  // --- INSTANT LOAD ON MOUNT ---
  // Runs analysis immediately so readiness, PACE, and all panels populate on first load
  // (the debounced effect above only fires on inventory/team *changes*)
  useEffect(() => {
    runAutoAnalysis()
  }, [])

  // --- EVACUATION ADVISOR ---
  const runEvacuationAdvisory = async (sendSms = false) => {
    setEvacLoading(true)
    setExpandedShelter(null)
    try {
      // B4 — Use selected type or fall back to live alert type
      const disasterType = selectedDisasterType !== 'auto'
        ? selectedDisasterType
        : (recentAlert?.weather_disaster_type || 'flood')
      const severity = recentAlert?.weather_severity || 'warning'
      const res = await fetch(`${API_URL}/api/evacuation_advisory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disaster_type: disasterType,
          severity: severity,
          location: userRegionDisplay || 'Malaysia',
          team: team,
          settings: settings,
          send_sms_alerts: sendSms,
          ...(userLocation ? { user_lat: userLocation.lat, user_lng: userLocation.lng } : {})
        })
      })
      if (res.ok) {
        const data = await res.json()
        setEvacAdvisory(data)
        const smsInfo = sendSms
          ? ` SMS dispatched to ${data.sms_results?.filter(r => r.status === 'sent').length || 0} contact(s).`
          : ''
        logEvent(
          'Evacuation Advisory Generated',
          `Threat Map — ${sendSms ? 'SMS Alert Mode' : 'Advisory Only'}`,
          ['Evacuation Advisor', 'Coordinator'],
          `${data.reasoning}${smsInfo}`,
          sendSms ? 'error' : 'warning'
        )
      } else {
        const err = await res.json().catch(() => ({}))
        logEvent('Evacuation Advisor Error', 'Threat Map', ['System'], err.detail || `HTTP ${res.status}`, 'error')
      }
    } catch (err) {
      logEvent('Evacuation Advisor Unreachable', 'Threat Map', ['System'], `Backend connection failed: ${err.message}`, 'error')
    }
    setEvacLoading(false)
  }

  // --- THREAT MAP AUTONOMOUS MODE ---
  // Auto-locates user and auto-generates advisory the moment Threat Map tab opens
  useEffect(() => {
    if (activeTab !== 'threatmap') return
    // Auto-request GPS location silently
    if (!userLocation && !locationLoading && navigator.geolocation) {
      setLocationLoading(true)
      setLocationError(null)
      navigator.geolocation.getCurrentPosition(
        pos => { setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocationLoading(false) },
        () => { setLocationError('Location access denied — using region data for advisory.'); setLocationLoading(false) },
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }
    // Auto-generate evacuation advisory — no user click needed
    if (!evacAdvisory && !evacLoading) {
      runEvacuationAdvisory(false)
    }
  }, [activeTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- LIVE POLLING & DEMO MODE ---
  useEffect(() => {
    const pollWeather = async (isDaily = false) => {
      try {
        const locParams = userLocation
          ? `&user_lat=${userLocation.lat}&user_lng=${userLocation.lng}`
          : ''
        const res = await fetch(`${API_URL}/api/weather/live?demo=${demoMode}${locParams}`)
        if (res.ok) {
          const data = await res.json()
          setLiveWeather(data)
          setWeatherSyncTime(new Date().toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit' }))
          // Store distant alerts and user region from backend response
          if (data.distant_alerts) setDistantAlerts(data.distant_alerts)
          if (data.user_location?.display) setUserRegionDisplay(data.user_location.display)

          const alertString = JSON.stringify(data.alerts)

          // Only trigger agents if nearby alerts changed, or demo toggle
          if (alertString !== lastAlertHash || demoMode) {
            setLastAlertHash(alertString)
            if (data.alerts && data.alerts.length > 0) {
              // Show toast for new alerts
              const alertCount = data.alerts.length
              const topAlert = data.alerts[0]
              const severity = alertCount >= 3 ? 'emergency' : alertCount >= 2 ? 'critical' : 'warning'
              addToast(severity, `${topAlert.type || 'Weather Alert'}`, `${alertCount} active alert(s) detected. ${topAlert.description || ''}`)
              triggerLiveAlert(data.alerts[0].type, data.alerts[0].description)
            } else {
              const distantNote = data.distant_alerts?.length > 0
                ? ` ${data.distant_alerts.length} warning(s) detected in other regions — not affecting your area.`
                : ''
              logEvent('Weather Status Update', 'System Sync', ['Watcher'], `Conditions nominal for your area. No nearby warnings detected.${distantNote}`, 'info')
            }
          } else if (isDaily) {
            logEvent('Daily Forecast Sync', 'Scheduled Task', ['Watcher'], 'Daily check completed. No new nearby threats identified.', 'info')
          }
        }
      } catch (err) {
        console.error(err)
      }
    }

    // Initial check
    pollWeather(true)

    // Warning Sync: Every 5 minutes (300,000 ms)
    const warningInterval = setInterval(() => pollWeather(false), 300000)

    // Daily Forecast Sync: Every 24 hours (86,400,000 ms)
    const dailyInterval = setInterval(() => pollWeather(true), 86400000)

    return () => {
      clearInterval(warningInterval)
      clearInterval(dailyInterval)
    }
  }, [demoMode, lastAlertHash, inventory, team, userLocation])


  // --- LEAFLET MAP LIFECYCLE ---
  useEffect(() => {
    if (activeTab !== 'threatmap') {
      if (leafletInstanceRef.current) {
        leafletInstanceRef.current.remove()
        leafletInstanceRef.current = null
      }
      return
    }
    if (!evacAdvisory) return

    const timer = setTimeout(() => {
      const container = document.getElementById('leaflet-threat-map')
      if (!container) return
      if (leafletInstanceRef.current) {
        leafletInstanceRef.current.remove()
        leafletInstanceRef.current = null
      }
      const L = window.L
      if (!L) { console.error('Leaflet not loaded'); return }

      // Collect all valid marker positions from AI advisory
      const shelters = (evacAdvisory.shelter_locations || []).filter(l => l.lat !== 0 && l.lng !== 0)
      const agencies = (evacAdvisory.enforcement_agencies || []).filter(l => l.lat !== 0 && l.lng !== 0)
      const allMarkers = [...shelters, ...agencies]

      // Determine initial map center:
      // Priority: user GPS → first shelter from advisory → KL fallback
      let mapCenter
      if (userLocation) {
        mapCenter = [userLocation.lat, userLocation.lng]
      } else if (shelters.length > 0) {
        mapCenter = [shelters[0].lat, shelters[0].lng]
      } else {
        mapCenter = [3.1390, 101.6869] // KL centre fallback
      }

      const map = L.map('leaflet-threat-map', { zoomControl: true }).setView(mapCenter, 13)
      leafletInstanceRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map)

      setTimeout(() => { map.invalidateSize() }, 300)

      const makeIcon = (emoji, large = false) => L.divIcon({
        html: `<div style="font-size:${large ? '30px' : '22px'};line-height:1;filter:drop-shadow(0 1px 3px rgba(0,0,0,0.7))">${emoji}</div>`,
        className: '',
        iconSize: [large ? 36 : 28, large ? 36 : 28],
        iconAnchor: [large ? 18 : 14, large ? 18 : 14]
      })

      // Find nearest shelter (shelters only, not agencies) to user
      let nearestShelter = null, nearestShelterDist = Infinity
      if (userLocation && shelters.length > 0) {
        shelters.forEach(loc => {
          const d = haversineKm(userLocation.lat, userLocation.lng, loc.lat, loc.lng)
          if (d < nearestShelterDist) { nearestShelterDist = d; nearestShelter = loc }
        })
      }

      // Also find nearest of ALL locations (shelter + agency) for the summary bar
      let nearestAny = null, nearestAnyDist = Infinity
      if (userLocation && allMarkers.length > 0) {
        allMarkers.forEach(loc => {
          const d = haversineKm(userLocation.lat, userLocation.lng, loc.lat, loc.lng)
          if (d < nearestAnyDist) { nearestAnyDist = d; nearestAny = loc }
        })
      }

      // Draw shelter markers
      let nearestShelterMarker = null
      shelters.forEach(loc => {
        const isNearest = nearestShelter && loc.name === nearestShelter.name
        const marker = L.marker([loc.lat, loc.lng], { icon: makeIcon('🏠', isNearest), zIndexOffset: isNearest ? 900 : 0 })
          .addTo(map)
          .bindPopup(
            `<b style="color:#16a34a">🏠 ${isNearest ? '🏆 NEAREST SHELTER' : 'Evacuation Shelter'}</b>
            <br><b>${loc.name}</b>
            <br><span style="color:#6b7280;font-size:12px">${loc.address}</span>
            ${userLocation ? `<br><span style="color:#84cc16;font-size:12px">📏 ${haversineKm(userLocation.lat, userLocation.lng, loc.lat, loc.lng).toFixed(2)} km from you</span>` : ''}
            <br><a href="https://maps.google.com/?q=${loc.lat},${loc.lng}" target="_blank" style="color:#3b82f6;font-size:12px">Open in Google Maps ↗</a>`
          )
        if (isNearest) nearestShelterMarker = marker
      })

      // Draw agency markers
      const agencyEmoji = { police: '🚔', fire: '🚒', hospital: '🏥', nadma: '🏛️' }
      agencies.forEach(agency => {
        const emoji = agencyEmoji[agency.type] || '📍'
        L.marker([agency.lat, agency.lng], { icon: makeIcon(emoji) })
          .addTo(map)
          .bindPopup(
            `<b style="color:#2563eb">${emoji} ${agency.type?.toUpperCase()}</b>
            <br><b>${agency.name}</b>
            <br><span style="color:#6b7280;font-size:12px">${agency.address}</span>
            ${userLocation ? `<br><span style="color:#94a3b8;font-size:12px">📏 ${haversineKm(userLocation.lat, userLocation.lng, agency.lat, agency.lng).toFixed(2)} km from you</span>` : ''}
            <br><a href="https://maps.google.com/?q=${agency.lat},${agency.lng}" target="_blank" style="color:#3b82f6;font-size:12px">Open in Google Maps ↗</a>`
          )
      })

      // User location marker + route line to nearest shelter
      if (userLocation) {
        const uIcon = L.divIcon({
          html: `<div class="user-loc-dot"><div class="user-loc-ring"></div></div>`,
          className: '',
          iconSize: [16, 16],
          iconAnchor: [8, 8]
        })
        const userMarker = L.marker([userLocation.lat, userLocation.lng], { icon: uIcon, zIndexOffset: 1000 })
          .addTo(map)
          .bindPopup(`<b style="color:#3b82f6">📍 Your Location</b><br><span style="color:#8b949e;font-size:11px">${userLocation.lat.toFixed(5)}, ${userLocation.lng.toFixed(5)}</span>`)

        // Draw route line to nearest shelter (prefer shelter over agency)
        if (nearestShelter) {
          L.polyline([[userLocation.lat, userLocation.lng], [nearestShelter.lat, nearestShelter.lng]], {
            color: '#84cc16', weight: 3.5, dashArray: '10,6', opacity: 0.9
          }).addTo(map)
            .bindTooltip(`🏆 Nearest shelter: ${nearestShelter.name} · ${nearestShelterDist.toFixed(2)} km`, {
              sticky: true, className: 'leaflet-route-tip', permanent: false
            })
          // Auto-open nearest shelter popup
          if (nearestShelterMarker) {
            setTimeout(() => nearestShelterMarker.openPopup(), 600)
          }
        } else if (nearestAny) {
          // Fallback: route to nearest of any type
          L.polyline([[userLocation.lat, userLocation.lng], [nearestAny.lat, nearestAny.lng]], {
            color: '#f59e0b', weight: 3, dashArray: '8,5', opacity: 0.85
          }).addTo(map)
            .bindTooltip(`→ ${nearestAny.name} · ${nearestAnyDist.toFixed(2)} km`, { sticky: true, className: 'leaflet-route-tip' })
        }

        // FitBounds: encompass user position + ALL advisory markers (true Malaysia-wide accuracy)
        const boundsPoints = [[userLocation.lat, userLocation.lng], ...allMarkers.map(l => [l.lat, l.lng])]
        if (boundsPoints.length > 1) {
          const bounds = L.latLngBounds(boundsPoints)
          map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 })
        } else {
          userMarker.openPopup()
        }
      } else if (allMarkers.length > 0) {
        // No user location — fit to all advisory markers
        const bounds = L.latLngBounds(allMarkers.map(l => [l.lat, l.lng]))
        map.fitBounds(bounds, { padding: [60, 60], maxZoom: 14 })
      }
    }, 250)

    return () => clearTimeout(timer)
  }, [activeTab, evacAdvisory, userLocation])

  const triggerLiveAlert = async (alertType, desc) => {
    try {
      const body = {
        inventory, team, settings,
        location: userRegionDisplay || 'Kuala Lumpur, Malaysia',
        ...(userLocation ? { user_lat: userLocation.lat, user_lng: userLocation.lng } : {})
      }
      const res = await fetch(`${API_URL}/api/evaluate_risk?demo=${demoMode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (res.ok) {
        const data = await res.json()
        setRecentAlert(data)

        // AUTO-POPULATE Threat Map tab when backend auto-generated an advisory
        if (data.evacuation_advisory) {
          setEvacAdvisory({
            ...data.evacuation_advisory,
            sms_results: data.sms_auto_results || []
          })
        }

        let reason = `Watcher identified ${alertType}: ${desc}.\n`
        reason += `Assessor urgency: ${data.evacuation_urgency?.toUpperCase()}. `
        reason += `Coordinator action: ${data.action_taken?.toUpperCase()}.`

        if (data.evacuation_advisory) {
          const smsSent = data.sms_auto_results?.filter(r => r.status === 'sent').length || 0
          const smsSkipped = data.sms_auto_results?.filter(r => r.status === 'skipped').length || 0
          reason += `\n\n[AUTO-EVAC] Evacuation Advisory auto-generated.\n`
          reason += `[AUTO-SMS] ${smsSent} SMS sent, ${smsSkipped} skipped. Open Threat Map tab to view full advisory.`
        }

        logEvent(
          'CRITICAL THREAT ESCALATION',
          'External Trigger (MET Sync)',
          data.evacuation_advisory
            ? ['Watcher', 'Assessor', 'Coordinator', 'Evacuation Advisor']
            : ['Watcher', 'Assessor', 'Coordinator'],
          reason,
          'error'
        )
      }
    } catch (err) {
      console.error(err)
    }
  }

  // Best-effort background sync to backend — localStorage is the primary store
  const saveToDb = async (type, data) => {
    try {
      const endpoint = type === 'inventory' ? 'inventory' : 'team'
      await fetch(`${API_URL}/api/data/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
    } catch (err) { console.error(`[saveToDb] Background sync failed for ${type}:`, err) }
  }

  const deleteFromDb = async (type, id) => {
    try {
      const endpoint = type === 'inventory' ? 'inventory' : 'team'
      await fetch(`${API_URL}/api/data/${endpoint}/${id}`, { method: 'DELETE' })
    } catch (err) { console.error(`Failed to delete ${type}:`, err) }
  }

  // --- FORMS ---
  const categories = ['Water', 'Food', 'Medical', 'Security', 'Shelter', 'Communication', 'Power', 'Tools', 'Hygiene', 'Transport', 'Documents', 'Misc']
  const [newItem, setNewItem] = useState({ name: '', category: 'Water', unit: 'Units', current_amount: 0, target_amount: 0, expiry_date: '' })

  const addInventoryItem = () => {
    if (!newItem.name) return
    const item = { ...newItem, id: Date.now().toString() }
    setInventory([item, ...inventory])
    saveToDb('inventory', item)
    setNewItem({ name: '', category: 'Water', unit: 'Units', current_amount: 0, target_amount: 0, expiry_date: '' })
  }

  const [editingId, setEditingId] = useState(null)
  const [editItemData, setEditItemData] = useState(null)

  const startEdit = (item) => {
    setEditingId(item.id)
    setEditItemData({ ...item })
  }

  const saveEdit = () => {
    setInventory(inventory.map(i => i.id === editingId ? editItemData : i))
    saveToDb('inventory', editItemData)
    setEditingId(null)
    setEditItemData(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditItemData(null)
  }

  // Voice command handlers
  const handleVoiceAdd = (item) => {
    const newItem = {
      ...item,
      id: Date.now().toString(),
      expiry_date: '',
    }
    setInventory(prev => [newItem, ...prev])
    saveToDb('inventory', newItem)
    logEvent('🎤 Voice Add', 'Voice Command', ['Voice Assistant'], `Added ${item.name} (${item.quantity || 1}) via voice`, 'info')
    addToast('success', 'Voice Add', `Added ${item.name} via voice`)
  }

  const handleVoiceUpdate = (itemName, quantity) => {
    const found = inventory.find(i => i.name.toLowerCase().includes(itemName.toLowerCase()))
    if (found) {
      const updated = { ...found, current_amount: quantity }
      setInventory(prev => prev.map(i => i.id === found.id ? updated : i))
      saveToDb('inventory', updated)
      logEvent('🎤 Voice Update', 'Voice Command', ['Voice Assistant'], `Updated ${found.name} to ${quantity} via voice`, 'info')
      addToast('success', 'Voice Update', `Updated ${found.name} to ${quantity}`)
    } else {
      addToast('warning', 'Not Found', `Item "${itemName}" not found in inventory`)
    }
  }

  const handleVoiceDelete = (itemName) => {
    const found = inventory.find(i => i.name.toLowerCase().includes(itemName.toLowerCase()))
    if (found) {
      setInventory(prev => prev.filter(i => i.id !== found.id))
      logEvent('🎤 Voice Delete', 'Voice Command', ['Voice Assistant'], `Removed ${found.name} via voice`, 'info')
      addToast('success', 'Voice Delete', `Removed ${found.name}`)
    } else {
      addToast('warning', 'Not Found', `Item "${itemName}" not found`)
    }
  }

  const handleVoiceSearch = (query) => {
    setFilterMode('all')
    // The search will be handled by filtering in the render
    addToast('info', 'Voice Search', `Searching for "${query}"`)
  }

  const [newMember, setNewMember] = useState({ name: '', age: 0, role: 'family', email: '', phone: '', remarks: '', skills: '', pinned: false })
  const addTeamMember = () => {
    if (!newMember.name) return
    setTeam([...team, { ...newMember, id: Date.now().toString() }])
    setNewMember({ name: '', age: 0, role: 'family', email: '', phone: '', remarks: '', skills: '', pinned: false })
  }

  const togglePin = (id) => {
    setTeam(team.map(m => m.id === id ? { ...m, pinned: !m.pinned } : m))
  }

  const [editingMemberId, setEditingMemberId] = useState(null)
  const [editMemberData, setEditMemberData] = useState(null)

  const startEditMember = (member) => {
    setEditingMemberId(member.id)
    setEditMemberData({ ...member })
  }

  const saveEditMember = () => {
    setTeam(team.map(m => m.id === editingMemberId ? editMemberData : m))
    saveToDb('team', editMemberData)
    setEditingMemberId(null)
    setEditMemberData(null)
  }

  const cancelEditMember = () => {
    setEditingMemberId(null)
    setEditMemberData(null)
  }

  // --- SORTING HELPERS ---
  const getSortedInventory = () => {
    const arr = [...inventory];
    if (sortBy === 'category') {
      return arr.sort((a, b) => (a.category || '').localeCompare(b.category || ''))
    } else if (sortBy === 'stock') {
      return arr.sort((a, b) => {
        const ratioA = a.target_amount ? a.current_amount / a.target_amount : 0
        const ratioB = b.target_amount ? b.current_amount / b.target_amount : 0
        return ratioA - ratioB
      })
    } else if (sortBy === 'expiry') {
      return arr.sort((a, b) => {
        if (!a.expiry_date) return 1
        if (!b.expiry_date) return -1
        return new Date(a.expiry_date) - new Date(b.expiry_date)
      })
    }
    return arr;
  }

  // --- MALAY WEATHER TRANSLATOR ---
  const translateWeather = (summary) => {
    if (!summary) return { en: '\u2014', icon: '\uD83C\uDF24\uFE0F' }
    const map = [
      ['Ribut petir', { en: 'Thunderstorm', icon: '\u26C8\uFE0F' }],
      ['Ribut', { en: 'Storm', icon: '\uD83C\uDF29\uFE0F' }],
      ['Berjerebu', { en: 'Haze ⚠️ Air quality risk', icon: '\uD83C\uDF2B\uFE0F' }],
      ['Hujan lebat', { en: 'Heavy rain', icon: '\u26C8\uFE0F' }],
      ['Hujan ringan', { en: 'Light rain', icon: '\uD83C\uDF26\uFE0F' }],
      ['Hujan', { en: 'Rain', icon: '\uD83C\uDF27\uFE0F' }],
      ['Berawan', { en: 'Cloudy', icon: '\u2601\uFE0F' }],
      ['Panas', { en: 'Hot & sunny', icon: '\u2600\uFE0F' }],
      ['Tiada hujan', { en: 'No rain expected', icon: '\u2600\uFE0F' }],
    ]
    for (const [key, val] of map) {
      if (summary.toLowerCase().includes(key.toLowerCase())) return val
    }
    return { en: summary, icon: '\uD83C\uDF21\uFE0F' }
  }

  // --- UI RENDERERS ---
  const getRadarData = () => {
    if (!inventoryAnalysis) return []
    const cap = (val, max) => Math.min(100, Math.max(0, (val / max) * 100))
    return [
      { subject: 'Water', A: cap(inventoryAnalysis.survival_days_water, 14), fullMark: 100 },
      { subject: 'Food', A: cap(inventoryAnalysis.survival_days_food, 14), fullMark: 100 },
      { subject: 'Medical', A: inventory.some(i => i.category === 'Medical' && i.current_amount > 0) ? 90 : 10, fullMark: 100 },
      { subject: 'Power', A: inventory.some(i => i.category === 'Power' && i.current_amount > 0) ? 80 : 10, fullMark: 100 },
      { subject: 'Readiness', A: inventoryAnalysis.readiness_score, fullMark: 100 },
    ]
  }

  const handleLocateMe = () => {
    if (!navigator.geolocation) { setLocationError('Geolocation not supported.'); return }
    setLocationLoading(true)
    setLocationError(null)
    navigator.geolocation.getCurrentPosition(
      pos => { setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocationLoading(false) },
      () => { setLocationError('Location access denied. Please allow it in your browser.'); setLocationLoading(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const handleCopySms = () => {
    if (evacAdvisory?.sms_alert_text) {
      navigator.clipboard.writeText(evacAdvisory.sms_alert_text)
      setSmsCopied(true)
      setTimeout(() => setSmsCopied(false), 2000)
    }
  }

  const handleShareLocation = () => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        const { latitude, longitude } = pos.coords
        const url = `https://maps.google.com/?q=${latitude},${longitude}`
        if (navigator.share) {
          navigator.share({ title: 'MyResilience — My Location', url })
        } else {
          window.open(url, '_blank')
        }
      }, () => window.open('https://maps.google.com', '_blank'))
    } else {
      window.open('https://maps.google.com', '_blank')
    }
  }

  const handleDownloadAdvisory = () => {
    if (!evacAdvisory) return
    const lines = [
      '=== MYRESILIENCE EVACUATION ADVISORY ===',
      `Generated: ${new Date().toLocaleString('en-MY')}`,
      '',
      '--- SMS ALERT ---',
      evacAdvisory.sms_alert_text || '',
      '',
      '--- SAFE ROUTES ---',
      ...(evacAdvisory.routes_to_take || []).map((r, i) => `${i + 1}. ${r}`),
      '',
      '--- AREAS TO AVOID ---',
      ...(evacAdvisory.areas_to_avoid || []).map(a => `⛔ ${a}`),
      '',
      '--- SHELTER LOCATIONS ---',
      ...(evacAdvisory.shelter_locations || []).map(s => `• ${s.name} — ${s.address}`),
      '',
      '--- ADVISOR REASONING ---',
      evacAdvisory.reasoning || '',
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `myresilience-advisory-${Date.now()}.txt`
    a.click()
  }

  const renderDashboard = () => (
    <div className="tab-pane animate-fade-in">
      <div className="dash-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <h2>⚡ COMMAND DASHBOARD</h2>
          <span className="header-status-badge">
            {liveWeather?.alerts?.length > 0 ? '🔴 THREAT ACTIVE' : '🟢 NOMINAL'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
          {userRegionDisplay && (
            <span className="header-location-pill">📍 {userRegionDisplay.split(',')[0]}</span>
          )}
          <span className="header-clock tech-font">
            {liveTime.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })} MYT
          </span>
          <div className="demo-toggle">
            <label>DEMO</label>
            <label className="switch">
              <input type="checkbox" checked={demoMode} onChange={e => setDemoMode(e.target.checked)} />
              <span className="slider round"></span>
            </label>
          </div>
        </div>
      </div>

      {/* ── Demo Scenario Launcher ── */}
      {demoMode && (
        <div style={{
          background: 'rgba(56,189,248,0.06)', border: '1px solid rgba(56,189,248,0.2)',
          borderRadius: '10px', padding: '0.75rem 1rem', marginBottom: '1rem',
          animation: 'fadeIn 0.3s ease'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: '700', color: 'var(--primary)', letterSpacing: '0.5px' }}>DEMO SCENARIOS</span>
            <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic' }}>Click to simulate</span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {DEMO_SCENARIOS.map(s => (
              <button key={s.id} onClick={() => loadScenario(s)} style={{
                background: s.badgeClass === 'scenario-critical' ? 'rgba(244,63,94,0.15)' :
                  s.badgeClass === 'scenario-danger' ? 'rgba(244,63,94,0.1)' :
                  s.badgeClass === 'scenario-safe' ? 'rgba(34,197,94,0.1)' : 'rgba(245,158,11,0.1)',
                border: `1px solid ${s.badgeClass === 'scenario-critical' ? 'rgba(244,63,94,0.4)' :
                  s.badgeClass === 'scenario-danger' ? 'rgba(244,63,94,0.3)' :
                  s.badgeClass === 'scenario-safe' ? 'rgba(34,197,94,0.3)' : 'rgba(245,158,11,0.3)'}`,
                borderRadius: '8px', padding: '0.4rem 0.75rem', cursor: 'pointer',
                color: 'var(--text)', fontSize: '0.78rem', fontWeight: '600',
                display: 'flex', alignItems: 'center', gap: '0.4rem',
                transition: 'all 0.2s ease'
              }}>
                <span>{s.badge}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Threat Level Indicator ── */}
      {liveWeather?.alerts?.length > 0 ? (
        <div className={`threat-level-bar ${liveWeather.alerts.length >= 3 ? 'critical' : 'elevated'}`}>
          <span className="threat-level-icon">{liveWeather.alerts.length >= 3 ? '🔴' : '🟡'}</span>
          <div className="threat-level-text">
            <span className="threat-level-label">Threat Level</span>
            <span className="threat-level-value">
              {liveWeather.alerts.length >= 3 ? 'CRITICAL — Multiple Active Threats' : 'ELEVATED — Active Warning'}
            </span>
          </div>
          <span className="threat-level-count">{liveWeather.alerts.length} alert{liveWeather.alerts.length > 1 ? 's' : ''}</span>
        </div>
      ) : (
        <div className="threat-level-bar nominal">
          <span className="threat-level-icon">🟢</span>
          <div className="threat-level-text">
            <span className="threat-level-label">Threat Level</span>
            <span className="threat-level-value">NOMINAL — All Clear</span>
          </div>
          {distantAlerts?.length > 0 && (
            <span className="threat-level-count">{distantAlerts.length} distant</span>
          )}
        </div>
      )}

      {/* ── Offline Banner ── */}
      {!backendOnline && (
        <div style={{
          background: 'rgba(244,63,94,0.12)', border: '1px solid rgba(244,63,94,0.35)',
          borderRadius: '8px', padding: '0.6rem 1rem', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.83rem',
          color: '#fca5a5', animation: 'fadeIn 0.3s ease'
        }}>
          <span style={{ fontSize: '1rem' }}>⚠️</span>
          <span><strong>AI Backend Offline</strong> — Local data shown. Some features may be limited. Retrying every 30s.</span>
          <button onClick={() => fetch(`${API_URL}/health`, { signal: AbortSignal.timeout(15000) }).then(r => setBackendOnline(r.ok)).catch(() => setBackendOnline(false))}
            style={{ marginLeft: 'auto', background: 'rgba(244,63,94,0.2)', border: '1px solid rgba(244,63,94,0.4)', color: '#fca5a5', borderRadius: '6px', padding: '0.25rem 0.65rem', cursor: 'pointer', fontSize: '0.75rem', fontWeight: '700' }}>
            Retry ↺
          </button>
        </div>
      )}

      {/* ── Mission Timeline ── */}
      <div style={{
        background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.15)',
        borderRadius: '10px', padding: '0.6rem 1rem', marginBottom: '1rem',
        display: 'flex', alignItems: 'center', gap: '0.15rem', fontSize: '0.72rem',
        overflowX: 'auto', whiteSpace: 'nowrap'
      }}>
        {[
          { icon: '🌧️', label: 'MET Warning', active: liveWeather?.alerts?.length > 0 },
          { icon: '📊', label: 'Household Assessed', active: !!inventoryAnalysis },
          { icon: '⏱️', label: inventoryAnalysis ? `Survival: ${inventoryAnalysis.survival_days || '?'} days` : 'Survival Window', active: !!inventoryAnalysis },
          { icon: '🗺️', label: 'Evacuation Route', active: !!evacAdvisory },
          { icon: '📱', label: 'Contacts Ready', active: team.length > 0 },
          { icon: '✅', label: 'Family Plan', active: !!pacePlan },
        ].map((step, i, arr) => (
          <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '0.2rem',
              padding: '0.25rem 0.5rem', borderRadius: '6px',
              background: step.active ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${step.active ? 'rgba(34,197,94,0.3)' : 'rgba(255,255,255,0.08)'}`,
              color: step.active ? '#4ade80' : 'var(--muted)',
              fontWeight: step.active ? '600' : '400',
              transition: 'all 0.3s ease'
            }}>
              <span>{step.icon}</span> {step.label}
            </span>
            {i < arr.length - 1 && <span style={{ color: step.active ? '#4ade80' : 'var(--muted)', margin: '0 0.1rem' }}>→</span>}
          </span>
        ))}
      </div>

      {/* ── Analysis Loading Banner (first load only) ── */}
      {analysisLoading && !inventoryAnalysis && (
        <div style={{
          background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)',
          borderRadius: '8px', padding: '0.6rem 1rem', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.83rem', color: 'var(--primary)'
        }}>
          <span className="pulse-dot" style={{ width: '8px', height: '8px', background: 'var(--primary)', borderRadius: '50%', flexShrink: 0 }} />
          <span>AI Assessor initialising — calculating readiness scores and P.A.C.E plan...</span>
        </div>
      )}

      <div className="dashboard-grid">
        <div className="panel radar-panel">
          <h3><Radar className="icon-sm" /> Asset Readiness</h3>
          {inventoryAnalysis ? (
            <>
              <ResponsiveContainer width="100%" height={250}>
                <RadarChart cx="50%" cy="50%" outerRadius="70%" data={getRadarData()}>
                  <PolarGrid stroke="#334155" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <RechartsRadar name="Score" dataKey="A" stroke="#84cc16" fill="#84cc16" fillOpacity={0.3} />
                </RadarChart>
              </ResponsiveContainer>

              {scoreHistory.length >= 2 && (
                <div className="score-trend-inline">
                  <h4 className="tech-font" style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Activity size={12} /> Readiness Score Trend
                  </h4>
                  <ResponsiveContainer width="100%" height={80}>
                    <LineChart data={scoreHistory} margin={{ top: 5, right: 10, left: -30, bottom: 0 }}>
                      <XAxis dataKey="t" tick={{ fill: '#8b949e', fontSize: 9 }} />
                      <YAxis domain={[0, 100]} tick={{ fill: '#8b949e', fontSize: 9 }} />
                      <Tooltip
                        contentStyle={{ background: '#1c2128', border: '1px solid #30363d', borderRadius: '6px', fontSize: '0.7rem' }}
                        labelStyle={{ color: '#8b949e' }}
                        itemStyle={{ color: '#84cc16' }}
                      />
                      <Line type="monotone" dataKey="score" stroke="#84cc16" strokeWidth={2} dot={{ r: 2, fill: '#84cc16' }} activeDot={{ r: 4 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </>
          ) : (
            <div className="panel-loading" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '1rem 0' }}>
              <div className="skeleton skeleton-text title"></div>
              <div className="skeleton skeleton-text"></div>
              <div className="skeleton skeleton-text"></div>
              <div className="skeleton skeleton-text short"></div>
            </div>
          )}
        </div>

        <div className={`panel tactical-intel-panel ${liveWeather?.alerts?.length > 0 ? 'critical-glow' : ''}`}>
          <h3 style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {liveWeather?.alerts?.length > 0 ? <AlertTriangle className="icon-sm text-red" /> : <Radar className="icon-sm text-green" />}
              Tactical Intel
            </div>
            {weatherSyncTime && <span className="text-muted tech-font" style={{ fontSize: '0.7rem', fontWeight: 'normal' }}>MET Malaysia · synced {weatherSyncTime}</span>}
          </h3>

          {liveWeather ? (
            <div className="intel-body">
              {/* Alert Section (Top Priority) */}
              {liveWeather.alerts.length > 0 && (() => {
                const rawDesc = liveWeather.alerts[0].description || ''
                // Strip embedded forecast period breakdowns from the alert description
                const cleanDesc = rawDesc
                  .replace(/\.?\s*(Morning|Afternoon|Night|Pagi|Petang|Malam)\s*:[^.]*\./gi, '')
                  .replace(/\s{2,}/g, ' ')
                  .trim()
                return (
                  <div className="alert-box critical mb-4">
                    <h4>🚨 {(liveWeather.alerts[0].type || 'Weather Alert').toUpperCase()}</h4>
                    {cleanDesc && <p>{cleanDesc}</p>}
                    {liveWeather.alerts[0].proximity_km != null && (
                      <span className="proximity-tag nearby">⚠️ {liveWeather.alerts[0].proximity_km} km from you</span>
                    )}
                  </div>
                )
              })()}


              <div className="weather-temp-row">
                <div className="weather-temp-block">
                  <span className="temp-number tech-font">{liveWeather.current_conditions.temperature_celsius}°</span>
                  <span className="temp-unit text-muted">C max</span>
                  {liveWeather.current_conditions.min_temp && (
                    <span className="temp-min text-muted tech-font">/ {liveWeather.current_conditions.min_temp}° min</span>
                  )}
                </div>
                <div className="weather-location-col">
                  <span className="weather-location-name">{liveWeather.location}</span>
                  <span className="weather-summary-en">
                    {translateWeather(liveWeather.current_conditions.summary).icon}&nbsp;
                    {translateWeather(liveWeather.current_conditions.summary).en}
                  </span>
                  <span className="weather-bm text-muted">BM: {liveWeather.current_conditions.summary}</span>
                </div>
              </div>

              {(liveWeather.current_conditions.morning || liveWeather.current_conditions.afternoon || liveWeather.current_conditions.night) && (
                <div className="forecast-strip">
                  {[['morning'], ['afternoon'], ['night']].map(([key]) =>
                    liveWeather.current_conditions[key] ? (
                      <div key={key} className="forecast-segment">
                        <span className="forecast-icon">{translateWeather(liveWeather.current_conditions[key]).icon}</span>
                        <span className="forecast-desc">{translateWeather(liveWeather.current_conditions[key]).en}</span>
                        <span className="forecast-bm text-muted">{liveWeather.current_conditions[key]}</span>
                      </div>
                    ) : null
                  )}
                </div>
              )}

              <div className="weather-footer" style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--panel-border)' }}>
                {liveWeather.official_warnings_count > 0
                  ? <span className="weather-warning-badge">⚠️ {liveWeather.official_warnings_count} official MET warning(s) active</span>
                  : distantAlerts.length > 0
                    ? <span className="text-muted" style={{ fontSize: '0.75rem' }}>🌐 {distantAlerts.length} distant alerts in other regions</span>
                    : <span className="weather-clear-badge">✅ Region status: Nominal</span>
                }
                <a href="https://www.met.gov.my" target="_blank" rel="noopener noreferrer" className="met-link">MET Malaysia ↗</a>
              </div>
            </div>
          ) : (
            <div className="panel-loading" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '1rem 0' }}>
              <div className="skeleton skeleton-text title"></div>
              <div className="skeleton skeleton-text"></div>
              <div className="skeleton skeleton-text short"></div>
            </div>
          )}
        </div>

        <div className="panel readiness-panel">
          <h3><ShieldCheck className="icon-sm text-green" /> Readiness Report</h3>
          {inventoryAnalysis ? (
            <div className="readiness-body">
              <div className="readiness-score-row">
                <span className={`score-number tech-font ${inventoryAnalysis.readiness_score >= 70 ? 'text-green' : inventoryAnalysis.readiness_score >= 40 ? 'text-yellow' : 'text-red'}`}>
                  {inventoryAnalysis.readiness_score}
                </span>
                <span className="text-muted" style={{ fontSize: '0.9rem' }}>/&nbsp;100</span>
                {inventoryAnalysis.survival_days != null && (
                  <span className="survival-days-pill" title="Estimated days of supply remaining">
                    🕒 {inventoryAnalysis.survival_days} day{inventoryAnalysis.survival_days !== 1 ? 's' : ''} supply
                  </span>
                )}
              </div>
              <p className="text-muted" style={{ fontSize: '0.85rem' }}>{inventoryAnalysis.summary}</p>
              {inventoryAnalysis.critical_gaps.length > 0 && (
                <div className="gaps-row">
                  <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--warning)' }}>⚠ GAPS:</span>
                  {inventoryAnalysis.critical_gaps.map(g => (
                    <span key={g} className="gap-tag clickable-tag" title="Click to view inventory"
                      onClick={() => setActiveTab('inventory')}>{g}</span>
                  ))}
                </div>
              )}
              {inventoryAnalysis.low_stock_items?.length > 0 && (
                <div className="gaps-row" style={{ marginTop: '0.4rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--danger)' }}>📉 LOW STOCK:</span>
                  {inventoryAnalysis.low_stock_items.slice(0, 4).map(item => (
                    <span key={item} className="gap-tag clickable-tag"
                      style={{ borderColor: 'rgba(239,68,68,0.4)', color: '#f87171' }}
                      title="Click to filter low stock items"
                      onClick={() => { setActiveTab('inventory'); setFilterMode('low_stock') }}>{item}</span>
                  ))}
                </div>
              )}
              {inventoryAnalysis.expiring_soon_items?.length > 0 && (
                <div className="gaps-row" style={{ marginTop: '0.4rem' }}>
                  <span style={{ fontSize: '0.75rem', fontWeight: 'bold', color: 'var(--warning)' }}>⏳ EXPIRING:</span>
                  {inventoryAnalysis.expiring_soon_items.slice(0, 3).map(item => (
                    <span key={item} className="gap-tag clickable-tag"
                      style={{ borderColor: 'rgba(234,179,8,0.4)', color: '#facc15' }}
                      title="Click to filter expiring items"
                      onClick={() => { setActiveTab('inventory'); setFilterMode('expiring') }}>{item}</span>
                  ))}
                </div>
              )}
              <div className="rec-list">
                {inventoryAnalysis.recommendations.map((r, i) => (
                  <div key={i} className="rec-item">
                    <span className="rec-num tech-font">{i + 1}</span>
                    <span>{r}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="panel-loading" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '1rem 0' }}>
              <div className="skeleton skeleton-text title"></div>
              <div className="skeleton skeleton-text"></div>
              <div className="skeleton skeleton-text short"></div>
            </div>
          )}
        </div>



        {/* B3 — Quick Actions Panel */}
        <div className="panel quick-actions-panel full-width">
          <h3>⚡ Quick Actions</h3>
          <div className="quick-actions-grid">
            <a href="tel:999" className="quick-action-btn qa-danger">
              <Phone size={18} />
              <span>Call 999</span>
              <small>Emergency</small>
            </a>
            <button className="quick-action-btn qa-info" onClick={handleShareLocation}>
              <Navigation size={18} />
              <span>Share Location</span>
              <small>Google Maps</small>
            </button>
            <button
              className={`quick-action-btn ${smsCopied ? 'qa-success' : 'qa-warning'}`}
              onClick={handleCopySms}
              disabled={!evacAdvisory?.sms_alert_text}
            >
              <Copy size={18} />
              <span>{smsCopied ? 'Copied!' : 'Copy SMS'}</span>
              <small>Alert text</small>
            </button>
            <button
              className="quick-action-btn qa-muted"
              onClick={handleDownloadAdvisory}
              disabled={!evacAdvisory}
            >
              <FileDown size={18} />
              <span>Download Advisory</span>
              <small>.txt report</small>
            </button>
          </div>
        </div>

        <div className="panel pace-panel full-width">
          <h3><ShieldAlert className="icon-sm" /> Autonomous P.A.C.E. Strategy</h3>
          {!pacePlan ? (
            <div className="panel-loading" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: '1rem 0' }}>
              <div className="skeleton skeleton-text title"></div>
              <div className="skeleton skeleton-text"></div>
              <div className="skeleton skeleton-text short"></div>
              <div style={{ marginTop: '1rem', width: '100%' }}>
                <div className="skeleton skeleton-text"></div>
                <div className="skeleton skeleton-text short"></div>
              </div>
            </div>
          ) : (
            <div className="pace-grid">
              <div className="pace-card p-primary">
                <span className="pace-letter">P</span>
                <div>
                  <h4>Primary</h4>
                  <p>{pacePlan.primary}</p>
                </div>
              </div>
              <div className="pace-card p-alternate">
                <span className="pace-letter">A</span>
                <div>
                  <h4>Alternate</h4>
                  <p>{pacePlan.alternate}</p>
                </div>
              </div>
              <div className="pace-card p-contingency">
                <span className="pace-letter">C</span>
                <div>
                  <h4>Contingency</h4>
                  <p>{pacePlan.contingency}</p>
                </div>
              </div>
              <div className="pace-card p-emergency">
                <span className="pace-letter">E</span>
                <div>
                  <h4>Emergency</h4>
                  <p>{pacePlan.emergency}</p>
                </div>
              </div>
            </div>
           )}
        </div>

        {/* ── Threat Map Quick Card (visible when threat active) ── */}
        {liveWeather?.alerts?.length > 0 && (
          <div className="panel full-width" style={{
            background: 'rgba(244,63,94,0.06)', border: '1px solid rgba(244,63,94,0.25)',
            marginTop: '1rem'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.5rem' }}>🗺️</span>
                <div>
                  <h4 style={{ margin: 0, fontSize: '0.9rem' }}>Evacuation Intelligence Available</h4>
                  <p style={{ margin: 0, fontSize: '0.78rem', color: 'var(--muted)' }}>
                    {evacAdvisory
                      ? `${evacAdvisory.shelter_locations?.length || 0} shelters found · Nearest: ${evacAdvisory.shelter_locations?.[0]?.name || 'calculating...'}`
                      : 'AI-generated shelter routes, safe zones, and SMS alerts ready'}
                  </p>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => setActiveTab('threatmap')} style={{
                  background: 'rgba(244,63,94,0.15)', border: '1px solid rgba(244,63,94,0.4)',
                  color: '#fca5a5', borderRadius: '8px', padding: '0.4rem 1rem',
                  cursor: 'pointer', fontSize: '0.8rem', fontWeight: '700'
                }}>
                  Open Threat Map →
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Why Malaysia Impact Banner ── */}
        <div style={{
          background: 'rgba(56,189,248,0.04)', border: '1px solid rgba(56,189,248,0.12)',
          borderRadius: '10px', padding: '0.75rem 1rem', marginTop: '1rem',
          display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.75rem',
          color: 'var(--muted)', flexWrap: 'wrap'
        }}>
          <span style={{ fontSize: '1rem' }}>🇲🇾</span>
          <span>Built for Malaysian flood, haze, thunderstorm & landslide risk</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>MET Malaysia live data</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>Zero personal data stored</span>
          <span style={{ opacity: 0.4 }}>·</span>
          <span>Families · NGOs · Community Centres</span>
        </div>
      </div>
    </div>
  )

  const renderInventory = () => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const in30Days = new Date(today)
    in30Days.setDate(today.getDate() + 30)

    const getExpiryStatus = (expiry_date) => {
      if (!expiry_date) return 'ok'
      const d = new Date(expiry_date)
      if (d < today) return 'expired'
      if (d <= in30Days) return 'expiring'
      return 'ok'
    }

    const filteredInventory = getSortedInventory().filter(item => {
      if (filterMode === 'low_stock') {
        const r = item.target_amount ? item.current_amount / item.target_amount : 0
        return r < 0.4
      }
      if (filterMode === 'expiring') {
        const s = getExpiryStatus(item.expiry_date)
        return s === 'expired' || s === 'expiring'
      }
      return true
    })

    return (
    <div className="tab-pane animate-fade-in">
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1rem', flexWrap:'wrap', gap:'0.75rem'}}>
        <h2 style={{margin:0}}>Asset Inventory</h2>
        <div style={{display:'flex', gap:'0.5rem'}}>
          <button
            className="btn-primary"
            style={{fontSize:'0.85rem', padding:'0.4rem 1rem', background:'linear-gradient(135deg, #8b5cf6, #06b6d4)'}}
            onClick={() => setShowAssetScanner(true)}
          >
            📷 Scan Asset
          </button>
          <button
            className={`btn-primary`}
            style={{fontSize:'0.85rem', padding:'0.4rem 1rem', background: showAddForm ? 'var(--panel-border)' : undefined}}
            onClick={() => setShowAddForm(p => !p)}
          >
            {showAddForm ? '✕ Close' : '+ Add Asset'}
          </button>
        </div>
      </div>

      {/* Voice Command */}
      <VoiceCommand
        inventory={inventory}
        onAddItem={handleVoiceAdd}
        onUpdateItem={handleVoiceUpdate}
        onDeleteItem={handleVoiceDelete}
        onSearch={handleVoiceSearch}
      />

      {showAddForm && (
        <div className="panel form-panel mb-4" style={{animation:'fadeIn 0.2s ease'}}>
          <h4 style={{marginBottom:'0.75rem', color:'var(--accent-green)'}}>Register New Asset</h4>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px,1fr))', gap:'0.6rem'}}>
            <input placeholder="Asset Name" value={newItem.name} onChange={e => setNewItem({ ...newItem, name: e.target.value })} />
            <select value={newItem.category} onChange={e => setNewItem({ ...newItem, category: e.target.value })}>
              {categories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input placeholder="Unit (e.g. Cans)" value={newItem.unit} onChange={e => setNewItem({ ...newItem, unit: e.target.value })} />
            <input type="number" placeholder="Current Qty" value={newItem.current_amount === 0 ? '' : newItem.current_amount} onChange={e => setNewItem({ ...newItem, current_amount: Number(e.target.value) })} />
            <input type="number" placeholder="Target Qty" value={newItem.target_amount === 0 ? '' : newItem.target_amount} onChange={e => setNewItem({ ...newItem, target_amount: Number(e.target.value) })} />
            <input type="date" value={newItem.expiry_date} onChange={e => setNewItem({ ...newItem, expiry_date: e.target.value })} />
          </div>
          <button className="btn-primary" style={{marginTop:'0.75rem'}} onClick={() => { addInventoryItem(); setShowAddForm(false) }}>Register Asset</button>
        </div>
      )}

      <div className="filter-row" style={{marginBottom:'0.75rem', flexWrap:'wrap', gap:'0.5rem'}}>
        <Filter className="icon-sm text-muted" />
        {[['all','All Items'],['low_stock','📉 Low Stock'],['expiring','⏳ Expiring / Expired']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilterMode(key)}
            style={{
              padding:'0.3rem 0.75rem', borderRadius:'999px', fontSize:'0.78rem', fontWeight:'600', cursor:'pointer', border:'1px solid',
              background: filterMode === key ? (key === 'expiring' ? 'rgba(234,179,8,0.15)' : key === 'low_stock' ? 'rgba(239,68,68,0.12)' : 'rgba(132,204,22,0.12)') : 'transparent',
              borderColor: filterMode === key ? (key === 'expiring' ? '#facc15' : key === 'low_stock' ? '#f87171' : '#84cc16') : 'var(--panel-border)',
              color: filterMode === key ? (key === 'expiring' ? '#fde047' : key === 'low_stock' ? '#fca5a5' : '#84cc16') : 'var(--text-muted)'
            }}
          >{label}</button>
        ))}
        <span style={{marginLeft:'auto', display:'flex', alignItems:'center', gap:'0.5rem'}}>
          <span className="text-muted" style={{fontSize:'0.8rem'}}>Sort:</span>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{fontSize:'0.8rem'}}>
            <option value="category">Category</option>
            <option value="stock">Stock Level (Lowest First)</option>
            <option value="expiry">Expiration Date (Soonest First)</option>
          </select>
        </span>
      </div>

      <div className="inventory-grid">
        {filteredInventory.map(item => {
          const ratio = item.target_amount ? item.current_amount / item.target_amount : 0
          // Standardised 3-tier colour: >80% green, 30-79% yellow, <30% red
          const barClass = ratio >= 0.8 ? 'bg-green' : ratio >= 0.3 ? 'bg-yellow' : 'bg-red'
          const expiryStatus = getExpiryStatus(item.expiry_date)
          const isExpired = expiryStatus === 'expired'
          const isExpiring = expiryStatus === 'expiring'

          const cardBorderStyle = isExpired
            ? { boxShadow: '0 0 0 2px rgba(239,68,68,0.7), 0 0 12px rgba(239,68,68,0.25)' }
            : isExpiring
            ? { boxShadow: '0 0 0 2px rgba(234,179,8,0.6), 0 0 10px rgba(234,179,8,0.2)' }
            : {}

          if (editingId === item.id) {
            return (
              <div key={item.id} className={`panel asset-card cat-${item.category.toLowerCase()}`}>
                <input style={{ marginBottom: '0.5rem' }} value={editItemData.name} onChange={e => setEditItemData({ ...editItemData, name: e.target.value })} />
                <select style={{ marginBottom: '0.5rem' }} value={editItemData.category} onChange={e => setEditItemData({ ...editItemData, category: e.target.value })}>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <input type="number" placeholder="Current" value={editItemData.current_amount} onChange={e => setEditItemData({ ...editItemData, current_amount: Number(e.target.value) })} />
                  <input type="number" placeholder="Target" value={editItemData.target_amount} onChange={e => setEditItemData({ ...editItemData, target_amount: Number(e.target.value) })} />
                  <input placeholder="Unit" value={editItemData.unit} onChange={e => setEditItemData({ ...editItemData, unit: e.target.value })} />
                </div>
                <input style={{ marginBottom: '0.5rem' }} type="date" value={editItemData.expiry_date || ''} onChange={e => setEditItemData({ ...editItemData, expiry_date: e.target.value })} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn-primary" onClick={saveEdit}>Save</button>
                  <button className="btn-primary" style={{ backgroundColor: 'var(--panel-border)', color: 'var(--text-main)' }} onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            )
          }

          return (
            <div key={item.id} className={`panel asset-card cat-${item.category.toLowerCase()}`} style={cardBorderStyle}>
              <div className="asset-header">
                <div style={{display:'flex', flexDirection:'column', gap:'0.2rem'}}>
                  <h4 style={{margin:0}}>{item.name}</h4>
                  {isExpired && (
                    <span style={{fontSize:'0.7rem', fontWeight:'700', color:'#ef4444', background:'rgba(239,68,68,0.12)', border:'1px solid rgba(239,68,68,0.4)', borderRadius:'4px', padding:'1px 6px', width:'fit-content'}}>
                      ⛔ EXPIRED
                    </span>
                  )}
                  {isExpiring && (
                    <span style={{fontSize:'0.7rem', fontWeight:'700', color:'#facc15', background:'rgba(234,179,8,0.1)', border:'1px solid rgba(234,179,8,0.4)', borderRadius:'4px', padding:'1px 6px', width:'fit-content'}}>
                      ⚠️ EXPIRING SOON
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <button className="icon-btn" onClick={()=> setInventory(inventory.map(i => i.id === item.id ? {...i, current_amount: Math.max(0, i.current_amount - 1)} : i))} title="Decrease"
                    style={{fontWeight:'700', fontSize:'1rem', lineHeight:1}}>−</button>
                  <button className="icon-btn" onClick={()=> setInventory(inventory.map(i => i.id === item.id ? {...i, current_amount: i.current_amount + 1} : i))} title="Increase"
                    style={{fontWeight:'700', fontSize:'1rem', lineHeight:1}}>+</button>
                  <button className="icon-btn" onClick={() => startEdit(item)} title="Edit"><Edit2 size={14} /></button>
                  <button className="icon-btn" onClick={() => setInventory(inventory.filter(i => i.id !== item.id))} title="Delete"><X size={14} /></button>
                </div>
              </div>
              <div className="asset-cat-tag">{item.category}</div>
              <div className="progress-bg" title={`${Math.round(ratio*100)}% stocked`}>
                <div className={`progress-fg ${barClass}`} style={{ width: `${Math.min(100, ratio * 100)}%` }}></div>
              </div>
              <div className="asset-footer">
                <span>{item.current_amount} / {item.target_amount} {item.unit}</span>
                {item.expiry_date && (
                  <span style={{color: isExpired ? '#ef4444' : isExpiring ? '#facc15' : 'var(--text-muted)', fontWeight: (isExpired || isExpiring) ? '600' : 'normal'}}>
                    {isExpired ? '⛔' : isExpiring ? '⏳' : ''} Exp: {item.expiry_date}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {filteredInventory.length === 0 && (
          <div style={{gridColumn:'1/-1', textAlign:'center', padding:'2rem', color:'var(--text-muted)'}}>No items match this filter.</div>
        )}
      </div>
    </div>
    )
  }

  const renderTeam = () => {
    // Sort: pinned first, then emergency_contact, then family, then useful_contact
    const roleOrder = { emergency_contact: 0, family: 1, useful_contact: 2 }
    const sorted = [...team].sort((a, b) => {
      if ((b.pinned ? 1 : 0) !== (a.pinned ? 1 : 0)) return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      return (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9)
    })

    return (
    <div className="tab-pane animate-fade-in">
      <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'1rem', flexWrap:'wrap', gap:'0.75rem'}}>
        <h2 style={{margin:0}}>Personnel & Comms</h2>
        <div style={{display:'flex', gap:'0.5rem'}}>
          <button
            className="btn-primary"
            style={{fontSize:'0.85rem', padding:'0.4rem 1rem', background:'linear-gradient(135deg, #f59e0b, #ef4444)'}}
            onClick={() => setShowIDScanner(true)}
          >
            🪪 Scan ID
          </button>
          <button
            className="btn-primary"
            style={{fontSize:'0.85rem', padding:'0.4rem 1rem', background: showAddMember ? 'var(--panel-border)' : undefined}}
            onClick={() => setShowAddMember(p => !p)}
          >
            {showAddMember ? '\u2715 Close' : '+ Add Personnel'}
          </button>
        </div>
      </div>

      {showAddMember && (
        <div className="panel form-panel mb-4" style={{animation:'fadeIn 0.2s ease'}}>
          <h4 style={{marginBottom:'0.75rem', color:'var(--accent-green)'}}>Enlist New Personnel</h4>
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(160px,1fr))', gap:'0.6rem'}}>
            <input placeholder="Name" value={newMember.name} onChange={e => setNewMember({ ...newMember, name: e.target.value })} />
            <input type="number" placeholder="Age" value={newMember.age || ''} onChange={e => setNewMember({ ...newMember, age: Number(e.target.value) })} />
            <select value={newMember.role} onChange={e => setNewMember({ ...newMember, role: e.target.value })}>
              <option value="family">Family (Household)</option>
              <option value="emergency_contact">Emergency Contact</option>
              <option value="useful_contact">Useful Contact</option>
            </select>
            <input type="email" placeholder="Email" value={newMember.email} onChange={e => setNewMember({ ...newMember, email: e.target.value })} />
            <input type="tel" placeholder="Phone (e.g. +60123456789)" value={newMember.phone} onChange={e => setNewMember({ ...newMember, phone: e.target.value })} />
            <input placeholder="Skills (e.g. CPR, Nurse, Mechanic)" value={newMember.skills} onChange={e => setNewMember({ ...newMember, skills: e.target.value })} />
            <input placeholder="Medical/Remarks (e.g. asthma, wheelchair)" value={newMember.remarks} onChange={e => setNewMember({ ...newMember, remarks: e.target.value })} style={{gridColumn:'span 2'}} />
          </div>
          <button className="btn-primary" style={{marginTop:'0.75rem'}} onClick={() => { addTeamMember(); setShowAddMember(false) }}>Enlist Personnel</button>
        </div>
      )}

      <div className="team-grid">
        {sorted.map(member => {
          if (editingMemberId === member.id) {
            return (
              <div key={member.id} className={`panel team-card role-${member.role}`}>
                <input style={{ marginBottom: '0.5rem' }} value={editMemberData.name} onChange={e => setEditMemberData({ ...editMemberData, name: e.target.value })} />
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <input type="number" placeholder="Age" value={editMemberData.age || ''} onChange={e => setEditMemberData({ ...editMemberData, age: Number(e.target.value) })} />
                  <select value={editMemberData.role} onChange={e => setEditMemberData({ ...editMemberData, role: e.target.value })}>
                    <option value="family">Family (Household)</option>
                    <option value="emergency_contact">Emergency Contact</option>
                    <option value="useful_contact">Useful Contact</option>
                  </select>
                </div>
                <input style={{ marginBottom: '0.5rem' }} type="email" placeholder="Email" value={editMemberData.email} onChange={e => setEditMemberData({ ...editMemberData, email: e.target.value })} />
                <input style={{ marginBottom: '0.5rem' }} type="tel" placeholder="Phone" value={editMemberData.phone} onChange={e => setEditMemberData({ ...editMemberData, phone: e.target.value })} />
                <input style={{ marginBottom: '0.5rem' }} placeholder="Skills (CPR, Nurse...)" value={editMemberData.skills || ''} onChange={e => setEditMemberData({ ...editMemberData, skills: e.target.value })} />
                <input style={{ marginBottom: '0.5rem' }} placeholder="Medical/Remarks" value={editMemberData.remarks} onChange={e => setEditMemberData({ ...editMemberData, remarks: e.target.value })} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn-primary" onClick={saveEditMember}>Save</button>
                  <button className="btn-primary" style={{ backgroundColor: 'var(--panel-border)', color: 'var(--text-main)' }} onClick={cancelEditMember}>Cancel</button>
                </div>
              </div>
            )
          }

          return (
            <div key={member.id} className={`panel team-card role-${member.role}`} style={member.pinned ? {boxShadow:'0 0 0 2px rgba(234,179,8,0.5), 0 0 8px rgba(234,179,8,0.15)'} : {}}>
              <div className="team-header">
                <div style={{display:'flex', alignItems:'center', gap:'0.4rem'}}>
                  {member.pinned && <span title="Pinned" style={{fontSize:'0.9rem'}}>\u2b50</span>}
                  <h4 style={{margin:0}}>{member.name} <span style={{color:'var(--text-muted)', fontWeight:'normal'}}>({member.age})</span></h4>
                </div>
                <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                  <button className="icon-btn" onClick={() => togglePin(member.id)} title={member.pinned ? 'Unpin' : 'Pin to top'}
                    style={{fontSize:'0.85rem'}}>{member.pinned ? '\u2b50' : '\u2606'}</button>
                  <button className="icon-btn" onClick={() => startEditMember(member)} title="Edit"><Edit2 size={14} /></button>
                  <button className="icon-btn" onClick={() => setTeam(team.filter(i => i.id !== member.id))} title="Delete"><X size={14} /></button>
                </div>
              </div>
              <div className="team-role-tag">{member.role.replace('_', ' ').toUpperCase()}</div>

              {/* Contact details — always visible */}
              {member.phone && (
                <div style={{display:'flex', alignItems:'center', gap:'0.5rem', marginTop:'0.4rem'}}>
                  <span className="text-muted" style={{fontSize:'0.82rem'}}>\ud83d\udcf1 {member.phone}</span>
                  <a href={`tel:${member.phone}`} style={{fontSize:'0.7rem', padding:'2px 8px', borderRadius:'4px', background:'rgba(132,204,22,0.12)', border:'1px solid rgba(132,204,22,0.4)', color:'#84cc16', textDecoration:'none', fontWeight:'600'}}>\ud83d\udcde Call</a>
                  <a href={`sms:${member.phone}`} style={{fontSize:'0.7rem', padding:'2px 8px', borderRadius:'4px', background:'rgba(59,130,246,0.12)', border:'1px solid rgba(59,130,246,0.4)', color:'#60a5fa', textDecoration:'none', fontWeight:'600'}}>\u2709\ufe0f SMS</a>
                </div>
              )}
              {member.email && (
                <div style={{marginTop:'0.3rem'}}>
                  <a href={`mailto:${member.email}`} className="text-muted" style={{fontSize:'0.82rem', textDecoration:'none'}}>\u2709\ufe0f {member.email}</a>
                </div>
              )}
              {member.skills && (
                <div style={{marginTop:'0.4rem', display:'flex', gap:'0.3rem', flexWrap:'wrap'}}>
                  {member.skills.split(',').map((s, i) => (
                    <span key={i} style={{fontSize:'0.7rem', padding:'1px 7px', borderRadius:'4px', background:'rgba(132,204,22,0.1)', border:'1px solid rgba(132,204,22,0.3)', color:'#a3e635', fontWeight:'600'}}>
                      \ud83d\udee0\ufe0f {s.trim()}
                    </span>
                  ))}
                </div>
              )}
              {member.remarks && (
                <div className="text-yellow" style={{ fontSize: '0.8rem', marginTop: '0.4rem' }}>\u26a0\ufe0f {member.remarks}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
    )
  }

  const renderActivity = () => (
    <div className="tab-pane animate-fade-in">
      <h2>Agent Activity Network</h2>
      <div className="terminal-panel">
        {activityEvents.map((ev) => (
          <div key={ev.id} className={`activity-event type-${ev.type}`}>
            <div className="event-header" onClick={() => toggleEvent(ev.id)}>
              <div className="event-title">
                {ev.expanded ? <ChevronDown className="icon-sm" /> : <ChevronRight className="icon-sm" />}
                <span className={ev.type === 'error' ? 'text-red' : ev.type === 'success' ? 'text-green' : ''}>
                  {ev.title}
                </span>
              </div>
              <span className="event-time">{ev.time}</span>
            </div>

            {ev.expanded && (
              <div className="event-body">
                <p><strong>Trigger/Action:</strong> {ev.userAction}</p>
                <div>
                  <strong>Agents Involved: </strong>
                  {ev.agentsTriggered.map(ag => (
                    <span key={ag} className="agent-trigger-tag">{ag}</span>
                  ))}
                </div>
                <div className="reasoning-box">
                  <strong>Agent Reasoning/Outcome:</strong>
                  <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', margin: 0, marginTop: '0.5rem' }}>
                    {ev.reasoning}
                  </pre>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  // B1 — Shelter detail cards renderer
  const SHELTER_CONTACTS = {
    'shelter': { capacity: '~300–500 persons', contact: '999 / portalbencana.nadma.gov.my', authority: 'JKM / Pihak Berkuasa Tempatan' },
    'police': { capacity: 'N/A', contact: '999 (Emergency) / 112', authority: 'PDRM' },
    'fire': { capacity: 'N/A', contact: '994 / 999', authority: 'Jabatan Bomba dan Penyelamat Malaysia' },
    'hospital': { capacity: 'ICU + Emergency', contact: '999 / Hospital terdekat', authority: 'Kementerian Kesihatan Malaysia (KKM)' },
    'nadma': { capacity: 'N/A', contact: '1800-88-2000 (NADMA)', authority: 'NADMA / JKM' },
  }

  const renderShelterCards = (locations, title, emoji) => {
    const withDist = (locations || []).map(loc => ({
      ...loc,
      _dist: userLocation ? haversineKm(userLocation.lat, userLocation.lng, loc.lat, loc.lng) : null
    }))
    if (userLocation) withDist.sort((a, b) => a._dist - b._dist)
    return (
      <div className="panel shelter-cards-panel">
        <h4>{emoji} {title}</h4>
        <div className="shelter-cards-list">
          {withDist.map((loc, i) => {
            const isOpen = expandedShelter === `${title}-${i}`
            const info = SHELTER_CONTACTS[loc.type] || {}
            const isNearest = userLocation && i === 0
            return (
              <div key={i} className={`shelter-card type-${loc.type}${isNearest ? ' nearest' : ''}`}>
                <div className="shelter-card-header" onClick={() => setExpandedShelter(isOpen ? null : `${title}-${i}`)}
                >
                  <div className="shelter-card-title">
                    <span className="shelter-type-icon">
                      {loc.type === 'shelter' ? '🏠' : loc.type === 'police' ? '🚔' : loc.type === 'fire' ? '🚒' : loc.type === 'hospital' ? '🏥' : '🏛️'}
                    </span>
                    <div>
                      <div className="shelter-name">
                        {loc.name}
                        {isNearest && <span className="nearest-badge">🏆 NEAREST</span>}
                      </div>
                      <div className="shelter-address text-muted">{loc.address}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {loc._dist !== null && <span className="distance-badge">{loc._dist.toFixed(2)} km</span>}
                    {isOpen ? <ChevronUp size={16} className="text-muted" /> : <ChevronDown size={16} className="text-muted" />}
                  </div>
                </div>
                {isOpen && (
                  <div className="shelter-card-details">
                    <div className="shelter-detail-row">
                      <span className="text-muted">Authority</span>
                      <span>{info.authority || '—'}</span>
                    </div>
                    <div className="shelter-detail-row">
                      <span className="text-muted">Capacity</span>
                      <span>{info.capacity || '—'}</span>
                    </div>
                    <div className="shelter-detail-row">
                      <span className="text-muted">Contact</span>
                      <a href={`tel:${info.contact?.split('/')[0]?.trim()}`} className="shelter-call-link">
                        📞 {info.contact || '—'}
                      </a>
                    </div>
                    <div className="shelter-detail-row">
                      <span className="text-muted">GPS</span>
                      <a
                        href={`https://maps.google.com/?q=${loc.lat},${loc.lng}`}
                        target="_blank" rel="noopener noreferrer"
                        className="shelter-call-link"
                      >
                        📍 {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}
                      </a>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const renderThreatMap = () => (
    <div className="tab-pane animate-fade-in">
      <div className="dash-header">
        <h2>🗺️ Threat Map — Evacuation Advisory</h2>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
          {/* B4 — Disaster Type Selector */}
          <div className="disaster-selector">
            <label className="text-muted" style={{ fontSize: '0.8rem', fontWeight: '600' }}>SCENARIO</label>
            <select
              value={selectedDisasterType}
              onChange={e => setSelectedDisasterType(e.target.value)}
              style={{ minWidth: '140px' }}
            >
              <option value="auto">🔴 Auto (Live)</option>
              <option value="flood">🌊 Flood</option>
              <option value="storm">⛈️ Storm</option>
              <option value="haze">🌫️ Haze</option>
              <option value="fire">🔥 Fire</option>
              <option value="earthquake">🌏 Earthquake</option>
            </select>
          </div>
          <button
            className="btn-primary"
            onClick={() => runEvacuationAdvisory(false)}
            disabled={evacLoading}
          >
            {evacLoading ? '⟳ Generating...' : '⚡ Run Advisory'}
          </button>
          {evacAdvisory && (
            <button
              className="btn-sms"
              onClick={() => runEvacuationAdvisory(true)}
              disabled={evacLoading}
            >
              📱 Send SMS Alerts
            </button>
          )}
        </div>
      </div>
      {locationError && (
        <div className="location-error-bar">⚠️ {locationError}</div>
      )}
      {userLocation && (
        <div className="location-info-bar">
          📍 Your position: <strong>{userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}</strong>
          {evacAdvisory && (() => {
            const allLocs = [...(evacAdvisory.shelter_locations || []), ...(evacAdvisory.enforcement_agencies || [])]
            let nearest = null, minDist = Infinity
            allLocs.forEach(loc => { const d = haversineKm(userLocation.lat, userLocation.lng, loc.lat, loc.lng); if (d < minDist) { minDist = d; nearest = loc } })
            return nearest ? <span className="nearest-summary"> · 🏆 Nearest: <strong>{nearest.name}</strong> ({minDist.toFixed(2)} km)</span> : null
          })()}
        </div>
      )}

      {!evacAdvisory && !evacLoading && (
        <>
          <div className="panel evac-empty-state">
            <div style={{ fontSize: '4rem', marginBottom: '1rem' }}>🗺️</div>
            <h3>Initializing Threat Map...</h3>
            <p className="text-muted" style={{ maxWidth: '500px', margin: '0 auto 0.75rem', lineHeight: '1.6' }}>
              Auto-detecting your location and generating a real-time evacuation plan —{' '}
              {userRegionDisplay
                ? <strong style={{ color: 'var(--info)' }}>tailored for {userRegionDisplay.split(',')[0]}</strong>
                : 'for your region across Malaysia'}.
            </p>
            <div className="evac-spinner" style={{ fontSize: '1.5rem', marginTop: '0.5rem' }}>⟳</div>
          </div>

          {/* Official Malaysian Data Sources Panel */}
          <div className="panel gov-sources-panel">
            <h4 style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--info)', letterSpacing: '1px', fontSize: '0.85rem', textTransform: 'uppercase' }}>
              🏛️ Official Malaysian Emergency Data Sources
            </h4>
            <div className="gov-sources-grid">
              {[
                { name: 'NADMA Portal Bencana', desc: 'Live disaster & evacuation centre status', url: 'https://portalbencana.nadma.gov.my', badge: 'LIVE', color: 'var(--danger)' },
                { name: 'JPS Water Level', desc: 'Real-time river & flood gauge data', url: 'https://water.jps.gov.my', badge: 'LIVE', color: 'var(--danger)' },
                { name: 'data.gov.my', desc: 'MET weather, warnings & open datasets', url: 'https://api.data.gov.my', badge: 'API', color: 'var(--info)' },
                { name: 'JKM Welfare', desc: 'Welfare shelters & aid coordination', url: 'https://www.jkm.gov.my', badge: 'GOV', color: 'var(--primary)' },
                { name: 'DOSM / Banci', desc: 'Census, population & demographic data', url: 'https://www.dosm.gov.my', badge: 'GOV', color: 'var(--primary)' },
                { name: 'KDN', desc: 'Home Affairs — enforcement & security ops', url: 'https://www.kdn.gov.my', badge: 'GOV', color: 'var(--primary)' },
                { name: 'MySikap / JPJ', desc: 'Road conditions & transport advisories', url: 'https://www.jpj.gov.my', badge: 'GOV', color: 'var(--primary)' },
                { name: 'Bomba Malaysia', desc: 'Fire & rescue station locator', url: 'https://www.bomba.gov.my', badge: 'GOV', color: 'var(--warning)' },
              ].map(s => (
                <a key={s.name} href={s.url} target="_blank" rel="noreferrer" className="gov-source-card">
                  <span className="gov-source-badge" style={{ background: `${s.color}22`, color: s.color, borderColor: `${s.color}44` }}>{s.badge}</span>
                  <div className="gov-source-name">{s.name}</div>
                  <div className="gov-source-desc">{s.desc}</div>
                  <div className="gov-source-url">{s.url.replace('https://', '')}</div>
                </a>
              ))}
            </div>
          </div>
        </>
      )}


      {evacLoading && (
        <div className="panel evac-empty-state">
          <div className="evac-spinner">⟳</div>
          <h3>Generating Advisory...</h3>
          <p className="text-muted">Groq Evacuation Advisor is computing shelter locations, enforcement agencies, safe routes, and SMS alert text.</p>
        </div>
      )}

      {evacAdvisory && !evacLoading && (
        <div className="threat-map-layout">
          <div className="panel threat-map-panel">
            <div id="leaflet-threat-map" style={{ width: '100%', height: '450px', borderRadius: '8px', overflow: 'hidden' }}></div>
            <div className="map-legend">
              <span>🏠 Shelter</span>
              <span>🚔 Police</span>
              <span>🚒 Bomba</span>
              <span>🏥 Hospital</span>
              <span>🏛️ NADMA/JKM</span>
            </div>
          </div>

          <div className="threat-details-col">
            <div className="panel sms-preview-panel">
              <h4>📱 SMS Alert Text</h4>
              <div className="sms-bubble">{evacAdvisory.sms_alert_text}</div>
              <span className="text-muted" style={{ fontSize: '0.75rem' }}>
                {evacAdvisory.sms_alert_text?.length}/160 characters
              </span>
              {evacAdvisory.sms_results?.length > 0 && (
                <div className="sms-results-row">
                  {evacAdvisory.sms_results.map((r, i) => (
                    <span key={i} className={`sms-status-badge sms-${r.status}`}>
                      {r.status === 'sent' ? '✅' : r.status === 'skipped' ? '⏭️' : '❌'} {r.phone || 'Contact'}: {r.status}
                      {r.reason?.includes('Simulated') && <span style={{ fontSize: '0.65rem', opacity: 0.7 }}> (Demo)</span>}
                    </span>
                  ))}
                </div>
              )}
              {demoMode && (
                <span style={{ fontSize: '0.7rem', color: 'var(--muted)', fontStyle: 'italic', marginTop: '0.25rem', display: 'block' }}>
                  Demo Mode — SMS dispatch simulated for hackathon presentation
                </span>
              )}
            </div>

            <div className="panel">
              <h4>🛣️ Safe Routes</h4>
              {evacAdvisory.routes_to_take?.map((r, i) => (
                <div key={i} className="route-item">
                  <span className="route-num tech-font">{i + 1}</span>
                  <span style={{ fontSize: '0.85rem' }}>{r}</span>
                </div>
              ))}
            </div>

            <div className="panel">
              <h4>⛔ Areas to Avoid</h4>
              {evacAdvisory.areas_to_avoid?.map((a, i) => (
                <div key={i} className="avoid-item">⛔ {a}</div>
              ))}
            </div>

            <div className="panel">
              <h4>🧠 Advisor Reasoning</h4>
              <p className="text-muted" style={{ fontSize: '0.85rem', lineHeight: '1.6' }}>{evacAdvisory.reasoning}</p>
            </div>
          </div>

          {/* B1 — Shelter & Agency Detail Cards (full width below map) */}
          <div className="shelter-cards-row">
            {renderShelterCards(evacAdvisory.shelter_locations, 'Evacuation Shelters', '🏠')}
            {renderShelterCards(evacAdvisory.enforcement_agencies, 'Enforcement & Emergency', '🚨')}
          </div>
        </div>
      )}
    </div>
  )

  const renderSettings = () => (
    <div className="tab-pane animate-fade-in">
      <h2>Preferences & Configuration</h2>

      <div className="panel mb-4" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div>
          <h3>📍 Location Services</h3>
          <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Allow MyResilience to automatically access your browser's location. This is required for proximity-based weather alerts and accurate Threat Map routing.
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.locationTracking}
              onChange={e => setSettings({ ...settings, locationTracking: e.target.checked })}
              style={{ width: 'auto', minWidth: 'auto', transform: 'scale(1.2)' }}
            />
            <span style={{ fontWeight: '500' }}>Enable GPS Location Tracking</span>
          </label>
        </div>

        <div style={{ borderTop: '1px solid var(--panel-border)', paddingTop: '1.5rem' }}>
          <h3>✉️ Email Notifications</h3>
          <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
            Configure which events trigger an automated email dispatch to your designated contact address.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.emailPreparedness}
                onChange={e => setSettings({ ...settings, emailPreparedness: e.target.checked })}
                style={{ width: 'auto', minWidth: 'auto', transform: 'scale(1.2)' }}
              />
              <span style={{ fontWeight: '500' }}>Preparedness Audits (Inventory Gaps)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.emailAdvisories}
                onChange={e => setSettings({ ...settings, emailAdvisories: e.target.checked })}
                style={{ width: 'auto', minWidth: 'auto', transform: 'scale(1.2)' }}
              />
              <span style={{ fontWeight: '500' }}>Weather & Threat Advisories (Warning Level)</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.emailEmergency}
                onChange={e => setSettings({ ...settings, emailEmergency: e.target.checked })}
                style={{ width: 'auto', minWidth: 'auto', transform: 'scale(1.2)' }}
              />
              <span style={{ fontWeight: '500' }}>Emergency Evacuation Alerts (Critical Level)</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )

  const renderSurvivalGuide = () => {
    const DISASTERS = [
      { id:'flood', emoji:'🌊', name:'Banjir (Flood)', color:'#38bdf8', freq:'HIGHEST RISK',
        zones:'Kelantan, Terengganu, Johor, Pahang, Sarawak, Kedah, Perak',
        desc:'Annual monsoon floods strike Nov–Mar (East Coast) and Apr–May (West Coast). Flash floods can hit urban areas within minutes year-round.',
        signs:['Water rising fast in rivers or drains','Heavy rain lasting more than 30 minutes','JPS/NADMA/PDRM official warning on radio or SMS','Unusual rushing water sounds from drains','Sewage or earth smell from drainage systems'],
        steps:['STOP what you are doing — assess water level immediately','Move to the HIGHEST FLOOR of your building NOW — do not wait','Switch OFF electricity at the main switch (MCB panel / fuse box)','Grab your Emergency Bag: 3 days of water + food, medicine, documents, power bank, torch','Call 999 or 991 (Bomba) if water is entering building quickly','Text your GPS coordinates + nearest landmark to family and contacts','NEVER walk through floodwater — 15cm of moving water can knock an adult down','If swept into water: float on BACK, legs downstream, feet first, steer toward shore','Use STAIRS only — never the lift during flood or emergency','Signal for rescue: wave bright cloth or torch light from window or rooftop'],
        dont:['Do NOT drive through flooded roads — most flood deaths happen this way','Do NOT touch any electrical equipment near or in water','Do NOT eat food that has been in contact with floodwater — it carries disease','Do NOT return home until NADMA or PDRM declares official all-clear'],
        after:['Wait for official all-clear before entering home','Wear rubber gloves and boots — floodwater carries leptospirosis, cholera, E.coli','Photograph ALL damage before cleaning for insurance claim','Boil all drinking water for at least 5 minutes','Inspect walls and floors for structural cracks before sleeping inside','Report damage and missing persons to nearest police station'] },
      { id:'flashflood', emoji:'⚡', name:'Banjir Kilat (Flash Flood)', color:'#818cf8', freq:'HIGH RISK — Urban',
        zones:'KL, Petaling Jaya, Penang, Johor Bahru, Kuching, Kota Kinabalu, Shah Alam',
        desc:'Flash floods occur within 5 minutes of heavy rain in urban areas. Can happen even if it is not raining above you — water rushes from upstream hills.',
        signs:['Water rising more than 10cm in under 5 minutes','Loud rushing water sound from nearby drains or streams','Drains suddenly overflowing with force','Cars stalling or stopping ahead on low-lying roads','Rain visible on surrounding hills even when it is dry above you'],
        steps:['MOVE IMMEDIATELY to higher ground — you have 3 to 5 minutes maximum','Leave your car if water reaches the door panel — your life is worth more','If trapped in car: unlock doors + wind windows down before water reaches chest','Find any concrete building and go to the SECOND FLOOR or ROOFTOP','If swept into current: float on back, legs downstream, grab fixed objects like poles or trees','Blow a whistle 3 times repeatedly — or shout HELP in sets of 3 sharp calls','Wave your phone torch or any bright reflective object for rescue crews','Stay elevated until water has fully receded — wait at least 2 hours after rain stops'],
        dont:['Do NOT assume ankle-deep water is safe to walk through','Do NOT stay in underpasses, tunnels, or car parks at ground level','Do NOT stop to collect belongings — evacuate with only yourself'],
        after:['Avoid rivers and drains for 24 hours after rain stops — they can surge again','Check for snakes and reptiles hiding in flood debris before touching anything','Clean all skin cuts and wounds immediately — flash flood water is contaminated','Report missing persons to police within 24 hours'] },
      { id:'landslide', emoji:'⛰️', name:'Tanah Runtuh (Landslide)', color:'#f59e0b', freq:'HIGH RISK — Highland',
        zones:'Cameron Highlands, Genting, Ampang (KL), Fraser Hill, Sabah highlands, Sarawak interior',
        desc:'Triggered by heavy prolonged rain on steep slopes, deforestation, or earthquakes. Can happen with almost no warning. Second slides are common within hours.',
        signs:['Cracking or deep rumbling sounds from hillside','Trees or structures on slope tilting or leaning','Sudden increase in muddy brown water from streams','Unusual earth smell or gas odour from ground','Small rockslides or soil movements on slope above you','Cracks appearing in roads, walls, or ground near a slope'],
        steps:['EVACUATE IMMEDIATELY — do not stop to collect belongings','Run PERPENDICULAR to the slide direction — never run downhill in the slide path','Get to high, flat, stable ground far away from the slope','If inside a building near slope: take cover under the sturdiest table or desk available','If caught in debris flow: protect your HEAD with both arms, try to roll to the side','Call 994 (Bomba) or 999 immediately once you reach safety','Alert all neighbours by shouting, knocking on doors, or sounding your car horn repeatedly','Do NOT re-enter the area — a second landslide is likely within hours','Mark your last known position clearly for rescue teams searching the area'],
        dont:['Do NOT use roads below the slide path — more debris may fall','Do NOT attempt to rescue trapped persons without professional equipment','Do NOT stay near the slope even after the initial slide has stopped'],
        after:['Stay at least 300 metres from the affected slope for 72 hours minimum','Report any trapped persons to Bomba: 994','Do NOT turn on gas supply — inspect for leaks first','Only return after a structural engineer and JKR have cleared the area'] },
      { id:'storm', emoji:'⛈️', name:'Ribut Petir (Thunderstorm)', color:'#a78bfa', freq:'VERY COMMON — Year Round',
        zones:'All states — most severe on West Coast Peninsular Mar–Apr and Oct–Nov',
        desc:'Malaysia averages 200+ thunderstorm days per year. Lightning is a leading outdoor killer. Storms can bring winds of 80–100 km/h with little warning.',
        signs:['Dark cumulonimbus clouds building tall and fast','Sudden sharp drop in temperature before the storm','Hair standing on end (lightning is about to strike nearby)','Distant thunder rumbling growing closer quickly','Strong gusty winds before heavy rain arrives','Birds and animals going quiet suddenly'],
        steps:['Get INSIDE a solid building or hard-top vehicle immediately','Stay away from all windows, open doors, and metal objects','Unplug all electrical appliances and the TV antenna','Avoid using running water or plumbing during an active storm','If caught outdoors: crouch low on the balls of your feet, feet together, head down — do NOT lie flat','NEVER shelter under trees — trees attract and conduct lightning directly to you','If driving: stay inside the car, avoid touching metal, pull over away from trees and signs','Wait 30 full minutes after the last thunder before going outdoors','If someone is struck by lightning: call 999 immediately, start CPR — they are NOT electrified'],
        dont:['Do NOT stand under trees, near tall poles, or near water bodies','Do NOT use your mobile phone outdoors during active lightning','Do NOT lie flat on the ground — crouch low on your feet instead','Do NOT stand in an open field, on a hilltop, or near a metal fence'],
        after:['Check all electrical systems before restoring power at the MCB','Inspect roof and ceiling for water damage or structural harm','Clear fallen branches before using driveway or parking area','Report downed power lines to TNB immediately: 15454 — never touch them'] },
      { id:'haze', emoji:'🌫️', name:'Jerebu (Haze)', color:'#94a3b8', freq:'SEASONAL — Jul–Oct',
        zones:'Worst in Sarawak, Peninsular west coast, Klang Valley, Selangor, Negeri Sembilan',
        desc:'Caused by forest and peat fires in Malaysia and Indonesia. API above 300 is hazardous to all persons. Can persist for days or weeks without improvement.',
        signs:['API reading above 100 on APIMS or official app','Visible grey or brown smoky haze reducing visibility','Persistent burning smell in the air outdoors','Eye irritation, coughing, or throat discomfort without illness','Sun appearing unusually orange or dark red at any time','DOE Malaysia haze alert issued via media or MySejahtera'],
        steps:['Check API at APIMS website or MySejahtera app before any outdoor activity','STAY INDOORS — keep all doors and windows closed tightly','Wear an N95 or FFP2 mask when going outside — surgical masks do NOT protect against haze particles','Keep all air conditioners running with windows fully closed','Drink at least 3 litres of water per day to support lung function','Move children under 12, elderly above 60, pregnant women, and asthma patients indoors FIRST','Run a wet towel or cloth under door gaps to block haze from entering','If asthmatic: keep your rescue inhaler in your pocket at all times, not in your bag','Cancel all outdoor sports, exercise, and events if API exceeds 200'],
        dont:['Do NOT exercise or do any physical activity outdoors when API is above 100','Do NOT use cloth handkerchiefs as masks — they provide zero protection from fine particles','Do NOT burn rubbish, leaves, or waste during haze period — it makes it worse','Do NOT open windows thinking fresh air will help — outdoor air is more toxic than indoor air during haze'],
        after:['Once API drops below 100: ventilate your home gradually over several hours','Replace all air-conditioning filters after a prolonged haze event','See a doctor if you have persistent cough, breathlessness, or chest tightness','Children and elderly should rest indoors for 24 hours after haze clears before resuming normal activity'] },
      { id:'earthquake', emoji:'🌏', name:'Gempa Bumi (Earthquake)', color:'#f43f5e', freq:'MODERATE RISK — East Malaysia',
        zones:'Sabah (highest risk in Malaysia), Sarawak, tremors felt in Peninsular from Sumatran megaquakes',
        desc:'The 2015 Ranau, Sabah earthquake (Magnitude 6.0) killed 18 people. Peninsular Malaysia regularly feels tremors from Sumatran fault events. Coastal quakes carry tsunami risk.',
        signs:['Sudden deep rumbling sound from beneath the ground','Ground shaking or vibrating beneath your feet','Objects falling, swaying, or sliding without wind','Animals behaving erratically before or during shaking','Water in pools or containers sloshing without cause'],
        steps:['DROP immediately — get down on your hands and knees so the quake cannot knock you down','Take COVER under a sturdy table, desk, or next to an interior wall — cover your HEAD and NECK with both arms','HOLD ON to the table and be prepared to move with it until shaking fully stops','If no table: get against an interior wall away from windows, against a low piece of furniture','If in bed: stay in bed, pull your pillow firmly over your head','If driving: pull over away from bridges, overpasses, and buildings — stay inside the vehicle','If outdoors: move to open area away from all buildings, trees, and power lines — crouch low','AFTER shaking stops: check yourself and others for injury, check for gas leak smell, and exit building','Use stairs only — inspect each step for cracks before placing weight on it','Move to open ground and expect aftershocks — they can occur within minutes to days','If near the coast and you felt a strong quake: move INLAND immediately without waiting for a warning siren'],
        dont:['Do NOT run outside during the shaking — most injuries come from falling objects in doorways or outside','Do NOT stand in doorframes — this is an outdated myth — it provides no protection','Do NOT use lifts or elevators at any point during or after an earthquake','Do NOT re-enter any building until a structural engineer has inspected and cleared it'],
        after:['Check gas, water, and electrical systems carefully for damage before switching anything on','Tune to RTM Radio 1 (91.5 FM) on a battery radio for all official updates','Report structural damage to Jabatan Kerja Raya (JKR)','If near coast: wait for the official JMM tsunami all-clear before returning to shoreline'] },
      { id:'tsunami', emoji:'🌊', name:'Tsunami', color:'#0ea5e9', freq:'LOW BUT DEADLY — Coastal',
        zones:'Penang, Kedah, Perlis (Indian Ocean coast), Sabah east coast, Sarawak coast, Terengganu',
        desc:'The 2004 Indian Ocean Tsunami killed 68 people in Malaysia. Risk exists for all Indian Ocean-facing and Sabah east coasts. Warning time can be as short as 15 minutes.',
        signs:['A strong earthquake near or under the sea (you will feel it)','Ocean water suddenly receding rapidly — beach exposed far beyond normal','Loud continuous roaring noise from ocean direction like a freight train','Official tsunami warning sirens or JMM alert on radio','Unusual chaotic wave patterns at the shoreline with no wind'],
        steps:['If you FEEL a strong earthquake near the coast: DO NOT WAIT for a siren — RUN INLAND NOW','If you SEE the ocean suddenly pulling back: you have 5 to 10 minutes — RUN to high ground immediately','Get to HIGH GROUND — minimum 30 metres above sea level or 3 kilometres inland from shore','Abandon your car if traffic blocks the road — run on foot, it is faster in gridlock','If no hills nearby: go to the highest floor of the tallest concrete building available','Do NOT go to the beach to watch or take photos — the first wave is never the largest','Stay at your elevated position until NADMA or JMM issues the official all-clear — this may take 12+ hours','Help elderly people and children near you move — knock on doors, shout, sound your horn','Take NOTHING except your medication, phone, and identity documents — speed is everything'],
        dont:['Do NOT wait to see the wave approaching — if you see it, it is already too late to outrun it','Do NOT return to the shore between waves — multiple large waves can come hours apart','Do NOT think you can outswim or dive under a tsunami — this is impossible','Do NOT cross any bridge or low-lying road near the coast during or after a tsunami warning'],
        after:['Wait for the official NADMA all-clear — multiple waves can arrive over 12 to 24 hours','Avoid all coastal floodwater — contains sewage, industrial chemicals, sharp debris, and live electricity','Do NOT eat seafood caught near the affected coast for at least 30 days after the event','NADMA Hotline: 1800-88-2000 | Marine Department: 03-2691 4244'] },
      { id:'fire', emoji:'🔥', name:'Kebakaran (Fire)', color:'#f97316', freq:'COMMON — All States',
        zones:'Urban residential, industrial zones, oil palm estates, dry forest areas',
        desc:'Building fires, LPG gas leaks, and electrical faults are the most common causes. Most deadly between 2am and 5am when people are asleep. Smoke kills 3x faster than flames.',
        signs:['Smell of burning, smoke, or melting plastic','Fire alarm or smoke detector activating','Visible smoke coming from under a closed door','Crackling or popping sounds from walls, ceiling, or wiring','Unusual heat felt through a floor, wall, or door surface'],
        steps:['SOUND THE ALARM immediately — shout FIRE loudly to alert every person in the building','Call 994 (Bomba) or 999 — give your building address and floor clearly','Touch any closed door with the BACK of your hand before opening — if it is hot, do NOT open it','CRAWL on hands and knees to stay below smoke — breathable air is within 30cm of the floor','Cover your nose and mouth with a wet cloth or clothing while moving','Exit via STAIRS — NEVER use a lift during any fire emergency','Close all doors behind you as you leave — each closed door slows fire spread significantly','If trapped in a room: seal the door gap with clothing or towels, and signal from the window','If your clothes catch fire: STOP — DROP to the ground — ROLL until flames are out','Once outside the building: move to the assembly point and DO NOT RE-ENTER for any reason'],
        dont:['Do NOT try to fight a large fire with a bucket or small extinguisher — evacuate first','Do NOT pour water on cooking oil fires or electrical fires — use a fire extinguisher or smother with a lid','Do NOT delay evacuation to collect valuables — fire size doubles every 60 seconds','Do NOT open windows in a burning room — oxygen directly feeds the fire'],
        after:['Do NOT re-enter until Bomba inspects and officially clears the structure','All gas and electrical systems must be professionally inspected before reuse','File a police report for your insurance claim within 24 hours of the fire','Call JKM for emergency shelter assistance: 03-8000-8000'] }
    ]

    const COMMS = [
      { phase:'IMMEDIATE (0–1 hour)', color:'var(--danger)', icon:'🚨', steps:[
        'Go to your PRE-AGREED FAMILY MEETING POINT — decide on this NOW before any disaster occurs',
        'Use a WHISTLE — 3 short blasts means I need help. 1 long blast means I am okay',
        'If you have walkie-talkies: switch to Channel 1 — the universal emergency frequency',
        'Place a BRIGHT CLOTH or flag on your front door to signal "we are safe here" to rescue teams',
        'Physically check on immediate neighbours by knocking on their doors' ]},
      { phase:'SHORT TERM (1–24 hours)', color:'var(--warning)', icon:'⚠️', steps:[
        'Tune to RTM Radio 1 (91.5 FM) — Malaysia Emergency Broadcast channel — requires only a battery or hand-crank radio',
        'Write physical notes and pass them to trusted neighbours for relay toward help',
        'Send your strongest group member to the nearest police station, fire station, or high ground with phone signal',
        'Mark your shelter location with arrows made from rocks, sticks, or cloth for rescue teams to follow',
        'Keep your group together — do not separate unless absolutely necessary' ]},
      { phase:'MEDIUM TERM (1–7 days)', color:'var(--primary)', icon:'📡', steps:[
        'Establish a fixed check-in schedule — meet at the agreed location every 6 hours',
        'Use MIRROR or polished metal to reflect sunlight — visible up to 16km on a clear day',
        'At night: use your torch in SOS pattern — 3 short, 3 long, 3 short flashes repeatedly',
        'Build a SIGNAL FIRE — 3 fires in a triangle shape is the international distress signal recognised by all rescue aircraft',
        'Pass written messages person to person until someone reaches an area with communication' ]},
      { phase:'PHYSICAL NAVIGATION', color:'var(--violet)', icon:'🧭', steps:[
        'In Malaysia, rivers and streams ALWAYS flow toward the coast — follow any river downstream to find civilization',
        'The SUN rises in the East and sets in the West — use this to determine direction at any time of day',
        'At night: find the Southern Cross constellation (5 stars in a cross shape) — it points South',
        'Mark your path as you move: break branches, stack 3 stones, or cut arrow marks in bark so rescuers can follow',
        'If injured or weak: STAY IN ONE PLACE — it is far easier for rescuers to find a stationary person' ]}
    ]

    const disaster = DISASTERS.find(d => d.id === activeSgDisaster) || DISASTERS[0]

    return (
      <div className="tab-pane animate-fade-in sg-container">
        {/* Hero */}
        <div className="sg-hero">
          <div className="sg-hero-bg" />
          <div className="sg-hero-content">
            <h2 className="sg-hero-title">🛡️ FIELD SURVIVAL MANUAL</h2>
            <p className="sg-hero-sub">Malaysia Emergency Response — Zero Knowledge Required</p>
            <div className="sg-hero-badges">
              <span className="sg-badge sg-badge-danger">8 Disaster Types</span>
              <span className="sg-badge sg-badge-info">Step-by-Step Protocol</span>
              <span className="sg-badge sg-badge-success">Works Offline</span>
            </div>
          </div>
        </div>

        {/* Comms Blackout Section */}
        <div className="sg-section">
          <div className="sg-section-header sg-comms-header">
            <h3>📡 COMMUNICATION BLACKOUT PROTOCOL</h3>
            <p className="text-muted" style={{fontSize:'0.85rem',margin:0}}>What to do when phone, internet, and electricity are all gone</p>
          </div>
          <div className="sg-comms-grid">
            {COMMS.map((phase, pi) => (
              <div key={pi} className="sg-comms-card" style={{borderTopColor: phase.color}}>
                <div className="sg-comms-phase" style={{color: phase.color}}>{phase.icon} {phase.phase}</div>
                <ol className="sg-comms-steps">
                  {phase.steps.map((s, si) => <li key={si}>{s}</li>)}
                </ol>
              </div>
            ))}
          </div>
        </div>

        {/* Disaster Selector */}
        <div className="sg-section">
          <div className="sg-section-header">
            <h3>🌏 MALAYSIAN DISASTER RESPONSE GUIDE</h3>
            <p className="text-muted" style={{fontSize:'0.85rem',margin:0}}>Select a disaster type for complete step-by-step survival instructions</p>
          </div>
          <div className="sg-disaster-tabs">
            {DISASTERS.map(d => (
              <button key={d.id}
                className={`sg-dis-tab ${activeSgDisaster === d.id ? 'active' : ''}`}
                style={activeSgDisaster === d.id ? {borderColor: d.color, color: d.color, background: `${d.color}18`} : {}}
                onClick={() => setActiveSgDisaster(d.id)}>
                <span>{d.emoji}</span>
                <span className="sg-tab-name">{d.name.split('(')[0].trim()}</span>
                <span className="sg-tab-freq" style={{color: d.color}}>{d.freq}</span>
              </button>
            ))}
          </div>

          {/* Disaster Detail */}
          <div className="sg-disaster-detail" style={{borderTopColor: disaster.color}}>
            <div className="sg-detail-header">
              <div>
                <div className="sg-detail-title">{disaster.emoji} {disaster.name}</div>
                <div className="sg-detail-zones">📍 Highest risk: {disaster.zones}</div>
                <p className="sg-detail-desc">{disaster.desc}</p>
              </div>
              <span className="sg-detail-freq-badge" style={{background:`${disaster.color}22`, color:disaster.color, borderColor:`${disaster.color}44`}}>{disaster.freq}</span>
            </div>

            <div className="sg-detail-grid">
              {/* Warning Signs */}
              <div className="sg-card sg-card-warning">
                <h4>⚠️ Warning Signs — Watch For These</h4>
                <ul>{disaster.signs.map((s,i) => <li key={i}>{s}</li>)}</ul>
              </div>

              {/* Action Steps */}
              <div className="sg-card sg-card-action">
                <h4>✅ What To Do — Follow These Steps In Order</h4>
                <ol>{disaster.steps.map((s,i) => <li key={i}>{s}</li>)}</ol>
              </div>

              {/* Don't */}
              <div className="sg-card sg-card-dont">
                <h4>🚫 Critical — What NOT To Do</h4>
                <ul>{disaster.dont.map((s,i) => <li key={i}>{s}</li>)}</ul>
              </div>

              {/* After */}
              <div className="sg-card sg-card-after">
                <h4>🔄 After The Disaster — Recovery Steps</h4>
                <ol>{disaster.after.map((s,i) => <li key={i}>{s}</li>)}</ol>
              </div>
            </div>
          </div>
        </div>

        {/* Emergency Contacts */}
        <div className="sg-section">
          <div className="sg-section-header">
            <h3>📞 MALAYSIA EMERGENCY CONTACTS</h3>
          </div>
          <div className="sg-contacts-grid">
            {[
              {num:'999', label:'Police / General Emergency', color:'var(--danger)'},
              {num:'994', label:'Bomba & Rescue (Fire)', color:'#f97316'},
              {num:'991', label:'Medical Emergency (Ambulance)', color:'#22c55e'},
              {num:'15454', label:'TNB (Power Outage / Downed Lines)', color:'#facc15'},
              {num:'1800-88-2000', label:'NADMA Disaster Operations', color:'#38bdf8'},
              {num:'03-8064 2400', label:'JPS Flood Control Room (24h)', color:'#818cf8'},
              {num:'1-300-88-1972', label:'DOE Haze Hotline', color:'#94a3b8'},
              {num:'03-8891 5400', label:'MET Malaysia Weather Warning', color:'#a78bfa'},
            ].map(c => (
              <a key={c.num} href={`tel:${c.num}`} className="sg-contact-card">
                <div className="sg-contact-num" style={{color:c.color}}>{c.num}</div>
                <div className="sg-contact-label">{c.label}</div>
              </a>
            ))}
          </div>
        </div>
      </div>
    )
  }

  const renderAgents = () => {
    const AGENT_META = {
      sentinel: { emoji: '🛡️', name: 'Sentinel', color: 'var(--primary)' },
      guardian: { emoji: '📦', name: 'Guardian', color: 'var(--info)' },
      escalator: { emoji: '⚡', name: 'Escalator', color: 'var(--warning)' },
      briefing: { emoji: '📋', name: 'Briefing', color: 'var(--cyan)' },
    }

    const agentsObj = agentStatus?.agents || {}
    const agents = Object.entries(agentsObj).map(([id, data]) => ({ id, ...data }))
    const orchestratorStatus = agentStatus?.orchestrator?.status || 'unknown'

    const handleGenerateBriefing = async () => {
      setBriefingLoading(true)
      try {
        const res = await fetch(`${API_URL}/api/agents/briefing`, { method: 'POST' })
        const data = await res.json()
        setAgentBriefing(data)
      } catch (err) {
        setAgentBriefing({ error: err.message })
      }
      setBriefingLoading(false)
    }

    return (
      <div className="tab-pane animate-fade-in">
        <div className="tab-header">
          <h2>🤖 Autonomous Agent System</h2>
          <p className="tab-subtitle">Real-time monitoring of autonomous resilience agents</p>
        </div>

        {/* System Overview */}
        <div className="agent-system-overview">
          <div className="agent-overview-card">
            <div className="overview-icon">🧠</div>
            <div>
              <div className="overview-label">Orchestrator</div>
              <div className="overview-value">{orchestratorStatus}</div>
            </div>
          </div>
          <div className="agent-overview-card">
            <div className="overview-icon">🤖</div>
            <div>
              <div className="overview-label">Active Agents</div>
              <div className="overview-value">{agents.filter(a => a.status === 'active' || a.status === 'scanning').length}/{agents.length}</div>
            </div>
          </div>
          <div className="agent-overview-card">
            <div className="overview-icon">📡</div>
            <div>
              <div className="overview-label">Connection</div>
              <div className="overview-value">
                <span className={`ws-status ${agentConnected ? 'connected' : 'disconnected'}`}>
                  <span className="ws-status-dot" />
                  {agentConnected ? 'Live' : 'Disconnected'}
                </span>
              </div>
            </div>
          </div>
          <div className="agent-overview-card">
            <div className="overview-icon">📋</div>
            <div>
              <div className="overview-label">Briefing</div>
              <div className="overview-value">
                <button className="agent-generate-btn" onClick={handleGenerateBriefing} disabled={briefingLoading}>
                  {briefingLoading ? '⏳ Generating...' : '📋 Generate Briefing'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Agent Status Cards */}
        {agents.length > 0 ? (
          <div className="agent-cards-grid">
            {agents.map((agent, idx) => {
              const meta = AGENT_META[agent.id] || AGENT_META[agent.name?.toLowerCase()] || { emoji: '🤖', name: agent.name || agent.id, color: 'var(--text-muted)' }
              const status = agent.status || 'stopped'
              return (
                <div key={idx} className={`agent-card status-${status}`}>
                  <div className="agent-card-header">
                    <div className="agent-card-name">
                      <span className="agent-emoji">{meta.emoji}</span>
                      {meta.name}
                    </div>
                    <span className={`agent-card-status ${status}`}>{status}</span>
                  </div>
                  <div className="agent-card-metrics">
                    {agent.details && Object.entries(agent.details).slice(0, 4).map(([key, val]) => (
                      <div key={key} className="agent-metric">
                        <span className="agent-metric-label">{key.replace(/_/g, ' ')}</span>
                        <span className="agent-metric-value">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>
                      </div>
                    ))}
                  </div>
                  {agent.last_heartbeat && (
                    <div className="agent-heartbeat">
                      <span className={`agent-status-dot ${status}`} />
                      Last heartbeat: {new Date(agent.last_heartbeat).toLocaleTimeString()}
                    </div>
                  )}
                  {agent.restart_count > 0 && (
                    <div className="agent-restart-count">🔄 Restarted {agent.restart_count} time(s)</div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="agent-empty-state">
            <div className="empty-icon">🤖</div>
            <p>No agent data available</p>
            <p style={{ fontSize: '0.8rem' }}>Agents will appear here once the backend agent system is running</p>
          </div>
        )}

        {/* Latest Briefing */}
        {agentBriefing && !agentBriefing.error && (
          <div className="agent-briefing-card">
            <h3>📋 Latest Briefing</h3>
            <div className="agent-briefing-content">
              {agentBriefing.summary || agentBriefing.content || JSON.stringify(agentBriefing, null, 2)}
            </div>
            {agentBriefing.generated_at && (
              <div className="agent-briefing-meta">
                <span>Generated: {new Date(agentBriefing.generated_at).toLocaleString()}</span>
                {agentBriefing.threat_level && <span>Threat Level: {agentBriefing.threat_level}</span>}
              </div>
            )}
          </div>
        )}
        {agentBriefing?.error && (
          <div className="agent-briefing-card" style={{ borderLeftColor: 'var(--danger)' }}>
            <h3 style={{ color: 'var(--danger)' }}>⚠️ Briefing Error</h3>
            <div className="agent-briefing-content">{agentBriefing.error}</div>
          </div>
        )}

        {/* Recent Events Feed */}
        <div className="agent-events-feed">
          <h3>📡 Recent Agent Events</h3>
          {agentEvents.length > 0 ? (
            agentEvents.map((evt, idx) => (
              <div key={idx} className="agent-event-item">
                <span className="agent-event-time">
                  {evt.timestamp ? new Date(evt.timestamp).toLocaleTimeString() : '--:--'}
                </span>
                <span className="agent-event-agent">{evt.agent || evt.agent_name || 'System'}</span>
                <span className="agent-event-type">{evt.event_type || evt.type || evt.message || 'event'}</span>
                <span className={`severity-badge ${evt.severity || 'info'}`}>{evt.severity || 'info'}</span>
              </div>
            ))
          ) : (
            <div className="agent-empty-state" style={{ padding: '1.5rem' }}>
              <p>No events recorded yet</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="app-container">
      {/* ════════ NOTIFICATION TOASTS ════════ */}
      <NotificationToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* ════════ DISTRESS SIGNAL MODAL ════════ */}
      {distressModal && (
        <div className="distress-overlay" onClick={() => { if (!distressLoading) { clearInterval(distressCountdownRef.current); setDistressModal(false); setDistressCountdown(5); setDistressReport(null); }}}>
          <div className="distress-modal" onClick={e => e.stopPropagation()}>
            {!distressReport ? (
              <>
                <div className="distress-modal-header">
                  <span style={{fontSize:'2rem'}}>🆘</span>
                  <div>
                    <div style={{fontSize:'1.1rem', fontWeight:'800', color:'#fca5a5', letterSpacing:'1px'}}>DISTRESS SIGNAL</div>
                    <div style={{fontSize:'0.78rem', color:'var(--text-muted)'}}>Broadcasting to all emergency contacts</div>
                  </div>
                </div>

                <div className="distress-contacts-preview">
                  <div style={{fontSize:'0.75rem', fontWeight:'700', color:'var(--text-muted)', marginBottom:'0.5rem', letterSpacing:'1px', textTransform:'uppercase'}}>Will Notify:</div>
                  {team.filter(m => m.phone || m.email).length === 0 ? (
                    <div style={{color:'var(--warning)', fontSize:'0.82rem'}}>⚠️ No phone/email contacts in roster. Add team members first.</div>
                  ) : team.filter(m => m.phone || m.email).map(m => (
                    <div key={m.id} className="distress-contact-item">
                      <span style={{fontWeight:'700', color:'var(--text-main)'}}>{m.name}</span>
                      <span style={{color:'var(--text-muted)', fontSize:'0.75rem'}}>{m.phone && `📱 ${m.phone}`} {m.email && `📧 ${m.email}`}</span>
                    </div>
                  ))}
                </div>

                <div className="distress-location">
                  <span style={{fontSize:'0.75rem', color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:'1px'}}>Location:</span>
                  <span style={{color:'var(--primary)', fontWeight:'700', fontSize:'0.85rem'}}>
                    {userLocation ? `📍 ${userRegionDisplay || 'GPS Located'} (${userLocation.lat.toFixed(4)}, ${userLocation.lng.toFixed(4)})` : '⚠️ No GPS — enable location tracking for precise coordinates'}
                  </span>
                </div>

                <textarea
                  className="distress-message-input"
                  placeholder="Optional: Add a custom message (e.g. 'Trapped on 2nd floor, water rising')"
                  value={distressCustomMsg}
                  onChange={e => setDistressCustomMsg(e.target.value)}
                  rows={2}
                  maxLength={120}
                />

                <div className="distress-countdown-bar">
                  <div style={{flex:1, background:'rgba(244,63,94,0.15)', borderRadius:'999px', height:'6px', overflow:'hidden'}}>
                    <div style={{height:'100%', background:'#f43f5e', borderRadius:'999px', width:`${(distressCountdown/5)*100}%`, transition:'width 1s linear'}} />
                  </div>
                  <span style={{fontSize:'0.9rem', fontWeight:'800', color:'#fca5a5', minWidth:'2rem', textAlign:'right'}}>{distressCountdown}s</span>
                </div>

                <div style={{display:'flex', gap:'0.75rem'}}>
                  <button className="distress-cancel-btn"
                    onClick={() => { clearInterval(distressCountdownRef.current); setDistressModal(false); setDistressCountdown(5); }}
                  >✕ Cancel</button>
                  <button className="distress-send-btn"
                    disabled={distressLoading || distressCountdown > 0}
                    onClick={async () => {
                      setDistressLoading(true)
                      try {
                        const res = await fetch(`${API_URL}/api/distress_signal`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            team,
                            user_lat: userLocation?.lat || null,
                            user_lng: userLocation?.lng || null,
                            location_name: userRegionDisplay || 'Unknown Location',
                            disaster_type: selectedDisasterType !== 'auto' ? selectedDisasterType : (recentAlert?.weather_disaster_type || 'emergency'),
                            custom_message: distressCustomMsg || null
                          })
                        })
                        const data = await res.json()
                        setDistressReport(data)
                        logEvent('🆘 Distress Signal Sent', 'Panic Button', ['Distress Broadcaster'], `SMS: ${data.sms_sent || 0} sent, Email: ${data.email_sent || 0} sent. Coords: ${data.coords}`, 'error')
                      } catch (err) {
                        setDistressReport({ status: 'error', error: err.message })
                      }
                      setDistressLoading(false)
                    }}
                  >
                    {distressLoading ? '📡 Sending...' : distressCountdown > 0 ? `⏳ Sending in ${distressCountdown}s` : '🆘 SEND NOW'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="distress-modal-header">
                  <span style={{fontSize:'2rem'}}>{distressReport.status === 'dispatched' ? '✅' : '❌'}</span>
                  <div>
                    <div style={{fontSize:'1.1rem', fontWeight:'800', color: distressReport.status === 'dispatched' ? '#4ade80' : '#fca5a5', letterSpacing:'1px'}}>
                      {distressReport.status === 'dispatched' ? 'SIGNAL DISPATCHED' : 'DISPATCH FAILED'}
                    </div>
                    <div style={{fontSize:'0.78rem', color:'var(--text-muted)'}}>{distressReport.timestamp}</div>
                  </div>
                </div>
                {distressReport.status === 'dispatched' && (
                  <div style={{display:'flex', flexDirection:'column', gap:'0.5rem'}}>
                    <div className="distress-report-row">
                      <span>📱 SMS Sent</span><span style={{color:'var(--primary)', fontWeight:'700'}}>{distressReport.sms_sent}/{distressReport.sms_results?.length || 0}</span>
                    </div>
                    <div className="distress-report-row">
                      <span>📧 Email Sent</span><span style={{color:'var(--info)', fontWeight:'700'}}>{distressReport.email_sent}/{distressReport.email_results?.length || 0}</span>
                    </div>
                    <div className="distress-report-row">
                      <span>📍 Coordinates</span><span style={{color:'var(--text-muted)', fontSize:'0.75rem', fontFamily:'monospace'}}>{distressReport.coords}</span>
                    </div>
                    <a href={distressReport.maps_url} target="_blank" rel="noreferrer" className="distress-maps-link">🗺️ Open in Google Maps ↗</a>
                    {distressReport.waze_url && <a href={distressReport.waze_url} target="_blank" rel="noreferrer" className="distress-maps-link" style={{background:'rgba(56,189,248,0.1)', borderColor:'rgba(56,189,248,0.3)', color:'var(--info)'}}>🚗 Open in Waze ↗</a>}
                  </div>
                )}
                {distressReport.error && <div style={{color:'#fca5a5', fontSize:'0.83rem'}}>Error: {distressReport.error}</div>}
                <div style={{display:'flex', gap:'0.75rem', marginTop:'0.5rem'}}>
                  <button className="distress-cancel-btn" style={{flex:1}} onClick={() => { setDistressModal(false); setDistressReport(null); setDistressCountdown(5); setDistressCustomMsg(''); }}>Close</button>
                  <a href="tel:999" className="distress-send-btn" style={{flex:1, textAlign:'center', textDecoration:'none', display:'flex', alignItems:'center', justifyContent:'center', gap:'0.4rem'}}>📞 Call 999</a>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ════════ FLOATING PANIC BUTTON ════════ */}
      <button
        className="distress-fab"
        title="Send Distress Signal to all emergency contacts"
        onClick={() => {
          setDistressReport(null)
          setDistressCountdown(5)
          setDistressModal(true)
          distressCountdownRef.current = setInterval(() => {
            setDistressCountdown(prev => {
              if (prev <= 1) { clearInterval(distressCountdownRef.current); return 0; }
              return prev - 1
            })
          }, 1000)
        }}
      >🆘</button>

      {/* ════════ SCANNER MODALS ════════ */}
      {showIDScanner && (
        <IDScanner
          onResult={handleIDScanResult}
          onClose={() => setShowIDScanner(false)}
        />
      )}
      {showAssetScanner && (
        <AssetScanner
          onResult={handleAssetScanResult}
          onClose={() => setShowAssetScanner(false)}
        />
      )}

      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpen={isSidebarOpen}
        onToggle={() => setSidebarOpen(!isSidebarOpen)}
      />

      <main className="main-content">
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'inventory' && renderInventory()}
        {activeTab === 'team' && renderTeam()}
        {activeTab === 'activity' && renderActivity()}
        {activeTab === 'agents' && renderAgents()}
        {activeTab === 'briefing' && <BriefingViewer />}
        {activeTab === 'threatmap' && renderThreatMap()}
        {activeTab === 'survival' && renderSurvivalGuide()}
        {activeTab === 'settings' && renderSettings()}
        {activeTab === 'admin' && isAdmin && <AdminDashboard />}
      </main>

      {/* ════════ AI CHATBOT WIDGET (Global) ════════ */}
      <ChatbotWidget
        inventory={inventory}
        team={team}
        threatStatus={recentAlert?.threat_level || liveWeather?.status || 'clear'}
        readinessScore={inventoryAnalysis?.readiness_score}
        liveWeather={liveWeather}
        metWarnings={recentAlert?.met_warnings}
        pacePlan={pacePlan}
        recentAlert={recentAlert}
        locationName={recentAlert?.location || 'Malaysia'}
      />
    </div>
  )
}

export default App
