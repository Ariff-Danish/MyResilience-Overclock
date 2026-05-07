import { useState, useRef, useCallback } from 'react'
import CameraCapture from './CameraCapture'
import { authenticatedFetch } from '../../lib/api'

const API_URL = import.meta.env.VITE_API_URL || ''

/**
 * AssetScanner — Enhanced camera-based inventory asset scanner with image recognition.
 * Supports: camera capture, drag-and-drop upload, batch scanning.
 * Auto-maps AI-detected categories to valid inventory categories.
 */
export default function AssetScanner({ onResult, onClose }) {
  const [mode, setMode] = useState('choose') // choose | camera | upload | batch
  const [scanning, setScanning] = useState(false)
  const [results, setResults] = useState(null) // single or array
  const [error, setError] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [batchFiles, setBatchFiles] = useState([])
  const [batchPreviews, setBatchPreviews] = useState([])
  const fileInputRef = useRef(null)
  const batchInputRef = useRef(null)

  // ─── Single scan via camera ──────────────────────────────────────────────
  const handleCameraCapture = async (file) => {
    setMode('choose')
    await scanSingleFile(file)
  }

  // ─── Single scan via file upload ─────────────────────────────────────────
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    await scanSingleFile(file)
  }

  const scanSingleFile = async (file) => {
    setScanning(true)
    setError(null)
    setResults(null)

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
        setResults(data)
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  // ─── Batch scan ──────────────────────────────────────────────────────────
  const handleBatchAdd = (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    const newFiles = [...batchFiles, ...files].slice(0, 5)
    setBatchFiles(newFiles)
    // Generate previews
    const previews = newFiles.map(f => ({
      name: f.name,
      url: URL.createObjectURL(f),
      size: (f.size / 1024).toFixed(0) + ' KB',
    }))
    setBatchPreviews(previews)
  }

  const removeBatchFile = (idx) => {
    const newFiles = batchFiles.filter((_, i) => i !== idx)
    setBatchFiles(newFiles)
    if (batchPreviews[idx]?.url) URL.revokeObjectURL(batchPreviews[idx].url)
    setBatchPreviews(newFiles.map(f => ({
      name: f.name,
      url: URL.createObjectURL(f),
      size: (f.size / 1024).toFixed(0) + ' KB',
    })))
  }

  const handleBatchScan = async () => {
    if (batchFiles.length === 0) return
    setScanning(true)
    setError(null)
    setResults(null)

    try {
      const formData = new FormData()
      batchFiles.forEach(f => formData.append('images', f))

      const res = await authenticatedFetch(`${API_URL}/api/scan/asset/batch`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

      if (data.error) {
        setError(data.error)
      } else {
        setResults(data.items || [])
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setScanning(false)
    }
  }

  // ─── Drag and drop ───────────────────────────────────────────────────────
  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)
  }, [])

  const handleDrop = useCallback(async (e) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOver(false)

    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.type.startsWith('image/')
    )

    if (files.length === 0) {
      setError('Please drop image files only (JPEG, PNG)')
      return
    }

    if (files.length === 1) {
      await scanSingleFile(files[0])
    } else {
      // Batch mode
      const batch = files.slice(0, 5)
      setBatchFiles(batch)
      setBatchPreviews(batch.map(f => ({
        name: f.name,
        url: URL.createObjectURL(f),
        size: (f.size / 1024).toFixed(0) + ' KB',
      })))
      setMode('batch')
    }
  }, [])

  // ─── Result handlers ─────────────────────────────────────────────────────
  const handleConfirmSingle = () => {
    if (results && !Array.isArray(results) && onResult) {
      onResult(results)
    }
  }

  const handleConfirmBatchItem = (item) => {
    if (onResult) onResult(item)
  }

  const handleConfirmAllBatch = () => {
    if (Array.isArray(results) && onResult) {
      results.forEach(item => {
        if (!item.error) onResult(item)
      })
    }
  }

  const handleRescan = () => {
    setResults(null)
    setError(null)
    setMode('choose')
    setBatchFiles([])
    setBatchPreviews([])
  }

  // ─── Mode Selection Screen ───────────────────────────────────────────────
  if (mode === 'choose' && !scanning && !results && !error) {
    return (
      <div
        className="scanner-container"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="scanner-choose-mode">
          <h3>📦 Scan Inventory Asset</h3>
          <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1.2rem' }}>
            Use AI image recognition to auto-identify and categorize items
          </p>

          <div className="scanner-mode-grid">
            <button className="scanner-mode-card" onClick={() => setMode('camera')}>
              <span className="mode-icon">📸</span>
              <span className="mode-label">Camera</span>
              <span className="mode-desc">Take a photo with your camera</span>
            </button>

            <button className="scanner-mode-card" onClick={() => fileInputRef.current?.click()}>
              <span className="mode-icon">📁</span>
              <span className="mode-label">Upload</span>
              <span className="mode-desc">Select an image from your device</span>
            </button>

            <button className="scanner-mode-card" onClick={() => setMode('batch')}>
              <span className="mode-icon">📚</span>
              <span className="mode-label">Batch Scan</span>
              <span className="mode-desc">Scan up to 5 items at once</span>
            </button>
          </div>

          {/* Drag and drop zone */}
          <div className={`scanner-dropzone ${dragOver ? 'active' : ''}`}>
            <span style={{ fontSize: '1.5rem' }}>⬇️</span>
            <span>Or drag & drop images here</span>
            <span className="text-muted" style={{ fontSize: '0.75rem' }}>
              Single image → instant scan · Multiple images → batch scan
            </span>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />

          <button className="scanner-btn secondary" onClick={onClose} style={{ marginTop: '1rem' }}>
            ✕ Close
          </button>
        </div>
      </div>
    )
  }

  // ─── Camera Mode ─────────────────────────────────────────────────────────
  if (mode === 'camera') {
    return (
      <CameraCapture
        title="Scan Inventory Asset"
        onCapture={handleCameraCapture}
        onClose={() => { setMode('choose'); onClose?.() }}
      />
    )
  }

  // ─── Batch Mode ──────────────────────────────────────────────────────────
  if (mode === 'batch' && !scanning && !results) {
    return (
      <div className="scanner-container">
        <div className="scanner-batch-setup">
          <h3>📚 Batch Scan — {batchFiles.length}/5 images</h3>
          <p className="text-muted" style={{ fontSize: '0.82rem', marginBottom: '1rem' }}>
            Upload multiple item photos to scan them all at once
          </p>

          {/* Preview grid */}
          {batchPreviews.length > 0 && (
            <div className="scanner-batch-previews">
              {batchPreviews.map((p, i) => (
                <div key={i} className="scanner-batch-thumb">
                  <img src={p.url} alt={p.name} />
                  <button className="batch-remove-btn" onClick={() => removeBatchFile(i)}>✕</button>
                  <span className="batch-thumb-name">{p.name}</span>
                  <span className="batch-thumb-size">{p.size}</span>
                </div>
              ))}
            </div>
          )}

          {/* Add more */}
          {batchFiles.length < 5 && (
            <button
              className="scanner-btn secondary"
              onClick={() => batchInputRef.current?.click()}
              style={{ marginBottom: '0.75rem' }}
            >
              ➕ Add Image ({5 - batchFiles.length} remaining)
            </button>
          )}
          <input
            ref={batchInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleBatchAdd}
          />

          {/* Actions */}
          <div className="scanner-actions">
            <button className="scanner-btn secondary" onClick={handleRescan}>← Back</button>
            <button
              className="scanner-btn primary"
              onClick={handleBatchScan}
              disabled={batchFiles.length === 0}
            >
              🔍 Scan {batchFiles.length} Item{batchFiles.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ─── Main render ─────────────────────────────────────────────────────────
  return (
    <div className="scanner-container">
      {/* Scanning indicator */}
      {scanning && (
        <div className="scanner-processing">
          <div className="scanner-spinner" />
          <h3>🔍 Analyzing Asset{batchFiles.length > 1 ? 's' : ''}...</h3>
          <p>
            {batchFiles.length > 1
              ? `Processing ${batchFiles.length} images with AI image recognition`
              : 'Identifying item using AI image recognition'
            }
          </p>
        </div>
      )}

      {/* Error */}
      {error && !scanning && (
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

      {/* Single Result */}
      {results && !scanning && !Array.isArray(results) && (
        <AssetResultCard
          result={results}
          onConfirm={handleConfirmSingle}
          onRescan={handleRescan}
        />
      )}

      {/* Batch Results */}
      {results && !scanning && Array.isArray(results) && (
        <div className="scanner-batch-results">
          <div className="scanner-results-header">
            <h3>📚 Batch Scan Results — {results.length} items</h3>
            <span className="text-muted" style={{ fontSize: '0.82rem' }}>
              {results.filter(r => !r.error).length} successful · {results.filter(r => r.error).length} failed
            </span>
          </div>

          <div className="scanner-batch-grid">
            {results.map((item, idx) => (
              <AssetResultCard
                key={idx}
                result={item}
                compact
                onConfirm={() => handleConfirmBatchItem(item)}
              />
            ))}
          </div>

          <div className="scanner-actions" style={{ marginTop: '1rem' }}>
            <button className="scanner-btn secondary" onClick={handleRescan}>🔄 Scan Again</button>
            <button className="scanner-btn primary" onClick={handleConfirmAllBatch}>
              ✅ Add All to Inventory ({results.filter(r => !r.error).length})
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * AssetResultCard — Displays a single scan result with auto-categorization info.
 */
function AssetResultCard({ result, compact = false, onConfirm, onRescan }) {
  if (result.error) {
    return (
      <div className="scanner-results" style={compact ? { padding: '12px' } : {}}>
        <div style={{ textAlign: 'center', padding: '1rem' }}>
          <span style={{ fontSize: '1.5rem' }}>❌</span>
          <p style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '0.5rem' }}>{result.error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="scanner-results" style={compact ? { padding: '12px' } : {}}>
      <div className="scanner-results-header">
        <h3>{compact ? '' : '📦 '}{result.asset_name || 'Unknown Item'}</h3>
        {result.confidence != null && (
          <span className={`confidence-badge ${result.confidence > 0.7 ? 'high' : result.confidence > 0.4 ? 'medium' : 'low'}`}>
            {Math.round(result.confidence * 100)}% confidence
          </span>
        )}
      </div>

      {/* Auto-categorization banner */}
      {result.suggested_inventory_category && (
        <div className="scanner-auto-category">
          <span className="auto-cat-icon">🏷️</span>
          <div className="auto-cat-info">
            <span className="auto-cat-label">Auto-categorized as:</span>
            <span className="auto-cat-value">{result.suggested_inventory_category}</span>
            {result.auto_unit && (
              <span className="auto-cat-unit">Unit: {result.auto_unit}</span>
            )}
          </div>
        </div>
      )}

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

      {/* Tags */}
      {result.tags && result.tags.length > 0 && (
        <div className="scanner-tags">
          {result.tags.map((tag, i) => (
            <span key={i} className="scanner-tag">{tag}</span>
          ))}
        </div>
      )}

      <div className="scanner-actions">
        {onRescan && <button className="scanner-btn secondary" onClick={onRescan}>🔄 Scan Again</button>}
        <button className="scanner-btn primary" onClick={onConfirm}>✅ Add to Inventory</button>
      </div>
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
