const ALIEN_FACE_CALIBRATION_STORAGE_KEY = 'moonwalk.alienFaceCalibration.v1'

export const DEFAULT_ALIEN_FACE_CALIBRATION = {
  modelScale: 1,
  paradeScale: 1,
  animationSpeedMultiplier: 1,
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
  front: {
    x: 0,
    y: 0,
    z: 0,
    width: 10.5,
    height: 11.5,
  },
  fallback: {
    x: 0,
    y: 0,
    z: 15.2,
    width: 9.8,
    height: 10.8,
  },
}

function toFiniteNumber(value, fallback) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function normalizeProfile(inputProfile, defaults) {
  const source = inputProfile && typeof inputProfile === 'object' ? inputProfile : {}
  const rawWidth = toFiniteNumber(source.width, defaults.width)
  const rawHeight = toFiniteNumber(source.height, defaults.height)
  // Legacy payloads used very large overlay sizes (~60-120). Keep backward compatibility
  // without shrinking valid current slider values (1-30).
  const isLegacyScale = rawWidth > 50 || rawHeight > 50
  const widthValue = isLegacyScale ? rawWidth * 0.32 : rawWidth
  const heightValue = isLegacyScale ? rawHeight * 0.32 : rawHeight

  return {
    x: clamp(toFiniteNumber(source.x, defaults.x), -40, 40),
    y: clamp(toFiniteNumber(source.y, defaults.y), -40, 40),
    z: clamp(toFiniteNumber(source.z, defaults.z), -40, 40),
    width: clamp(widthValue, 1, 30),
    height: clamp(heightValue, 1, 30),
  }
}

function normalizeTransformVector(inputVector, defaults, min, max) {
  const source = inputVector && typeof inputVector === 'object' ? inputVector : {}
  return {
    x: clamp(toFiniteNumber(source.x, defaults.x), min, max),
    y: clamp(toFiniteNumber(source.y, defaults.y), min, max),
    z: clamp(toFiniteNumber(source.z, defaults.z), min, max),
  }
}

export function normalizeAlienFaceCalibration(input) {
  const source = input && typeof input === 'object' ? input : {}
  const rawModelScale = toFiniteNumber(source.modelScale, DEFAULT_ALIEN_FACE_CALIBRATION.modelScale)
  const rawParadeScale = toFiniteNumber(source.paradeScale, DEFAULT_ALIEN_FACE_CALIBRATION.paradeScale)
  const rawAnimationSpeedMultiplier = toFiniteNumber(
    source.animationSpeedMultiplier,
    DEFAULT_ALIEN_FACE_CALIBRATION.animationSpeedMultiplier,
  )
  const modelScale = clamp(rawModelScale, 0.6, 2.2)
  const paradeScale = clamp(rawParadeScale, 0.6, 2.2)
  const animationSpeedMultiplier = clamp(rawAnimationSpeedMultiplier, 0.5, 2.5)

  return {
    modelScale,
    paradeScale,
    animationSpeedMultiplier,
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
    front: normalizeProfile(source.front, DEFAULT_ALIEN_FACE_CALIBRATION.front),
    fallback: normalizeProfile(source.fallback, DEFAULT_ALIEN_FACE_CALIBRATION.fallback),
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
