import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import StationAvatarPreview from '../components/station/StationAvatarPreview.jsx'
import StationWebcamCapture from '../components/station/StationWebcamCapture.jsx'
import { CHARACTER_VARIANTS, DEFAULT_CHARACTER_VARIANT } from '../components/avatar/characterVariants'
import { socket, SOCKET_SERVER_URL } from '../lib/socket'

const CHARACTER_OPTIONS = [
  { id: 'alien', tag: 'Galaxy Visitor' },
  { id: 'astronaut', tag: 'Moon Ranger' },
  { id: 'human', tag: 'Earth Explorer' },
  { id: 'robot', tag: 'Neon Machine' },
].map((option) => ({ ...option, name: CHARACTER_VARIANTS[option.id].label }))

const IDLE_RESET_MS = 60 * 1000
const SUCCESS_RESET_SECONDS = 15
const SUBMIT_TIMEOUT_MS = 7000

function formatTicket(ticketNumber) {
  const n = Number(ticketNumber || 0)
  return n > 0 ? `#${String(n).padStart(3, '0')}` : ''
}

function submitPlayer(payload) {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('The parade server did not respond in time.'))
    }, SUBMIT_TIMEOUT_MS)

    socket.emit('player:submit', payload, (ack) => {
      window.clearTimeout(timeoutId)
      if (!ack?.ok) {
        reject(new Error(ack?.message || 'Failed to join the parade.'))
        return
      }
      resolve(ack)
    })
  })
}

function useSocketConnected() {
  const [isConnected, setIsConnected] = useState(socket.connected)

  useEffect(() => {
    const handleConnect = () => setIsConnected(true)
    const handleDisconnect = () => setIsConnected(false)
    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleDisconnect)
    if (!socket.connected) socket.connect()
    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleDisconnect)
    }
  }, [])

  return isConnected
}

function StepLabel({ step }) {
  return <p className="station-eyebrow">Step {step} of 3</p>
}

