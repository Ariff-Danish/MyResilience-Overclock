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

  // Sync inventory/team to autonomous agent system (so Guardian can analyze)
  useEffect(() => {
    const syncToAgents = async () => {
      try {
        await fetch(`${API_URL}/api/agents/configure`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            inventory: inventory.map(i => ({ name: i.name, category: i.category, current_amount: i.current_amount, target_amount: i.target_amount, unit: i.unit, expiry_date: i.expiry_date })),
            team: team.map(m => ({ name: m.name, role: m.role, age: m.age })),
            location_name: userRegionDisplay || 'Petaling',
            demo: demoMode,
          }),
        })
      } catch { /* silent — best effort */ }
    }
    syncToAgents()
  }, [inventory, team, demoMode])

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
              {inventoryAnalysis.reasoning && (
                <details style={{ marginTop: '0.4rem', fontSize: '0.72rem', color: 'var(--muted)' }}>
                  <summary style={{ cursor: 'pointer', fontWeight: '600', color: 'var(--info)' }}>📐 Verification — Show AI Arithmetic</summary>
                  <p style={{ margin: '0.3rem 0 0', padding: '0.4rem 0.6rem', background: 'rgba(56,189,248,0.05)', borderRadius: '6px', lineHeight: '1.5' }}>
                    {inventoryAnalysis.reasoning}
                  </p>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.65rem', opacity: 0.7 }}>
                    Sources: Your inventory data ({inventory.length} items) · Household size ({team.filter(m => m.role === 'family').length || 1}) · Groq Llama-3.3 70B
                  </p>
                </details>
              )}
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
      </div>
    </div>
  )

  const renderInventory = () => {
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
