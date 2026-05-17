import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import { ANIMATED_CHARACTER_GLB_URLS, CHARACTER_GLB_URL } from './alienGlbConfig'

const FACE_SLOT_NAME = 'FaceSlot'
const DEFAULT_ANIMATION_INTENT = 'idle'
const ANIMATION_KEYWORD_MAP = {
  idle: ['idle', 'stand', 'breath', 'rest'],
  wave: ['wave', 'hello', 'greet'],
  dance: ['dance', 'groove'],
  pose: ['pose', 'jump', 'celebrate'],
}
const STATIC_CLIP_DURATION_EPSILON = 0.05
let didLogGlbDebug = false

function resolveAnimationIntent(paradeAnimation) {
  const intent = String(paradeAnimation || DEFAULT_ANIMATION_INTENT).toLowerCase()
  if (intent === 'pose') return 'pose'
  if (intent === 'wave' || intent === 'dance' || intent === 'idle') return intent
  return DEFAULT_ANIMATION_INTENT
}

function collectMeshNames(scene) {
  const names = []
  scene.traverse((node) => {
    if (!node?.isMesh) return
    names.push(String(node.name || '(unnamed-mesh)'))
  })
  return [...new Set(names)]
}

function collectAnimationNames(clips) {
  return clips.map((clip) => String(clip?.name || '(unnamed-animation)'))
}

function findFaceSlotMesh(scene) {
  if (!scene) return null
  let matched = null
  scene.traverse((node) => {
    if (matched || !node?.isMesh) return
    if (String(node.name || '') === FACE_SLOT_NAME) {
      matched = node
    }
  })
  return matched
}

function resolveAnimationClipName(paradeAnimation, clips) {
  if (!Array.isArray(clips) || clips.length === 0) {
    return ''
  }

  const intent = resolveAnimationIntent(paradeAnimation)
  const clipEntries = clips.map((clip) => ({
    original: String(clip?.name || ''),
    normalized: String(clip?.name || '').toLowerCase(),
  }))
  const keywords = ANIMATION_KEYWORD_MAP[intent] || [intent]

  for (const keyword of keywords) {
    const matched = clipEntries.find((entry) => entry.normalized.includes(keyword))
    if (matched?.original) return matched.original
  }

  return clipEntries[0]?.original || ''
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
  texture.flipY = false
  texture.needsUpdate = true
  return texture
}

function orientUserFaceTexture(texture) {
  if (!texture) return null
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.wrapS = THREE.ClampToEdgeWrapping
  texture.wrapT = THREE.ClampToEdgeWrapping
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.repeat.set(1, -1)
  texture.offset.set(0, 1)
  texture.needsUpdate = true
  return texture
}

function getFaceSlotMaterial(mesh) {
  if (!mesh) return null
  if (Array.isArray(mesh.material)) {
    return mesh.material[0] || null
  }
  return mesh.material || null
}

function getFaceSlotMaterialName(mesh) {
  const material = getFaceSlotMaterial(mesh)
  if (!material) return ''
  return String(material.name || material.type || '(unnamed-material)')
}

function replaceFaceSlotMaterial(mesh, texture) {
  if (!mesh) return
  const hasFaceTexture = Boolean(texture)

  const nextMaterial = new THREE.MeshBasicMaterial({
    map: texture || null,
    side: THREE.DoubleSide,
    transparent: false,
    alphaTest: 0,
    depthTest: true,
    depthWrite: true,
    polygonOffset: hasFaceTexture,
    polygonOffsetFactor: hasFaceTexture ? -0.6 : 0,
    polygonOffsetUnits: hasFaceTexture ? -0.6 : 0,
    toneMapped: false,
  })
  nextMaterial.name = 'FaceSlotPhotoMaterial'
  nextMaterial.forceSinglePass = true
  nextMaterial.blending = THREE.NoBlending

  const existingMaterial = getFaceSlotMaterial(mesh)
  if (Array.isArray(mesh.material)) {
    const nextMaterials = [...mesh.material]
    nextMaterials[0] = nextMaterial
    mesh.material = nextMaterials
  } else {
    mesh.material = nextMaterial
  }

  if (mesh.userData.__faceSlotMaterialOwned && existingMaterial?.dispose) {
    existingMaterial.dispose()
  }
  mesh.userData.__faceSlotMaterialOwned = true
  mesh.frustumCulled = false
  mesh.renderOrder = 8
}

