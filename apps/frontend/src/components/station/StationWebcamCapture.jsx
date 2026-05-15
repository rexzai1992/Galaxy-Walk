import { useCallback, useEffect, useRef, useState } from 'react'
import { createCenteredCircularFacePng } from '../../utils/faceCrop'

const CAMERA_CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: 'user',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
}

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

  return {
    sx,
    sy,
    sWidth,
    sHeight,
    targetWidth,
    targetHeight,
  }
}

function StationWebcamCapture({ onBack, onContinue }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const [cameraStatus, setCameraStatus] = useState('requesting')
  const [errorMessage, setErrorMessage] = useState('')
  const [capturedSelfie, setCapturedSelfie] = useState('')
  const [croppedFacePng, setCroppedFacePng] = useState('')
  const [cropStatus, setCropStatus] = useState('idle')
  const [cropErrorMessage, setCropErrorMessage] = useState('')
  const [isCropConfirmed, setIsCropConfirmed] = useState(false)

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
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
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
          // Browsers may require user gesture in some contexts.
        }
      }

      setCameraStatus('ready')
    } catch (error) {
      setCameraStatus('error')
      setErrorMessage(error instanceof Error ? error.message : 'Camera permission denied or unavailable.')
    }
  }, [stopCamera])

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      void requestCamera()
    }, 0)

    return () => {
      window.clearTimeout(timerId)
      stopCamera()
    }
  }, [requestCamera, stopCamera])

  const capturePhoto = async () => {
    if (!videoRef.current || !canvasRef.current) {
      return
    }

    const video = videoRef.current
    const canvas = canvasRef.current
    const sourceRect = getVisibleVideoSourceRect(video)

    canvas.width = sourceRect.targetWidth
    canvas.height = sourceRect.targetHeight

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    ctx.drawImage(
      video,
      sourceRect.sx,
      sourceRect.sy,
      sourceRect.sWidth,
      sourceRect.sHeight,
      0,
      0,
      sourceRect.targetWidth,
      sourceRect.targetHeight,
    )

    const base64Image = canvas.toDataURL('image/jpeg', 0.92)
    setCapturedSelfie(base64Image)
    setCroppedFacePng('')
    setCropErrorMessage('')
    setCropStatus('generating')
    setIsCropConfirmed(false)

    try {
      const centeredFacePng = await createCenteredCircularFacePng(base64Image, {
        outputSize: 480,
        cropRatio: 0.78,
        cropOffsetY: -0.04,
      })
      setCroppedFacePng(centeredFacePng)
      setCropStatus('ready')
    } catch (error) {
      setCropStatus('error')
      setCropErrorMessage(error instanceof Error ? error.message : 'Failed to crop selfie.')
    }

    stopCamera()
    setCameraStatus('captured')
  }

  const retakePhoto = async () => {
    setCapturedSelfie('')
    setCroppedFacePng('')
    setCropStatus('idle')
    setCropErrorMessage('')
    setIsCropConfirmed(false)
    await requestCamera()
  }

  const confirmCrop = () => {
    if (!croppedFacePng) {
      return
    }

    setIsCropConfirmed(true)
  }

  const handleContinue = () => {
    if (!croppedFacePng || !isCropConfirmed) {
      return
    }

    onContinue(croppedFacePng)
  }

  return (
    <div className="station-capture-layout">
      <div className="station-camera-frame">
        {capturedSelfie ? (
          <div className="station-helmet-preview">
            <div className="station-helmet-shell">
              <div className="station-helmet-face-ring">
                {cropStatus === 'ready' && croppedFacePng ? (
                  <img className="station-selfie-preview" src={croppedFacePng} alt="Centered circular face crop preview" />
                ) : (
                  <div className="station-crop-waiting">
                    {cropStatus === 'generating' ? 'Generating centered face crop...' : 'Unable to crop preview'}
                  </div>
                )}
              </div>
            </div>
            <p className="station-camera-hint">Preview inside helmet face frame</p>
          </div>
        ) : (
          <video ref={videoRef} className="station-camera-video" autoPlay playsInline muted />
        )}

        {cameraStatus === 'requesting' ? <p className="station-camera-hint">Requesting camera access...</p> : null}

        {cameraStatus === 'error' ? <p className="station-camera-error">Camera error: {errorMessage}</p> : null}
        {cropStatus === 'error' ? <p className="station-camera-error">Crop error: {cropErrorMessage}</p> : null}
      </div>

      <canvas ref={canvasRef} className="station-hidden-canvas" aria-hidden="true" />

      <div className="station-capture-actions">
        {!capturedSelfie ? (
          <button
            type="button"
            className="station-primary-button station-capture-button"
            onClick={capturePhoto}
            disabled={cameraStatus !== 'ready'}
          >
            Capture Selfie
          </button>
        ) : (
          <>
            <button type="button" className="station-secondary-button station-capture-button" onClick={retakePhoto}>
              Retake
            </button>
            <button
              type="button"
              className="station-secondary-button station-capture-button"
              onClick={confirmCrop}
              disabled={!croppedFacePng || isCropConfirmed}
            >
              {isCropConfirmed ? 'Confirmed' : 'Confirm Face Crop'}
            </button>
            <button
              type="button"
              className="station-primary-button station-capture-button"
              onClick={handleContinue}
              disabled={!isCropConfirmed}
            >
              Continue
            </button>
          </>
        )}

        <button type="button" className="station-secondary-button station-capture-button" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  )
}

export default StationWebcamCapture
