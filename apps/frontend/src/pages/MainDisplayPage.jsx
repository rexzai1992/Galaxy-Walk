import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { CanvasTexture, MathUtils, SRGBColorSpace, Vector3 } from 'three'
import { Html, TransformControls } from '@react-three/drei'
import { io } from 'socket.io-client'
import { useLocation } from 'react-router-dom'
import AvatarCharacter from '../components/avatar/AvatarCharacter.jsx'
import AvatarLighting from '../components/avatar/AvatarLighting.jsx'
import GroundShadow from '../components/avatar/GroundShadow.jsx'
import { CHARACTER_VARIANTS, resolveCharacterVariant } from '../components/avatar/characterVariants'
import { ANIMATED_CHARACTER_GLB_URLS, CHARACTER_GLB_URL } from '../components/main/alienGlbConfig'
import {
  ALIEN_FACE_CALIBRATION_STORAGE_KEY,
  DEFAULT_ALIEN_FACE_CALIBRATION,
  HEAD_CALIBRATION_LIMITS,
  clearAlienFaceCalibration,
  loadAlienFaceCalibration,
  saveAlienFaceCalibration,
} from '../lib/alienFaceCalibration'
import { SOCKET_SERVER_URL } from '../lib/socket'

// Characters on screen at once: 10 on a single TV, more on a wide video wall
// (roughly one per 7 units of parade width) so the queue keeps moving.
const MIN_ACTIVE_CHARACTERS = 10
const MAX_ACTIVE_CHARACTERS = 20
const PARADE_UNITS_PER_CHARACTER = 7
const MAX_PENDING_QUEUE_PLAYERS = 200
const LANE_SPAWN_GAP = 2.4
const GLOBAL_SPAWN_GAP = 1.8
const SPAWN_INTERVAL_MS = 3000
const PARADE_CHARACTER_SCALE = 1.2
// How far past the visible screen edge characters spawn / despawn (route units).
const SCREEN_EDGE_MARGIN = 4
const DEFAULT_PARADE_BOUNDS = { startX: 22, exitX: -22 }
// Height of the name tag above the feet, in character model units.
const NAME_TAG_HEIGHT = 4.25
// Dance party: every character keeps switching moves at random, throws in
// spins/hops/wiggles, and the whole parade bobs on one shared beat. Every
// 35-55 s a synchronised "Dance Break" stops everyone for a group dance.
const CONVEYOR_ANIMATIONS = ['dance', 'dance', 'pose', 'pose', 'wave', 'idle']
const MOVE_SECONDS = [3, 6]
const FLOURISH_SECONDS = [4, 9]
const FLOURISHES = [
  { type: 'spin', duration: 0.9 },
  { type: 'hop', duration: 0.7 },
  { type: 'wiggle', duration: 1.1 },
  { type: 'spin', duration: 0.9 },
]
const BEATS_PER_SECOND = 2
const BEAT_BOB_HEIGHT = 0.07
const DANCE_BREAK_EVERY_SECONDS = [35, 55]
const DANCE_BREAK_SECONDS = 7.5
const DANCE_BREAK_MOVES = ['dance', 'pose']
const DANCE_BREAK_MIN_CHARACTERS = 2
const FACE_DEBUG_DEFAULT = {
  modelLoaded: false,
  headBoneFound: false,
  imageLoaded: false,
  characterVariant: '',
  currentAnimationName: '',
  animationNames: [],
}
const CALIBRATION_ANIMATION_OPTIONS = [
  { value: 'idle', label: 'Idle' },
  { value: 'wave', label: 'Wave' },
  { value: 'dance', label: 'Dance' },
  { value: 'pose', label: 'Pose' },
]
const CALIBRATION_CHARACTER_OPTIONS = Object.values(CHARACTER_VARIANTS).map((variant) => ({
  value: variant.id,
  label: variant.label,
}))
const CALIBRATION_TRANSFORM_MODE_OPTIONS = [
  { value: 'translate', label: 'Move' },
  { value: 'rotate', label: 'Rotate' },
]
const CALIBRATION_TRANSFORM_TARGET_OPTIONS = [
  { value: 'character', label: 'Character' },
  { value: 'route', label: 'Route' },
]
const HEAD_SLIDERS = [
  { key: 'scale', label: 'Head Size', step: 0.01 },
  { key: 'y', label: 'Head Up', step: 0.005 },
  { key: 'z', label: 'Head Fwd', step: 0.005 },
  { key: 'x', label: 'Head Side', step: 0.005 },
  { key: 'faceZoom', label: 'Face Zoom', step: 0.01 },
  { key: 'faceY', label: 'Face Up', step: 0.005 },
]
// Camera framing that calibration was done with (16:9). Wider screens keep the
// same vertical framing but use a longer lens so the edges are not stretched.
const BASE_CAMERA_POSITION = new Vector3(0, 7, 26)
const BASE_CAMERA_FOV = 36
const MAX_HORIZONTAL_FOV = 60
const MAIN_BACKGROUND_VIDEO_PLAYLIST_ENDPOINT = '/backgrounds/videos/playlist.json'
const MAIN_BACKGROUND_SWITCH_MS = 3 * 60 * 1000
const MAIN_BACKGROUND_DEFAULT_VIDEO_URLS = []

// Each lane has its own fixed speed so characters in the same lane never
// walk through each other.
const PARADE_LANES = [
  { y: -0.27, z: 3.2, speed: 2.5 },
  { y: -0.27, z: 2.1, speed: 2.25 },
  { y: -0.27, z: 1.0, speed: 2.75 },
  { y: -0.27, z: -0.1, speed: 2.4 },
  { y: -0.27, z: -1.2, speed: 2.9 },
  { y: -0.27, z: -2.3, speed: 2.6 },
]
const FARTHEST_LANE = PARADE_LANES.reduce((far, lane) => (lane.z < far.z ? lane : far), PARADE_LANES[0])

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function activeLimitForEdge(edgeX) {
  return Math.round(clamp((2 * edgeX) / PARADE_UNITS_PER_CHARACTER, MIN_ACTIVE_CHARACTERS, MAX_ACTIVE_CHARACTERS))
}

function formatTicket(ticketNumber) {
  const n = Number(ticketNumber || 0)
  return n > 0 ? `#${String(n).padStart(3, '0')}` : ''
}

