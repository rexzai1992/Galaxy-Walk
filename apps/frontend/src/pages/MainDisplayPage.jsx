import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { MathUtils } from 'three'
import { io } from 'socket.io-client'
import AlienGlbCharacter from '../components/main/AlienGlbCharacter.jsx'
import { ALIEN_GLB_FILES } from '../components/main/alienGlbConfig'
import ParadeCharacter from '../components/main/ParadeCharacter.jsx'
import {
  DEFAULT_ALIEN_FACE_CALIBRATION,
  clearAlienFaceCalibration,
  loadAlienFaceCalibration,
  saveAlienFaceCalibration,
} from '../lib/alienFaceCalibration'
import { SOCKET_SERVER_URL } from '../lib/socket'

const MAX_ACTIVE_CHARACTERS = 10
const START_X = 22
const EXIT_X = -22
const LANE_SPAWN_GAP = 2.4
const SPAWN_INTERVAL_MS = 3000
const PARADE_CHARACTER_SCALE = 1.2
const CONVEYOR_ANIMATIONS = ['idle', 'idle', 'wave', 'dance', 'pose']
const CALIBRATION_DEFAULT_FACE_TEXTURE_URL =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'%3E%3Crect width='512' height='512' fill='%23f2bf8d'/%3E%3Cellipse cx='180' cy='210' rx='30' ry='22' fill='%23683a1d'/%3E%3Cellipse cx='332' cy='210' rx='30' ry='22' fill='%23683a1d'/%3E%3Cpath d='M172 318 Q256 390 340 318' fill='none' stroke='%23854528' stroke-width='34' stroke-linecap='round'/%3E%3C/svg%3E"
const BLACK_FACE_DATA_URL =
  "data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 2 2'%3E%3Crect width='2' height='2' fill='black'/%3E%3C/svg%3E"
const DEBUG_FORCE_BLACK_FACE = false

const PARADE_LANES = [
  { y: -0.27, z: 3.2 },
  { y: -0.27, z: 2.1 },
  { y: -0.27, z: 1.0 },
  { y: -0.27, z: -0.1 },
  { y: -0.27, z: -1.2 },
  { y: -0.27, z: -2.3 },
]

function UfoPlaceholder() {
  return (
    <group position={[-8, 8.2, -10]}>
      <mesh rotation-x={MathUtils.degToRad(90)}>
        <cylinderGeometry args={[2.9, 3.8, 1.1, 42, 1]} />
        <meshStandardMaterial color="#a5adc2" metalness={0.55} roughness={0.34} />
      </mesh>
      <mesh position={[0, 1, 0]}>
        <sphereGeometry args={[1.45, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color="#8af6ff" emissive="#42d5ff" emissiveIntensity={0.4} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, -0.7, 0]}>
        <ringGeometry args={[2.2, 3.5, 36]} />
        <meshStandardMaterial color="#8ee7ff" emissive="#53d8ff" emissiveIntensity={0.45} side={2} />
      </mesh>
    </group>
  )
}

