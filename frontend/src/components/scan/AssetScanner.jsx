import { useState } from 'react'
import CameraCapture from './CameraCapture'
import { authenticatedFetch } from '../../lib/api'

const API_URL = import.meta.env.VITE_API_URL || ''

/**
 * AssetScanner — Camera-based inventory asset scanner with image recognition.
 * Captures an item photo, sends to backend for Groq Vision analysis,
 * and displays extracted asset fields for user verification.
 */
export default function AssetScanner({ onResult, onClose }) {
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

      const res = await authenticatedFetch(`${API_URL}/api/scan/asset`, {
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
          title="Scan Inventory Asset"
          onCapture={handleCapture}
          onClose={onClose}
        />
      )}

      {/* Scanning indicator */}
      {scanning && (
        <div className="scanner-processing">
          <div className="scanner-spinner" />
          <h3>🔍 Analyzing Asset...</h3>
          <p>Identifying item using AI image recognition</p>
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
            <h3>📦 Asset Scan Results</h3>
            {result.confidence != null && (
              <span className={`confidence-badge ${result.confidence > 0.7 ? 'high' : result.confidence > 0.4 ? 'medium' : 'low'}`}>
                {Math.round(result.confidence * 100)}% confidence
              </span>
            )}
          </div>

          <div className="scanner-fields">
            <ScanField label="Asset Name" value={result.asset_name} icon="📦" />
            <ScanField label="Type" value={result.asset_type} icon="🏷️" />
            <ScanField label="Category" value={result.category} icon="📁" />
            <ScanField label="Brand" value={result.brand} icon="🏭" />
            <ScanField label="Model" value={result.model} icon="📋" />
            <ScanField label="Serial Number" value={result.serial_number} icon="🔢" />
            <ScanField label="Color" value={result.color} icon="🎨" />
            <ScanField label="Condition" value={result.condition} icon="⭐" />
            <ScanField label="Est. Value" value={result.estimated_value ? `RM ${result.estimated_value}` : null} icon="💰" />
            <ScanField label="Expiry Date" value={result.expiry_date} icon="📅" />
            <ScanField label="Quantity" value={result.quantity?.toString()} icon="📊" />
            <ScanField label="Description" value={result.description} icon="📝" />
          </div>

          <div className="scanner-actions">
            <button className="scanner-btn secondary" onClick={handleRescan}>🔄 Scan Again</button>
            <button className="scanner-btn primary" onClick={handleConfirm}>✅ Add to Inventory</button>
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