function createOpaqueFaceTextureFromImage(image) {
  if (!image || typeof document === 'undefined') return null

  const width = Number(image.width || image.videoWidth || image.naturalWidth || 0)
  const height = Number(image.height || image.videoHeight || image.naturalHeight || 0)
  if (width <= 0 || height <= 0) return null

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) return null

  // Remove transparent regions from the face crop so helmet interior never shows as white.
  ctx.fillStyle = '#0f1f45'
  ctx.fillRect(0, 0, width, height)
  ctx.drawImage(image, 0, 0, width, height)

  const texture = new THREE.CanvasTexture(canvas)
  return orientUserFaceTexture(texture)
}

function cloneConfiguredTexture(sourceTexture) {
  if (!sourceTexture) return null
  const clonedTexture = sourceTexture.clone()
  return orientUserFaceTexture(clonedTexture)
}

function hasMotionTrack(clip) {
  if (!clip || !Array.isArray(clip.tracks)) return false
  if (!Number.isFinite(clip.duration) || clip.duration <= STATIC_CLIP_DURATION_EPSILON) return false
  return clip.tracks.some((track) => Number(track?.times?.length || 0) > 1)
}

function isAnimationAction(action) {
  return Boolean(
    action
    && typeof action.stop === 'function'
    && typeof action.play === 'function'
    && typeof action.reset === 'function'
    && typeof action.fadeIn === 'function'
    && typeof action.setEffectiveWeight === 'function'
    && typeof action.setEffectiveTimeScale === 'function',
  )
}

function collectDefinedActions(actions) {
  return Object.values(actions || {}).filter((action) => isAnimationAction(action))
}