function normalizeBackgroundVideoUrls(input) {
  if (!Array.isArray(input)) return []
  return input
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

function parseBackgroundPlaylistPayload(payload) {
  if (Array.isArray(payload)) {
    return normalizeBackgroundVideoUrls(payload)
  }
  return normalizeBackgroundVideoUrls(payload?.videos)
}

function MainDisplayBackgroundVideo() {
  const videoRef = useRef(null)
  const [playlist, setPlaylist] = useState(() => normalizeBackgroundVideoUrls(MAIN_BACKGROUND_DEFAULT_VIDEO_URLS))
  const [videoIndex, setVideoIndex] = useState(0)
  const [readyVideoSrc, setReadyVideoSrc] = useState('')
  const [errorVideoSrc, setErrorVideoSrc] = useState('')

  const activeVideoSrc = useMemo(() => {
    if (playlist.length === 0) return ''
    return playlist[videoIndex % playlist.length] || ''
  }, [playlist, videoIndex])

  useEffect(() => {
    let isCancelled = false

    const loadPlaylist = async () => {
      try {
        const response = await fetch(MAIN_BACKGROUND_VIDEO_PLAYLIST_ENDPOINT, { cache: 'no-store' })
        if (!response.ok) return
        const payload = await response.json()
        const urls = parseBackgroundPlaylistPayload(payload)
        if (urls.length === 0 || isCancelled) return
        setPlaylist(urls)
        setVideoIndex(0)
      } catch {
        // Keep fallback image if playlist file does not exist yet.
      }
    }

    void loadPlaylist()
    return () => {
      isCancelled = true
    }
  }, [])

  useEffect(() => {
    if (playlist.length <= 1) return undefined

    const intervalId = window.setInterval(() => {
      setVideoIndex((previous) => (previous + 1) % playlist.length)
    }, MAIN_BACKGROUND_SWITCH_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [playlist])

  useEffect(() => {
    const videoElement = videoRef.current
    if (!videoElement || !activeVideoSrc) return

    const playPromise = videoElement.play()
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {})
    }
  }, [activeVideoSrc])

  const shouldShowVideo = Boolean(
    activeVideoSrc
    && readyVideoSrc === activeVideoSrc
    && errorVideoSrc !== activeVideoSrc,
  )

  return (
    <div className="main-display-bg-media" aria-hidden="true">
      {activeVideoSrc ? (
        <video
          ref={videoRef}
          className={`main-display-bg-video ${shouldShowVideo ? 'is-ready' : ''}`}
          src={activeVideoSrc}
          autoPlay
          muted
          playsInline
          loop
          preload="auto"
          onCanPlay={() => {
            setReadyVideoSrc(activeVideoSrc)
            if (errorVideoSrc === activeVideoSrc) {
              setErrorVideoSrc('')
            }
          }}
          onError={() => {
            setErrorVideoSrc(activeVideoSrc)
          }}
        />
      ) : null}
      <div className="main-display-bg-overlay"></div>
    </div>
  )
}

function CalibrationShadowRail() {
  const lane = PARADE_LANES[2]
  const railLength = 52
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

function buildFaceTextureUrl(payload) {
  const inlineBase64 = String(payload?.faceImageBase64 || '')
  if (inlineBase64) {
    return inlineBase64
  }

  const directUrl = String(payload?.faceImageUrl || '')
  if (!directUrl) {
    return ''
  }

  try {
    return new URL(directUrl, SOCKET_SERVER_URL).toString()
  } catch {
    if (directUrl.startsWith('http://') || directUrl.startsWith('https://')) {
      return directUrl
    }
    return `${SOCKET_SERVER_URL.replace(/\/$/, '')}/${directUrl.replace(/^\//, '')}`
  }
}

function randomBetween([min, max]) {
  return min + Math.random() * (max - min)
}

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function pickConveyorAnimation(previous) {
  // Avoid repeating the same move back to back.
  const options = CONVEYOR_ANIMATIONS.filter((move) => move !== previous)
  return pickRandom(options.length > 0 ? options : CONVEYOR_ANIMATIONS)
}

function createCheckerFaceTexture() {
  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const cell = 64
  for (let y = 0; y < size; y += cell) {
    for (let x = 0; x < size; x += cell) {
      const isEven = ((x / cell) + (y / cell)) % 2 === 0
      ctx.fillStyle = isEven ? '#63dcff' : '#153876'
      ctx.fillRect(x, y, cell, cell)
    }
  }
  ctx.strokeStyle = '#ffffff'
  ctx.lineWidth = 16
  ctx.strokeRect(0, 0, size, size)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.needsUpdate = true

  return {
    texture,
    previewUrl: canvas.toDataURL('image/png'),
  }
}

function captureVideoFrameDataUrl(videoElement) {
  if (!videoElement) return ''
  const width = videoElement.videoWidth || 0
  const height = videoElement.videoHeight || 0
  if (width <= 0 || height <= 0) return ''

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.drawImage(videoElement, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', 0.92)
}

function isCharacterCalibrationSearch(search) {
  return search.get('calibrateFace') === '1'
    || search.get('calibrateCharacter') === '1'
    || search.get('calibrate') === 'face'
    || search.get('calibrate') === 'character'
    || search.get('mode') === 'face-calibration'
    || search.get('mode') === 'character-calibration'
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

function createQueuedPlayerEntity(payload, laneIndex, laneBackOffset, globalBackOffset, startX) {
  const lane = PARADE_LANES[laneIndex] || PARADE_LANES[0]
  const playerId = String(payload?.playerId || `queued-${Date.now()}-${Math.floor(Math.random() * 10000)}`)

  return {
    playerId,
    stationId: String(payload?.stationId || 'station-unknown'),
    characterType: resolveCharacterVariant(payload?.characterType).id,
    ticketNumber: Number(payload?.ticketNumber || 0),
    faceTextureUrl: buildFaceTextureUrl(payload),
    createdAt: payload?.createdAt || new Date().toISOString(),
    laneIndex,
    laneY: lane.y,
    laneZ: lane.z,
    spawnX: startX + laneBackOffset * LANE_SPAWN_GAP + globalBackOffset * GLOBAL_SPAWN_GAP,
    speed: lane.speed,
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

// Adapts the lens to the screen shape. At 16:9 this is exactly the original
// camera; on a multi-TV wall it narrows the field of view and moves back so the
// parade keeps the same height on screen without wide-angle distortion.
function fitParadeCamera(camera, width, height) {
  if (!camera?.isPerspectiveCamera || width <= 0 || height <= 0) return
  const aspect = width / height
  const maxVerticalFov = MathUtils.radToDeg(
    2 * Math.atan(Math.tan(MathUtils.degToRad(MAX_HORIZONTAL_FOV / 2)) / aspect),
  )
  const fov = Math.min(BASE_CAMERA_FOV, maxVerticalFov)
  const distance = BASE_CAMERA_POSITION.length()
    * Math.tan(MathUtils.degToRad(BASE_CAMERA_FOV / 2))
    / Math.tan(MathUtils.degToRad(fov / 2))

  camera.fov = fov
  camera.aspect = aspect
  camera.far = Math.max(320, distance * 3)
  camera.position.copy(BASE_CAMERA_POSITION).setLength(distance)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()
}

function ParadeCamera() {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)

  useLayoutEffect(() => {
    fitParadeCamera(camera, size.width, size.height)
  }, [camera, size.width, size.height])

  return null
}

// Keeps spawn/exit just outside the visible area for any screen shape
// (single TV or a multi-TV video wall).
function ParadeBoundsTracker({ boundsRef, paradeRouteOffset, paradeRouteRotation, paradeScale, onBoundsChange }) {
  const camera = useThree((state) => state.camera)
  const size = useThree((state) => state.size)
  const viewport = useThree((state) => state.viewport)

  useEffect(() => {
    const farLaneWorld = new Vector3(
      paradeRouteOffset.x,
      paradeRouteOffset.y + FARTHEST_LANE.y,
      paradeRouteOffset.z + FARTHEST_LANE.z,
    )
    const { width } = viewport.getCurrentViewport(camera, farLaneWorld, size)
    const routeCos = Math.max(0.35, Math.abs(Math.cos(MathUtils.degToRad(paradeRouteRotation.y))))
    const halfWidth = (width / 2 + Math.abs(paradeRouteOffset.x)) / routeCos
    const edge = halfWidth + SCREEN_EDGE_MARGIN * Math.max(1, paradeScale)
    boundsRef.current = { startX: edge, exitX: -edge }
    onBoundsChange?.(edge)
  }, [
    boundsRef,
    onBoundsChange,
    camera,
    size,
    viewport,
    paradeRouteOffset.x,
    paradeRouteOffset.y,
    paradeRouteOffset.z,
    paradeRouteRotation.y,
    paradeScale,
  ])

  return null
}

function MovingParadeCharacter({
  player,
  boundsRef,
  onExit,
  modelScale,
  paradeScale,
  animationSpeedMultiplier,
  characterOffset,
  characterRotation,
  headCalibration,
  showNameTag,
  danceBreak,
}) {
  const moverRef = useRef(null)
  const flairRef = useRef(null)
  const xRef = useRef(player.spawnX)
  const hasExitedRef = useRef(false)
  const speedFactorRef = useRef(1)
  const flourishRef = useRef(null)
  const clockRef = useRef(0)
  const wasOnBreakRef = useRef(false)
  const [move, setMove] = useState(player.paradeAnimation)
  const ticketLabel = formatTicket(player.ticketNumber)
  const scale = PARADE_CHARACTER_SCALE * paradeScale
  const isOnBreak = Boolean(danceBreak)

  // Random move changes and flourishes while walking.
  useEffect(() => {
    if (isOnBreak) return undefined
    let moveTimer = null
    let flourishTimer = null
    const scheduleMove = () => {
      moveTimer = window.setTimeout(() => {
        setMove((previous) => pickConveyorAnimation(previous))
        scheduleMove()
      }, randomBetween(MOVE_SECONDS) * 1000)
    }
    const scheduleFlourish = () => {
      flourishTimer = window.setTimeout(() => {
        flourishRef.current = { ...pickRandom(FLOURISHES), start: clockRef.current }
        scheduleFlourish()
      }, randomBetween(FLOURISH_SECONDS) * 1000)
    }
    scheduleMove()
    scheduleFlourish()
    return () => {
      window.clearTimeout(moveTimer)
      window.clearTimeout(flourishTimer)
    }
  }, [isOnBreak])

  // Everyone hops into the dance break and spins out of it.
  useEffect(() => {
    if (isOnBreak) flourishRef.current = { type: 'hop', duration: 0.7, start: clockRef.current }
    else if (wasOnBreakRef.current) flourishRef.current = { type: 'spin', duration: 0.9, start: clockRef.current }
    wasOnBreakRef.current = isOnBreak
  }, [isOnBreak, danceBreak?.id])

  useFrame((state, delta) => {
    clockRef.current = state.clock.elapsedTime
    if (hasExitedRef.current) return

    // Ease to a stop for the dance break and back to walking afterwards.
    const targetSpeed = isOnBreak ? 0 : 1
    speedFactorRef.current += (targetSpeed - speedFactorRef.current) * Math.min(1, delta * 4)
    xRef.current -= player.speed * speedFactorRef.current * delta
    if (moverRef.current) {
      moverRef.current.position.x = xRef.current
    }

    const flair = flairRef.current
    if (flair) {
      const t = state.clock.elapsedTime
      // Shared beat (same clock for everyone) so the parade bobs together.
      let lift = Math.abs(Math.sin(t * Math.PI * BEATS_PER_SECOND)) * BEAT_BOB_HEIGHT
      let spin = 0
      let tilt = 0
      const flourish = flourishRef.current
      if (flourish) {
        const progress = (t - flourish.start) / flourish.duration
        if (progress >= 1 || progress < 0) {
          flourishRef.current = null
        } else if (flourish.type === 'spin') {
          spin = (1 - Math.cos(progress * Math.PI)) * Math.PI
        } else if (flourish.type === 'hop') {
          lift += Math.sin(progress * Math.PI) * 0.9
        } else if (flourish.type === 'wiggle') {
          tilt = Math.sin(progress * Math.PI * 8) * 0.2 * (1 - progress)
        }
      }
      flair.position.y = lift
      flair.rotation.set(0, spin, tilt)
    }

    if (xRef.current < boundsRef.current.exitX) {
      hasExitedRef.current = true
      onExit(player.playerId)
    }
  })

  return (
    <group ref={moverRef} position={[player.spawnX, player.laneY, player.laneZ]} scale={[scale, scale, scale]}>
      <GroundShadow width={2.6 * modelScale} depth={1.2 * modelScale} />
      <group ref={flairRef}>
        <group
          position={[characterOffset.x, characterOffset.y, characterOffset.z]}
          rotation={[
            MathUtils.degToRad(characterRotation.x),
            MathUtils.degToRad(characterRotation.y),
            MathUtils.degToRad(characterRotation.z),
          ]}
        >
          <Suspense fallback={null}>
            <AvatarCharacter
              characterType={player.characterType}
              paradeAnimation={danceBreak ? danceBreak.move : move}
              // Same speed for everyone during a break keeps the group dance in sync.
              animationSpeed={danceBreak
                ? animationSpeedMultiplier
                : Math.max(0.65, player.speed * 0.4 * animationSpeedMultiplier)}
              syncKey={danceBreak ? danceBreak.id : 0}
              faceTextureUrl={player.faceTextureUrl}
              modelScale={modelScale}
              headCalibration={headCalibration}
            />
          </Suspense>
        </group>
      </group>
      {showNameTag && ticketLabel ? (
        <Html
          position={[characterOffset.x, characterOffset.y + NAME_TAG_HEIGHT * modelScale, characterOffset.z]}
          center
          zIndexRange={[3, 0]}
          pointerEvents="none"
        >
          <div className={`parade-name-tag parade-name-tag--${player.characterType}`}>{ticketLabel}</div>
        </Html>
      ) : null}
    </group>
  )
}

function MainMoonScene({
  activePlayers,
  onPlayerExit,
  danceBreak,
  boundsRef,
  onBoundsChange,
  settings,
}) {
  const { paradeRouteOffset, paradeRouteRotation } = settings

  return (
    <>
      <ParadeCamera />
      <AvatarLighting />
      <ParadeBoundsTracker
        boundsRef={boundsRef}
        paradeRouteOffset={paradeRouteOffset}
        paradeRouteRotation={paradeRouteRotation}
        paradeScale={settings.paradeScale}
        onBoundsChange={onBoundsChange}
      />

      <group
        position={[paradeRouteOffset.x, paradeRouteOffset.y, paradeRouteOffset.z]}
        rotation={[
          MathUtils.degToRad(paradeRouteRotation.x),
          MathUtils.degToRad(paradeRouteRotation.y),
          MathUtils.degToRad(paradeRouteRotation.z),
        ]}
      >
        {activePlayers.map((player) => (
          <MovingParadeCharacter
            key={player.playerId}
            player={player}
            boundsRef={boundsRef}
            onExit={onPlayerExit}
            modelScale={settings.modelScale}
            paradeScale={settings.paradeScale}
            animationSpeedMultiplier={settings.animationSpeedMultiplier}
            characterOffset={settings.characterOffset}
            characterRotation={settings.characterRotation}
            headCalibration={settings.head}
            showNameTag={settings.showNameTags}
            danceBreak={danceBreak}
          />
        ))}
      </group>
    </>
  )
}

function CalibrationPreviewCharacter({
  characterType,
  faceTextureUrl,
  faceTexture,
  previewAnimation,
  settings,
  onCharacterDebugInfo,
}) {
  const { characterOffset, characterRotation, paradeScale } = settings
  return (
    <group
      position={[characterOffset.x, characterOffset.y, characterOffset.z]}
      rotation={[
        MathUtils.degToRad(characterRotation.x),
        MathUtils.degToRad(characterRotation.y),
        MathUtils.degToRad(characterRotation.z),
      ]}
    >
      <group scale={[paradeScale, paradeScale, paradeScale]}>
        <AvatarCharacter
          position={[0, -0.4, 1.0]}
          characterType={characterType}
          paradeAnimation={previewAnimation}
          animationSpeed={settings.animationSpeedMultiplier}
          faceTextureUrl={faceTextureUrl}
          faceTexture={faceTexture}
          modelScale={settings.modelScale}
          headCalibration={settings.head}
          onDebugInfoChange={onCharacterDebugInfo}
        />
      </group>
    </group>
  )
}

function CalibrationPreviewCharacterManipulator({
  transformMode,
  onTransformChange,
  ...previewProps
}) {
  const controlTargetRef = useRef(null)
  const isApplyingExternalRef = useRef(false)
  const { characterOffset, characterRotation } = previewProps.settings

  useEffect(() => {
    const target = controlTargetRef.current
    if (!target) return

    isApplyingExternalRef.current = true
    target.position.set(characterOffset.x, characterOffset.y, characterOffset.z)
    target.rotation.set(
      MathUtils.degToRad(characterRotation.x),
      MathUtils.degToRad(characterRotation.y),
      MathUtils.degToRad(characterRotation.z),
    )
    queueMicrotask(() => {
      isApplyingExternalRef.current = false
    })
  }, [
    characterOffset.x,
    characterOffset.y,
    characterOffset.z,
    characterRotation.x,
    characterRotation.y,
    characterRotation.z,
  ])

  const handleTransformChange = useCallback(() => {
    if (isApplyingExternalRef.current) return
    const target = controlTargetRef.current
    if (!target) return

    const nextOffset = {
      x: Number(clamp(target.position.x, -10, 10).toFixed(2)),
      y: Number(clamp(target.position.y, -10, 10).toFixed(2)),
      z: Number(clamp(target.position.z, -10, 10).toFixed(2)),
    }
    const nextRotation = {
      x: Number(clamp(MathUtils.radToDeg(target.rotation.x), -180, 180).toFixed(1)),
      y: Number(clamp(MathUtils.radToDeg(target.rotation.y), -180, 180).toFixed(1)),
      z: Number(clamp(MathUtils.radToDeg(target.rotation.z), -180, 180).toFixed(1)),
    }

    onTransformChange(nextOffset, nextRotation)
  }, [onTransformChange])

  return (
    <TransformControls
      mode={transformMode}
      showX
      showY
      showZ
      onObjectChange={handleTransformChange}
    >
      <group ref={controlTargetRef}>
        <CalibrationPreviewCharacter {...previewProps} />
      </group>
    </TransformControls>
  )
}

function CalibrationPreviewRouteManipulator({
  paradeRouteOffset,
  paradeRouteRotation,
  transformMode,
  onTransformChange,
  children,
}) {
  const controlTargetRef = useRef(null)
  const isApplyingExternalRef = useRef(false)
  const shouldRotateYOnly = transformMode === 'rotate'

  useEffect(() => {
    const target = controlTargetRef.current
    if (!target) return

    isApplyingExternalRef.current = true
    target.position.set(paradeRouteOffset.x, paradeRouteOffset.y, paradeRouteOffset.z)
    target.rotation.set(
      MathUtils.degToRad(paradeRouteRotation.x),
      MathUtils.degToRad(paradeRouteRotation.y),
      MathUtils.degToRad(paradeRouteRotation.z),
    )
    queueMicrotask(() => {
      isApplyingExternalRef.current = false
    })
  }, [
    paradeRouteOffset.x,
    paradeRouteOffset.y,
    paradeRouteOffset.z,
    paradeRouteRotation.x,
    paradeRouteRotation.y,
    paradeRouteRotation.z,
  ])

  const handleTransformChange = useCallback(() => {
    if (isApplyingExternalRef.current) return
    const target = controlTargetRef.current
    if (!target) return

    let rotX = MathUtils.radToDeg(target.rotation.x)
    const rotY = MathUtils.radToDeg(target.rotation.y)
    let rotZ = MathUtils.radToDeg(target.rotation.z)
    if (shouldRotateYOnly) {
      rotX = 0
      rotZ = 0
      target.rotation.set(0, MathUtils.degToRad(rotY), 0)
    }

    const nextOffset = {
      x: Number(clamp(target.position.x, -20, 20).toFixed(2)),
      y: Number(clamp(target.position.y, -20, 20).toFixed(2)),
      z: Number(clamp(target.position.z, -20, 20).toFixed(2)),
    }
    const nextRotation = {
      x: Number(clamp(rotX, -180, 180).toFixed(1)),
      y: Number(clamp(rotY, -180, 180).toFixed(1)),
      z: Number(clamp(rotZ, -180, 180).toFixed(1)),
    }

    onTransformChange(nextOffset, nextRotation)
  }, [onTransformChange, shouldRotateYOnly])

  return (
    <TransformControls
      mode={transformMode}
      showX={!shouldRotateYOnly}
      showY
      showZ={!shouldRotateYOnly}
      onObjectChange={handleTransformChange}
    >
      <group ref={controlTargetRef}>{children}</group>
    </TransformControls>
  )
}

function CalibrationPreviewScene({
  transformMode,
  transformTarget,
  onCharacterTransformChange,
  onRouteTransformChange,
  ...previewProps
}) {
  const { paradeRouteOffset, paradeRouteRotation } = previewProps.settings

  return (
    <>
      <ParadeCamera />
      <AvatarLighting />

      {transformTarget === 'route' ? (
        <Suspense fallback={null}>
          <CalibrationPreviewRouteManipulator
            paradeRouteOffset={paradeRouteOffset}
            paradeRouteRotation={paradeRouteRotation}
            transformMode={transformMode}
            onTransformChange={onRouteTransformChange}
          >
            <CalibrationShadowRail />
            <CalibrationPreviewCharacter {...previewProps} />
          </CalibrationPreviewRouteManipulator>
        </Suspense>
      ) : (
        <group
          position={[paradeRouteOffset.x, paradeRouteOffset.y, paradeRouteOffset.z]}
          rotation={[
            MathUtils.degToRad(paradeRouteRotation.x),
            MathUtils.degToRad(paradeRouteRotation.y),
            MathUtils.degToRad(paradeRouteRotation.z),
          ]}
        >
          <CalibrationShadowRail />
          <Suspense fallback={null}>
            <CalibrationPreviewCharacterManipulator
              transformMode={transformMode}
              onTransformChange={onCharacterTransformChange}
              {...previewProps}
            />
          </Suspense>
        </group>
      )}
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

function CalibrationSelect({ label, value, options, onChange }) {
  const activeOption = options.find((option) => option.value === value) || options[0]

  return (
    <label className="face-calibration-row">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(String(event.target.value))}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <strong>{activeOption?.label || value}</strong>
    </label>
  )
}

function MainDisplayPage() {
  const location = useLocation()
  const socketRef = useRef(null)
  const laneCursorRef = useRef(0)
  const activePlayersRef = useRef([])
  const paradeBoundsRef = useRef(DEFAULT_PARADE_BOUNDS)
  const activeLimitRef = useRef(MIN_ACTIVE_CHARACTERS)
  const cameraVideoRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const uploadedFaceUrlRef = useRef('')
  const faceSlotTextureRef = useRef(null)
  const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search])
  const isCharacterCalibrationMode = useMemo(() => isCharacterCalibrationSearch(searchParams), [searchParams])

  const [activePlayers, setActivePlayers] = useState([])
  const [pendingPlayers, setPendingPlayers] = useState([])
  const [connectionState, setConnectionState] = useState('connecting')
  const [socketId, setSocketId] = useState('')
  const [lastQueuedPlayer, setLastQueuedPlayer] = useState(null)
  const [danceBreak, setDanceBreak] = useState(null)
  const [isAlienGlbReady, setIsAlienGlbReady] = useState(false)
  const [paradeEdgeX, setParadeEdgeX] = useState(DEFAULT_PARADE_BOUNDS.startX)
  const [isDebugVisible, setIsDebugVisible] = useState(() => searchParams.get('debug') === '1')
  const [faceCalibration, setFaceCalibration] = useState(() => loadAlienFaceCalibration())
  const [previewAnimation, setPreviewAnimation] = useState('idle')
  const [previewCharacterType, setPreviewCharacterType] = useState('alien')
  const [calibrationTransformMode, setCalibrationTransformMode] = useState('translate')
  const [calibrationTransformTarget, setCalibrationTransformTarget] = useState('character')
  const [calibrationNotice, setCalibrationNotice] = useState('')
  const [calibrationFaceTextureUrl, setCalibrationFaceTextureUrl] = useState('')
  const [calibrationFaceFileName, setCalibrationFaceFileName] = useState('')
  const [uploadedFaceTextureUrl, setUploadedFaceTextureUrl] = useState('')
  const [faceSlotTexture, setFaceSlotTexture] = useState(null)
  const [facePreviewUrl, setFacePreviewUrl] = useState('')
  const [faceDebug, setFaceDebug] = useState(FACE_DEBUG_DEFAULT)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [isCameraStarting, setIsCameraStarting] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const settings = useMemo(() => ({
    ...DEFAULT_ALIEN_FACE_CALIBRATION,
    ...faceCalibration,
    head: { ...DEFAULT_ALIEN_FACE_CALIBRATION.head, ...(faceCalibration?.head || {}) },
  }), [faceCalibration])
  const effectiveFaceTextureUrl = uploadedFaceTextureUrl || calibrationFaceTextureUrl || ''
  const showDebugPanel = isDebugVisible || isCharacterCalibrationMode

  useEffect(() => {
    faceSlotTextureRef.current = faceSlotTexture
  }, [faceSlotTexture])

  useEffect(() => {
    activePlayersRef.current = activePlayers
  }, [activePlayers])

  // Press "D" on the display to toggle the operator debug panel.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return
      if (event.key === 'd' || event.key === 'D') setIsDebugVisible((previous) => !previous)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    const syncFromStorage = () => {
      setFaceCalibration(loadAlienFaceCalibration())
    }

    const handleStorage = (event) => {
      if (event.key && event.key !== ALIEN_FACE_CALIBRATION_STORAGE_KEY) return
      syncFromStorage()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        syncFromStorage()
      }
    }

    // The calibration page edits live values; only the parade view follows storage.
    if (isCharacterCalibrationMode) return undefined

    window.addEventListener('storage', handleStorage)
    window.addEventListener('focus', syncFromStorage)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.removeEventListener('storage', handleStorage)
      window.removeEventListener('focus', syncFromStorage)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [isCharacterCalibrationMode])

  const releaseUploadedFaceUrl = useCallback(() => {
    if (uploadedFaceUrlRef.current) {
      URL.revokeObjectURL(uploadedFaceUrlRef.current)
      uploadedFaceUrlRef.current = ''
    }
  }, [])

  const replaceFaceSlotTexture = useCallback((nextTexture) => {
    setFaceSlotTexture((previousTexture) => {
      if (previousTexture && previousTexture !== nextTexture) {
        previousTexture.dispose()
      }
      return nextTexture || null
    })
  }, [])

  const stopCameraStream = useCallback(() => {
    const stream = cameraStreamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
    }
    cameraStreamRef.current = null
    const videoElement = cameraVideoRef.current
    if (videoElement) {
      videoElement.srcObject = null
    }
    setIsCameraOpen(false)
    setIsCameraStarting(false)
  }, [])

  useEffect(() => {
    return () => {
      stopCameraStream()
      releaseUploadedFaceUrl()
      if (faceSlotTextureRef.current) {
        faceSlotTextureRef.current.dispose()
        faceSlotTextureRef.current = null
      }
    }
  }, [stopCameraStream, releaseUploadedFaceUrl])

  useEffect(() => {
    if (!isCharacterCalibrationMode) return undefined

    let isCancelled = false
    const latestFaceEndpoint = buildLatestFaceEndpoint()

    const loadCalibrationFace = async () => {
      try {
        const response = await fetch(latestFaceEndpoint, { cache: 'no-store' })
        const payload = await response.json()
        if (isCancelled) return
        const hasFace = response.ok && payload?.ok && payload?.faceImageBase64
        setCalibrationFaceTextureUrl(hasFace ? String(payload.faceImageBase64) : '')
        setCalibrationFaceFileName(hasFace ? String(payload.fileName || '') : '')
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
  }, [isCharacterCalibrationMode])

  useEffect(() => {
    let isMounted = true
    let retryTimerId = null
    let retryCount = 0
    const MAX_RETRIES = 8
    const glbUrlsToCheck = Array.from(
      new Set([CHARACTER_GLB_URL, ...Object.values(ANIMATED_CHARACTER_GLB_URLS)]),
    )

    const checkCharacterFiles = async () => {
      const checks = await Promise.all(glbUrlsToCheck.map((url) => isValidGlbFile(url)))
      const ready = checks.every(Boolean)

      if (!isMounted) return

      setIsAlienGlbReady(ready)

      if (!ready && retryCount < MAX_RETRIES) {
        retryCount += 1
        retryTimerId = window.setTimeout(() => {
          void checkCharacterFiles()
        }, 1200)
      }
    }

    void checkCharacterFiles()
    return () => {
      isMounted = false
      if (retryTimerId) {
        window.clearTimeout(retryTimerId)
      }
    }
  }, [])

  const handleParadeBoundsChange = useCallback((edgeX) => {
    activeLimitRef.current = activeLimitForEdge(edgeX)
    setParadeEdgeX(edgeX)
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

      if (merged.length > MAX_PENDING_QUEUE_PLAYERS) {
        return merged.slice(-MAX_PENDING_QUEUE_PLAYERS)
      }
      return merged
    })
  }, [])

  useEffect(() => {
    if (isCharacterCalibrationMode) {
      return undefined
    }

    const intervalId = window.setInterval(() => {
      setPendingPlayers((previous) => {
        if (previous.length === 0) return previous
        const activeLimit = activeLimitRef.current
        if (activePlayersRef.current.length >= activeLimit) return previous

        const [nextPayload, ...rest] = previous
        const laneIndex = laneCursorRef.current % PARADE_LANES.length
        laneCursorRef.current += 1

        const nextPlayerId = String(nextPayload?.playerId || '')
        const liveSocket = socketRef.current
        if (nextPlayerId && liveSocket?.connected) {
          liveSocket.emit('player:dequeue', { playerId: nextPlayerId })
        }

        const startX = paradeBoundsRef.current.startX
        setActivePlayers((currentActive) => {
          const laneCount = currentActive.filter((player) => player.laneIndex === laneIndex).length
          const globalBackOffset = currentActive.length
          const queuedPlayer = createQueuedPlayerEntity(nextPayload, laneIndex, laneCount, globalBackOffset, startX)
          setLastQueuedPlayer(queuedPlayer)

          const deduped = currentActive.filter((player) => player.playerId !== queuedPlayer.playerId)
          return [...deduped, queuedPlayer].slice(-activeLimit)
        })

        return rest
      })
    }, SPAWN_INTERVAL_MS)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [isCharacterCalibrationMode])

  // Synchronised group "Dance Break" every 35-55 s (or ?danceBreakEvery=<seconds> for testing).
  useEffect(() => {
    if (isCharacterCalibrationMode) return undefined
    const fixedEvery = Number(searchParams.get('danceBreakEvery'))
    const nextDelay = () => (fixedEvery > 0 ? fixedEvery : randomBetween(DANCE_BREAK_EVERY_SECONDS)) * 1000
    let startTimer = null
    let endTimer = null

    const scheduleBreak = () => {
      startTimer = window.setTimeout(() => {
        if (activePlayersRef.current.length < DANCE_BREAK_MIN_CHARACTERS) {
          scheduleBreak()
          return
        }
        setDanceBreak({ id: Date.now(), move: pickRandom(DANCE_BREAK_MOVES) })
        endTimer = window.setTimeout(() => {
          setDanceBreak(null)
          scheduleBreak()
        }, DANCE_BREAK_SECONDS * 1000)
      }, nextDelay())
    }

    scheduleBreak()
    return () => {
      window.clearTimeout(startTimer)
      window.clearTimeout(endTimer)
    }
  }, [isCharacterCalibrationMode, searchParams])

  const statusText = useMemo(() => {
    if (isCharacterCalibrationMode) return 'Calibration'
    if (connectionState === 'connected') return 'Connected'
    if (connectionState === 'connecting') return 'Connecting'
    return 'Disconnected'
  }, [connectionState, isCharacterCalibrationMode])

  useEffect(() => {
    if (isCharacterCalibrationMode) {
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

    const handlePlayerQueued = (payload) => {
      enqueuePendingPlayers(payload)
    }

    const handleQueueSnapshot = (payload) => {
      enqueuePendingPlayers(payload?.players || [])
    }

    const handlePlayerDequeued = (payload) => {
      const playerId = String(payload?.playerId || '')
      if (!playerId) return

      setPendingPlayers((previous) => previous.filter((player) => player.playerId !== playerId))
    }

    socket.on('connect', handleConnect)
    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleDisconnect)
    socket.on('player:queued', handlePlayerQueued)
    socket.on('queue:snapshot', handleQueueSnapshot)
    socket.on('player:dequeued', handlePlayerDequeued)

    return () => {
      socket.off('connect', handleConnect)
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleDisconnect)
      socket.off('player:queued', handlePlayerQueued)
      socket.off('queue:snapshot', handleQueueSnapshot)
      socket.off('player:dequeued', handlePlayerDequeued)
      socket.disconnect()
      socketRef.current = null
    }
  }, [enqueuePendingPlayers, isCharacterCalibrationMode])

  const updateCalibration = useCallback((updater) => {
    setFaceCalibration((previous) => updater(previous || DEFAULT_ALIEN_FACE_CALIBRATION))
    setCalibrationNotice('Unsaved changes')
  }, [])

  const updateTopLevelField = useCallback((field, value) => {
    updateCalibration((previous) => ({ ...previous, [field]: value }))
  }, [updateCalibration])

  const updateNestedField = useCallback((group, field, value) => {
    updateCalibration((previous) => ({
      ...previous,
      [group]: {
        ...(DEFAULT_ALIEN_FACE_CALIBRATION[group] || {}),
        ...(previous?.[group] || {}),
        [field]: value,
      },
    }))
  }, [updateCalibration])

  const handleTransformChange = useCallback((offsetKey, rotationKey, nextOffset, nextRotation) => {
    setFaceCalibration((previous) => {
      const prevOffset = previous?.[offsetKey] || DEFAULT_ALIEN_FACE_CALIBRATION[offsetKey]
      const prevRotation = previous?.[rotationKey] || DEFAULT_ALIEN_FACE_CALIBRATION[rotationKey]
      const unchanged = ['x', 'y', 'z'].every((axis) => (
        nextOffset[axis] === prevOffset[axis] && nextRotation[axis] === prevRotation[axis]
      ))
      if (unchanged) return previous
      return { ...previous, [offsetKey]: nextOffset, [rotationKey]: nextRotation }
    })
    setCalibrationNotice('Unsaved changes')
  }, [])

  const handleCharacterTransformChange = useCallback((nextOffset, nextRotation) => {
    handleTransformChange('characterOffset', 'characterRotation', nextOffset, nextRotation)
  }, [handleTransformChange])

  const handleParadeRouteTransformChange = useCallback((nextOffset, nextRotation) => {
    handleTransformChange('paradeRouteOffset', 'paradeRouteRotation', nextOffset, nextRotation)
  }, [handleTransformChange])

  const handleSaveCalibration = useCallback(() => {
    const saved = saveAlienFaceCalibration(faceCalibration)
    setFaceCalibration(saved)
    setCalibrationNotice('Saved for all parade characters')
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

  const handleFaceUploadChange = useCallback((event) => {
    const file = event.target.files?.[0]
    if (!file) return

    replaceFaceSlotTexture(null)
    releaseUploadedFaceUrl()

    const objectUrl = URL.createObjectURL(file)
    uploadedFaceUrlRef.current = objectUrl
    setUploadedFaceTextureUrl(objectUrl)
    setFacePreviewUrl(objectUrl)
    setCameraError('')
    setCalibrationNotice(`Loaded upload: ${file.name} (face is detected and aligned automatically)`)
    event.target.value = ''
  }, [replaceFaceSlotTexture, releaseUploadedFaceUrl])

  const handleApplyTestFaceTexture = useCallback(() => {
    const created = createCheckerFaceTexture()
    if (!created) {
      setCalibrationNotice('Could not create checker test texture')
      return
    }

    releaseUploadedFaceUrl()
    setUploadedFaceTextureUrl('')
    replaceFaceSlotTexture(created.texture)
    setFacePreviewUrl(created.previewUrl)
    setCameraError('')
    setCalibrationNotice('Applied checker pattern to the selfie head')
  }, [releaseUploadedFaceUrl, replaceFaceSlotTexture])

  const handleOpenCamera = useCallback(async () => {
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError('Camera API is not available in this browser')
      return
    }

    setCameraError('')
    setIsCameraStarting(true)
    stopCameraStream()

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      })
      cameraStreamRef.current = stream
      setIsCameraOpen(true)
      setCalibrationNotice('Camera opened. Click Capture Frame to try your face on the character.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown camera error'
      setCameraError(`Camera open failed: ${message}`)
      stopCameraStream()
    } finally {
      setIsCameraStarting(false)
    }
  }, [stopCameraStream])

  // Attach the stream once the <video> element has rendered.
  useEffect(() => {
    const videoElement = cameraVideoRef.current
    const stream = cameraStreamRef.current
    if (!isCameraOpen || !videoElement || !stream) return
    videoElement.srcObject = stream
    videoElement.play().catch(() => {})
  }, [isCameraOpen])

  const handleCaptureFromCamera = useCallback(() => {
    const frameUrl = captureVideoFrameDataUrl(cameraVideoRef.current)
    if (!frameUrl) {
      setCameraError('Camera frame is not ready yet')
      return
    }

    releaseUploadedFaceUrl()
    replaceFaceSlotTexture(null)
    setUploadedFaceTextureUrl(frameUrl)
    setFacePreviewUrl(frameUrl)
    setCameraError('')
    setCalibrationNotice('Captured camera frame; face is detected and aligned automatically')
    stopCameraStream()
  }, [releaseUploadedFaceUrl, replaceFaceSlotTexture, stopCameraStream])

  const handleCloseCamera = useCallback(() => {
    stopCameraStream()
    setCalibrationNotice('Camera preview closed')
  }, [stopCameraStream])

  const handleCharacterDebugInfo = useCallback((nextInfo) => {
    setFaceDebug((previous) => ({ ...previous, ...nextInfo }))
  }, [])

  const { characterOffset, characterRotation, paradeRouteOffset, paradeRouteRotation } = settings

  return (
    <main className="main-display-page">
      <MainDisplayBackgroundVideo />
      <div className="main-display-canvas-wrap">
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          camera={{ position: [0, 7, 26], fov: 36, near: 0.1, far: 320 }}
        >
          {isCharacterCalibrationMode ? (
            <CalibrationPreviewScene
              characterType={previewCharacterType}
              faceTextureUrl={faceSlotTexture ? '' : effectiveFaceTextureUrl}
              faceTexture={faceSlotTexture}
              previewAnimation={previewAnimation}
              settings={settings}
              transformMode={calibrationTransformMode}
              transformTarget={calibrationTransformTarget}
              onCharacterTransformChange={handleCharacterTransformChange}
              onRouteTransformChange={handleParadeRouteTransformChange}
              onCharacterDebugInfo={handleCharacterDebugInfo}
            />
          ) : (
            <MainMoonScene
              activePlayers={activePlayers}
              danceBreak={danceBreak}
              onPlayerExit={handlePlayerExit}
              boundsRef={paradeBoundsRef}
              onBoundsChange={handleParadeBoundsChange}
              settings={settings}
            />
          )}
        </Canvas>
      </div>

      <div className="main-display-overlay">
        <h1 className="main-display-title">Moonwalk Selfie Parade</h1>
        {showDebugPanel ? (
          <div className="main-display-debug">
            {isCharacterCalibrationMode ? <p>Mode: <strong>Character Calibration</strong></p> : null}
            <p>Status: <strong>{statusText}</strong></p>
            <p>Server: {SOCKET_SERVER_URL}</p>
            <p>Socket ID: {socketId || 'n/a'}</p>
            <p>Active Characters: {activePlayers.length}/{activeLimitForEdge(paradeEdgeX)}</p>
            <p>Pending Queue: {pendingPlayers.length}</p>
            <p>Spawn: every {SPAWN_INTERVAL_MS / 1000}s, edges at x=±{paradeEdgeX.toFixed(1)}</p>
            <p>Character GLB: {isAlienGlbReady ? 'ready' : 'loading or missing'}</p>
            <p>Model / Parade / Anim: {settings.modelScale.toFixed(2)}x / {settings.paradeScale.toFixed(2)}x / {settings.animationSpeedMultiplier.toFixed(2)}x</p>
            <p>Character Offset: {characterOffset.x.toFixed(2)}, {characterOffset.y.toFixed(2)}, {characterOffset.z.toFixed(2)}</p>
            <p>Character Rotation: {characterRotation.x.toFixed(1)}°, {characterRotation.y.toFixed(1)}°, {characterRotation.z.toFixed(1)}°</p>
            <p>Route Offset: {paradeRouteOffset.x.toFixed(2)}, {paradeRouteOffset.y.toFixed(2)}, {paradeRouteOffset.z.toFixed(2)}</p>
            <p>Route Rotation: {paradeRouteRotation.x.toFixed(1)}°, {paradeRouteRotation.y.toFixed(1)}°, {paradeRouteRotation.z.toFixed(1)}°</p>
            {isCharacterCalibrationMode ? (
              <p>
                Calibration Face: {calibrationFaceFileName ? `storage/faces/${calibrationFaceFileName}` : 'placeholder face'}
              </p>
            ) : null}
            <p>
              Last Spawned: {lastQueuedPlayer
                ? `${formatTicket(lastQueuedPlayer.ticketNumber) || lastQueuedPlayer.playerId} (${lastQueuedPlayer.characterType})`
                : 'none'}
            </p>
            {!isCharacterCalibrationMode ? <p className="main-display-debug-hint">Press D to hide</p> : null}
          </div>
        ) : null}
      </div>

      {danceBreak ? (
        <div className="dance-break-banner" key={danceBreak.id} aria-live="polite">
          Dance Break!
        </div>
      ) : null}

      {isCharacterCalibrationMode ? (
        <section className="face-calibration-panel">
          <h2>Character Calibration</h2>
          <p>Tune the parade characters and how the selfie sits on the 3D head. Save applies to every character.</p>
          <p className="face-calibration-hint">URL: <code>/main?calibrateCharacter=1</code> · Character lineup: <code>/admin</code></p>

          <h3>Test Face</h3>
          <label className="face-calibration-upload">
            <span>Upload Image</span>
            <input type="file" accept="image/*" onChange={handleFaceUploadChange} />
          </label>
          <div className="face-calibration-actions">
            <button type="button" className="face-calibration-button primary" onClick={handleApplyTestFaceTexture}>Checker Pattern</button>
            <button
              type="button"
              className="face-calibration-button"
              onClick={handleOpenCamera}
              disabled={isCameraStarting}
            >
              {isCameraStarting ? 'Opening Camera...' : 'Open Camera'}
            </button>
            <button
              type="button"
              className="face-calibration-button"
              onClick={handleCaptureFromCamera}
              disabled={!isCameraOpen}
            >
              Capture Frame
            </button>
          </div>
          {isCameraOpen ? (
            <div className="face-calibration-camera-wrap">
              <video ref={cameraVideoRef} autoPlay muted playsInline />
              <button type="button" className="face-calibration-button" onClick={handleCloseCamera}>Close Camera</button>
            </div>
          ) : null}
          {cameraError ? <p className="face-calibration-error">{cameraError}</p> : null}
          {facePreviewUrl ? (
            <img
              className="face-calibration-preview-face"
              src={facePreviewUrl}
              alt="Selected face preview"
            />
          ) : null}
          <div className="face-calibration-debug-panel">
            <p>Model loaded: <strong>{faceDebug.modelLoaded ? 'yes' : 'no'}</strong></p>
            <p>Head bone found: <strong>{faceDebug.headBoneFound ? 'yes' : 'no'}</strong></p>
            <p>Selfie photo loaded: <strong>{faceDebug.imageLoaded ? 'yes' : 'no (placeholder face)'}</strong></p>
            <p>Character: <strong>{faceDebug.characterVariant || '-'}</strong></p>
            <p>Current animation: <strong>{faceDebug.currentAnimationName || previewAnimation}</strong></p>
          </div>

          <h3>Character Setup</h3>
          <CalibrationSelect
            label="Preview"
            value={previewCharacterType}
            options={CALIBRATION_CHARACTER_OPTIONS}
            onChange={setPreviewCharacterType}
          />
          <CalibrationSelect
            label="Animation"
            value={previewAnimation}
            options={CALIBRATION_ANIMATION_OPTIONS}
            onChange={setPreviewAnimation}
          />
          <CalibrationSlider
            label="Model Size"
            min={0.6}
            max={2.2}
            step={0.05}
            value={settings.modelScale}
            onChange={(value) => updateTopLevelField('modelScale', value)}
          />
          <CalibrationSlider
            label="Parade Size"
            min={0.6}
            max={2.2}
            step={0.05}
            value={settings.paradeScale}
            onChange={(value) => updateTopLevelField('paradeScale', value)}
          />
          <CalibrationSlider
            label="Anim Speed"
            min={0.5}
            max={2.5}
            step={0.05}
            value={settings.animationSpeedMultiplier}
            onChange={(value) => updateTopLevelField('animationSpeedMultiplier', value)}
          />
          <label className="face-calibration-row face-calibration-toggle">
            <span>Ticket Tags</span>
            <input
              type="checkbox"
              checked={settings.showNameTags}
              onChange={(event) => updateTopLevelField('showNameTags', event.target.checked)}
            />
            <strong>{settings.showNameTags ? 'On' : 'Off'}</strong>
          </label>
          <CalibrationSelect
            label="Drag Tool"
            value={calibrationTransformMode}
            options={CALIBRATION_TRANSFORM_MODE_OPTIONS}
            onChange={setCalibrationTransformMode}
          />
          <CalibrationSelect
            label="Drag Target"
            value={calibrationTransformTarget}
            options={CALIBRATION_TRANSFORM_TARGET_OPTIONS}
            onChange={setCalibrationTransformTarget}
          />
          <p className="face-calibration-hint">Tip: set target to Route to drag the parade path. Set target to Character to move avatar inside route.</p>
          {['x', 'y', 'z'].map((axis) => (
            <CalibrationSlider
              key={`pos-${axis}`}
              label={`Pos ${axis.toUpperCase()}`}
              min={-10}
              max={10}
              step={0.05}
              value={characterOffset[axis]}
              onChange={(value) => updateNestedField('characterOffset', axis, value)}
            />
          ))}
          {['x', 'y', 'z'].map((axis) => (
            <CalibrationSlider
              key={`rot-${axis}`}
              label={`Rot ${axis.toUpperCase()}`}
              min={-180}
              max={180}
              step={1}
              value={characterRotation[axis]}
              onChange={(value) => updateNestedField('characterRotation', axis, value)}
            />
          ))}

          <h3>Selfie Head</h3>
          <p className="face-calibration-hint">Fit the 3D head to the body, then zoom/shift the photo on the face.</p>
          {HEAD_SLIDERS.map((slider) => (
            <CalibrationSlider
              key={slider.key}
              label={slider.label}
              min={HEAD_CALIBRATION_LIMITS[slider.key][0]}
              max={HEAD_CALIBRATION_LIMITS[slider.key][1]}
              step={slider.step}
              value={settings.head[slider.key]}
              onChange={(value) => updateNestedField('head', slider.key, value)}
            />
          ))}

          <h3>Parade Route</h3>
          {['x', 'y', 'z'].map((axis) => (
            <CalibrationSlider
              key={`route-${axis}`}
              label={`Route ${axis.toUpperCase()}`}
              min={-20}
              max={20}
              step={0.05}
              value={paradeRouteOffset[axis]}
              onChange={(value) => updateNestedField('paradeRouteOffset', axis, value)}
            />
          ))}
          <CalibrationSlider
            label="Route RotY"
            min={-180}
            max={180}
            step={1}
            value={paradeRouteRotation.y}
            onChange={(value) => updateNestedField('paradeRouteRotation', 'y', value)}
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
