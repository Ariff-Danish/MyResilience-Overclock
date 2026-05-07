import { useState, useRef, useCallback, useEffect } from 'react'
import { Mic, MicOff, Loader2, CheckCircle, XCircle, Volume2 } from 'lucide-react'
import { api } from '../../lib/api'

/**
 * VoiceCommand — Voice-controlled inventory management using Web Speech API.
 * Captures speech, sends to backend for intent parsing, and executes actions.
 */
export default function VoiceCommand({ inventory, onAddItem, onUpdateItem, onDeleteItem, onSearch }) {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [supported, setSupported] = useState(true)
  const recognitionRef = useRef(null)
  const timeoutRef = useRef(null)

  // Check browser support on mount
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setSupported(false)
    }
    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.abort()
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const startListening = useCallback(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SpeechRecognition) {
      setError('Speech recognition is not supported in this browser. Try Chrome or Edge.')
      return
    }

    setError(null)
    setResult(null)
    setTranscript('')

    const recognition = new SpeechRecognition()
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-MY' // English (Malaysia)
    recognition.maxAlternatives = 1

    recognition.onstart = () => {
      setIsListening(true)
    }

    recognition.onresult = (event) => {
      let interimTranscript = ''
      let finalTranscript = ''

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          finalTranscript += t
        } else {
          interimTranscript += t
        }
      }

      setTranscript(finalTranscript || interimTranscript)

      if (finalTranscript) {
        // Auto-process after getting final result
        processCommand(finalTranscript)
      }
    }

    recognition.onerror = (event) => {
      setIsListening(false)
      if (event.error === 'no-speech') {
        setError('No speech detected. Please try again.')
      } else if (event.error === 'not-allowed') {
        setError('Microphone access denied. Please allow microphone permission.')
      } else {
        setError(`Speech error: ${event.error}`)
      }
    }

    recognition.onend = () => {
      setIsListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()

    // Auto-stop after 10 seconds of silence
    timeoutRef.current = setTimeout(() => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }, 15000)
  }, [])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop()
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setIsListening(false)
  }, [])

  const processCommand = async (text) => {
    setProcessing(true)
    setError(null)

    try {
      const data = await api.post('/api/voice/process', {
        transcript: text,
        current_inventory: inventory?.map(item => ({
          name: item.name,
          category: item.category,
          current_amount: item.current_amount,
        })) || [],
      })

      setResult(data)

      // Auto-execute the action based on parsed intent
      if (data.confidence >= 0.7) {
        executeAction(data)
      }
    } catch (err) {
      setError(err.message || 'Failed to process voice command')
    } finally {
      setProcessing(false)
    }
  }

  const executeAction = (action) => {
    switch (action.action) {
      case 'add':
        if (action.item_name && onAddItem) {
          onAddItem({
            name: action.item_name,
            category: action.category || 'other',
            current_amount: action.quantity || 1,
            target_amount: action.quantity || 1,
            unit: action.unit || 'pcs',
          })
        }
        break
      case 'update':
        if (action.item_name && onUpdateItem) {
          onUpdateItem(action.item_name, action.quantity)
        }
        break
      case 'delete':
        if (action.item_name && onDeleteItem) {
          onDeleteItem(action.item_name)
        }
        break
      case 'search':
        if (action.search_query && onSearch) {
          onSearch(action.search_query)
        }
        break
      default:
        break
    }
  }

  const handleConfirm = () => {
    if (result) {
      executeAction(result)
    }
  }

  if (!supported) {
    return (
      <div className="voice-command-unsupported">
        <MicOff size={20} />
        <span>Voice commands not supported in this browser</span>
      </div>
    )
  }

  return (
    <div className="voice-command">
      {/* Microphone Button */}
      <button
        className={`voice-mic-btn ${isListening ? 'listening' : ''} ${processing ? 'processing' : ''}`}
        onClick={isListening ? stopListening : startListening}
        disabled={processing}
        title={isListening ? 'Stop listening' : 'Start voice command'}
      >
        {processing ? (
          <Loader2 className="voice-spinner" size={24} />
        ) : isListening ? (
          <MicOff size={24} />
        ) : (
          <Mic size={24} />
        )}
      </button>

      {/* Status */}
      <div className="voice-status">
        {isListening && (
          <div className="voice-listening">
            <div className="voice-wave">
              <span /><span /><span /><span /><span />
            </div>
            <p>Listening... Speak your command</p>
          </div>
        )}

        {transcript && (
          <div className="voice-transcript">
            <Volume2 size={16} />
            <p>"{transcript}"</p>
          </div>
        )}

        {processing && (
          <div className="voice-processing">
            <Loader2 className="voice-spinner" size={16} />
            <p>Processing command...</p>
          </div>
        )}

        {result && !processing && (
          <div className={`voice-result ${result.confidence >= 0.7 ? 'success' : 'low-confidence'}`}>
            {result.confidence >= 0.7 ? (
              <CheckCircle size={16} />
            ) : (
              <XCircle size={16} />
            )}
            <div className="voice-result-info">
              <p>{result.message}</p>
              <span className="voice-confidence">
                {Math.round(result.confidence * 100)}% confidence
              </span>
            </div>
            {result.confidence < 0.7 && result.confidence >= 0.3 && (
              <button className="voice-confirm-btn" onClick={handleConfirm}>
                Execute Anyway
              </button>
            )}
          </div>
        )}

        {error && (
          <div className="voice-error">
            <XCircle size={16} />
            <p>{error}</p>
          </div>
        )}
      </div>

      {/* Quick Command Hints */}
      {!isListening && !transcript && !result && (
        <div className="voice-hints">
          <p className="voice-hints-title">Try saying:</p>
          <div className="voice-hints-list">
            <span onClick={() => processCommand('add 5 bottles of water')}>"Add 5 bottles of water"</span>
            <span onClick={() => processCommand('search for medical supplies')}>"Search for medical supplies"</span>
            <span onClick={() => processCommand('how much food do I have')}>"How much food do I have?"</span>
          </div>
        </div>
      )}
    </div>
  )
}
