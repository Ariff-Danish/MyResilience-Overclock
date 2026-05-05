import { useState, useEffect, useRef } from 'react'
import { Activity, ShieldAlert, PackageSearch, Users, Radar, Settings, AlertTriangle, ShieldCheck, ChevronDown, ChevronRight, Filter } from 'lucide-react'
import { Radar as RechartsRadar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from 'recharts'
import './App.css'

function App() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [demoMode, setDemoMode] = useState(false)
  const [isSidebarOpen, setSidebarOpen] = useState(true)

  // Core State
  const [inventory, setInventory] = useState([
    { id: '1', name: 'Bottled Water', category: 'Water', unit: 'Liters', current_amount: 10, target_amount: 30, expiry_date: '2027-01-01' },
    { id: '2', name: 'Canned Beans', category: 'Food', unit: 'Cans', current_amount: 5, target_amount: 20, expiry_date: '2026-05-01' },
    { id: '3', name: 'First Aid Kit', category: 'Medical', unit: 'Kits', current_amount: 1, target_amount: 1, expiry_date: '2028-01-01' },
    { id: '4', name: 'Power Bank', category: 'Power', unit: 'Units', current_amount: 1, target_amount: 3, expiry_date: '' },
  ])

  const [team, setTeam] = useState([
    { id: '1', name: 'John Doe', age: 35, role: 'family', email: '', phone: '' },
    { id: '2', name: 'Jane Doe', age: 32, role: 'family', email: '', phone: '' }
  ])

  // Sorting State
  const [sortBy, setSortBy] = useState('category') // category, stock, expiry

  // AI Results
  const [inventoryAnalysis, setInventoryAnalysis] = useState(null)
  const [pacePlan, setPacePlan] = useState(null)
  const [recentAlert, setRecentAlert] = useState(null)
  const [liveWeather, setLiveWeather] = useState(null)
  const [lastAlertHash, setLastAlertHash] = useState('') // For change detection
  
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
    try {
      const [invRes, paceRes] = await Promise.all([
        fetch('http://localhost:8000/api/analyze_inventory', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inventory, team })
        }),
        fetch('http://localhost:8000/api/generate_pace', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ inventory, team, location: 'Kuala Lumpur, Malaysia' })
        })
      ])
      
      let invData = null;
      let paceData = null;
      let reasonString = '';

      if (invRes.ok) {
        const payload = await invRes.json()
        invData = payload.analysis
        setInventoryAnalysis(invData)
        reasonString += `[Assessor Agent] ${invData.reasoning}\n\n`
        if (payload.coordinator_message) {
          reasonString += `[Coordinator Agent] PREPAREDNESS PROTOCOL:\n${payload.coordinator_message}\n\n`
        }
      } else {
        const errBody = await invRes.json().catch(() => ({}))
        reasonString += `[Assessor Agent] Analysis degraded — ${errBody.detail || `HTTP ${invRes.status}`}. Displaying last known state.\n\n`
      }

      if (paceRes.ok) {
        paceData = await paceRes.json()
        setPacePlan(paceData)
        reasonString += `[P.A.C.E Strategist] ${paceData.reasoning}`
      } else {
        const errBody = await paceRes.json().catch(() => ({}))
        reasonString += `[P.A.C.E Strategist] Plan generation degraded — ${errBody.detail || `HTTP ${paceRes.status}`}. Previous plan retained.`
        // Set a degraded fallback plan if none exists
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
        invRes.ok && paceRes.ok ? 'success' : 'warning'
      )
    } catch (err) {
      logEvent('Agent Unreachable', 'Auto Analysis Trigger', ['System'], `Could not connect to backend: ${err.message}. Check that the server is running on port 8000.`, 'error')
    }
  }

  // --- LIVE POLLING & DEMO MODE ---
  useEffect(() => {
    const pollWeather = async (isDaily = false) => {
      try {
        const res = await fetch(`http://localhost:8000/api/weather/live?demo=${demoMode}`)
        if (res.ok) {
          const data = await res.json()
          setLiveWeather(data)
          
          const alertString = JSON.stringify(data.alerts)
          
          // Only trigger agents if alerts have changed OR if it's a manual demo toggle
          if (alertString !== lastAlertHash || demoMode) {
            setLastAlertHash(alertString)
            if (data.alerts && data.alerts.length > 0) {
              triggerLiveAlert(data.alerts[0].type, data.alerts[0].description)
            } else {
              logEvent('Weather Status Update', 'System Sync', ['Watcher'], 'Conditions nominal. No active warnings detected.', 'info')
            }
          } else if (isDaily) {
            logEvent('Daily Forecast Sync', 'Scheduled Task', ['Watcher'], 'Daily check completed. No new threats identified.', 'info')
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
  }, [demoMode, lastAlertHash, inventory, team])

  const triggerLiveAlert = async (alertType, desc) => {
    try {
      const res = await fetch(`http://localhost:8000/api/evaluate_risk?demo=${demoMode}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inventory, team, location: 'Kuala Lumpur, Malaysia' })
      })
      if (res.ok) {
        const data = await res.json()
        setRecentAlert(data)
        
        let reason = `Watcher identified ${alertType}: ${desc}. `
        reason += `Coordinator decided action: ${data.action_taken.toUpperCase()}. `
        if (data.action_taken === 'email_sent') {
           reason += `Coordinator dispatched emergency protocol to ${data.contacts_notified.length} contacts.`
        }
        
        logEvent('CRITICAL THREAT ESCALATION', 'External Trigger (MET Sync)', ['Watcher', 'Coordinator'], reason, 'error')
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

  const renderDashboard = () => (
    <div className="tab-pane animate-fade-in">
      <div className="dash-header">
        <h2>Command Dashboard</h2>
        <div className="demo-toggle">
          <label>Live Demo Mode</label>
          <label className="switch">
            <input type="checkbox" checked={demoMode} onChange={e => setDemoMode(e.target.checked)} />
            <span className="slider round"></span>
          </label>
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
             <div className="panel-loading">Awaiting data...</div>
          )}
        </div>

        <div className="panel alert-panel">
          <h3>
            <div style={{display:'flex', alignItems:'center', gap:'0.5rem'}}>
              <AlertTriangle className="icon-sm text-yellow" /> Active Intel
            </div>
            {liveWeather && <span className="text-muted" style={{fontSize:'0.8rem', fontWeight:'normal'}}>{liveWeather.location}</span>}
          </h3>
          {liveWeather && liveWeather.alerts.length > 0 ? (
            <div className="alert-box critical">
              <h4>🚨 {liveWeather.alerts[0].type.toUpperCase()}</h4>
              <p>{liveWeather.alerts[0].description}</p>
            </div>
          ) : (
            <div className="alert-box safe">
              <ShieldCheck className="icon-lg text-green" />
              <h4>No Active Threats</h4>
              <p>Daily MET Forecast: Regional sensors report nominal conditions.</p>
            </div>
          )}
          
          {recentAlert && (
            <div className="recent-alert-actions mt-4">
              <h4>Agent Protocol: {recentAlert.action_taken.toUpperCase()}</h4>
              {recentAlert.action_taken === 'email_sent' && (
                <div className="email-preview">
                  <p><strong>Comms sent to:</strong> {recentAlert.contacts_notified.join(', ')}</p>
                  <pre>{recentAlert.message_drafted}</pre>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="panel pace-panel full-width">
          <h3><ShieldAlert className="icon-sm" /> Autonomous P.A.C.E. Strategy</h3>
          {!pacePlan ? (
             <div className="panel-loading">Generating tactical doctrine...</div>
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
        </nav>
      </aside>

      <main className="main-content">
        {activeTab === 'dashboard' && renderDashboard()}
        {activeTab === 'inventory' && renderInventory()}
        {activeTab === 'team' && renderTeam()}
        {activeTab === 'activity' && renderActivity()}
      </main>
    </div>
  )
}

export default App
