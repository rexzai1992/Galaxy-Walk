import { Suspense, useCallback, useEffect, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import AvatarCharacter from '../components/avatar/AvatarCharacter.jsx'
import AvatarLighting from '../components/avatar/AvatarLighting.jsx'
import GroundShadow from '../components/avatar/GroundShadow.jsx'
import { CHARACTER_VARIANTS } from '../components/avatar/characterVariants'
import { loadAlienFaceCalibration } from '../lib/alienFaceCalibration'
import { alignFacePhoto, loadImage } from '../lib/faceAlign'
import { SOCKET_SERVER_URL } from '../lib/socket'

const ANIMATIONS = ['idle', 'wave', 'dance', 'pose']
const LINEUP = Object.values(CHARACTER_VARIANTS)

function buildApiUrl(path) {
  try {
    return new URL(path, SOCKET_SERVER_URL).toString()
  } catch {
    return path
  }
}

function LineupScene({ faceUrl, animation, headCalibration }) {
  return (
    <>
      <AvatarLighting />
      {LINEUP.map((variant, index) => (
        <Suspense key={variant.id} fallback={null}>
          <GroundShadow position={[(index - (LINEUP.length - 1) / 2) * 2.6, -1.88, 0]} width={3} depth={1.4} />
          <AvatarCharacter
            position={[(index - (LINEUP.length - 1) / 2) * 2.6, -1.9, 0]}
            characterType={variant.id}
            paradeAnimation={animation}
            faceTextureUrl={faceUrl}
            headCalibration={headCalibration}
          />
        </Suspense>
      ))}
    </>
  )
}

function AdminPage() {
  const [faceUrl, setFaceUrl] = useState('')
  const [animation, setAnimation] = useState('idle')
  const [status, setStatus] = useState('Loading latest selfie...')
  const [headCalibration] = useState(() => loadAlienFaceCalibration().head)

  const applyImageAsFace = useCallback(async (imageUrl, label) => {
    const image = await loadImage(imageUrl)
    const aligned = await alignFacePhoto(image)
    setFaceUrl(aligned.dataUrl)
    setStatus(`${label}: ${aligned.detected ? 'face detected and aligned' : 'no face detected, used centre crop'}`)
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadLatest = async () => {
      try {
        const response = await fetch(buildApiUrl('/api/faces/latest'), { cache: 'no-store' })
        const payload = await response.json()
        if (cancelled) return
        if (!payload?.ok || !payload.faceImageBase64) {
          setStatus('No selfies stored yet; showing the placeholder face.')
          return
        }
        await applyImageAsFace(payload.faceImageBase64, `Latest selfie ${payload.fileName}`)
      } catch (error) {
        if (!cancelled) setStatus(`Could not load latest selfie: ${error instanceof Error ? error.message : error}`)
      }
    }
    void loadLatest()
    return () => {
      cancelled = true
    }
  }, [applyImageAsFace])

  const handleUpload = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const objectUrl = URL.createObjectURL(file)
    try {
      await applyImageAsFace(objectUrl, file.name)
    } catch (error) {
      setStatus(`Upload failed: ${error instanceof Error ? error.message : error}`)
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  }

  return (
    <main className="admin-lineup-page">
      <header className="admin-lineup-header">
        <div>
          <h1>Character Lineup</h1>
          <p className="muted">{status}</p>
        </div>
        <div className="admin-lineup-controls">
          <label>
            Animation
            <select value={animation} onChange={(event) => setAnimation(event.target.value)}>
              {ANIMATIONS.map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </label>
          <label className="admin-lineup-upload">
            Try a photo
            <input type="file" accept="image/*" onChange={handleUpload} />
          </label>
          {faceUrl ? <img className="admin-lineup-face" src={faceUrl} alt="Aligned face used for the lineup" /> : null}
        </div>
      </header>
      <div className="admin-lineup-canvas">
        <Canvas dpr={[1, 2]} camera={{ position: [0, 0.6, 9.5], fov: 38 }}>
          <LineupScene faceUrl={faceUrl} animation={animation} headCalibration={headCalibration} />
        </Canvas>
        <div className="admin-lineup-labels">
          {LINEUP.map((variant) => (
            <span key={variant.id}>{variant.label}</span>
          ))}
        </div>
      </div>
    </main>
  )
}

export default AdminPage
