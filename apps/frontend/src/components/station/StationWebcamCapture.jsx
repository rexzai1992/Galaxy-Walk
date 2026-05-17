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

const CHARACTER_PREVIEW_OPTIONS = [
  { id: 'astronaut', name: 'Astronaut' },
  { id: 'alien', name: 'Alien' },
  { id: 'human', name: 'Human' },
  { id: 'robot', name: 'Robot' },
]

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

function StationWebcamCapture({ onBack, onContinue, selectedCharacter, onSelectCharacter }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)

  const [cameraStatus, setCameraStatus] = useState('requesting')
  const [errorMessage, setErrorMessage] = useState('')
  const [capturedSelfie, setCapturedSelfie] = useState('')
  const [croppedFacePng, setCroppedFacePng] = useState('')
  const [cropStatus, setCropStatus] = useState('idle')
  const [cropErrorMessage, setCropErrorMessage] = useState('')

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
    await requestCamera()
  }

  const selectCharacter = useCallback((characterId) => {
    if (typeof onSelectCharacter === 'function') {
      onSelectCharacter(characterId)
    }
  }, [onSelectCharacter])

  const handleContinue = () => {
    if (!croppedFacePng || !selectedCharacter) {
      return
    }

    onContinue(croppedFacePng, selectedCharacter)
  }

  const isFacePreviewReady = cropStatus === 'ready' && Boolean(croppedFacePng)
  const previewFallbackMessage = cropStatus === 'generating'
    ? 'Generating centered face crop...'
    : 'Unable to crop preview'

  return (
    <div className="station-capture-layout">
      <div className="station-camera-frame">
        {capturedSelfie ? (
          <div className="station-capture-preview-split">
            <div className="station-helmet-preview">
              <div className="station-helmet-shell">
                <div className="station-helmet-face-ring">
                  {isFacePreviewReady ? (
                    <img className="station-selfie-preview" src={croppedFacePng} alt="Centered circular face crop preview" />
                  ) : (
                    <div className="station-crop-waiting">{previewFallbackMessage}</div>
                  )}
                </div>
              </div>
              <p className="station-camera-hint">Face shape preview</p>
            </div>

            <div className="station-capture-character-side">
              <p className="station-capture-character-title">Character Preview</p>
              <p className="station-capture-character-subtitle">Tap one character here, then continue.</p>

              <div className="station-capture-character-mini-grid">
                {CHARACTER_PREVIEW_OPTIONS.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    className={`station-capture-character-mini station-capture-character-mini--${character.id} ${selectedCharacter === character.id ? 'active' : ''}`}
                    onClick={() => selectCharacter(character.id)}
                    aria-pressed={selectedCharacter === character.id}
                  >
                    <div className="station-capture-character-mini-head">
                      <div className="station-capture-character-mini-face-ring">
                        {isFacePreviewReady ? (
                          <img
                            className="station-selfie-preview"
                            src={croppedFacePng}
                            alt={`${character.name} face preview`}
                          />
                        ) : (
                          <span className="station-capture-character-mini-placeholder">...</span>
                        )}
                      </div>
                    </div>
                    <div className="station-capture-character-mini-body"></div>
                    <p className="station-capture-character-mini-name">{character.name}</p>
                  </button>
                ))}
              </div>
              <p className="station-capture-character-selected">
                Selected: {selectedCharacter ? CHARACTER_PREVIEW_OPTIONS.find((character) => character.id === selectedCharacter)?.name : 'None'}
              </p>
            </div>
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
              className="station-primary-button station-capture-button"
              onClick={handleContinue}
              disabled={!croppedFacePng || !selectedCharacter}
            >
              Continue
            </button>
          </>
        )}
        {!capturedSelfie ? (
          <button type="button" className="station-secondary-button station-capture-button" onClick={onBack}>
            Back
          </button>
        ) : null}
      </div>
    </div>
  )
}

export default StationWebcamCapture