function AlienGlbCharacter({
  position = [0, 0, 0],
  paradeAnimation = DEFAULT_ANIMATION_INTENT,
  animationSpeed = 1,
  faceTextureUrl = '',
  faceTexture = null,
  modelScale = 1,
  forceFallbackFace = false,
  onDebugInfoChange,
}) {
  const groupRef = useRef(null)
  const motionPhaseRef = useRef(0)
  const baseLocalYRef = useRef(Number(position?.[1] || 0))
  const faceSlotMeshRef = useRef(null)
  const activeActionRef = useRef(null)
  const currentAnimationNameRef = useRef('')
  const faceSlotFoundRef = useRef(false)
  const faceSlotMaterialNameRef = useRef('')
  const faceImageLoadedRef = useRef(false)
  const fallbackFaceTexture = useMemo(() => createFallbackFaceTexture(), [])
  const animationIntent = useMemo(() => resolveAnimationIntent(paradeAnimation), [paradeAnimation])
  const resolvedAnimationGlbUrl = useMemo(() => {
    return ANIMATED_CHARACTER_GLB_URLS[animationIntent] || CHARACTER_GLB_URL
  }, [animationIntent])

  const baseCharacterGltf = useGLTF(CHARACTER_GLB_URL)
  const animationCharacterGltf = useGLTF(resolvedAnimationGlbUrl)
  const clips = useMemo(() => {
    const animationClips = Array.isArray(animationCharacterGltf?.animations) ? animationCharacterGltf.animations : []
    if (animationClips.length > 0) return animationClips
    return Array.isArray(baseCharacterGltf?.animations) ? baseCharacterGltf.animations : []
  }, [animationCharacterGltf, baseCharacterGltf])
  const meshNames = useMemo(() => {
    if (!baseCharacterGltf?.scene) return []
    return collectMeshNames(baseCharacterGltf.scene)
  }, [baseCharacterGltf])
  const animationNames = useMemo(() => collectAnimationNames(clips), [clips])

  const clonedScene = useMemo(() => {
    if (!baseCharacterGltf?.scene) return null
    return SkeletonUtils.clone(baseCharacterGltf.scene)
  }, [baseCharacterGltf])

  const targetClipName = useMemo(() => {
    return resolveAnimationClipName(paradeAnimation, clips)
  }, [paradeAnimation, clips])
  const hasPlayableClipAnimation = useMemo(() => clips.some((clip) => hasMotionTrack(clip)), [clips])

  const { actions } = useAnimations(clips, groupRef)

  const emitDebug = useCallback(() => {
    if (!onDebugInfoChange) return
    onDebugInfoChange({
      modelLoaded: Boolean(baseCharacterGltf?.scene),
      faceSlotFound: faceSlotFoundRef.current,
      faceSlotMaterialName: faceSlotMaterialNameRef.current,
      imageLoaded: faceImageLoadedRef.current,
      currentAnimationName: currentAnimationNameRef.current || targetClipName || '',
      meshNames,
      animationNames,
    })
  }, [onDebugInfoChange, baseCharacterGltf, targetClipName, meshNames, animationNames])

  useEffect(() => {
    if (!baseCharacterGltf?.scene || didLogGlbDebug) return
    didLogGlbDebug = true

    const sourceFaceSlotMesh = findFaceSlotMesh(baseCharacterGltf.scene)
    const isFound = Boolean(sourceFaceSlotMesh)
    const sourceFaceSlotMaterialName = getFaceSlotMaterialName(sourceFaceSlotMesh)

    console.log('[AlienGlbCharacter] GLB mesh names:', meshNames)
    console.log('[AlienGlbCharacter] Base GLB url:', CHARACTER_GLB_URL)
    console.log('[AlienGlbCharacter] Animation GLB url:', resolvedAnimationGlbUrl)
    console.log('[AlienGlbCharacter] FaceSlot found:', isFound)
    console.log('[AlienGlbCharacter] FaceSlot material name:', sourceFaceSlotMaterialName || '(none)')
    console.log('[AlienGlbCharacter] GLB animation names:', animationNames)
    if (!isFound) {
      console.warn('[AlienGlbCharacter] FaceSlot mesh not found in base character GLB')
    }
  }, [baseCharacterGltf, meshNames, animationNames, resolvedAnimationGlbUrl])

  useEffect(() => {
    if (!clonedScene) {
      faceSlotMeshRef.current = null
      faceSlotFoundRef.current = false
      faceSlotMaterialNameRef.current = ''
      emitDebug()
      return
    }

    const faceSlot = findFaceSlotMesh(clonedScene)
    faceSlotMeshRef.current = faceSlot
    faceSlotFoundRef.current = Boolean(faceSlot)
    faceSlotMaterialNameRef.current = getFaceSlotMaterialName(faceSlot)
    if (!faceSlot) {
      console.warn('[AlienGlbCharacter] FaceSlot mesh not found on cloned scene instance')
    }
    emitDebug()
  }, [clonedScene, emitDebug])

  useEffect(() => {
    motionPhaseRef.current = Math.random() * Math.PI * 2
  }, [])

  useEffect(() => {
    baseLocalYRef.current = Number(position?.[1] || 0)
  }, [position])

  useFrame((_, delta) => {
    const root = groupRef.current
    if (!root) return

    if (hasPlayableClipAnimation) {
      root.position.y = baseLocalYRef.current
      root.rotation.x = 0
      root.rotation.z = 0
      return
    }

    const speedScale = Math.max(0.35, animationSpeed)
    motionPhaseRef.current += delta * (1.8 + speedScale * 1.35)
    const phase = motionPhaseRef.current
    const baseY = baseLocalYRef.current

    if (animationIntent === 'wave') {
      root.position.y = baseY + Math.abs(Math.sin(phase * 2.1)) * 0.06
      root.rotation.x = Math.sin(phase * 2) * 0.08
      root.rotation.z = Math.sin(phase * 2.5) * 0.11
      return
    }

    if (animationIntent === 'dance') {
      root.position.y = baseY + Math.abs(Math.sin(phase * 2.8)) * 0.11
      root.rotation.x = Math.sin(phase * 1.7) * 0.12
      root.rotation.z = Math.sin(phase * 2.4) * 0.15
      return
    }

    if (animationIntent === 'pose') {
      root.position.y = baseY + 0.04 + Math.abs(Math.sin(phase * 1.2)) * 0.03
      root.rotation.x = 0.16 + Math.sin(phase * 0.9) * 0.03
      root.rotation.z = -0.06
      return
    }

    root.position.y = baseY + Math.abs(Math.sin(phase * 1.3)) * 0.04
    root.rotation.x = 0
    root.rotation.z = Math.sin(phase * 0.9) * 0.05
  })

  useEffect(() => {
    if (hasPlayableClipAnimation) return
    currentAnimationNameRef.current = `procedural:${animationIntent}`
    emitDebug()
  }, [hasPlayableClipAnimation, animationIntent, emitDebug])

  useEffect(() => {
    const faceSlotMesh = faceSlotMeshRef.current
    if (!faceSlotMesh) {
      faceImageLoadedRef.current = false
      emitDebug()
      return undefined
    }

    let disposed = false
    let createdTexture = null

    const applyFaceTexture = (texture, imageLoaded) => {
      if (disposed) return
      replaceFaceSlotMaterial(faceSlotMesh, texture)
      faceSlotMaterialNameRef.current = getFaceSlotMaterialName(faceSlotMesh)
      faceImageLoadedRef.current = Boolean(imageLoaded)
      emitDebug()
    }

    if (faceTexture && !forceFallbackFace) {
      createdTexture = createOpaqueFaceTextureFromImage(faceTexture.image) || cloneConfiguredTexture(faceTexture)
      applyFaceTexture(createdTexture, true)
      return () => {
        disposed = true
        if (createdTexture?.dispose) {
          createdTexture.dispose()
        }
      }
    }

    if (faceTextureUrl && !forceFallbackFace) {
      const imageLoader = new THREE.ImageLoader()
      // Avoid a brief white flash while the face image texture is still loading.
      applyFaceTexture(fallbackFaceTexture || null, false)
      imageLoader.load(
        faceTextureUrl,
        (image) => {
          createdTexture = createOpaqueFaceTextureFromImage(image)
          if (!createdTexture) {
            applyFaceTexture(fallbackFaceTexture || null, false)
            return
          }
          applyFaceTexture(createdTexture, true)
        },
        undefined,
        () => {
          applyFaceTexture(fallbackFaceTexture || null, false)
        },
      )

      return () => {
        disposed = true
        if (createdTexture?.dispose) {
          createdTexture.dispose()
        }
      }
    }

    applyFaceTexture(fallbackFaceTexture || null, false)
    return () => {
      disposed = true
    }
  }, [faceTexture, faceTextureUrl, forceFallbackFace, fallbackFaceTexture, emitDebug])

  useEffect(() => {
    if (!actions || !hasPlayableClipAnimation) return
    collectDefinedActions(actions).forEach((action) => {
      action.enabled = true
      action.setEffectiveWeight(1)
      action.setEffectiveTimeScale(Math.max(0.1, animationSpeed))
    })
  }, [actions, animationSpeed, hasPlayableClipAnimation])

  useEffect(() => {
    if (!actions || !hasPlayableClipAnimation) return undefined

    const allActions = collectDefinedActions(actions)
    if (allActions.length === 0) return undefined
    const preferredAction = actions[targetClipName]
    const nextAction = isAnimationAction(preferredAction) ? preferredAction : allActions[0]
    if (!nextAction) return undefined

    if (
      activeActionRef.current
      && activeActionRef.current !== nextAction
      && typeof activeActionRef.current.fadeOut === 'function'
    ) {
      activeActionRef.current.fadeOut(0.2)
    }

    nextAction.reset()
    nextAction.fadeIn(0.2)
    nextAction.play()
    activeActionRef.current = nextAction
    currentAnimationNameRef.current = String(nextAction.getClip()?.name || targetClipName || '')
    emitDebug()

    return undefined
  }, [actions, targetClipName, emitDebug, hasPlayableClipAnimation])

  useEffect(() => {
    return () => {
      if (!actions) return
      collectDefinedActions(actions).forEach((action) => {
        action?.stop?.()
      })
    }
  }, [actions])

  useEffect(() => {
    return () => {
      if (fallbackFaceTexture?.dispose) {
        fallbackFaceTexture.dispose()
      }
    }
  }, [fallbackFaceTexture])

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
      <primitive object={clonedScene} />
    </group>
  )
}

useGLTF.preload(CHARACTER_GLB_URL)
Object.values(ANIMATED_CHARACTER_GLB_URLS).forEach((url) => {
  useGLTF.preload(url)
})

export default AlienGlbCharacter
