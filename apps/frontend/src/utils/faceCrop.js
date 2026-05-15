function loadImageFromDataUrl(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load selfie image for cropping.'))
    image.src = dataUrl
  })
}

function findForegroundBounds(ctx, size) {
  const imageData = ctx.getImageData(0, 0, size, size)
  const data = imageData.data

  let minX = size
  let minY = size
  let maxX = -1
  let maxY = -1
  let count = 0

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const a = data[i + 3]

      // Keep opaque subject pixels, ignore near-white background.
      if (a < 24) continue
      if (r > 242 && g > 242 && b > 242) continue

      count += 1
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
  }

  if (maxX < minX || maxY < minY || count < size * size * 0.003) {
    return null
  }

  return {
    minX,
    minY,
    maxX,
    maxY,
  }
}

function normalizeSubjectToCenter(sourceCanvas, outputSize) {
  const sourceCtx = sourceCanvas.getContext('2d', { alpha: true })
  if (!sourceCtx) return sourceCanvas

  const bounds = findForegroundBounds(sourceCtx, outputSize)
  if (!bounds) return sourceCanvas

  const subjectWidth = bounds.maxX - bounds.minX + 1
  const subjectHeight = bounds.maxY - bounds.minY + 1

  // Expand bbox so we keep full head + a bit of shoulders.
  const paddedWidth = subjectWidth * 1.85
  const paddedHeight = subjectHeight * 1.95
  const centerX = (bounds.minX + bounds.maxX) / 2
  const centerY = (bounds.minY + bounds.maxY) / 2

  const srcSize = Math.min(outputSize, Math.max(paddedWidth, paddedHeight))
  const srcX = Math.max(0, Math.min(outputSize - srcSize, centerX - srcSize / 2))
  const srcY = Math.max(0, Math.min(outputSize - srcSize, centerY - srcSize / 2))

  const outCanvas = document.createElement('canvas')
  outCanvas.width = outputSize
  outCanvas.height = outputSize

  const outCtx = outCanvas.getContext('2d', { alpha: true })
  if (!outCtx) return sourceCanvas

  const targetSize = outputSize * 0.88
  const targetX = (outputSize - targetSize) / 2
  const targetY = (outputSize - targetSize) / 2 - outputSize * 0.03

  outCtx.clearRect(0, 0, outputSize, outputSize)
  outCtx.save()
  outCtx.beginPath()
  outCtx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2)
  outCtx.closePath()
  outCtx.clip()
  outCtx.drawImage(sourceCanvas, srcX, srcY, srcSize, srcSize, targetX, targetY, targetSize, targetSize)
  outCtx.restore()

  return outCanvas
}

export async function createCenteredCircularFacePng(selfieDataUrl, options = {}) {
  const { outputSize = 480, cropRatio = 0.72, cropOffsetX = 0, cropOffsetY = 0 } = options

  const image = await loadImageFromDataUrl(selfieDataUrl)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height

  const shortestSide = Math.min(sourceWidth, sourceHeight)
  const safeRatio = Math.min(Math.max(cropRatio, 0.3), 1)
  const cropSize = Math.round(shortestSide * safeRatio)
  const safeOffsetX = Math.min(Math.max(cropOffsetX, -0.35), 0.35)
  const safeOffsetY = Math.min(Math.max(cropOffsetY, -0.35), 0.35)

  const centerX = sourceWidth / 2 + cropSize * safeOffsetX
  const centerY = sourceHeight / 2 + cropSize * safeOffsetY
  const sx = Math.round(Math.min(Math.max(0, centerX - cropSize / 2), sourceWidth - cropSize))
  const sy = Math.round(Math.min(Math.max(0, centerY - cropSize / 2), sourceHeight - cropSize))

  const canvas = document.createElement('canvas')
  canvas.width = outputSize
  canvas.height = outputSize

  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) {
    throw new Error('Unable to create canvas context for face crop.')
  }

  ctx.clearRect(0, 0, outputSize, outputSize)
  ctx.save()
  ctx.beginPath()
  ctx.arc(outputSize / 2, outputSize / 2, outputSize / 2, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()

  ctx.drawImage(image, sx, sy, cropSize, cropSize, 0, 0, outputSize, outputSize)
  ctx.restore()

  const normalized = normalizeSubjectToCenter(canvas, outputSize)
  return normalized.toDataURL('image/png')
}
