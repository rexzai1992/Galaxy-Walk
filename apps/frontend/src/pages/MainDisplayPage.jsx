import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { CanvasTexture, MathUtils, SRGBColorSpace } from 'three'
import { TransformControls } from '@react-three/drei'
import { io } from 'socket.io-client'
import AlienGlbCharacter from '../components/main/AlienGlbCharacter.jsx'
import { CHARACTER_GLB_URL } from '../components/main/alienGlbConfig'
import ParadeCharacter from '../components/main/ParadeCharacter.jsx'
import {
  DEFAULT_ALIEN_FACE_CALIBRATION,
  clearAlienFaceCalibration,
  loadAlienFaceCalibration,
  saveAlienFaceCalibration,
} from '../lib/alienFaceCalibration'
import { SOCKET_SERVER_URL } from '../lib/socket'

const MAX_ACTIVE_CHARACTERS = 10
const MAX_PENDING_QUEUE_PLAYERS = 200
const START_X = 22
const EXIT_X = -22
const LANE_SPAWN_GAP = 2.4
const GLOBAL_SPAWN_GAP = 1.8
const SPAWN_INTERVAL_MS = 3000
const PARADE_CHARACTER_SCALE = 1.2
const CONVEYOR_ANIMATIONS = ['idle', 'idle', 'wave', 'dance', 'pose']
const FACE_SLOT_DEBUG_DEFAULT = {
  modelLoaded: false,
  faceSlotFound: false,
  imageLoaded: false,
  currentAnimationName: '',
  faceSlotMaterialName: '',
  meshNames: [],
  animationNames: [],
}
const CALIBRATION_ANIMATION_OPTIONS = [
  { value: 'idle', label: 'Idle' },
  { value: 'wave', label: 'Wave' },
  { value: 'dance', label: 'Dance' },
  { value: 'pose', label: 'Pose' },
]
const CALIBRATION_TRANSFORM_MODE_OPTIONS = [
  { value: 'translate', label: 'Move' },
  { value: 'rotate', label: 'Rotate' },
]
const CALIBRATION_TRANSFORM_TARGET_OPTIONS = [
  { value: 'character', label: 'Character' },
  { value: 'route', label: 'Route' },
]
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

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

function pickConveyorAnimation() {
  const index = Math.floor(Math.random() * CONVEYOR_ANIMATIONS.length)
  return CONVEYOR_ANIMATIONS[index] || 'idle'
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
  texture.flipY = false
  texture.needsUpdate = true

  return {
    texture,
    previewUrl: canvas.toDataURL('image/png'),
  }
}

