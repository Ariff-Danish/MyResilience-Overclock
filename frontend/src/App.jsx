import { useState, useEffect, useRef } from 'react'
import { Activity, ShieldAlert, PackageSearch, Users, Radar, AlertTriangle, ShieldCheck, ChevronDown, ChevronRight, Filter, Menu, ChevronLeft, Map, Phone, Copy, Navigation, FileDown, ChevronUp } from 'lucide-react'
import { Radar as RechartsRadar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip } from 'recharts'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:8000' : 'https://myresilience-overclock-api.vercel.app');

// Haversine great-circle distance (km)
const haversineKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [demoMode, setDemoMode] = useState(false)
  const [isSidebarOpen, setSidebarOpen] = useState(true)

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

  // Persist to localStorage
  useEffect(() => { localStorage.setItem('myresilience_inventory', JSON.stringify(inventory)) }, [inventory])
  useEffect(() => { localStorage.setItem('myresilience_team', JSON.stringify(team)) }, [team])

  // Sorting State
  const [sortBy, setSortBy] = useState('category') // category, stock, expiry

  // AI Results
  const [inventoryAnalysis, setInventoryAnalysis] = useState(null)
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
  const [userLocation, setUserLocation] = useState(null)
  const [locationLoading, setLocationLoading] = useState(false)
  const [locationError, setLocationError] = useState(null)
  // Distant alerts (threats in other regions, not affecting user)
  const [distantAlerts, setDistantAlerts] = useState([])
  const [userRegionDisplay, setUserRegionDisplay] = useState(null)
  // Live clock
  const [liveTime, setLiveTime] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setLiveTime(new Date()), 1000); return () => clearInterval(t) }, [])
  
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
  const initialRender = useRef(true)
  useEffect(() => {
    if (initialRender.current) {
      initialRender.current = false
      return
    }
    const timer = setTimeout(() => {
      runAutoAnalysis()
    }, 1500)
    return () => clearTimeout(timer)
  }, [inventory, team])

  const runAutoAnalysis = async () => {
    // Single Groq call: analyze_inventory returns both inventory audit AND pace plan
    // This eliminates the duplicate token burn from calling generate_pace separately
    const location = userRegionDisplay || 'Malaysia'
    try {
      const invRes = await fetch(`${API_BASE_URL}/api/analyze_inventory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory, team, location })
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
    } catch (err) {
      logEvent('Agent Unreachable', 'Auto Analysis Trigger', ['System'], `Could not connect to backend: ${err.message}. Check that the server is running on port 8000.`, 'error')
    }
  }

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
      const res = await fetch(`${API_BASE_URL}/api/evacuation_advisory`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          disaster_type: disasterType,
          severity: severity,
          location: userRegionDisplay || 'Malaysia',
          team: team,
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

  // --- LIVE POLLING & DEMO MODE ---
  useEffect(() => {
    const pollWeather = async (isDaily = false) => {
      try {
        const locParams = userLocation
          ? `&user_lat=${userLocation.lat}&user_lng=${userLocation.lng}`
          : ''
        const res = await fetch(`${API_BASE_URL}/api/weather/live?demo=${demoMode}${locParams}`)
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
        inventory, team,
        location: userRegionDisplay || 'Kuala Lumpur, Malaysia',
        ...(userLocation ? { user_lat: userLocation.lat, user_lng: userLocation.lng } : {})
      }
      const res = await fetch(`${API_BASE_URL}/api/evaluate_risk?demo=${demoMode}`, {
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

  // --- FORMS ---
  const categories = ['Water', 'Food', 'Medical', 'Security', 'Shelter', 'Communication', 'Power', 'Tools', 'Hygiene', 'Transport', 'Documents', 'Misc']
  const [newItem, setNewItem] = useState({ name: '', category: 'Water', unit: 'Units', current_amount: 0, target_amount: 0, expiry_date: '' })
  
  const addInventoryItem = () => {
    if (!newItem.name) return
    setInventory([{ ...newItem, id: Date.now().toString() }, ...inventory])
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
    setEditingId(null)
    setEditItemData(null)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditItemData(null)
  }

  const [newMember, setNewMember] = useState({ name: '', age: 0, role: 'family', email: '', phone: '', remarks: '' })
  const addTeamMember = () => {
    if (!newMember.name) return
    setTeam([...team, { ...newMember, id: Date.now().toString() }])
    setNewMember({ name: '', age: 0, role: 'family', email: '', phone: '', remarks: '' })
  }

  // --- SORTING HELPERS ---
  const getSortedInventory = () => {
    const arr = [...inventory];
    if (sortBy === 'category') {
      return arr.sort((a, b) => a.category.localeCompare(b.category))
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
        <div style={{display:'flex', alignItems:'center', gap:'1rem'}}>
          <h2>⚡ COMMAND DASHBOARD</h2>
          <span className="header-status-badge">
            {liveWeather?.alerts?.length > 0 ? '🔴 THREAT ACTIVE' : '🟢 NOMINAL'}
          </span>
        </div>
        <div style={{display:'flex', alignItems:'center', gap:'1.25rem', flexWrap:'wrap'}}>
          {userRegionDisplay && (
            <span className="header-location-pill">📍 {userRegionDisplay.split(',')[0]}</span>
          )}
          <span className="header-clock tech-font">
            {liveTime.toLocaleTimeString('en-MY', {hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false})} MYT
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

      <div className="dashboard-grid">
        <div className="panel radar-panel">
          <h3><Radar className="icon-sm" /> Asset Readiness</h3>
          {inventoryAnalysis ? (
            <ResponsiveContainer width="100%" height={250}>
              <RadarChart cx="50%" cy="50%" outerRadius="70%" data={getRadarData()}>
                <PolarGrid stroke="#334155" />
                <PolarAngleAxis dataKey="subject" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                <RechartsRadar name="Score" dataKey="A" stroke="#84cc16" fill="#84cc16" fillOpacity={0.3} />
              </RadarChart>
            </ResponsiveContainer>
          ) : (
             <div className="panel-loading" style={{flexDirection: 'column', alignItems: 'flex-start', padding: '1rem 0'}}>
               <div className="skeleton skeleton-text title"></div>
               <div className="skeleton skeleton-text"></div>
               <div className="skeleton skeleton-text"></div>
               <div className="skeleton skeleton-text short"></div>
             </div>
          )}
        </div>

        <div className="panel alert-panel">
          <h3>
            <div style={{display:'flex', alignItems:'center', gap:'0.5rem'}}>
              <AlertTriangle className="icon-sm text-yellow" /> Active Intel
            </div>
            <span className="text-muted" style={{fontSize:'0.8rem', fontWeight:'normal'}}>
              {userRegionDisplay || liveWeather?.location || 'Detecting location...'}
            </span>
          </h3>

          {/* Nearby threat alert */}
          {liveWeather && liveWeather.alerts.length > 0 ? (
            <div className="alert-box critical">
              <h4>🚨 {liveWeather.alerts[0].type.toUpperCase()}</h4>
              <p>{liveWeather.alerts[0].description}</p>
              {liveWeather.alerts[0].proximity_km != null && (
                <span className="proximity-tag nearby">⚠️ {liveWeather.alerts[0].proximity_km} km from you</span>
              )}
            </div>
          ) : (
            <div className="alert-box safe">
              <ShieldCheck className="icon-lg text-green" />
              <h4>Your Area is Safe</h4>
              <p>
                {userLocation
                  ? `No active threats detected within 150 km of your location.`
                  : 'Enable location for personalised threat detection.'}
              </p>
            </div>
          )}

          {/* Distant alerts notice */}
          {distantAlerts.length > 0 && (
            <div className="distant-alerts-notice">
              <span className="distant-label">🌐 Warnings in other regions ({distantAlerts.length})</span>
              {distantAlerts.slice(0, 2).map((a, i) => (
                <div key={i} className="distant-alert-item">
                  <span className="distant-alert-type">{a.type.replace('OFFICIAL WARNING: ', '').replace('Forecast: ', '')}</span>
                  {a.proximity_km && <span className="proximity-tag distant">{a.proximity_km} km away</span>}
                </div>
              ))}
              {distantAlerts.length > 2 && (
                <span className="text-muted" style={{fontSize:'0.75rem'}}>+{distantAlerts.length - 2} more — not affecting your area</span>
              )}
            </div>
          )}

          {recentAlert && (
            <div className="recent-alert-actions mt-4">
              <h4>Agent Protocol: {recentAlert.action_taken.toUpperCase()}</h4>
              {recentAlert.user_location && (
                <p className="text-muted" style={{fontSize:'0.8rem'}}>📍 Assessed for: {recentAlert.user_location}</p>
              )}
              {recentAlert.action_taken === 'email_sent' && (
                <div className="email-preview">
                  <p><strong>Comms sent to:</strong> {recentAlert.contacts_notified.join(', ')}</p>
                  <pre>{recentAlert.message_drafted}</pre>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="panel weather-intel-panel">
          <h3 style={{justifyContent:'space-between', flexWrap:'wrap', gap:'0.5rem'}}>
            <span style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>🌤️ Weather Intel</span>
            {weatherSyncTime && <span className="text-muted tech-font" style={{fontSize:'0.7rem',fontWeight:'normal'}}>MET Malaysia · synced {weatherSyncTime}</span>}
          </h3>
          {liveWeather ? (
            <div className="weather-body">
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
                  {[['PAGI', 'morning'], ['PETANG', 'afternoon'], ['MALAM', 'night']].map(([label, key]) =>
                    liveWeather.current_conditions[key] ? (
                      <div key={label} className="forecast-segment">
                        <span className="forecast-label">{label}</span>
                        <span className="forecast-icon">{translateWeather(liveWeather.current_conditions[key]).icon}</span>
                        <span className="forecast-desc">{translateWeather(liveWeather.current_conditions[key]).en}</span>
                        <span className="forecast-bm text-muted">{liveWeather.current_conditions[key]}</span>
                      </div>
                    ) : null
                  )}
                </div>
              )}

              <div className="weather-footer">
                {liveWeather.official_warnings_count > 0
                  ? <span className="weather-warning-badge">⚠️ {liveWeather.official_warnings_count} official MET warning(s) active</span>
                  : <span className="weather-clear-badge">✅ No official MET warnings for this region</span>
                }
                <a href="https://www.met.gov.my" target="_blank" rel="noopener noreferrer" className="met-link">MET Malaysia ↗</a>
              </div>
            </div>
          ) : (
            <div className="panel-loading" style={{flexDirection:'column',alignItems:'flex-start',padding:'1rem 0'}}>
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
                <span className="text-muted" style={{fontSize:'0.9rem'}}>/&nbsp;100</span>
                {inventoryAnalysis.survival_days != null && (
                  <span className="survival-days-pill" title="Estimated days of supply remaining">
                    🕒 {inventoryAnalysis.survival_days} day{inventoryAnalysis.survival_days !== 1 ? 's' : ''} supply
                  </span>
                )}
              </div>
              <p className="text-muted" style={{fontSize:'0.85rem'}}>{inventoryAnalysis.summary}</p>
              {inventoryAnalysis.critical_gaps.length > 0 && (
                <div className="gaps-row">
                  <span style={{fontSize:'0.75rem', fontWeight:'bold', color:'var(--warning)'}}>⚠ GAPS:</span>
                  {inventoryAnalysis.critical_gaps.map(g => <span key={g} className="gap-tag">{g}</span>)}
                </div>
              )}
              {inventoryAnalysis.low_stock_items?.length > 0 && (
                <div className="gaps-row" style={{marginTop:'0.4rem'}}>
                  <span style={{fontSize:'0.75rem', fontWeight:'bold', color:'var(--danger)'}}>📉 LOW STOCK:</span>
                  {inventoryAnalysis.low_stock_items.slice(0,4).map(item => (
                    <span key={item} className="gap-tag" style={{borderColor:'rgba(239,68,68,0.4)',color:'#f87171'}}>{item}</span>
                  ))}
                </div>
              )}
              {inventoryAnalysis.expiring_items?.length > 0 && (
                <div className="gaps-row" style={{marginTop:'0.4rem'}}>
                  <span style={{fontSize:'0.75rem', fontWeight:'bold', color:'var(--warning)'}}>⏳ EXPIRING:</span>
                  {inventoryAnalysis.expiring_items.slice(0,3).map(item => (
                    <span key={item} className="gap-tag" style={{borderColor:'rgba(234,179,8,0.4)',color:'#facc15'}}>{item}</span>
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
            <div className="panel-loading" style={{flexDirection:'column',alignItems:'flex-start',padding:'1rem 0'}}>
              <div className="skeleton skeleton-text title"></div>
              <div className="skeleton skeleton-text"></div>
              <div className="skeleton skeleton-text short"></div>
            </div>
          )}
        </div>

        {/* B2 — Readiness Score Trend */}
        {scoreHistory.length >= 2 && (
          <div className="panel score-trend-panel full-width">
            <h3>📈 Readiness Score Trend</h3>
            <ResponsiveContainer width="100%" height={120}>
              <LineChart data={scoreHistory} margin={{ top: 5, right: 20, left: -30, bottom: 0 }}>
                <XAxis dataKey="t" tick={{ fill: '#8b949e', fontSize: 10 }} />
                <YAxis domain={[0, 100]} tick={{ fill: '#8b949e', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ background: '#1c2128', border: '1px solid #30363d', borderRadius: '6px', fontSize: '0.8rem' }}
                  labelStyle={{ color: '#8b949e' }}
                  itemStyle={{ color: '#84cc16' }}
                />
                <Line type="monotone" dataKey="score" stroke="#84cc16" strokeWidth={2} dot={{ r: 3, fill: '#84cc16' }} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

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
             <div className="panel-loading" style={{flexDirection: 'column', alignItems: 'flex-start', padding: '1rem 0'}}>
               <div className="skeleton skeleton-text title"></div>
               <div className="skeleton skeleton-text"></div>
               <div className="skeleton skeleton-text short"></div>
               <div style={{marginTop: '1rem', width: '100%'}}>
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
      </div>
    </div>
  )

  const renderInventory = () => (
    <div className="tab-pane animate-fade-in">
      <h2>Asset Inventory</h2>
      
      <div className="panel form-panel mb-4">
        <div className="input-row">
          <input placeholder="Asset Name" value={newItem.name} onChange={e => setNewItem({...newItem, name: e.target.value})} />
          <select value={newItem.category} onChange={e => setNewItem({...newItem, category: e.target.value})}>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <input placeholder="Unit (e.g. Cans)" value={newItem.unit} onChange={e => setNewItem({...newItem, unit: e.target.value})} />
          <input type="number" placeholder="Current Qty" value={newItem.current_amount === 0 ? '' : newItem.current_amount} onChange={e => setNewItem({...newItem, current_amount: Number(e.target.value)})} />
          <input type="number" placeholder="Target Qty" value={newItem.target_amount === 0 ? '' : newItem.target_amount} onChange={e => setNewItem({...newItem, target_amount: Number(e.target.value)})} />
          <input type="date" value={newItem.expiry_date} onChange={e => setNewItem({...newItem, expiry_date: e.target.value})} />
          <button className="btn-primary" onClick={addInventoryItem}>Register</button>
        </div>
      </div>

      <div className="filter-row">
        <Filter className="icon-sm text-muted" />
        <span className="text-muted">Sort by:</span>
        <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="category">Category</option>
          <option value="stock">Stock Level (Lowest First)</option>
          <option value="expiry">Expiration Date (Soonest First)</option>
        </select>
      </div>

      <div className="inventory-grid">
        {getSortedInventory().map(item => {
          const ratio = item.target_amount ? item.current_amount / item.target_amount : 0;
          const isLow = ratio < 0.3;
          const isMedium = ratio >= 0.3 && ratio < 0.8;
          
          if (editingId === item.id) {
            return (
              <div key={item.id} className={`panel asset-card cat-${item.category.toLowerCase()}`}>
                <input style={{marginBottom: '0.5rem'}} value={editItemData.name} onChange={e => setEditItemData({...editItemData, name: e.target.value})} />
                <select style={{marginBottom: '0.5rem'}} value={editItemData.category} onChange={e => setEditItemData({...editItemData, category: e.target.value})}>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <input type="number" placeholder="Current" value={editItemData.current_amount} onChange={e => setEditItemData({...editItemData, current_amount: Number(e.target.value)})} />
                  <input type="number" placeholder="Target" value={editItemData.target_amount} onChange={e => setEditItemData({...editItemData, target_amount: Number(e.target.value)})} />
                  <input placeholder="Unit" value={editItemData.unit} onChange={e => setEditItemData({...editItemData, unit: e.target.value})} />
                </div>
                <input style={{marginBottom: '0.5rem'}} type="date" value={editItemData.expiry_date || ''} onChange={e => setEditItemData({...editItemData, expiry_date: e.target.value})} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn-primary" onClick={saveEdit}>Save</button>
                  <button className="btn-primary" style={{backgroundColor: 'var(--panel-border)', color: 'var(--text-main)'}} onClick={cancelEdit}>Cancel</button>
                </div>
              </div>
            )
          }

          return (
            <div key={item.id} className={`panel asset-card cat-${item.category.toLowerCase()}`}>
              <div className="asset-header">
                <h4>{item.name}</h4>
                <div style={{display:'flex', gap:'0.5rem'}}>
                  <button className="icon-btn" onClick={() => startEdit(item)} style={{fontSize:'0.9rem'}}>✏️</button>
                  <button className="icon-btn" onClick={() => setInventory(inventory.filter(i => i.id !== item.id))}>×</button>
                </div>
              </div>
              <div className="asset-cat-tag">{item.category}</div>
              <div className="progress-bg">
                <div className={`progress-fg ${isLow ? 'bg-red' : isMedium ? 'bg-yellow' : 'bg-green'}`} style={{ width: `${Math.min(100, ratio*100)}%` }}></div>
              </div>
              <div className="asset-footer">
                <span>{item.current_amount} / {item.target_amount} {item.unit}</span>
                {item.expiry_date && <span className="text-muted">Exp: {item.expiry_date}</span>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )

  const renderTeam = () => (
    <div className="tab-pane animate-fade-in">
      <h2>Personnel & Comms</h2>
      
      <div className="panel form-panel mb-4">
        <div className="input-row">
          <input placeholder="Name" value={newMember.name} onChange={e => setNewMember({...newMember, name: e.target.value})} />
          <input type="number" placeholder="Age" value={newMember.age || ''} onChange={e => setNewMember({...newMember, age: Number(e.target.value)})} />
          <select value={newMember.role} onChange={e => setNewMember({...newMember, role: e.target.value})}>
            <option value="family">Family (Household)</option>
            <option value="emergency_contact">Emergency Contact</option>
            <option value="useful_contact">Useful Contact</option>
          </select>
          <input type="email" placeholder="Email" value={newMember.email} onChange={e => setNewMember({...newMember, email: e.target.value})} />
          <input type="tel" placeholder="Phone" value={newMember.phone} onChange={e => setNewMember({...newMember, phone: e.target.value})} />
          <input placeholder="Remarks (e.g. asthma, wheelchair)" value={newMember.remarks} onChange={e => setNewMember({...newMember, remarks: e.target.value})} />
          <button className="btn-primary" onClick={addTeamMember}>Enlist</button>
        </div>
      </div>

      <div className="team-grid">
        {team.map(member => (
          <div key={member.id} className={`panel team-card role-${member.role}`}>
            <div className="team-header">
              <h4>{member.name} <span>({member.age})</span></h4>
              <button className="icon-btn" onClick={() => setTeam(team.filter(i => i.id !== member.id))}>×</button>
            </div>
            <div className="team-role-tag">{member.role.replace('_', ' ').toUpperCase()}</div>
            {member.email && <div className="team-contact text-muted">{member.email}</div>}
            {member.phone && <div className="team-contact text-muted">{member.phone}</div>}
            {member.remarks && <div className="team-contact text-yellow" style={{fontSize: '0.8rem', marginTop: '0.5rem'}}>⚠️ {member.remarks}</div>}
          </div>
        ))}
      </div>
    </div>
  )

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
    'police':  { capacity: 'N/A', contact: '999 (Emergency) / 112', authority: 'PDRM' },
    'fire':    { capacity: 'N/A', contact: '994 / 999', authority: 'Jabatan Bomba dan Penyelamat Malaysia' },
    'hospital':{ capacity: 'ICU + Emergency', contact: '999 / Hospital terdekat', authority: 'Kementerian Kesihatan Malaysia (KKM)' },
    'nadma':   { capacity: 'N/A', contact: '1800-88-2000 (NADMA)', authority: 'NADMA / JKM' },
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
                <div style={{display:'flex',alignItems:'center',gap:'0.5rem'}}>
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
  )}

  const renderThreatMap = () => (
    <div className="tab-pane animate-fade-in">
      <div className="dash-header">
        <h2>🗺️ Threat Map — Evacuation Advisory</h2>
        <div style={{display:'flex', gap:'0.75rem', flexWrap:'wrap', alignItems:'center'}}>
          {/* B4 — Disaster Type Selector */}
          <div className="disaster-selector">
            <label className="text-muted" style={{fontSize:'0.8rem', fontWeight:'600'}}>SCENARIO</label>
            <select
              value={selectedDisasterType}
              onChange={e => setSelectedDisasterType(e.target.value)}
              style={{minWidth:'140px'}}
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
          <button
            className={`btn-locate ${userLocation ? 'located' : ''}`}
            onClick={handleLocateMe}
            disabled={locationLoading}
          >
            {locationLoading ? '⟳ Locating...' : userLocation ? '📍 Located' : '📍 Locate Me'}
          </button>
        </div>
      </div>
      {locationError && (
        <div className="location-error-bar">⚠️ {locationError}</div>
      )}
      {userLocation && (
        <div className="location-info-bar">
          📍 Your position: <strong>{userLocation.lat.toFixed(5)}, {userLocation.lng.toFixed(5)}</strong>
          {evacAdvisory && (() => {
            const allLocs = [...(evacAdvisory.shelter_locations||[]), ...(evacAdvisory.enforcement_agencies||[])]
            let nearest = null, minDist = Infinity
            allLocs.forEach(loc => { const d = haversineKm(userLocation.lat, userLocation.lng, loc.lat, loc.lng); if (d < minDist) { minDist = d; nearest = loc } })
            return nearest ? <span className="nearest-summary"> · 🏆 Nearest: <strong>{nearest.name}</strong> ({minDist.toFixed(2)} km)</span> : null
          })()}
        </div>
      )}

      {!evacAdvisory && !evacLoading && (
        <>
          <div className="panel evac-empty-state">
            <div style={{fontSize:'4rem', marginBottom:'1rem'}}>🗺️</div>
            <h3>Evacuation Advisor Ready</h3>
            <p className="text-muted" style={{maxWidth:'500px', margin:'0 auto 0.75rem', lineHeight:'1.6'}}>
              Click <strong>Run Advisory</strong> to generate a real-time evacuation plan with shelter locations,
              enforcement agencies, safe routes, and avoidance zones —{' '}
              {userRegionDisplay
                ? <strong style={{color:'var(--info)'}}>tailored for {userRegionDisplay.split(',')[0]}</strong>
                : 'for your current location across all of Malaysia'}.
            </p>
            {!userRegionDisplay && (
              <p className="text-muted" style={{fontSize:'0.8rem', margin:'0 auto', maxWidth:'400px'}}>
                💡 Click <strong>Locate Me</strong> first for a location-specific advisory (Sabah, Sarawak, or any Malaysian state).
              </p>
            )}
          </div>

          {/* Official Malaysian Data Sources Panel */}
          <div className="panel gov-sources-panel">
            <h4 style={{marginTop:0, marginBottom:'1rem', color:'var(--info)', letterSpacing:'1px', fontSize:'0.85rem', textTransform:'uppercase'}}>
              🏛️ Official Malaysian Emergency Data Sources
            </h4>
            <div className="gov-sources-grid">
              {[
                { name:'NADMA Portal Bencana', desc:'Live disaster & evacuation centre status', url:'https://portalbencana.nadma.gov.my', badge:'LIVE', color:'var(--danger)' },
                { name:'JPS Water Level', desc:'Real-time river & flood gauge data', url:'https://water.jps.gov.my', badge:'LIVE', color:'var(--danger)' },
                { name:'data.gov.my', desc:'MET weather, warnings & open datasets', url:'https://api.data.gov.my', badge:'API', color:'var(--info)' },
                { name:'JKM Welfare', desc:'Welfare shelters & aid coordination', url:'https://www.jkm.gov.my', badge:'GOV', color:'var(--primary)' },
                { name:'DOSM / Banci', desc:'Census, population & demographic data', url:'https://www.dosm.gov.my', badge:'GOV', color:'var(--primary)' },
                { name:'KDN', desc:'Home Affairs — enforcement & security ops', url:'https://www.kdn.gov.my', badge:'GOV', color:'var(--primary)' },
                { name:'MySikap / JPJ', desc:'Road conditions & transport advisories', url:'https://www.jpj.gov.my', badge:'GOV', color:'var(--primary)' },
                { name:'Bomba Malaysia', desc:'Fire & rescue station locator', url:'https://www.bomba.gov.my', badge:'GOV', color:'var(--warning)' },
              ].map(s => (
                <a key={s.name} href={s.url} target="_blank" rel="noreferrer" className="gov-source-card">
                  <span className="gov-source-badge" style={{background:`${s.color}22`, color:s.color, borderColor:`${s.color}44`}}>{s.badge}</span>
                  <div className="gov-source-name">{s.name}</div>
                  <div className="gov-source-desc">{s.desc}</div>
                  <div className="gov-source-url">{s.url.replace('https://','')}</div>
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
            <div id="leaflet-threat-map" style={{width:'100%', height:'450px', borderRadius:'8px', overflow:'hidden'}}></div>
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
              <span className="text-muted" style={{fontSize:'0.75rem'}}>
                {evacAdvisory.sms_alert_text?.length}/160 characters
              </span>
              {evacAdvisory.sms_results?.length > 0 && (
                <div className="sms-results-row">
                  {evacAdvisory.sms_results.map((r, i) => (
                    <span key={i} className={`sms-status-badge sms-${r.status}`}>
                      {r.status === 'sent' ? '✅' : r.status === 'skipped' ? '⏭️' : '❌'} {r.phone || 'Contact'}: {r.status}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="panel">
              <h4>🛣️ Safe Routes</h4>
              {evacAdvisory.routes_to_take?.map((r, i) => (
                <div key={i} className="route-item">
                  <span className="route-num tech-font">{i + 1}</span>
                  <span style={{fontSize:'0.85rem'}}>{r}</span>
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
              <p className="text-muted" style={{fontSize:'0.85rem', lineHeight:'1.6'}}>{evacAdvisory.reasoning}</p>
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

  return (
    <div className="app-container">
      <aside className={`sidebar ${isSidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-logo">
          <ShieldAlert className="logo-icon" />
          {isSidebarOpen && <h1>MyResilience</h1>}
        </div>
        
        <nav className="sidebar-nav">
          <button className={activeTab === 'dashboard' ? 'active' : ''} onClick={() => setActiveTab('dashboard')}>
            <Radar className="nav-icon" /> {isSidebarOpen && 'Dashboard'}
          </button>
          <button className={activeTab === 'inventory' ? 'active' : ''} onClick={() => setActiveTab('inventory')}>
            <PackageSearch className="nav-icon" /> {isSidebarOpen && 'Inventory'}
          </button>
          <button className={activeTab === 'team' ? 'active' : ''} onClick={() => setActiveTab('team')}>
            <Users className="nav-icon" /> {isSidebarOpen && 'Personnel'}
          </button>
          <button className={activeTab === 'activity' ? 'active' : ''} onClick={() => setActiveTab('activity')}>
            <Activity className="nav-icon" /> {isSidebarOpen && 'Activity Network'}
          </button>
          <button className={activeTab === 'threatmap' ? 'active' : ''} onClick={() => setActiveTab('threatmap')}>
            <Map className="nav-icon" /> {isSidebarOpen && 'Threat Map'}
          </button>
        </nav>
        <button className="sidebar-toggle-btn" onClick={() => setSidebarOpen(!isSidebarOpen)} title={isSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>
          {isSidebarOpen ? <ChevronLeft className="nav-icon" /> : <Menu className="nav-icon" />}
        </button>
      </aside>

      <main className="main-content">
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'inventory' && renderInventory()}
        {activeTab === 'team' && renderTeam()}
        {activeTab === 'activity' && renderActivity()}
        {activeTab === 'threatmap' && renderThreatMap()}
      </main>
    </div>
  )
}

export default App
