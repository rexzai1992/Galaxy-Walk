const ALIEN_FACE_CALIBRATION_STORAGE_KEY = 'moonwalk.alienFaceCalibration.v1'

export const DEFAULT_ALIEN_FACE_CALIBRATION = {
  modelScale: 1,
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
  const isLegacyScale = rawWidth > 24 || rawHeight > 24
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

export function normalizeAlienFaceCalibration(input) {
  const source = input && typeof input === 'object' ? input : {}
  const rawModelScale = toFiniteNumber(source.modelScale, DEFAULT_ALIEN_FACE_CALIBRATION.modelScale)
  const modelScale = clamp(rawModelScale, 0.6, 2.2)

  return {
    modelScale,
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
