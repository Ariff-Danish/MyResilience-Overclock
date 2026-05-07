import { useState } from 'react'
import CameraCapture from './CameraCapture'
import { authenticatedFetch } from '../../lib/api'

const API_URL = import.meta.env.VITE_API_URL || 'https://myresilience-overclock-api.vercel.app'

/**
 * IDScanner — Camera-based ID card scanner with OCR extraction.
 * Captures an ID card photo, sends to backend for Groq Vision OCR,
 * and displays extracted fields for user verification.
 */
export default function IDScanner({ onResult, onClose }) {
  const [showCamera, setShowCamera] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)

  const handleCapture = async (file) => {
    setShowCamera(false)
    setScanning(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('image', file)

      const res = await authenticatedFetch(`${API_URL}/api/scan/id`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setResult(data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  const handleConfirm = () => {
    if (result && onResult) {
      onResult(result)
    }
  }

  const handleRescan = () => {
    setResult(null)
    setError(null)
    setShowCamera(true)
  }

  return (
    <div className="scanner-container">
      {/* Camera */}
      {showCamera && (
        <CameraCapture
          title="Scan ID Card"
          onCapture={handleCapture}
          onClose={onClose}
        />
      )}

      {/* Scanning indicator */}
      {scanning && (
        <div className="scanner-processing">
          <div className="scanner-spinner" />
          <h3>🔍 Scanning ID Card...</h3>
          <p>Extracting text using AI vision analysis</p>
        </div>
      )}

      {/* Error */}
      {error && !showCamera && (
        <div className="scanner-error">
          <span style={{ fontSize: '2rem' }}>❌</span>
          <h3>Scan Failed</h3>
          <p>{error}</p>
          <div className="scanner-error-actions">
            <button className="scanner-btn secondary" onClick={handleRescan}>🔄 Try Again</button>
            <button className="scanner-btn secondary" onClick={onClose}>✕ Close</button>
          </div>
        </div>
      )}

      {/* Results */}
      {result && !scanning && (
        <div className="scanner-results">
          <div className="scanner-results-header">
            <h3>🪪 ID Scan Results</h3>
            {result.confidence != null && (
              <span className={`confidence-badge ${result.confidence > 0.7 ? 'high' : result.confidence > 0.4 ? 'medium' : 'low'}`}>
                {Math.round(result.confidence * 100)}% confidence
              </span>
            )}
          </div>

          <div className="scanner-fields">
            <ScanField label="Document Type" value={result.id_type} icon="📄" />
            <ScanField label="Full Name" value={result.full_name} icon="👤" />
            <ScanField label="ID Number" value={result.id_number} icon="🔢" />
            <ScanField label="Date of Birth" value={result.date_of_birth} icon="🎂" />
            <ScanField label="Gender" value={result.gender} icon="⚧" />
            <ScanField label="Nationality" value={result.nationality} icon="🌍" />
            <ScanField label="Address" value={result.address} icon="📍" />
            <ScanField label="Expiry Date" value={result.expiry_date} icon="📅" />
          </div>

          {result.raw_text && (
            <details className="scanner-raw-text">
              <summary>📝 Raw Extracted Text</summary>
              <pre>{result.raw_text}</pre>
            </details>
          )}

          <div className="scanner-actions">
            <button className="scanner-btn secondary" onClick={handleRescan}>🔄 Scan Again</button>
            <button className="scanner-btn primary" onClick={handleConfirm}>✅ Use This Data</button>
          </div>
        </div>
      )}
    </div>
  )
}

function ScanField({ label, value, icon }) {
  if (!value) return null
  return (
    <div className="scan-field">
      <span className="scan-field-icon">{icon}</span>
      <div className="scan-field-content">
        <span className="scan-field-label">{label}</span>
        <span className="scan-field-value">{value}</span>
      </div>
    </div>
  )
}
