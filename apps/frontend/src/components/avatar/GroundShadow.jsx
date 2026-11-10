import { useMemo } from 'react'
import { CanvasTexture, SRGBColorSpace } from 'three'

let sharedShadowTexture = null

// One tiny radial texture shared by every shadow (drawn once, 128px).
function getShadowTexture() {
  if (sharedShadowTexture) return sharedShadowTexture
  const size = 128
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  const falloff = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  falloff.addColorStop(0, 'rgba(0, 0, 0, 0.55)')
  falloff.addColorStop(0.55, 'rgba(0, 0, 0, 0.22)')
  falloff.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = falloff
  ctx.fillRect(0, 0, size, size)
  sharedShadowTexture = new CanvasTexture(canvas)
  sharedShadowTexture.colorSpace = SRGBColorSpace
  return sharedShadowTexture
}

/** Soft contact shadow that grounds a character on any background. */
function GroundShadow({ width = 2.4, depth = 1.1, position = [0, 0.02, 0], opacity = 1 }) {
  const texture = useMemo(() => getShadowTexture(), [])
  return (
    <mesh rotation-x={-Math.PI / 2} position={position} renderOrder={-1}>
      <planeGeometry args={[width, depth]} />
      <meshBasicMaterial map={texture} transparent opacity={opacity} depthWrite={false} toneMapped={false} />
    </mesh>
  )
}

export default GroundShadow
