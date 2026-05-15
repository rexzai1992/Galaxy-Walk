import { useEffect, useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import { ALIEN_GLB_FILES } from './alienGlbConfig'
import { loadAlienFaceCalibration, normalizeAlienFaceCalibration } from '../../lib/alienFaceCalibration'

const FACE_SLOT_NAMES = ['FaceSlot', 'FacePlane', 'faceSlot', 'face_plane']
const FACE_FRONT_ANCHOR_NAMES = ['headfront', 'HeadFront', 'head_front', 'FaceAnchor', 'face_anchor', 'faceanchor']
const HEAD_ANCHOR_NAMES = ['mixamorigHead', 'Head', 'head', 'CC_Base_Head', 'Bip001 Head']
const FACE_OVERLAY_SCALE_MULTIPLIER = 0.018

function resolveAnimationKey(paradeAnimation) {
  const key = String(paradeAnimation || 'idle').toLowerCase()
  if (key === 'pose') return 'dance'
  if (key === 'wave' || key === 'dance' || key === 'idle') return key
  return 'idle'
}

function findFaceSlotMesh(scene) {
  for (const name of FACE_SLOT_NAMES) {
    const found = scene.getObjectByName(name)
    if (found?.isMesh) return found
  }
  return null
}

function findNamedObject(scene, names) {
  for (const name of names) {
    const found = scene.getObjectByName(name)
    if (found) return found
  }
  return null
}

function findHeadAnchor(scene) {
  const explicitFront = findNamedObject(scene, FACE_FRONT_ANCHOR_NAMES)
  if (explicitFront) return explicitFront

  let detectedFront = null
  let detectedHeadBone = null
  scene.traverse((node) => {
    const nodeName = String(node?.name || '')
    if (!detectedFront && /(headfront|facefront|face.?anchor)/i.test(nodeName)) {
      detectedFront = node
    }
    if (!detectedHeadBone && node?.isBone && /head/i.test(node.name || '')) {
      detectedHeadBone = node
    }
  })

  if (detectedFront) return detectedFront

  const explicitHead = findNamedObject(scene, HEAD_ANCHOR_NAMES)
  if (explicitHead) return explicitHead

  return detectedHeadBone || scene
}

function getAutoFaceSlotConfig(anchor, calibration) {
  const anchorName = String(anchor?.name || '').toLowerCase()
  const usesFrontAnchor = /(headfront|facefront|faceanchor|face_anchor)/i.test(anchorName)
  const resolved = normalizeAlienFaceCalibration(calibration)

  if (usesFrontAnchor) {
    return resolved.front
  }

  return resolved.fallback
}

function createFallbackFaceTexture() {
  if (typeof document === 'undefined') {
    return null
  }

  const size = 512
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return null
  }

  ctx.fillStyle = '#f2bf8d'
  ctx.fillRect(0, 0, size, size)

  ctx.fillStyle = '#683a1d'
  ctx.beginPath()
  ctx.ellipse(180, 210, 30, 22, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.beginPath()
  ctx.ellipse(332, 210, 30, 22, 0, 0, Math.PI * 2)
  ctx.fill()

  ctx.strokeStyle = '#854528'
  ctx.lineWidth = 34
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(172, 318)
  ctx.quadraticCurveTo(256, 390, 340, 318)
  ctx.stroke()

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

function AlienGlbCharacter({
  position = [0, 0, 0],
  paradeAnimation = 'idle',
  animationSpeed = 1,
  faceTextureUrl = '',
  faceCalibration = null,
  modelScale = 1,
  forceFallbackFace = false,
}) {
  const groupRef = useRef(null)
  const faceOverlayRef = useRef(null)
  const faceAnchorRef = useRef(null)
  const faceWorldPointRef = useRef(new THREE.Vector3())
  const faceLocalPointRef = useRef(new THREE.Vector3())
  const fallbackFaceTexture = useMemo(() => createFallbackFaceTexture(), [])
  const [resolvedFaceTexture, setResolvedFaceTexture] = useState(() => fallbackFaceTexture)
  const resolvedFaceCalibration = useMemo(() => {
    if (faceCalibration) {
      return normalizeAlienFaceCalibration(faceCalibration)
    }
    return loadAlienFaceCalibration()
  }, [faceCalibration])

  const baseGltf = useGLTF(ALIEN_GLB_FILES.base)
  const idleGltf = useGLTF(ALIEN_GLB_FILES.idle)
  const waveGltf = useGLTF(ALIEN_GLB_FILES.wave)
  const danceGltf = useGLTF(ALIEN_GLB_FILES.dance)
  useGLTF(ALIEN_GLB_FILES.pose)

  const selectedAnimationGltf = useMemo(() => {
    const key = resolveAnimationKey(paradeAnimation)
    if (key === 'wave' && waveGltf?.scene) return waveGltf
    if (key === 'dance' && danceGltf?.scene) return danceGltf
    if (idleGltf?.scene) return idleGltf
    return baseGltf
  }, [baseGltf, danceGltf, idleGltf, paradeAnimation, waveGltf])

  const clonedScene = useMemo(() => {
    // Keep mesh source stable from base character so alien is always visible.
    if (!baseGltf?.scene) return null
    return SkeletonUtils.clone(baseGltf.scene)
  }, [baseGltf])

  const clips = useMemo(() => {
    if (Array.isArray(selectedAnimationGltf?.animations) && selectedAnimationGltf.animations.length > 0) {
      return selectedAnimationGltf.animations
    }
    if (Array.isArray(baseGltf?.animations)) {
      return baseGltf.animations
    }
    return []
  }, [baseGltf, selectedAnimationGltf])

  const { actions } = useAnimations(clips, groupRef)

  useEffect(() => {
    let isCancelled = false
    let createdTexture = null
    const scheduleTextureState = (nextTexture) => {
      queueMicrotask(() => {
        if (!isCancelled) {
          setResolvedFaceTexture(nextTexture)
        }
      })
    }

    if (forceFallbackFace || !faceTextureUrl) {
      scheduleTextureState(fallbackFaceTexture || null)
      return undefined
    }

    scheduleTextureState(fallbackFaceTexture || null)

    const loader = new THREE.TextureLoader()
    createdTexture = loader.load(
      faceTextureUrl,
      () => {
        if (isCancelled || !createdTexture) return
        createdTexture.colorSpace = THREE.SRGBColorSpace
        createdTexture.minFilter = THREE.LinearFilter
        createdTexture.magFilter = THREE.LinearFilter
        createdTexture.flipY = true
        createdTexture.needsUpdate = true
        setResolvedFaceTexture(createdTexture)
      },
      undefined,
      () => {
        if (isCancelled) return
        if (createdTexture) {
          createdTexture.dispose()
          createdTexture = null
        }
        scheduleTextureState(fallbackFaceTexture || null)
      },
    )

    return () => {
      isCancelled = true
      if (createdTexture) {
        createdTexture.dispose()
      }
    }
  }, [faceTextureUrl, fallbackFaceTexture, forceFallbackFace])

  useEffect(() => {
    return () => {
      if (fallbackFaceTexture) {
        fallbackFaceTexture.dispose()
      }
    }
  }, [fallbackFaceTexture])

  useEffect(() => {
    if (!clonedScene) {
      faceAnchorRef.current = null
      return
    }
    faceAnchorRef.current = findHeadAnchor(clonedScene)
  }, [clonedScene])

  useEffect(() => {
    if (!actions) return undefined

    const allActions = Object.values(actions)
    const target = allActions[0]

    allActions.forEach((action) => {
      action.reset()
      action.stop()
      action.enabled = true
      action.setEffectiveTimeScale(Math.max(0.7, animationSpeed))
      action.setEffectiveWeight(1)
    })

    if (target) {
      target.reset()
      target.fadeIn(0.2)
      target.play()
    }

    return () => {
      if (target) {
        target.fadeOut(0.2)
      }
    }
  }, [actions, animationSpeed])

  useEffect(() => {
    if (!clonedScene) return

    const preferredFaceSlot = findFaceSlotMesh(clonedScene)
    if (preferredFaceSlot && resolvedFaceTexture) {
      const baseMaterial = preferredFaceSlot.material
      const material = Array.isArray(baseMaterial) ? baseMaterial[0] : baseMaterial
      if (material) {
        const clonedMaterial = material.clone()
        clonedMaterial.map = resolvedFaceTexture
        clonedMaterial.transparent = true
        clonedMaterial.depthWrite = false
        clonedMaterial.depthTest = false
        clonedMaterial.alphaTest = 0.02
        clonedMaterial.side = THREE.DoubleSide
        clonedMaterial.needsUpdate = true
        preferredFaceSlot.material = clonedMaterial
      }
    }

  }, [clonedScene, resolvedFaceCalibration, resolvedFaceTexture])

  useFrame(() => {
    const overlay = faceOverlayRef.current
    const anchor = faceAnchorRef.current
    const holder = groupRef.current

    if (!overlay || !anchor || !holder) {
      if (overlay) overlay.visible = false
      return
    }

    const config = getAutoFaceSlotConfig(anchor, resolvedFaceCalibration)
    const worldPoint = faceWorldPointRef.current
    const localPoint = faceLocalPointRef.current

    worldPoint.set(config.x, config.y, config.z)
    anchor.localToWorld(worldPoint)

    localPoint.copy(worldPoint)
    holder.worldToLocal(localPoint)

    overlay.position.copy(localPoint)
    overlay.scale.set(
      config.width * FACE_OVERLAY_SCALE_MULTIPLIER,
      config.height * FACE_OVERLAY_SCALE_MULTIPLIER,
      1,
    )
    overlay.visible = true
  })

  useEffect(() => {
    return () => {
      faceAnchorRef.current = null
    }
  }, [])

  if (!clonedScene) {
    return null
  }

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, 0, 0]}
      scale={[2.05 * modelScale, 2.05 * modelScale, 2.05 * modelScale]}
    >
      <sprite ref={faceOverlayRef} renderOrder={96} frustumCulled={false}>
        <spriteMaterial
          attach="material"
          map={resolvedFaceTexture || null}
          color={resolvedFaceTexture ? '#ffffff' : '#7ff6ff'}
          opacity={resolvedFaceTexture ? 1 : 0.92}
          transparent
          alphaTest={0.02}
          depthWrite={false}
          depthTest={false}
          toneMapped={false}
          sizeAttenuation
        />
      </sprite>
      <primitive object={clonedScene} />
    </group>
  )
}

export default AlienGlbCharacter
