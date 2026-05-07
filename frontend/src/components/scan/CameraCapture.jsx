import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * CameraCapture — Reusable camera component for capturing images.
 * Uses getUserMedia API for mobile/desktop camera access.
 * Returns captured image as a File object via onCapture callback.
 */
export default function CameraCapture({ onCapture, onClose, title = 'Camera' }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [captured, setCaptured] = useState(null) // preview URL
  const [capturedFile, setCapturedFile] = useState(null)
  const [facingMode, setFacingMode] = useState('environment') // back camera default
  const [error, setError] = useState(null)

  // Start camera
  const startCamera = useCallback(async () => {
    try {
      // Stop existing stream
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }

      const constraints = {
        video: {
          facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        videoRef.current.play()
        setCameraReady(true)
        setError(null)
      }
    } catch (err) {
      console.error('Camera error:', err)
      setError(
        err.name === 'NotAllowedError'
          ? 'Camera access denied. Please allow camera permissions.'
          : err.name === 'NotFoundError'
          ? 'No camera found on this device.'
          : `Camera error: ${err.message}`
      )
    }
  }, [facingMode])

  useEffect(() => {
    startCamera()
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop())
      }
    }
  }, [startCamera])

  // Capture photo
  const capturePhoto = () => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(video, 0, 0)

    canvas.toBlob((blob) => {
      if (blob) {
        const file = new File([blob], `scan_${Date.now()}.jpg`, { type: 'image/jpeg' })
        const url = URL.createObjectURL(blob)
        setCaptured(url)
        setCapturedFile(file)
      }
    }, 'image/jpeg', 0.85)
  }

  // Retake
  const retake = () => {
    if (captured) URL.revokeObjectURL(captured)
    setCaptured(null)
    setCapturedFile(null)
  }

  // Confirm capture
  const confirmCapture = () => {
    if (capturedFile && onCapture) {
      onCapture(capturedFile)
    }
  }

  // Switch camera
  const switchCamera = () => {
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')
  }

  return (
    <div className="camera-overlay">
      <div className="camera-modal">
        {/* Header */}
        <div className="camera-header">
          <h3>📸 {title}</h3>
          <button className="camera-close-btn" onClick={onClose}>✕</button>
        </div>

        {error ? (
          <div className="camera-error">
            <span style={{ fontSize: '2rem' }}>📷</span>
            <p>{error}</p>
            <button className="camera-retry-btn" onClick={startCamera}>🔄 Retry</button>
          </div>
        ) : !captured ? (
          <>
            {/* Live Camera View */}
            <div className="camera-viewport">
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="camera-video"
              />
              <canvas ref={canvasRef} style={{ display: 'none' }} />

              {/* Viewfinder overlay */}
              <div className="camera-viewfinder">
                <div className="viewfinder-corner tl" />
                <div className="viewfinder-corner tr" />
                <div className="viewfinder-corner bl" />
                <div className="viewfinder-corner br" />
              </div>

              {!cameraReady && (
                <div className="camera-loading">
                  <div className="camera-spinner" />
                  <span>Starting camera...</span>
                </div>
              )}
            </div>

            {/* Controls */}
            <div className="camera-controls">
              <button className="camera-switch-btn" onClick={switchCamera} title="Switch camera">
                🔄
              </button>
              <button
                className="camera-capture-btn"
                onClick={capturePhoto}
                disabled={!cameraReady}
              >
                <div className="capture-btn-inner" />
              </button>
              <div style={{ width: 44 }} /> {/* spacer for centering */}
            </div>
          </>
        ) : (
          <>
            {/* Captured Preview */}
            <div className="camera-viewport">
              <img src={captured} alt="Captured" className="camera-preview-img" />
            </div>

            <div className="camera-controls">
              <button className="camera-retake-btn" onClick={retake}>
                🔄 Retake
              </button>
              <button className="camera-confirm-btn" onClick={confirmCapture}>
                ✅ Use Photo
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