function createCapturedFaceTexture(videoElement) {
  if (!videoElement) return null
  const sourceWidth = videoElement.videoWidth || 0
  const sourceHeight = videoElement.videoHeight || 0
  if (sourceWidth <= 0 || sourceHeight <= 0) return null

  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const sourceSize = Math.min(sourceWidth, sourceHeight)
  const sx = (sourceWidth - sourceSize) / 2
  const sy = (sourceHeight - sourceSize) / 2
  ctx.drawImage(videoElement, sx, sy, sourceSize, sourceSize, 0, 0, size, size)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.flipY = false
  texture.needsUpdate = true

  return {
    texture,
    previewUrl: canvas.toDataURL('image/png'),
  }
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

function createQueuedPlayerEntity(payload, laneIndex, laneBackOffset, globalBackOffset) {
  const lane = PARADE_LANES[laneIndex] || PARADE_LANES[0]
  const playerId = String(payload?.playerId || `queued-${Date.now()}-${Math.floor(Math.random() * 10000)}`)
  const characterType = String(payload?.characterType || 'human')
  const faceImageBase64 = String(payload?.faceImageBase64 || '')
  const faceTextureUrl = buildFaceTextureUrl(payload)
  const laneGap = laneBackOffset * LANE_SPAWN_GAP
  const globalGap = globalBackOffset * GLOBAL_SPAWN_GAP

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
    spawnX: START_X + laneGap + globalGap,
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

function MovingParadeCharacter({
  player,
  onExit,
  forceBlackFace,
  modelScale,
  paradeScale,
  animationSpeedMultiplier,
  characterOffset,
  characterRotation,
}) {
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
      scale={[
        PARADE_CHARACTER_SCALE * paradeScale,
        PARADE_CHARACTER_SCALE * paradeScale,
        PARADE_CHARACTER_SCALE * paradeScale,
      ]}
    >
      {isAlien ? (
        <Suspense
          fallback={null}
        >
          <group
            position={[characterOffset.x, characterOffset.y, characterOffset.z]}
            rotation={[
              MathUtils.degToRad(characterRotation.x),
              MathUtils.degToRad(characterRotation.y),
              MathUtils.degToRad(characterRotation.z),
            ]}
          >
            <AlienGlbCharacter
              position={[0, 0, 0]}
              paradeAnimation={player.paradeAnimation || 'idle'}
              animationSpeed={Math.max(0.65, player.speed * 0.4 * animationSpeedMultiplier)}
              faceTextureUrl={resolvedFaceTextureUrl}
              modelScale={modelScale}
            />
          </group>
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

function MainMoonScene({
  activePlayers,
  onPlayerExit,
  forceBlackFace,
  modelScale,
  paradeScale,
  animationSpeedMultiplier,
  characterOffset,
  characterRotation,
  paradeRouteOffset,
  paradeRouteRotation,
}) {
  return (
    <>
      <fog attach="fog" args={["#040712", 55, 160]} />

      <ambientLight intensity={0.72} />
      <directionalLight position={[14, 18, 6]} intensity={1.1} castShadow />
      <pointLight position={[-8, 6, -10]} intensity={1.7} color="#5deaff" distance={34} />

      <UfoPlaceholder />

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
            onExit={onPlayerExit}
            forceBlackFace={forceBlackFace}
            modelScale={modelScale}
            paradeScale={paradeScale}
            animationSpeedMultiplier={animationSpeedMultiplier}
            characterOffset={characterOffset}
            characterRotation={characterRotation}
          />
        ))}
      </group>
    </>
  )
}

function CalibrationPreviewAlienCharacter({
  faceTextureUrl,
  faceTexture,
  modelScale,
  paradeScale,
  previewAnimation,
  animationSpeedMultiplier,
  characterOffset,
  characterRotation,
  onCharacterDebugInfo,
}) {
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
        <AlienGlbCharacter
          position={[0, -0.4, 1.0]}
          paradeAnimation={previewAnimation}
          animationSpeed={animationSpeedMultiplier}
          faceTextureUrl={faceTextureUrl}
          faceTexture={faceTexture}
          modelScale={modelScale}
          forceFallbackFace={!faceTextureUrl && !faceTexture}
          onDebugInfoChange={onCharacterDebugInfo}
        />
      </group>
    </group>
  )
}

function CalibrationPreviewCharacterManipulator({
  faceTextureUrl,
  faceTexture,
  modelScale,
  paradeScale,
  previewAnimation,
  animationSpeedMultiplier,
  characterOffset,
  characterRotation,
  transformMode,
  onTransformChange,
  onCharacterDebugInfo,
}) {
  const controlTargetRef = useRef(null)
  const isApplyingExternalRef = useRef(false)

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
        <CalibrationPreviewAlienCharacter
          faceTextureUrl={faceTextureUrl}
          faceTexture={faceTexture}
          modelScale={modelScale}
          paradeScale={paradeScale}
          previewAnimation={previewAnimation}
          animationSpeedMultiplier={animationSpeedMultiplier}
          characterOffset={characterOffset}
          characterRotation={characterRotation}
          onCharacterDebugInfo={onCharacterDebugInfo}
        />
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
    let rotY = MathUtils.radToDeg(target.rotation.y)
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
  faceTextureUrl,
  faceTexture,
  modelScale,
  paradeScale,
  previewAnimation,
  animationSpeedMultiplier,
  characterOffset,
  characterRotation,
  paradeRouteOffset,
  paradeRouteRotation,
  transformMode,
  transformTarget,
  onCharacterTransformChange,
  onRouteTransformChange,
  onCharacterDebugInfo,
}) {
  return (
    <>
      <fog attach="fog" args={["#040712", 55, 160]} />
      <ambientLight intensity={0.78} />
      <directionalLight position={[14, 18, 6]} intensity={1.2} castShadow />
      <pointLight position={[-8, 6, -10]} intensity={1.7} color="#5deaff" distance={34} />

      <UfoPlaceholder />
      {transformTarget === 'route' ? (
        <Suspense
          fallback={null}
        >
          <CalibrationPreviewRouteManipulator
            paradeRouteOffset={paradeRouteOffset}
            paradeRouteRotation={paradeRouteRotation}
            transformMode={transformMode}
            onTransformChange={onRouteTransformChange}
          >
            <CalibrationShadowRail />
            <CalibrationPreviewAlienCharacter
              faceTextureUrl={faceTextureUrl}
              faceTexture={faceTexture}
              modelScale={modelScale}
              paradeScale={paradeScale}
              previewAnimation={previewAnimation}
              animationSpeedMultiplier={animationSpeedMultiplier}
              characterOffset={characterOffset}
              characterRotation={characterRotation}
              onCharacterDebugInfo={onCharacterDebugInfo}
            />
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
          <Suspense
            fallback={null}
          >
            <CalibrationPreviewCharacterManipulator
              faceTextureUrl={faceTextureUrl}
              faceTexture={faceTexture}
              modelScale={modelScale}
              paradeScale={paradeScale}
              previewAnimation={previewAnimation}
              animationSpeedMultiplier={animationSpeedMultiplier}
              characterOffset={characterOffset}
              characterRotation={characterRotation}
              transformMode={transformMode}
              onTransformChange={onCharacterTransformChange}
              onCharacterDebugInfo={onCharacterDebugInfo}
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
  const socketRef = useRef(null)
  const laneCursorRef = useRef(0)
  const alienGlbReadyRef = useRef(false)
  const activePlayersRef = useRef([])
  const cameraVideoRef = useRef(null)
  const cameraStreamRef = useRef(null)
  const uploadedFaceUrlRef = useRef('')
  const faceSlotTextureRef = useRef(null)
  const isCharacterCalibrationMode = useMemo(() => {
    const search = new URLSearchParams(window.location.search)
    return isCharacterCalibrationSearch(search)
  }, [])

  const [activePlayers, setActivePlayers] = useState([])
  const [pendingPlayers, setPendingPlayers] = useState([])
  const [connectionState, setConnectionState] = useState('connecting')
  const [socketId, setSocketId] = useState('')
  const [lastQueuedPlayerId, setLastQueuedPlayerId] = useState('')
  const [isAlienGlbReady, setIsAlienGlbReady] = useState(false)
  const [faceCalibration, setFaceCalibration] = useState(() => loadAlienFaceCalibration())
  const [previewAnimation, setPreviewAnimation] = useState('idle')
  const [calibrationTransformMode, setCalibrationTransformMode] = useState('translate')
  const [calibrationTransformTarget, setCalibrationTransformTarget] = useState('character')
  const [calibrationNotice, setCalibrationNotice] = useState('')
  const [calibrationFaceTextureUrl, setCalibrationFaceTextureUrl] = useState('')
  const [calibrationFaceFileName, setCalibrationFaceFileName] = useState('')
  const [uploadedFaceTextureUrl, setUploadedFaceTextureUrl] = useState('')
  const [faceSlotTexture, setFaceSlotTexture] = useState(null)
  const [facePreviewUrl, setFacePreviewUrl] = useState('')
  const [faceSlotImageLoaded, setFaceSlotImageLoaded] = useState(false)
  const [faceSlotDebug, setFaceSlotDebug] = useState(FACE_SLOT_DEBUG_DEFAULT)
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const [isCameraStarting, setIsCameraStarting] = useState(false)
  const [cameraError, setCameraError] = useState('')
  const forceBlackFace = DEBUG_FORCE_BLACK_FACE
  const alienModelScale = Number(faceCalibration?.modelScale || DEFAULT_ALIEN_FACE_CALIBRATION.modelScale || 1)
  const alienParadeScale = Number(faceCalibration?.paradeScale || DEFAULT_ALIEN_FACE_CALIBRATION.paradeScale || 1)
  const alienAnimationSpeedMultiplier = Number(
    faceCalibration?.animationSpeedMultiplier || DEFAULT_ALIEN_FACE_CALIBRATION.animationSpeedMultiplier || 1,
  )
  const characterOffset = faceCalibration?.characterOffset || DEFAULT_ALIEN_FACE_CALIBRATION.characterOffset
  const characterRotation = faceCalibration?.characterRotation || DEFAULT_ALIEN_FACE_CALIBRATION.characterRotation
  const paradeRouteOffset = faceCalibration?.paradeRouteOffset || DEFAULT_ALIEN_FACE_CALIBRATION.paradeRouteOffset
  const paradeRouteRotation = faceCalibration?.paradeRouteRotation || DEFAULT_ALIEN_FACE_CALIBRATION.paradeRouteRotation
  const effectiveFaceTextureUrl = uploadedFaceTextureUrl || calibrationFaceTextureUrl || ''
  const effectiveFaceTexture = faceSlotTexture

  useEffect(() => {
    faceSlotTextureRef.current = faceSlotTexture
  }, [faceSlotTexture])

  useEffect(() => {
    alienGlbReadyRef.current = isAlienGlbReady
  }, [isAlienGlbReady])

  useEffect(() => {
    activePlayersRef.current = activePlayers
  }, [activePlayers])

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
  }, [isCharacterCalibrationMode])

  useEffect(() => {
    let isMounted = true
    let retryTimerId = null
    let retryCount = 0
    const MAX_RETRIES = 8

    const checkAlienFiles = async () => {
      const checks = await Promise.all([isValidGlbFile(CHARACTER_GLB_URL)])
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
          const globalBackOffset = currentActive.length
          const queuedPlayer = createQueuedPlayerEntity(nextPayload, laneIndex, laneCount, globalBackOffset)
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
  }, [isCharacterCalibrationMode])

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
  }, [enqueuePendingPlayers, isCharacterCalibrationMode])

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

  const updateParadeScale = useCallback((value) => {
    setFaceCalibration((previous) => ({
      ...previous,
      paradeScale: value,
    }))
    setCalibrationNotice('Unsaved changes')
  }, [])

  const updateAnimationSpeedMultiplier = useCallback((value) => {
    setFaceCalibration((previous) => ({
      ...previous,
      animationSpeedMultiplier: value,
    }))
    setCalibrationNotice('Unsaved changes')
  }, [])

  const updateCharacterOffsetField = useCallback((field, value) => {
    setFaceCalibration((previous) => ({
      ...previous,
      characterOffset: {
        ...(previous?.characterOffset || DEFAULT_ALIEN_FACE_CALIBRATION.characterOffset),
        [field]: value,
      },
    }))
    setCalibrationNotice('Unsaved changes')
  }, [])

  const updateCharacterRotationField = useCallback((field, value) => {
    setFaceCalibration((previous) => ({
      ...previous,
      characterRotation: {
        ...(previous?.characterRotation || DEFAULT_ALIEN_FACE_CALIBRATION.characterRotation),
        [field]: value,
      },
    }))
    setCalibrationNotice('Unsaved changes')
  }, [])

  const updateParadeRouteOffsetField = useCallback((field, value) => {
    setFaceCalibration((previous) => ({
      ...previous,
      paradeRouteOffset: {
        ...(previous?.paradeRouteOffset || DEFAULT_ALIEN_FACE_CALIBRATION.paradeRouteOffset),
        [field]: value,
      },
    }))
    setCalibrationNotice('Unsaved changes')
  }, [])

  const updateParadeRouteRotationField = useCallback((field, value) => {
    setFaceCalibration((previous) => ({
      ...previous,
      paradeRouteRotation: {
        ...(previous?.paradeRouteRotation || DEFAULT_ALIEN_FACE_CALIBRATION.paradeRouteRotation),
        [field]: value,
      },
    }))
    setCalibrationNotice('Unsaved changes')
  }, [])

  const handleCharacterTransformChange = useCallback((nextOffset, nextRotation) => {
    setFaceCalibration((previous) => {
      const prevOffset = previous?.characterOffset || DEFAULT_ALIEN_FACE_CALIBRATION.characterOffset
      const prevRotation = previous?.characterRotation || DEFAULT_ALIEN_FACE_CALIBRATION.characterRotation
      const hasOffsetChange = nextOffset.x !== prevOffset.x
        || nextOffset.y !== prevOffset.y
        || nextOffset.z !== prevOffset.z
      const hasRotationChange = nextRotation.x !== prevRotation.x
        || nextRotation.y !== prevRotation.y
        || nextRotation.z !== prevRotation.z

      if (!hasOffsetChange && !hasRotationChange) return previous

      return {
        ...previous,
        characterOffset: nextOffset,
        characterRotation: nextRotation,
      }
    })
    setCalibrationNotice('Unsaved changes')
  }, [])

  const handleParadeRouteTransformChange = useCallback((nextOffset, nextRotation) => {
    setFaceCalibration((previous) => {
      const prevOffset = previous?.paradeRouteOffset || DEFAULT_ALIEN_FACE_CALIBRATION.paradeRouteOffset
      const prevRotation = previous?.paradeRouteRotation || DEFAULT_ALIEN_FACE_CALIBRATION.paradeRouteRotation
      const hasOffsetChange = nextOffset.x !== prevOffset.x
        || nextOffset.y !== prevOffset.y
        || nextOffset.z !== prevOffset.z
      const hasRotationChange = nextRotation.x !== prevRotation.x
        || nextRotation.y !== prevRotation.y
        || nextRotation.z !== prevRotation.z

      if (!hasOffsetChange && !hasRotationChange) return previous

      return {
        ...previous,
        paradeRouteOffset: nextOffset,
        paradeRouteRotation: nextRotation,
      }
    })
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

  const handleFaceUploadChange = useCallback((event) => {
    const file = event.target.files?.[0]
    if (!file) return

    replaceFaceSlotTexture(null)
    releaseUploadedFaceUrl()

    const objectUrl = URL.createObjectURL(file)
    uploadedFaceUrlRef.current = objectUrl
    setUploadedFaceTextureUrl(objectUrl)
    setFacePreviewUrl(objectUrl)
    setFaceSlotImageLoaded(true)
    setCameraError('')
    setCalibrationNotice(`Loaded upload: ${file.name}`)
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
    setFaceSlotImageLoaded(true)
    setCameraError('')
    setCalibrationNotice('Applied checker test texture to FaceSlot')
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

      const videoElement = cameraVideoRef.current
      if (videoElement) {
        videoElement.srcObject = stream
        await videoElement.play()
      }
      setIsCameraOpen(true)
      setCalibrationNotice('Camera opened. Click capture to apply frame to FaceSlot.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown camera error'
      setCameraError(`Camera open failed: ${message}`)
      stopCameraStream()
    } finally {
      setIsCameraStarting(false)
    }
  }, [stopCameraStream])

  const handleCaptureFromCamera = useCallback(() => {
    const capture = createCapturedFaceTexture(cameraVideoRef.current)
    if (!capture) {
      setCameraError('Camera frame is not ready yet')
      return
    }

    releaseUploadedFaceUrl()
    setUploadedFaceTextureUrl('')
    replaceFaceSlotTexture(capture.texture)
    setFacePreviewUrl(capture.previewUrl)
    setFaceSlotImageLoaded(true)
    setCameraError('')
    setCalibrationNotice('Captured camera frame applied to FaceSlot')
    stopCameraStream()
  }, [releaseUploadedFaceUrl, replaceFaceSlotTexture, stopCameraStream])

  const handleCloseCamera = useCallback(() => {
    stopCameraStream()
    setCalibrationNotice('Camera preview closed')
  }, [stopCameraStream])

  const handleCharacterDebugInfo = useCallback((nextInfo) => {
    setFaceSlotDebug((previous) => ({
      ...previous,
      ...nextInfo,
    }))
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
          {isCharacterCalibrationMode ? (
            <CalibrationPreviewScene
              faceTextureUrl={effectiveFaceTextureUrl}
              faceTexture={effectiveFaceTexture}
              modelScale={alienModelScale}
              paradeScale={alienParadeScale}
              previewAnimation={previewAnimation}
              animationSpeedMultiplier={alienAnimationSpeedMultiplier}
              characterOffset={characterOffset}
              characterRotation={characterRotation}
              paradeRouteOffset={paradeRouteOffset}
              paradeRouteRotation={paradeRouteRotation}
              transformMode={calibrationTransformMode}
              transformTarget={calibrationTransformTarget}
              onCharacterTransformChange={handleCharacterTransformChange}
              onRouteTransformChange={handleParadeRouteTransformChange}
              onCharacterDebugInfo={handleCharacterDebugInfo}
            />
          ) : (
            <MainMoonScene
              activePlayers={activePlayers}
              onPlayerExit={handlePlayerExit}
              forceBlackFace={forceBlackFace}
              modelScale={alienModelScale}
              paradeScale={alienParadeScale}
              animationSpeedMultiplier={alienAnimationSpeedMultiplier}
              characterOffset={characterOffset}
              characterRotation={characterRotation}
              paradeRouteOffset={paradeRouteOffset}
              paradeRouteRotation={paradeRouteRotation}
            />
          )}
        </Canvas>
      </div>

      <div className="main-display-overlay">
        <p className="main-display-route">Route: /main</p>
        {isCharacterCalibrationMode ? <p className="main-display-route">Mode: Alien Character Calibration</p> : null}
        <h1 className="main-display-title">Moonwalk Selfie Parade</h1>
        <div className="main-display-debug">
          <p>Status: <strong>{statusText}</strong></p>
          <p>Server: {SOCKET_SERVER_URL}</p>
          <p>Socket ID: {socketId || 'n/a'}</p>
          <p>Active Characters: {activePlayers.length}/10</p>
          <p>Pending Queue: {pendingPlayers.length}</p>
          <p>Spawn Gap: {SPAWN_INTERVAL_MS / 1000}s (lane {LANE_SPAWN_GAP.toFixed(1)} / global {GLOBAL_SPAWN_GAP.toFixed(1)})</p>
          <p>Alien GLB: {isAlienGlbReady ? 'ready' : 'loading or missing (no placeholder fallback)'}</p>
          <p>Face Test: {forceBlackFace ? 'black override ON' : 'live selfie'}</p>
          <p>Alien Model Scale: {alienModelScale.toFixed(2)}x</p>
          <p>Parade Size: {alienParadeScale.toFixed(2)}x</p>
          <p>Animation Speed: {alienAnimationSpeedMultiplier.toFixed(2)}x</p>
          <p>Character Offset: {characterOffset.x.toFixed(2)}, {characterOffset.y.toFixed(2)}, {characterOffset.z.toFixed(2)}</p>
          <p>Character Rotation: {characterRotation.x.toFixed(1)}°, {characterRotation.y.toFixed(1)}°, {characterRotation.z.toFixed(1)}°</p>
          <p>Route Offset: {paradeRouteOffset.x.toFixed(2)}, {paradeRouteOffset.y.toFixed(2)}, {paradeRouteOffset.z.toFixed(2)}</p>
          <p>Route Rotation: {paradeRouteRotation.x.toFixed(1)}°, {paradeRouteRotation.y.toFixed(1)}°, {paradeRouteRotation.z.toFixed(1)}°</p>
          {isCharacterCalibrationMode ? (
            <p>
              Calibration Face: {calibrationFaceFileName ? `storage/faces/${calibrationFaceFileName}` : 'fallback test face'}
            </p>
          ) : null}
          <p>Last Queued Player: {lastQueuedPlayerId || 'none'}</p>
        </div>
      </div>

      {isCharacterCalibrationMode ? (
        <section className="face-calibration-panel">
          <h2>Alien Character Calibration</h2>
          <p>Calibrate animation, size, and face fit in one place from the character route.</p>
          <p className="face-calibration-hint">URL: <code>/main?calibrateCharacter=1</code> or <code>/main?calibrateFace=1</code></p>
          <h3>FaceSlot Test Flow</h3>
          <label className="face-calibration-upload">
            <span>Upload Image</span>
            <input type="file" accept="image/*" onChange={handleFaceUploadChange} />
          </label>
          <div className="face-calibration-actions">
            <button type="button" className="face-calibration-button primary" onClick={handleApplyTestFaceTexture}>Test Face Texture</button>
            <button
              type="button"
              className="face-calibration-button"
              onClick={handleOpenCamera}
              disabled={isCameraStarting}
            >
              {isCameraStarting ? 'Opening Camera...' : 'Capture From Camera'}
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
            <p>Model loaded: <strong>{faceSlotDebug.modelLoaded ? 'yes' : 'no'}</strong></p>
            <p>FaceSlot found: <strong>{faceSlotDebug.faceSlotFound ? 'yes' : 'no'}</strong></p>
            <p>Uploaded/captured image loaded: <strong>{faceSlotImageLoaded ? 'yes' : 'no'}</strong></p>
            <p>Current animation name: <strong>{faceSlotDebug.currentAnimationName || previewAnimation}</strong></p>
          </div>
          <img
            className="face-calibration-default-face"
            src={CALIBRATION_DEFAULT_FACE_TEXTURE_URL}
            alt="Default test face texture for calibration"
          />

          <h3>Character Setup</h3>
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
            value={alienModelScale}
            onChange={updateModelScale}
          />
          <CalibrationSlider
            label="Parade Size"
            min={0.6}
            max={2.2}
            step={0.05}
            value={alienParadeScale}
            onChange={updateParadeScale}
          />
          <CalibrationSlider
            label="Anim Speed"
            min={0.5}
            max={2.5}
            step={0.05}
            value={alienAnimationSpeedMultiplier}
            onChange={updateAnimationSpeedMultiplier}
          />
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
          <CalibrationSlider
            label="Pos X"
            min={-10}
            max={10}
            step={0.05}
            value={characterOffset.x}
            onChange={(value) => updateCharacterOffsetField('x', value)}
          />
          <CalibrationSlider
            label="Pos Y"
            min={-10}
            max={10}
            step={0.05}
            value={characterOffset.y}
            onChange={(value) => updateCharacterOffsetField('y', value)}
          />
          <CalibrationSlider
            label="Pos Z"
            min={-10}
            max={10}
            step={0.05}
            value={characterOffset.z}
            onChange={(value) => updateCharacterOffsetField('z', value)}
          />
          <CalibrationSlider
            label="Rot X"
            min={-180}
            max={180}
            step={1}
            value={characterRotation.x}
            onChange={(value) => updateCharacterRotationField('x', value)}
          />
          <CalibrationSlider
            label="Rot Y"
            min={-180}
            max={180}
            step={1}
            value={characterRotation.y}
            onChange={(value) => updateCharacterRotationField('y', value)}
          />
          <CalibrationSlider
            label="Rot Z"
            min={-180}
            max={180}
            step={1}
            value={characterRotation.z}
            onChange={(value) => updateCharacterRotationField('z', value)}
          />

          <h3>Parade Route</h3>
          <CalibrationSlider
            label="Route X"
            min={-20}
            max={20}
            step={0.05}
            value={paradeRouteOffset.x}
            onChange={(value) => updateParadeRouteOffsetField('x', value)}
          />
          <CalibrationSlider
            label="Route Y"
            min={-20}
            max={20}
            step={0.05}
            value={paradeRouteOffset.y}
            onChange={(value) => updateParadeRouteOffsetField('y', value)}
          />
          <CalibrationSlider
            label="Route Z"
            min={-20}
            max={20}
            step={0.05}
            value={paradeRouteOffset.z}
            onChange={(value) => updateParadeRouteOffsetField('z', value)}
          />
          <CalibrationSlider
            label="Route RotY"
            min={-180}
            max={180}
            step={1}
            value={paradeRouteRotation.y}
            onChange={(value) => updateParadeRouteRotationField('y', value)}
          />

          <h3>Front Anchor</h3>
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
