import { useState, useRef, useEffect } from 'react'
import { MessageCircle, X, Send, Bot, User, Loader2, AlertTriangle, Shield } from 'lucide-react'
import { api } from '../../lib/api'

/**
 * ChatbotWidget — Situationally-aware AI assistant for disaster preparedness.
 * Adapts suggestions and behavior based on current threat level, weather, and inventory.
 */
export default function ChatbotWidget({
  inventory,
  team,
  threatStatus,
  readinessScore,
  liveWeather,
  metWarnings,
  pacePlan,
  recentAlert,
  locationName,
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

  // Generate welcome message based on current situation
  useEffect(() => {
    const threat = (threatStatus || '').toLowerCase()
    let welcomeMsg = ''
    let welcomeSuggestions = []

    if (threat.includes('red') || threat.includes('danger') || threat.includes('severe')) {
      welcomeMsg = '🚨 ACTIVE THREAT DETECTED. I\'m monitoring the situation. How can I help you stay safe?'
      welcomeSuggestions = [
        'What should I do right now?',
        'Show evacuation routes',
        'Send SOS to my contacts',
      ]
    } else if (threat.includes('elevated') || threat.includes('warning')) {
      welcomeMsg = '⚠️ Weather advisory active in your area. I\'m here to help you prepare. What do you need?'
      welcomeSuggestions = [
        'What should I prepare?',
        'Check my supply readiness',
        'Show nearby shelters',
      ]
    } else {
      welcomeMsg = 'Hello! I\'m your MyResilience AI assistant. 🛡️ I can help with inventory, weather updates, evacuation plans, and disaster preparedness.'
      welcomeSuggestions = [
        'How prepared am I?',
        'What\'s the weather situation?',
        'How do I use voice commands?',
      ]
    }

    setMessages([{
      role: 'assistant',
      content: welcomeMsg,
      suggestions: welcomeSuggestions,
    }])
  }, [threatStatus])

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Focus input when opened
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }, [isOpen])

  // Build rich context from all available app state
  const buildContext = () => {
    const ctx = {}

    if (inventory?.length) {
      ctx.inventory = inventory.map(item => ({
        name: item.name,
        current_amount: item.current_amount,
        target_amount: item.target_amount,
        category: item.category,
        unit: item.unit,
        expiry_date: item.expiry_date,
      }))
    }

    if (team?.length) {
      ctx.team = team.map(m => ({
        name: m.name,
        role: m.role,
        age: m.age,
        email: m.email,
        phone: m.phone,
      }))
    }

    if (threatStatus) ctx.threat_status = threatStatus
    if (readinessScore != null) ctx.readiness_score = readinessScore
    if (locationName) ctx.location = locationName

    // Live weather data
    if (liveWeather) {
      ctx.weather = {
        location: liveWeather.location || locationName || 'Malaysia',
        condition: liveWeather.forecast || liveWeather.condition || '',
        temperature: liveWeather.max_temp ? `${liveWeather.max_temp}°C max / ${liveWeather.min_temp}°C min` : '',
      }
    }

    // MET warnings
    if (metWarnings?.length) {
      ctx.met_warnings = metWarnings.map(w => ({
        heading: w.heading || w.title || 'Active warning',
        valid: w.valid_from || '',
      }))
    }

    // PACE plan
    if (pacePlan) {
      ctx.pace = {
        primary: pacePlan.primary || '',
        alternate: pacePlan.alternate || '',
        contingency: pacePlan.contingency || '',
        emergency: pacePlan.emergency || '',
      }
    }

    // Recent alert context
    if (recentAlert) {
      ctx.threat_status = recentAlert.threat_level || threatStatus || 'nominal'
    }

    return ctx
  }

  const sendMessage = async (text) => {
    if (!text.trim() || loading) return

    const userMessage = { role: 'user', content: text.trim() }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      // Build conversation history for API
      const history = messages
        .filter(m => m.role === 'user' || m.role === 'assistant')
        .map(m => ({ role: m.role, content: m.content }))
        .slice(-10)

      const context = buildContext()

      const data = await api.post('/api/chatbot/message', {
        message: text.trim(),
        history,
        context,
      })

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: data.reply,
          suggestions: data.suggestions || [],
          intent: data.intent,
        },
      ])
    } catch (err) {
      const errorMsg = err.message?.includes('401') || err.message?.includes('Authentication')
        ? 'I\'m available without sign-in for general guidance. For personalized inventory analysis, please sign in first.'
        : err.message?.includes('429')
        ? 'I\'m getting a lot of requests right now. Please try again in a moment. 🙏'
        : 'Sorry, I encountered an error. Please try again.'

      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: errorMsg,
          suggestions: ['What can you help me with?', 'Show me the Survival Guide'],
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    sendMessage(input)
  }

  const handleSuggestionClick = (suggestion) => {
    sendMessage(suggestion)
  }

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  // Determine button urgency indicator
  const threat = (threatStatus || '').toLowerCase()
  const isUrgent = threat.includes('red') || threat.includes('danger') || threat.includes('severe')
  const isWarning = threat.includes('elevated') || threat.includes('warning')

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        className={`chatbot-toggle ${isUrgent ? 'chatbot-toggle-urgent' : isWarning ? 'chatbot-toggle-warning' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={isOpen ? 'Close chat' : 'Open AI assistant'}
        aria-label={isOpen ? 'Close chat' : 'Open AI assistant'}
      >
        {isOpen ? <X size={24} /> : <MessageCircle size={24} />}
        {(isUrgent || isWarning) && !isOpen && (
          <span className="chatbot-toggle-badge" />
        )}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="chatbot-window">
          {/* Header */}
          <div className={`chatbot-header ${isUrgent ? 'chatbot-header-urgent' : isWarning ? 'chatbot-header-warning' : ''}`}>
            <div className="chatbot-header-info">
              {isUrgent ? <AlertTriangle size={20} /> : <Bot size={20} />}
              <span>MyResilience AI</span>
              <span className={`chatbot-status-dot ${isUrgent ? 'urgent' : isWarning ? 'warning' : ''}`} />
            </div>
            <button className="chatbot-close" onClick={() => setIsOpen(false)}>
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div className="chatbot-messages">
            {messages.map((msg, i) => (
              <div key={i} className={`chatbot-message ${msg.role}`}>
                <div className="chatbot-avatar">
                  {msg.role === 'assistant' ? <Bot size={16} /> : <User size={16} />}
                </div>
                <div className="chatbot-bubble">
                  <p>{msg.content}</p>
                  {/* Quick-action suggestions */}
                  {msg.suggestions?.length > 0 && (
                    <div className="chatbot-suggestions">
                      {msg.suggestions.map((s, j) => (
                        <button
                          key={j}
                          className="chatbot-suggestion-btn"
                          onClick={() => handleSuggestionClick(s)}
                          disabled={loading}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Typing indicator */}
            {loading && (
              <div className="chatbot-message assistant">
                <div className="chatbot-avatar">
                  <Bot size={16} />
                </div>
                <div className="chatbot-bubble chatbot-typing">
                  <Loader2 className="chatbot-spinner" size={16} />
                  <span>Analyzing situation...</span>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <form className="chatbot-input" onSubmit={handleSubmit}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isUrgent ? 'Ask about safety actions...' : 'Ask me anything...'}
              disabled={loading}
              maxLength={2000}
            />
            <button type="submit" disabled={loading || !input.trim()}>
              <Send size={18} />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