function CalibrationShadowRail() {
  const lane = PARADE_LANES[2] || { y: -0.27, z: 1.0 }
  const railLength = Math.abs(START_X - EXIT_X) + 8
  const markerCount = 13
  const markerXs = Array.from({ length: markerCount }, (_, index) => {
    const t = markerCount <= 1 ? 0 : index / (markerCount - 1)
    return -railLength / 2 + t * railLength
  })

  return (
    <group position={[0, lane.y - 0.36, lane.z]}>
      <mesh rotation-x={-Math.PI / 2}>
        <planeGeometry args={[railLength, 2.8]} />
        <meshStandardMaterial color="#0d1020" transparent opacity={0.62} />
      </mesh>

      <mesh position={[0, 0.01, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[railLength, 1.7]} />
        <meshStandardMaterial color="#2f3a63" emissive="#1c2e5a" emissiveIntensity={0.3} transparent opacity={0.84} />
      </mesh>

      <mesh position={[0, 0.02, -0.78]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[railLength, 0.05]} />
        <meshStandardMaterial color="#9ad3ff" emissive="#78c5ff" emissiveIntensity={0.45} transparent opacity={0.9} />
      </mesh>

      <mesh position={[0, 0.02, 0.78]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[railLength, 0.05]} />
        <meshStandardMaterial color="#9ad3ff" emissive="#78c5ff" emissiveIntensity={0.45} transparent opacity={0.9} />
      </mesh>

      {markerXs.map((x) => (
        <mesh key={x} position={[x, 0.03, 0]} rotation-x={-Math.PI / 2}>
          <planeGeometry args={[0.9, 0.08]} />
          <meshStandardMaterial color="#cde8ff" emissive="#8bcfff" emissiveIntensity={0.35} transparent opacity={0.75} />
        </mesh>
      ))}
    </group>
  )
}

function buildLatestFaceEndpoint() {
  try {
    return new URL('/api/faces/latest', SOCKET_SERVER_URL).toString()
  } catch {
    return `${SOCKET_SERVER_URL.replace(/\/$/, '')}/api/faces/latest`
  }
}

function pickConveyorAnimation() {
  const index = Math.floor(Math.random() * CONVEYOR_ANIMATIONS.length)
  return CONVEYOR_ANIMATIONS[index] || 'idle'
}

async function isValidGlbFile(url) {
  try {
    const head = await fetch(url, { method: 'HEAD', cache: 'no-store' })
    if (!head.ok) return false

    const contentType = (head.headers.get('content-type') || '').toLowerCase()
    if (contentType.includes('text/html')) return false
    const contentLength = Number(head.headers.get('content-length') || 0)
    if (!Number.isFinite(contentLength) || contentLength <= 1024) return false

    return contentType.includes('model/gltf-binary') || contentType.includes('application/octet-stream')
  } catch {
    return false
  }
}

function createQueuedPlayerEntity(payload, laneIndex, laneBackOffset) {
  const lane = PARADE_LANES[laneIndex] || PARADE_LANES[0]
  const playerId = String(payload?.playerId || `queued-${Date.now()}-${Math.floor(Math.random() * 10000)}`)
  const characterType = String(payload?.characterType || 'human')
  const faceImageBase64 = String(payload?.faceImageBase64 || '')
  // LAN/offline runtime: use socket-transferred base64 directly, no URL dependency.
  const faceTextureUrl = faceImageBase64

  return {
    playerId,
    stationId: String(payload?.stationId || 'station-unknown'),
    characterType,
    faceImageBase64,
    faceTextureUrl,
    createdAt: payload?.createdAt || new Date().toISOString(),
    laneIndex,
    laneY: lane.y,
    laneZ: lane.z,
    spawnX: START_X + laneBackOffset * LANE_SPAWN_GAP,
    speed: 2.2 + Math.random() * 1.1,
    paradeAnimation: pickConveyorAnimation(),
  }
}

function normalizeQueuedPayload(payload) {
  const playerId = String(payload?.playerId || '')
  if (!playerId) return null

  return {
    ...payload,
    playerId,
  }
}

function MovingParadeCharacter({ player, onExit, forceBlackFace, faceCalibration, modelScale }) {
  const moverRef = useRef(null)
  const xRef = useRef(player.spawnX)
  const hasExitedRef = useRef(false)
  const normalizedType = String(player.characterType || '').trim().toLowerCase()
  const isAlien = normalizedType === 'alien'

  useFrame((_, delta) => {
    if (hasExitedRef.current) {
      return
    }

    xRef.current -= player.speed * delta

    if (moverRef.current) {
      moverRef.current.position.x = xRef.current
    }

    if (xRef.current < EXIT_X) {
      hasExitedRef.current = true
      onExit(player.playerId)
    }
  })

  const resolvedFaceTextureUrl = forceBlackFace
    ? BLACK_FACE_DATA_URL
    : player.faceTextureUrl || player.faceImageBase64 || ''

  return (
    <group
      ref={moverRef}
      position={[player.spawnX, player.laneY, player.laneZ]}
      scale={[PARADE_CHARACTER_SCALE, PARADE_CHARACTER_SCALE, PARADE_CHARACTER_SCALE]}
    >
      {isAlien ? (
        <Suspense
          fallback={null}
        >
          <AlienGlbCharacter
            position={[0, 0, 0]}
            paradeAnimation={player.paradeAnimation || 'idle'}
            animationSpeed={Math.max(0.85, player.speed * 0.4)}
            faceTextureUrl={resolvedFaceTextureUrl}
            faceCalibration={faceCalibration}
            modelScale={modelScale}
          />
        </Suspense>
      ) : (
        <ParadeCharacter
          characterType={player.characterType}
          faceTextureUrl={resolvedFaceTextureUrl}
          position={[0, 0, 0]}
          isWalking={false}
          walkSpeed={player.speed}
          paradeAnimation={player.paradeAnimation || 'idle'}
        />
      )}
    </group>
  )
}

function MainMoonScene({ activePlayers, onPlayerExit, forceBlackFace, faceCalibration, modelScale }) {
  return (
    <>
      <fog attach="fog" args={["#040712", 55, 160]} />

      <ambientLight intensity={0.72} />
      <directionalLight position={[14, 18, 6]} intensity={1.1} castShadow />
      <pointLight position={[-8, 6, -10]} intensity={1.7} color="#5deaff" distance={34} />

      <UfoPlaceholder />

      {activePlayers.map((player) => (
        <MovingParadeCharacter
          key={player.playerId}
          player={player}
          onExit={onPlayerExit}
          forceBlackFace={forceBlackFace}
          faceCalibration={faceCalibration}
          modelScale={modelScale}
        />
      ))}
    </>
  )
}

function CalibrationPreviewScene({ faceCalibration, calibrationFaceTextureUrl, modelScale }) {
  return (
    <>
      <fog attach="fog" args={["#040712", 55, 160]} />
      <ambientLight intensity={0.78} />
      <directionalLight position={[14, 18, 6]} intensity={1.2} castShadow />
      <pointLight position={[-8, 6, -10]} intensity={1.7} color="#5deaff" distance={34} />

      <UfoPlaceholder />
      <CalibrationShadowRail />

      <Suspense
        fallback={null}
      >
        <AlienGlbCharacter
          position={[0, -0.4, 1.0]}
          paradeAnimation="idle"
          animationSpeed={1}
          faceTextureUrl={calibrationFaceTextureUrl}
          faceCalibration={faceCalibration}
          modelScale={modelScale}
          forceFallbackFace={!calibrationFaceTextureUrl}
        />
      </Suspense>
    </>
  )
}

function CalibrationSlider({ label, value, min, max, step, onChange }) {
  return (
    <label className="face-calibration-row">
      <span>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <strong>{Number(value).toFixed(2)}</strong>
    </label>
  )
}

function MainDisplayPage() {
  const socketRef = useRef(null)
  const laneCursorRef = useRef(0)
  const alienGlbReadyRef = useRef(false)
  const activePlayersRef = useRef([])
  const isFaceCalibrationMode = useMemo(() => {
    const search = new URLSearchParams(window.location.search)
    return search.get('calibrateFace') === '1'
      || search.get('calibrate') === 'face'
      || search.get('mode') === 'face-calibration'
  }, [])

  const [activePlayers, setActivePlayers] = useState([])
  const [pendingPlayers, setPendingPlayers] = useState([])
  const [connectionState, setConnectionState] = useState('connecting')
  const [socketId, setSocketId] = useState('')
  const [lastQueuedPlayerId, setLastQueuedPlayerId] = useState('')
  const [isAlienGlbReady, setIsAlienGlbReady] = useState(false)
  const [faceCalibration, setFaceCalibration] = useState(() => loadAlienFaceCalibration())
  const [calibrationNotice, setCalibrationNotice] = useState('')
  const [calibrationFaceTextureUrl, setCalibrationFaceTextureUrl] = useState('')
  const [calibrationFaceFileName, setCalibrationFaceFileName] = useState('')
  const forceBlackFace = DEBUG_FORCE_BLACK_FACE
  const alienModelScale = Number(faceCalibration?.modelScale || DEFAULT_ALIEN_FACE_CALIBRATION.modelScale || 1)

  useEffect(() => {
    alienGlbReadyRef.current = isAlienGlbReady
  }, [isAlienGlbReady])

  useEffect(() => {
    activePlayersRef.current = activePlayers
  }, [activePlayers])

  useEffect(() => {
    if (!isFaceCalibrationMode) return undefined

    let isCancelled = false
    const latestFaceEndpoint = buildLatestFaceEndpoint()

    const loadCalibrationFace = async () => {
      try {
        const response = await fetch(latestFaceEndpoint, { cache: 'no-store' })
        const payload = await response.json()
        if (!response.ok || !payload?.ok || !payload?.faceImageBase64) {
          if (isCancelled) return
          setCalibrationFaceTextureUrl('')
          setCalibrationFaceFileName('')
          return
        }

        if (isCancelled) return
        setCalibrationFaceTextureUrl(String(payload.faceImageBase64 || ''))
        setCalibrationFaceFileName(String(payload.fileName || ''))
      } catch {
        if (isCancelled) return
        setCalibrationFaceTextureUrl('')
        setCalibrationFaceFileName('')
      }
    }

    void loadCalibrationFace()
    return () => {
      isCancelled = true
    }
  }, [isFaceCalibrationMode])

  useEffect(() => {
    let isMounted = true
    let retryTimerId = null
    let retryCount = 0
    const MAX_RETRIES = 8

    const checkAlienFiles = async () => {
      const fileUrls = Object.values(ALIEN_GLB_FILES)
      const checks = await Promise.all(fileUrls.map((url) => isValidGlbFile(url)))
      const ready = checks.every(Boolean)

      if (!isMounted) return

      setIsAlienGlbReady(ready)

      if (!ready && retryCount < MAX_RETRIES) {
        retryCount += 1
        retryTimerId = window.setTimeout(() => {
          void checkAlienFiles()
        }, 1200)
      }
    }

    void checkAlienFiles()
    return () => {
      isMounted = false
      if (retryTimerId) {
        window.clearTimeout(retryTimerId)
      }
    }
  }, [])

  const handlePlayerExit = useCallback((playerId) => {
    setActivePlayers((previous) => previous.filter((player) => player.playerId !== playerId))
  }, [])

  const enqueuePendingPlayers = useCallback((payloads) => {
    const incoming = (Array.isArray(payloads) ? payloads : [payloads])
      .map((payload) => normalizeQueuedPayload(payload))
      .filter(Boolean)

    if (incoming.length === 0) return

    setPendingPlayers((previous) => {
      const activeIds = new Set(activePlayersRef.current.map((player) => player.playerId))
      const knownIds = new Set(previous.map((player) => player.playerId))
      const merged = [...previous]

      incoming.forEach((payload) => {
        if (activeIds.has(payload.playerId) || knownIds.has(payload.playerId)) {
          return
        }
        knownIds.add(payload.playerId)
        merged.push(payload)
      })

      return merged
    })
  }, [])

  useEffect(() => {
    if (isFaceCalibrationMode) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setPendingPlayers((previous) => {
        if (previous.length === 0) return previous
        if (activePlayersRef.current.length >= MAX_ACTIVE_CHARACTERS) return previous

        const [nextPayload, ...rest] = previous
        const laneIndex = laneCursorRef.current % PARADE_LANES.length
        laneCursorRef.current += 1

        const nextPlayerId = String(nextPayload?.playerId || '')
        const liveSocket = socketRef.current
        if (nextPlayerId && liveSocket?.connected) {
          liveSocket.emit('player:dequeue', { playerId: nextPlayerId })
        }

        setActivePlayers((currentActive) => {
          const laneCount = currentActive.filter((player) => player.laneIndex === laneIndex).length
          const queuedPlayer = createQueuedPlayerEntity(nextPayload, laneIndex, laneCount)
          setLastQueuedPlayerId(queuedPlayer.playerId)

          const deduped = currentActive.filter((player) => player.playerId !== queuedPlayer.playerId)
          return [...deduped, queuedPlayer].slice(-MAX_ACTIVE_CHARACTERS)
        })

        return rest
      })
    }, SPAWN_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isFaceCalibrationMode])

  const statusText = useMemo(() => {
    if (isFaceCalibrationMode) return 'Calibration'
    if (connectionState === 'connected') return 'Connected'
    if (connectionState === 'connecting') return 'Connecting'
    return 'Disconnected'
  }, [connectionState, isFaceCalibrationMode])

  useEffect(() => {
    if (isFaceCalibrationMode) {
      return undefined
    }

    const socket = io(SOCKET_SERVER_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
    })
    socketRef.current = socket

    const handleConnect = () => {
      setConnectionState('connected')
      setSocketId(socket.id || '')
    }

    const handleDisconnect = () => {
      setConnectionState('disconnected')
      setSocketId('')
    }

    const handleConnectError = () => {
      setConnectionState('disconnected')
      setSocketId('')
    }

    const handlePlayerQueued = (payload) => {
      enqueuePendingPlayers(payload)
    }

    const handleQueueSnapshot = (payload) => {
      const queuePlayers = payload?.players || []
      enqueuePendingPlayers(queuePlayers)
    }

    const handlePlayerDequeued = (payload) => {
      const playerId = String(payload?.playerId || '')
      if (!playerId) return

      setPendingPlayers((previous) => previous.filter((player) => player.playerId !== playerId))
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleConnectError)
    socket.on('player:queued', handlePlayerQueued)
    socket.on('queue:snapshot', handleQueueSnapshot)
    socket.on('player:dequeued', handlePlayerDequeued)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleConnectError)
      socket.off('player:queued', handlePlayerQueued)
      socket.off('queue:snapshot', handleQueueSnapshot)
      socket.off('player:dequeued', handlePlayerDequeued)
      socket.disconnect()
      socketRef.current = null
    }
  }, [enqueuePendingPlayers, isFaceCalibrationMode])

  const updateCalibrationField = useCallback((profileKey, field, value) => {
    setFaceCalibration((previous) => {
      const next = {
        ...previous,
        [profileKey]: {
          ...(previous?.[profileKey] || DEFAULT_ALIEN_FACE_CALIBRATION[profileKey]),
          [field]: value,
        },
      }
      return next
    })
    setCalibrationNotice('Unsaved changes')
  }, [])

  const updateModelScale = useCallback((value) => {
    setFaceCalibration((previous) => ({
      ...previous,
      modelScale: value,
    }))
    setCalibrationNotice('Unsaved changes')
  }, [])

  const handleSaveCalibration = useCallback(() => {
    const saved = saveAlienFaceCalibration(faceCalibration)
    setFaceCalibration(saved)
    setCalibrationNotice('Saved for all Alien GLB players')
  }, [faceCalibration])

  const handleReloadSavedCalibration = useCallback(() => {
    setFaceCalibration(loadAlienFaceCalibration())
    setCalibrationNotice('Loaded saved calibration')
  }, [])

  const handleResetCalibration = useCallback(() => {
    const defaults = clearAlienFaceCalibration()
    setFaceCalibration(defaults)
    setCalibrationNotice('Reset to default calibration')
  }, [])

  return (
    <main className="main-display-page">
      <div className="main-display-canvas-wrap">
        <Canvas
          shadows
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          camera={{ position: [0, 7, 26], fov: 36, near: 0.1, far: 320 }}
        >
          {isFaceCalibrationMode ? (
            <CalibrationPreviewScene
              faceCalibration={faceCalibration}
              calibrationFaceTextureUrl={calibrationFaceTextureUrl}
              modelScale={alienModelScale}
            />
          ) : (
            <MainMoonScene
              activePlayers={activePlayers}
              onPlayerExit={handlePlayerExit}
              forceBlackFace={forceBlackFace}
              faceCalibration={faceCalibration}
              modelScale={alienModelScale}
            />
          )}
        </Canvas>
      </div>

      <div className="main-display-overlay">
        <p className="main-display-route">Route: /main</p>
        {isFaceCalibrationMode ? <p className="main-display-route">Mode: Alien Face Calibration</p> : null}
        <h1 className="main-display-title">Moonwalk Selfie Parade</h1>
        <div className="main-display-debug">
          <p>Status: <strong>{statusText}</strong></p>
          <p>Server: {SOCKET_SERVER_URL}</p>
          <p>Socket ID: {socketId || 'n/a'}</p>
          <p>Active Characters: {activePlayers.length}/10</p>
          <p>Pending Queue: {pendingPlayers.length}</p>
          <p>Spawn Gap: {SPAWN_INTERVAL_MS / 1000}s</p>
          <p>Alien GLB: {isAlienGlbReady ? 'ready' : 'loading or missing (no placeholder fallback)'}</p>
          <p>Face Test: {forceBlackFace ? 'black override ON' : 'live selfie'}</p>
          <p>Alien Model Scale: {alienModelScale.toFixed(2)}x</p>
          {isFaceCalibrationMode ? (
            <p>
              Calibration Face: {calibrationFaceFileName ? `storage/faces/${calibrationFaceFileName}` : 'fallback test face'}
            </p>
          ) : null}
          <p>Last Queued Player: {lastQueuedPlayerId || 'none'}</p>
        </div>
      </div>

      {isFaceCalibrationMode ? (
        <section className="face-calibration-panel">
          <h2>Alien Face Calibration</h2>
          <p>Adjust until the test face fully covers the alien helmet white circle.</p>
          <p className="face-calibration-hint">URL: <code>/main?calibrateFace=1</code></p>
          <img
            className="face-calibration-default-face"
            src={CALIBRATION_DEFAULT_FACE_TEXTURE_URL}
            alt="Default test face texture for calibration"
          />

          <h3>Front Anchor</h3>
          <CalibrationSlider
            label="Model Size"
            min={0.6}
            max={2.2}
            step={0.05}
            value={alienModelScale}
            onChange={updateModelScale}
          />
          <CalibrationSlider
            label="X"
            min={-20}
            max={20}
            step={0.1}
            value={faceCalibration.front.x}
            onChange={(value) => updateCalibrationField('front', 'x', value)}
          />
          <CalibrationSlider
            label="Y"
            min={-20}
            max={20}
            step={0.1}
            value={faceCalibration.front.y}
            onChange={(value) => updateCalibrationField('front', 'y', value)}
          />
          <CalibrationSlider
            label="Z"
            min={-20}
            max={20}
            step={0.1}
            value={faceCalibration.front.z}
            onChange={(value) => updateCalibrationField('front', 'z', value)}
          />
          <CalibrationSlider
            label="Width"
            min={1}
            max={30}
            step={0.1}
            value={faceCalibration.front.width}
            onChange={(value) => updateCalibrationField('front', 'width', value)}
          />
          <CalibrationSlider
            label="Height"
            min={1}
            max={30}
            step={0.1}
            value={faceCalibration.front.height}
            onChange={(value) => updateCalibrationField('front', 'height', value)}
          />

          <h3>Fallback Anchor</h3>
          <CalibrationSlider
            label="X"
            min={-20}
            max={20}
            step={0.1}
            value={faceCalibration.fallback.x}
            onChange={(value) => updateCalibrationField('fallback', 'x', value)}
          />
          <CalibrationSlider
            label="Y"
            min={-20}
            max={20}
            step={0.1}
            value={faceCalibration.fallback.y}
            onChange={(value) => updateCalibrationField('fallback', 'y', value)}
          />
          <CalibrationSlider
            label="Z"
            min={-20}
            max={20}
            step={0.1}
            value={faceCalibration.fallback.z}
            onChange={(value) => updateCalibrationField('fallback', 'z', value)}
          />
          <CalibrationSlider
            label="Width"
            min={1}
            max={30}
            step={0.1}
            value={faceCalibration.fallback.width}
            onChange={(value) => updateCalibrationField('fallback', 'width', value)}
          />
          <CalibrationSlider
            label="Height"
            min={1}
            max={30}
            step={0.1}
            value={faceCalibration.fallback.height}
            onChange={(value) => updateCalibrationField('fallback', 'height', value)}
          />

          <div className="face-calibration-actions">
            <button type="button" className="face-calibration-button primary" onClick={handleSaveCalibration}>Save</button>
            <button type="button" className="face-calibration-button" onClick={handleReloadSavedCalibration}>Reload Saved</button>
            <button type="button" className="face-calibration-button" onClick={handleResetCalibration}>Reset Default</button>
          </div>
          <p className="face-calibration-status">{calibrationNotice || 'Ready'}</p>
        </section>
      ) : null}
    </main>
  )
}

export default MainDisplayPage
