import { useMemo, useState } from 'react'
import StationWebcamCapture from '../components/station/StationWebcamCapture.jsx'
import { socket, SOCKET_SERVER_URL } from '../lib/socket'

const CHARACTER_OPTIONS = [
  { id: 'astronaut', name: 'Astronaut', tag: 'Moon Ranger' },
  { id: 'alien', name: 'Alien', tag: 'Galaxy Visitor' },
  { id: 'human', name: 'Human', tag: 'Earth Explorer' },
  { id: 'robot', name: 'Robot', tag: 'Neon Machine' },
]

function StationPage() {
  const stationId = useMemo(() => {
    const search = new URLSearchParams(window.location.search)
    return search.get('stationId') || search.get('id') || 'station-01'
  }, [])

  const [screen, setScreen] = useState('welcome')
  const [faceCropPngBase64, setFaceCropPngBase64] = useState('')
  const [selectedCharacter, setSelectedCharacter] = useState('')
  const [joinMessage, setJoinMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleStart = () => {
    setJoinMessage('')
    setFaceCropPngBase64('')
    setSelectedCharacter('')
    setScreen('capture')
  }

  const handleContinueFromCapture = (facePngBase64) => {
    setFaceCropPngBase64(facePngBase64)
    setSelectedCharacter('')
    setJoinMessage('')
    setScreen('character')
  }

  const handleJoinParade = async () => {
    if (!faceCropPngBase64 || !selectedCharacter) {
      return
    }

    if (!socket.connected) {
      socket.connect()
    }

    const selected = CHARACTER_OPTIONS.find((character) => character.id === selectedCharacter)
    const characterName = selected ? selected.name : selectedCharacter
    const payload = {
      stationId,
      faceImageBase64: faceCropPngBase64,
      characterType: characterName,
      createdAt: new Date().toISOString(),
    }

    try {
      setIsSubmitting(true)
      setJoinMessage(`Submitting ${characterName} to local server...`)

      const response = await new Promise((resolve, reject) => {
        const timeoutId = window.setTimeout(() => {
          reject(new Error('Local server did not respond in time.'))
        }, 7000)

        socket.emit('player:submit', payload, (ack) => {
          window.clearTimeout(timeoutId)

          if (!ack?.ok) {
            reject(new Error(ack?.message || 'Failed to queue player.'))
            return
          }

          resolve(ack)
        })
      })

      const queuePosition = typeof response.queuePosition === 'number' ? response.queuePosition : '?'
      setJoinMessage(`${characterName} queued successfully. Queue position: ${queuePosition}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to reach local server.'
      setJoinMessage(`Join Parade failed: ${message}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="station-page">
      <div className="station-bg" aria-hidden="true">
        <span className="station-star star-a"></span>
        <span className="station-star star-b"></span>
        <span className="station-star star-c"></span>
        <span className="station-star star-d"></span>
        <span className="station-moon"></span>
      </div>

      <section className="station-card">
        {screen === 'welcome' ? (
          <>
            <p className="station-eyebrow">Moonwalk Selfie Parade</p>
            <h1 className="station-title">Welcome Explorer</h1>
            <p className="station-text">Tap Start to take your selfie and join the moon catwalk parade.</p>
            <button type="button" className="station-primary-button" onClick={handleStart}>
              Start
            </button>
          </>
        ) : null}

        {screen === 'capture' ? (
          <>
            <p className="station-eyebrow">Step 2 of 3</p>
            <h1 className="station-title">Webcam Capture</h1>
            <p className="station-text">Position your face inside the frame, capture, confirm the crop, then continue.</p>

            <StationWebcamCapture
              onBack={() => setScreen('welcome')}
              onContinue={handleContinueFromCapture}
            />
          </>
        ) : null}

        {screen === 'character' ? (
          <>
            <p className="station-eyebrow">Step 3 of 3</p>
            <h1 className="station-title">Choose Your Character</h1>
            <p className="station-text">Tap one character card to pair with your selfie, then join the parade.</p>
            <p className="station-status-muted">Station ID: {stationId}</p>
            <p className="station-status-muted">Server: {SOCKET_SERVER_URL}</p>

            <div className="station-character-layout">
              <div className="station-character-preview-panel">
                <div className="station-helmet-shell station-helmet-shell-small">
                  <div className="station-helmet-face-ring station-helmet-face-ring-small">
                    <img className="station-selfie-preview" src={faceCropPngBase64} alt="Selected face crop preview" />
                  </div>
                </div>
                <p className="station-status-muted">
                  Selected Character:{' '}
                  <strong>{selectedCharacter ? CHARACTER_OPTIONS.find((character) => character.id === selectedCharacter)?.name : 'None'}</strong>
                </p>
              </div>

              <div className="station-character-grid">
                {CHARACTER_OPTIONS.map((character) => (
                  <button
                    key={character.id}
                    type="button"
                    className={`station-character-card ${selectedCharacter === character.id ? 'active' : ''}`}
                    onClick={() => setSelectedCharacter(character.id)}
                  >
                    <span className="station-character-name">{character.name}</span>
                    <span className="station-character-tag">{character.tag}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="station-character-actions">
              <button type="button" className="station-secondary-button station-join-button" onClick={() => setScreen('capture')}>
                Retake Selfie
              </button>
              <button
                type="button"
                className="station-primary-button station-join-button"
                onClick={handleJoinParade}
                disabled={!selectedCharacter || isSubmitting}
              >
                {isSubmitting ? 'Submitting...' : 'Submit / Join Parade'}
              </button>
            </div>

            {joinMessage ? <p className="station-status-ok">{joinMessage}</p> : null}
          </>
        ) : null}
      </section>
    </main>
  )
}

export default StationPage