function StationPage() {
  const searchParams = useMemo(() => new URLSearchParams(window.location.search), [])
  const stationId = searchParams.get('stationId') || searchParams.get('id') || 'station-01'
  const showDebug = searchParams.get('debug') === '1'
  const isServerConnected = useSocketConnected()

  const [screen, setScreen] = useState('welcome')
  const [faceDataUrl, setFaceDataUrl] = useState('')
  const [faceDetected, setFaceDetected] = useState(true)
  const [selectedCharacter, setSelectedCharacter] = useState(DEFAULT_CHARACTER_VARIANT)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [joinResult, setJoinResult] = useState(null)
  const [successCountdown, setSuccessCountdown] = useState(SUCCESS_RESET_SECONDS)
  const lastActivityRef = useRef(0)

  const resetToWelcome = useCallback(() => {
    setScreen('welcome')
    setFaceDataUrl('')
    setFaceDetected(true)
    setSelectedCharacter(DEFAULT_CHARACTER_VARIANT)
    setSubmitError('')
    setJoinResult(null)
    setIsSubmitting(false)
  }, [])

  // Kiosk safety net: a guest who walks away mid-flow does not block the next one.
  useEffect(() => {
    if (screen === 'welcome' || screen === 'success') return undefined
    lastActivityRef.current = Date.now()
    const intervalId = window.setInterval(() => {
      if (Date.now() - lastActivityRef.current > IDLE_RESET_MS) resetToWelcome()
    }, 5000)
    return () => window.clearInterval(intervalId)
  }, [screen, resetToWelcome])

  useEffect(() => {
    if (screen !== 'success') return undefined
    const timerId = window.setTimeout(() => {
      if (successCountdown <= 1) resetToWelcome()
      else setSuccessCountdown(successCountdown - 1)
    }, 1000)
    return () => window.clearTimeout(timerId)
  }, [screen, successCountdown, resetToWelcome])

  const handleStart = () => {
    resetToWelcome()
    setScreen('capture')
  }

  const handleCaptured = useCallback(({ faceDataUrl: capturedFace, detected }) => {
    setFaceDataUrl(capturedFace)
    setFaceDetected(detected)
    setSubmitError('')
    setScreen('character')
  }, [])

  const handleJoinParade = async () => {
    if (!faceDataUrl || !selectedCharacter || isSubmitting) return
    if (!socket.connected) socket.connect()

    const character = CHARACTER_OPTIONS.find((option) => option.id === selectedCharacter)
    setIsSubmitting(true)
    setSubmitError('')

    try {
      const ack = await submitPlayer({
        stationId,
        faceImageBase64: faceDataUrl,
        characterType: character?.name || selectedCharacter,
        createdAt: new Date().toISOString(),
      })
      setJoinResult({
        ticketNumber: Number(ack.ticketNumber || 0),
        queuePosition: Number(ack.queuePosition || 0),
        characterName: character?.name || selectedCharacter,
      })
      setSuccessCountdown(SUCCESS_RESET_SECONDS)
      setScreen('success')
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Unable to reach the parade server.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const guestsAhead = Math.max(0, (joinResult?.queuePosition || 1) - 1)

  return (
    <main className="station-page" onPointerDown={() => { lastActivityRef.current = Date.now() }}>
      <div className="station-bg" aria-hidden="true"></div>

      <div
        className={`station-connection ${isServerConnected ? 'is-online' : 'is-offline'}`}
        title={SOCKET_SERVER_URL}
      >
        <span className="station-connection-dot"></span>
        {isServerConnected ? 'Parade online' : 'Parade offline - please call staff'}
      </div>

      <section className="station-card">
        {screen === 'welcome' ? (
          <>
            <p className="station-eyebrow">Moonwalk Selfie Parade</p>
            <h1 className="station-title">Join the Parade!</h1>
            <p className="station-text">Snap a selfie, pick your character and watch yourself moonwalk across the big screen.</p>
            <ol className="station-how-it-works">
              <li><strong>1</strong> Take a selfie</li>
              <li><strong>2</strong> Pick a character</li>
              <li><strong>3</strong> Find your number on screen</li>
            </ol>
            <button type="button" className="station-primary-button" onClick={handleStart}>
              Start
            </button>
          </>
        ) : null}

        {screen === 'capture' ? (
          <>
            <StepLabel step={1} />
            <h1 className="station-title">Take Your Selfie</h1>
            <p className="station-text">Look at the camera and fit your face inside the oval.</p>
            <StationWebcamCapture onCaptured={handleCaptured} onBack={resetToWelcome} />
          </>
        ) : null}

        {screen === 'character' ? (
          <>
            <StepLabel step={2} />
            <h1 className="station-title">Your Parade Twin</h1>
            {!faceDetected ? (
              <p className="station-warning">We could not spot your face clearly. Retake for the best result, or continue anyway.</p>
            ) : (
              <p className="station-text">Tap a character to try it on.</p>
            )}

            <div className="station-character-stage">
              <StationAvatarPreview faceDataUrl={faceDataUrl} characterType={selectedCharacter} />
              <div className="station-character-picker" role="radiogroup" aria-label="Choose your character">
                {CHARACTER_OPTIONS.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    role="radio"
                    aria-checked={selectedCharacter === character.id}
                    className={`station-character-pill station-character-pill--${character.id} ${selectedCharacter === character.id ? 'active' : ''}`}
                    onClick={() => setSelectedCharacter(character.id)}
                  >
                    <span className="station-character-pill-name">{character.name}</span>
                    <span className="station-character-pill-tag">{character.tag}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="station-character-actions station-character-actions--row">
              <button
                type="button"
                className="station-primary-button station-join-button"
                onClick={handleJoinParade}
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Joining...' : 'Join the Parade'}
              </button>
              <button
                type="button"
                className="station-secondary-button station-join-button"
                onClick={() => setScreen('capture')}
                disabled={isSubmitting}
              >
                Retake Selfie
              </button>
            </div>
            {submitError ? <p className="station-camera-error">{submitError} Please try again.</p> : null}
          </>
        ) : null}

        {screen === 'success' && joinResult ? (
          <>
            <StepLabel step={3} />
            <h1 className="station-title">You&apos;re in the Parade!</h1>
            <p className="station-text">Look for your number above your {joinResult.characterName.toLowerCase()} on the big screen.</p>
            {joinResult.ticketNumber ? (
              <div className="station-ticket">
                <span className="station-ticket-label">Your number</span>
                <span className="station-ticket-number">{formatTicket(joinResult.ticketNumber)}</span>
              </div>
            ) : null}
            <p className="station-status-muted">
              {guestsAhead === 0 ? 'You are next to walk on!' : `${guestsAhead} ${guestsAhead === 1 ? 'guest' : 'guests'} ahead of you`}
            </p>
            <button type="button" className="station-primary-button" onClick={resetToWelcome}>
              Done ({successCountdown})
            </button>
          </>
        ) : null}

        {showDebug ? (
          <p className="station-status-muted station-debug">Station: {stationId} · Server: {SOCKET_SERVER_URL}</p>
        ) : null}
      </section>
    </main>
  )
}

export default StationPage
