import { useCallback, useEffect, useRef, useState } from 'react'
import { alignFacePhoto, warmUpFaceDetector } from '../../lib/faceAlign'

const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: 'user',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
}
const COUNTDOWN_SECONDS = 3

// Source rectangle of the video that is actually visible with object-fit: cover.
function getVisibleVideoSourceRect(videoElement) {
  const sourceWidth = videoElement.videoWidth || 1280
  const sourceHeight = videoElement.videoHeight || 720
  const targetWidth = Math.max(1, Math.round(videoElement.clientWidth || sourceWidth))
  const targetHeight = Math.max(1, Math.round(videoElement.clientHeight || sourceHeight))

  const sourceAspect = sourceWidth / sourceHeight
  const targetAspect = targetWidth / targetHeight

  let sx = 0
  let sy = 0
  let sWidth = sourceWidth
  let sHeight = sourceHeight

  if (sourceAspect > targetAspect) {
    sWidth = Math.round(sourceHeight * targetAspect)
    sx = Math.round((sourceWidth - sWidth) / 2)
  } else if (sourceAspect < targetAspect) {
    sHeight = Math.round(sourceWidth / targetAspect)
    sy = Math.round((sourceHeight - sHeight) / 2)
  }

  // Capture at camera resolution (not CSS size) for a sharper face.
  const scale = sHeight / targetHeight
  return {
    sx,
    sy,
    sWidth,
    sHeight,
    targetWidth: Math.round(targetWidth * scale),
    targetHeight: Math.round(targetHeight * scale),
  }
}

/**
 * Live camera with a face guide and a 3-2-1 countdown. Calls
 * onCaptured({ faceDataUrl, detected }) with a selfie already aligned to
 * FACE_LAYOUT (eyes level and centred).
 */
function StationWebcamCapture({ onCaptured, onBack }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const countdownTimerRef = useRef(null)

  const [cameraStatus, setCameraStatus] = useState('requesting')
  const [errorMessage, setErrorMessage] = useState('')
  const [countdown, setCountdown] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isFlashing, setIsFlashing] = useState(false)

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
  }, [])

  const requestCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('error')
      setErrorMessage('This device does not support webcam access in the current runtime.')
      return
    }

    setCameraStatus('requesting')
    setErrorMessage('')

    try {
      const stream = await navigator.mediaDevices.getUserMedia(CAMERA_CONSTRAINTS)
      stopCamera()
      streamRef.current = stream

      if (videoRef.current) {
        videoRef.current.srcObject = stream
        try {
          await videoRef.current.play()
        } catch {
          // Some browsers need a user gesture; the video still shows once it starts.
        }
      }

      setCameraStatus('ready')
    } catch (error) {
      setCameraStatus('error')
      setErrorMessage(error instanceof Error ? error.message : 'Camera permission denied or unavailable.')
    }
  }, [stopCamera])

  useEffect(() => {
    // Load the face model while the guest is getting into position.
    warmUpFaceDetector().catch(() => {})
    const timerId = window.setTimeout(() => {
      void requestCamera()
    }, 0)

    return () => {
      window.clearTimeout(timerId)
      window.clearInterval(countdownTimerRef.current)
      stopCamera()
    }
  }, [requestCamera, stopCamera])

  const captureFrame = useCallback(async () => {
    const video = videoRef.current
    if (!video) return

    const rect = getVisibleVideoSourceRect(video)
    const canvas = document.createElement('canvas')
    canvas.width = rect.targetWidth
    canvas.height = rect.targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Mirror like the on-screen preview so the guest gets exactly what they saw.
    ctx.translate(canvas.width, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(video, rect.sx, rect.sy, rect.sWidth, rect.sHeight, 0, 0, canvas.width, canvas.height)

    setIsFlashing(true)
    window.setTimeout(() => setIsFlashing(false), 260)
    setIsProcessing(true)

    try {
      const aligned = await alignFacePhoto(canvas)
      stopCamera()
      setCameraStatus('captured')
      onCaptured({ faceDataUrl: aligned.dataUrl, detected: aligned.detected })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Could not process the selfie.')
    } finally {
      setIsProcessing(false)
    }
  }, [onCaptured, stopCamera])

  const startCountdown = () => {
    if (cameraStatus !== 'ready' || countdown > 0 || isProcessing) return
    let remaining = COUNTDOWN_SECONDS
    setCountdown(remaining)
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1
      if (remaining > 0) {
        setCountdown(remaining)
        return
      }
      window.clearInterval(countdownTimerRef.current)
      setCountdown(0)
      void captureFrame()
    }, 1000)
  }

  const isBusy = countdown > 0 || isProcessing

  return (
    <div className="station-capture-layout">
      <div className="station-camera-frame station-camera-frame--live">
        <video ref={videoRef} className="station-camera-video station-camera-video--mirrored" autoPlay playsInline muted />
        {cameraStatus === 'ready' ? (
          <>
            <div className="station-face-guide" aria-hidden="true"></div>
            <p className="station-face-guide-label">{isProcessing ? 'Finding your face...' : 'Fit your face inside the oval'}</p>
          </>
        ) : null}
        {countdown > 0 ? <div className="station-countdown" key={countdown}>{countdown}</div> : null}
        {isFlashing ? <div className="station-flash" aria-hidden="true"></div> : null}
        {cameraStatus === 'requesting' ? <p className="station-camera-hint station-camera-overlay-text">Starting camera...</p> : null}
        {cameraStatus === 'error' ? (
          <p className="station-camera-error station-camera-overlay-text">Camera error: {errorMessage}</p>
        ) : null}
      </div>

      <div className="station-capture-actions">
        {cameraStatus === 'error' ? (
          <button type="button" className="station-primary-button station-capture-button" onClick={() => void requestCamera()}>
            Try Camera Again
          </button>
        ) : (
          <button
            type="button"
            className="station-primary-button station-capture-button"
            onClick={startCountdown}
            disabled={cameraStatus !== 'ready' || isBusy}
          >
            {isProcessing ? 'Processing...' : countdown > 0 ? 'Smile!' : 'Take Selfie'}
          </button>
        )}
        <button type="button" className="station-secondary-button station-capture-button" onClick={onBack} disabled={isBusy}>
          Back
        </button>
        {cameraStatus === 'ready' && errorMessage ? <p className="station-camera-error">{errorMessage}</p> : null}
      </div>
    </div>
  )
}

export default StationWebcamCapture
