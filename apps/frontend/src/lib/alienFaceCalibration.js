export const ALIEN_FACE_CALIBRATION_STORAGE_KEY = 'moonwalk.alienFaceCalibration.v1'

export const DEFAULT_ALIEN_FACE_CALIBRATION = {
  modelScale: 1,
  paradeScale: 1,
  animationSpeedMultiplier: 1,
  showNameTags: true,
  // 'galaxy' = procedural 3D space scene; 'video' = backgrounds/videos/playlist.json
  backgroundMode: 'galaxy',
  // Galaxy mode rotates through the worlds in components/main/worlds.js.
  worldMinutes: 2,
  characterOffset: {
    x: 0,
    y: 0,
    z: 0,
  },
  characterRotation: {
    x: 0,
    y: 0,
    z: 0,
  },
  paradeRouteOffset: {
    x: 0,
    y: 0,
    z: 0,
  },
  paradeRouteRotation: {
    x: 0,
    y: 0,
    z: 0,
  },
  // Selfie head fit on the body (see components/avatar/AvatarCharacter.jsx).
  head: {
    scale: 1,
    x: 0,
    y: 0,
    z: 0,
    faceZoom: 1,
    faceY: 0,
  },
}

export const HEAD_CALIBRATION_LIMITS = {
  scale: [0.6, 1.6],
  x: [-0.3, 0.3],
  y: [-0.3, 0.3],
  z: [-0.3, 0.3],
  faceZoom: [0.6, 1.6],
  faceY: [-0.15, 0.15],
}

function toFiniteNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeTransformVector(inputVector, defaults, min, max) {
  const source = inputVector && typeof inputVector === 'object' ? inputVector : {}
  return {
    x: clamp(toFiniteNumber(source.x, defaults.x), min, max),
    y: clamp(toFiniteNumber(source.y, defaults.y), min, max),
    z: clamp(toFiniteNumber(source.z, defaults.z), min, max),
  }
}

function normalizeHead(inputHead) {
  const source = inputHead && typeof inputHead === 'object' ? inputHead : {}
  return Object.fromEntries(
    Object.entries(HEAD_CALIBRATION_LIMITS).map(([key, [min, max]]) => [
      key,
      clamp(toFiniteNumber(source[key], DEFAULT_ALIEN_FACE_CALIBRATION.head[key]), min, max),
    ]),
  )
}

export function normalizeAlienFaceCalibration(input) {
  const source = input && typeof input === 'object' ? input : {}
  const rawModelScale = toFiniteNumber(source.modelScale, DEFAULT_ALIEN_FACE_CALIBRATION.modelScale)
  const rawParadeScale = toFiniteNumber(source.paradeScale, DEFAULT_ALIEN_FACE_CALIBRATION.paradeScale)
  const rawAnimationSpeedMultiplier = toFiniteNumber(
    source.animationSpeedMultiplier,
    DEFAULT_ALIEN_FACE_CALIBRATION.animationSpeedMultiplier,
  )

  return {
    modelScale: clamp(rawModelScale, 0.6, 2.2),
    paradeScale: clamp(rawParadeScale, 0.6, 2.2),
    animationSpeedMultiplier: clamp(rawAnimationSpeedMultiplier, 0.5, 2.5),
    showNameTags: source.showNameTags === undefined ? DEFAULT_ALIEN_FACE_CALIBRATION.showNameTags : Boolean(source.showNameTags),
    backgroundMode: source.backgroundMode === 'video' ? 'video' : 'galaxy',
    worldMinutes: clamp(toFiniteNumber(source.worldMinutes, DEFAULT_ALIEN_FACE_CALIBRATION.worldMinutes), 0.5, 30),
    characterOffset: normalizeTransformVector(
      source.characterOffset,
      DEFAULT_ALIEN_FACE_CALIBRATION.characterOffset,
      -10,
      10,
    ),
    characterRotation: normalizeTransformVector(
      source.characterRotation,
      DEFAULT_ALIEN_FACE_CALIBRATION.characterRotation,
      -180,
      180,
    ),
    paradeRouteOffset: normalizeTransformVector(
      source.paradeRouteOffset,
      DEFAULT_ALIEN_FACE_CALIBRATION.paradeRouteOffset,
      -20,
      20,
    ),
    paradeRouteRotation: normalizeTransformVector(
      source.paradeRouteRotation,
      DEFAULT_ALIEN_FACE_CALIBRATION.paradeRouteRotation,
      -180,
      180,
    ),
    head: normalizeHead(source.head),
  }
}

export function loadAlienFaceCalibration() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_ALIEN_FACE_CALIBRATION
  }

  try {
    const raw = window.localStorage.getItem(ALIEN_FACE_CALIBRATION_STORAGE_KEY)
    if (!raw) return DEFAULT_ALIEN_FACE_CALIBRATION
    const parsed = JSON.parse(raw)
    return normalizeAlienFaceCalibration(parsed)
  } catch {
    return DEFAULT_ALIEN_FACE_CALIBRATION
  }
}

export function saveAlienFaceCalibration(input) {
  const normalized = normalizeAlienFaceCalibration(input)
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(ALIEN_FACE_CALIBRATION_STORAGE_KEY, JSON.stringify(normalized))
  }
  return normalized
}

export function clearAlienFaceCalibration() {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(ALIEN_FACE_CALIBRATION_STORAGE_KEY)
  }
  return DEFAULT_ALIEN_FACE_CALIBRATION
}
