import { useEffect, useMemo, useState } from 'react'
import * as THREE from 'three'
import { alignFacePhoto } from '../../lib/faceAlign'
import { FACE_LAYOUT } from '../../lib/faceLayout'

const DEFAULT_SKIN_HEX = '#d9a27e'
const DEFAULT_HAIR_HEX = '#2b1d16'
const SAMPLE_PATCH = 14

function toHex(rgb) {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`
}

function luminance([r, g, b]) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

function collectPixels(ctx, x, y, width, height) {
  const data = ctx.getImageData(Math.round(x), Math.round(y), Math.round(width), Math.round(height)).data
  const pixels = []
  for (let i = 0; i < data.length; i += 4) pixels.push([data[i], data[i + 1], data[i + 2]])
  return pixels
}

function averageColor(pixels) {
  if (pixels.length === 0) return null
  const sum = pixels.reduce((acc, pixel) => [acc[0] + pixel[0], acc[1] + pixel[1], acc[2] + pixel[2]], [0, 0, 0])
  return sum.map((value) => value / pixels.length)
}

// Average of the pixels between two luminance percentiles (drops shadows/highlights).
function averageLuminanceBand(pixels, from, to) {
  const sorted = [...pixels].sort((a, b) => luminance(a) - luminance(b))
  const start = Math.floor(sorted.length * from)
  const end = Math.max(start + 1, Math.floor(sorted.length * to))
  return averageColor(sorted.slice(start, end))
}

// Samples skin (forehead, nose bridge, cheeks) and hair (above the hairline)
// from an image in FACE_LAYOUT.
function sampleFaceColors(ctx, size) {
  const eyeY = FACE_LAYOUT.eyeCenterY * size
  const unit = FACE_LAYOUT.eyeDistance * size
  const half = SAMPLE_PATCH / 2
  const skinPixels = [
    [size / 2, eyeY - unit * 0.7],
    [size / 2, eyeY + unit * 0.3],
    [size / 2 - unit * 0.6, eyeY + unit * 0.55],
    [size / 2 + unit * 0.6, eyeY + unit * 0.55],
  ].flatMap(([x, y]) => collectPixels(ctx, x - half, y - half, SAMPLE_PATCH, SAMPLE_PATCH))
  // Upper-middle of the luminance range: well-lit skin, not shadow or shine.
  const skin = averageLuminanceBand(skinPixels, 0.45, 0.85)

  const hairPixels = collectPixels(ctx, size / 2 - unit * 0.8, eyeY - unit * 2.1, unit * 1.6, unit * 0.55)
  const hair = averageLuminanceBand(hairPixels, 0, 0.4)

  // A very bright "hair" sample is almost certainly background (wall, sky), not hair.
  const hairLooksLikeBackground = !hair || luminance(hair) > 0.6

  return {
    skinHex: skin ? toHex(skin) : DEFAULT_SKIN_HEX,
    hairHex: hairLooksLikeBackground ? DEFAULT_HAIR_HEX : toHex(hair),
  }
}

function drawPlaceholderFace(ctx, size) {
  const eyeY = FACE_LAYOUT.eyeCenterY * size
  const unit = FACE_LAYOUT.eyeDistance * size
  ctx.fillStyle = DEFAULT_SKIN_HEX
  ctx.fillRect(0, 0, size, size)
  ctx.fillStyle = '#3a2418'
  ;[-0.5, 0.5].forEach((side) => {
    ctx.beginPath()
    ctx.ellipse(size / 2 + side * unit, eyeY, unit * 0.13, unit * 0.17, 0, 0, Math.PI * 2)
    ctx.fill()
  })
  ctx.strokeStyle = '#8a4b33'
  ctx.lineWidth = unit * 0.12
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.arc(size / 2, eyeY + unit * 0.65, unit * 0.42, Math.PI * 0.2, Math.PI * 0.8)
  ctx.stroke()
}

function buildFace(image) {
  const size = FACE_LAYOUT.size
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null

  let colors = { skinHex: DEFAULT_SKIN_HEX, hairHex: DEFAULT_HAIR_HEX }
  if (image) {
    ctx.drawImage(image, 0, 0, size, size)
    colors = sampleFaceColors(ctx, size)
  } else {
    drawPlaceholderFace(ctx, size)
  }

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.anisotropy = 4
  texture.needsUpdate = true
  return { texture, ...colors }
}

// Re-detects the face so photos that were not captured through the station
// (older selfies, uploads) still land in FACE_LAYOUT. Already-aligned photos
// come back unchanged; if no face is found the original image is kept.
async function alignImageIfPossible(image) {
  try {
    const aligned = await alignFacePhoto(image, { fallbackToGuide: false })
    return aligned.detected ? await loadImageElement(aligned.dataUrl) : image
  } catch {
    return image
  }
}

function loadImageElement(url) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load face image: ${url.slice(0, 64)}`))
    image.src = url
  })
}

/**
 * Loads a selfie, aligns it to FACE_LAYOUT (see lib/faceAlign.js) and returns
 * a texture plus the guest's sampled skin and hair colours. A `faceTexture` is
 * used as-is (test patterns). Broken or missing images fall back to a friendly
 * placeholder face.
 */
export function useSelfieFace({ faceTextureUrl = '', faceTexture = null, autoAlign = true } = {}) {
  const placeholder = useMemo(() => {
    const built = buildFace(null)
    return built ? { ...built, isPhoto: false } : null
  }, [])
  const [loaded, setLoaded] = useState(null)

  useEffect(() => {
    let cancelled = false
    let created = null

    const accept = (image) => {
      if (cancelled) return
      try {
        created = buildFace(image)
      } catch (error) {
        console.warn('[useSelfieFace] could not read face image:', error)
        created = null
      }
      setLoaded(created ? { ...created, isPhoto: true, source: faceTexture || faceTextureUrl } : null)
    }

    if (faceTexture?.image) {
      Promise.resolve(faceTexture.image).then(accept)
    } else if (faceTextureUrl) {
      loadImageElement(faceTextureUrl)
        .then((image) => (autoAlign ? alignImageIfPossible(image) : image))
        .then(accept)
        .catch((error) => {
          console.warn('[useSelfieFace]', error.message)
          if (!cancelled) setLoaded(null)
        })
    }
    // With no source the hook simply returns the placeholder (see below).

    return () => {
      cancelled = true
      created?.texture?.dispose()
    }
  }, [faceTextureUrl, faceTexture, autoAlign])

  useEffect(() => () => placeholder?.texture?.dispose(), [placeholder])

  const isCurrent = loaded && loaded.source === (faceTexture || faceTextureUrl)
  return isCurrent ? loaded : placeholder
}
