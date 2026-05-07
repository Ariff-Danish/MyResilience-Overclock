import { useState, useRef, useEffect } from 'react'
import { MessageCircle, X, Send, Bot, User, Loader2 } from 'lucide-react'
import { api } from '../../lib/api'

/**
 * ChatbotWidget — Floating AI chatbot for inventory queries and app navigation.
 * Supports multi-turn conversation with context-aware responses.
 */
export default function ChatbotWidget({ inventory, threatStatus, readinessScore }) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hello! I\'m your MyResilience AI assistant. 🛡️ How can I help you today? You can ask about your inventory, navigation, or disaster preparedness.',
      suggestions: [
        'How do I add inventory items?',
        'What supplies should I prepare?',
        'How does voice command work?',
      ],
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)
  const inputRef = useRef(null)

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

      // Build context from current app state
      const context = {}
      if (inventory?.length) {
        context.inventory = inventory.map(item => ({
          name: item.name,
          current_amount: item.current_amount,
          target_amount: item.target_amount,
          category: item.category,
        }))
      }
      if (threatStatus) context.threat_status = threatStatus
      if (readinessScore != null) context.readiness_score = readinessScore

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
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Sorry, I encountered an error. Please try again.',
          suggestions: [],
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

  return (
    <>
      {/* Floating Toggle Button */}
      <button
        className="chatbot-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title={isOpen ? 'Close chat' : 'Open AI assistant'}
        aria-label={isOpen ? 'Close chat' : 'Open AI assistant'}
      >
        {isOpen ? <X size={24} /> : <MessageCircle size={24} />}
      </button>

      {/* Chat Window */}
      {isOpen && (
        <div className="chatbot-window">
          {/* Header */}
          <div className="chatbot-header">
            <div className="chatbot-header-info">
              <Bot size={20} />
              <span>MyResilience AI</span>
              <span className="chatbot-status-dot" />
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
                  <span>Thinking...</span>
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
              placeholder="Ask me anything..."
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
