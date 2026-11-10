import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import { FACE_LAYOUT } from './faceLayout'

// Served from public/ (copied by scripts/copy-mediapipe-wasm.mjs) so this works offline.
const MEDIAPIPE_WASM_BASE = '/mediapipe/wasm'
const FACE_MODEL_URL = '/models/mediapipe/blaze_face_short_range.tflite'
const OUTPUT_MIME = 'image/jpeg'
const OUTPUT_QUALITY = 0.92
// Typical adult ratio: eye-midpoint -> mouth distance is ~1.1x the pupil distance.
const EYE_TO_MOUTH_RATIO = 1.1

let detectorPromise = null

export function warmUpFaceDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE)
      return FaceDetector.createFromOptions(vision, {
        baseOptions: { modelAssetPath: FACE_MODEL_URL, delegate: 'CPU' },
        runningMode: 'IMAGE',
        minDetectionConfidence: 0.5,
      })
    })().catch((error) => {
      detectorPromise = null
      throw error
    })
  }
  return detectorPromise
}

function sourceSize(source) {
  return {
    width: Number(source.videoWidth || source.naturalWidth || source.width || 0),
    height: Number(source.videoHeight || source.naturalHeight || source.height || 0),
  }
}

function pickLargestDetection(detections) {
  let best = null
  let bestArea = 0
  for (const detection of detections || []) {
    const box = detection?.boundingBox
    const area = Number(box?.width || 0) * Number(box?.height || 0)
    if (area > bestArea && Array.isArray(detection.keypoints) && detection.keypoints.length >= 4) {
      best = detection
      bestArea = area
    }
  }
  return best
}

// Converts a detection into "eyes midpoint, roll angle, face size" in source pixels.
function faceGeometryFromDetection(detection, width, height) {
  const [eyeA, eyeB, , mouth] = detection.keypoints
  const toPx = (point) => ({ x: point.x * width, y: point.y * height })
  let leftEye = toPx(eyeA)
  let rightEye = toPx(eyeB)
  if (leftEye.x > rightEye.x) [leftEye, rightEye] = [rightEye, leftEye]
  const mouthPx = toPx(mouth)

  const eyeCenter = { x: (leftEye.x + rightEye.x) / 2, y: (leftEye.y + rightEye.y) / 2 }
  const eyeDistance = Math.hypot(rightEye.x - leftEye.x, rightEye.y - leftEye.y)
  const eyeToMouth = Math.hypot(mouthPx.x - eyeCenter.x, mouthPx.y - eyeCenter.y)
  // Turning the head shrinks the eye distance, tilting it shrinks eye->mouth;
  // taking the larger estimate keeps the face size stable in both cases.
  const faceUnit = Math.max(eyeDistance, eyeToMouth / EYE_TO_MOUTH_RATIO)
  const roll = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x)

  return { eyeCenter, faceUnit, roll }
}

// Where the on-screen guide oval expects the eyes, as fractions of the frame
// height. Keep in sync with .station-face-guide in index.css.
export const GUIDE_EYE_LINE_Y = 0.45
export const GUIDE_EYE_DISTANCE = 0.13

// Used when no face is detected: assumes the guest lined up with the guide oval.
export function guideFaceGeometry(width, height) {
  return {
    eyeCenter: { x: width / 2, y: height * GUIDE_EYE_LINE_Y },
    faceUnit: height * GUIDE_EYE_DISTANCE,
    roll: 0,
  }
}

function renderAlignedFace(source, geometry) {
  const size = FACE_LAYOUT.size
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('Unable to create canvas for face alignment.')

  const scale = (FACE_LAYOUT.eyeDistance * size) / Math.max(1, geometry.faceUnit)
  ctx.fillStyle = '#20232b'
  ctx.fillRect(0, 0, size, size)
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(FACE_LAYOUT.eyeCenterX * size, FACE_LAYOUT.eyeCenterY * size)
  ctx.rotate(-geometry.roll)
  ctx.scale(scale, scale)
  ctx.translate(-geometry.eyeCenter.x, -geometry.eyeCenter.y)
  ctx.drawImage(source, 0, 0)
  return canvas.toDataURL(OUTPUT_MIME, OUTPUT_QUALITY)
}

/**
 * Detects the face in `source` (canvas, image or video) and returns a square
 * JPEG data URL in FACE_LAYOUT: eyes level, centred and at a fixed scale.
 * Falls back to the guide-oval position when no face is found.
 */
export async function alignFacePhoto(source, { fallbackToGuide = true } = {}) {
  const { width, height } = sourceSize(source)
  if (width <= 0 || height <= 0) throw new Error('Face photo has no pixels yet.')

  let geometry = null
  let detectionError = ''
  try {
    const detector = await warmUpFaceDetector()
    const result = detector.detect(source)
    const detection = pickLargestDetection(result?.detections)
    if (detection) geometry = faceGeometryFromDetection(detection, width, height)
  } catch (error) {
    detectionError = error instanceof Error ? error.message : String(error)
    console.warn('[faceAlign] face detection unavailable:', detectionError)
  }

  if (!geometry && !fallbackToGuide) {
    return { dataUrl: '', detected: false, detectionError }
  }

  const detected = Boolean(geometry)
  const dataUrl = renderAlignedFace(source, geometry || guideFaceGeometry(width, height))
  return { dataUrl, detected, detectionError }
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image.'))
    image.src = url
  })
}
