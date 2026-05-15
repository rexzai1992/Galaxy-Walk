import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useAnimations, useGLTF } from '@react-three/drei'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import { CHARACTER_GLB_URL } from './alienGlbConfig'

const FACE_SLOT_NAME = 'FaceSlot'
const DEFAULT_ANIMATION_INTENT = 'idle'
const ANIMATION_KEYWORD_MAP = {
  idle: ['idle', 'stand', 'breath', 'rest'],
  wave: ['wave', 'hello', 'greet'],
  dance: ['dance', 'groove'],
  pose: ['pose', 'jump', 'celebrate'],
}
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

  const nextMaterial = new THREE.MeshBasicMaterial({
    map: texture || null,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  nextMaterial.name = 'FaceSlotPhotoMaterial'

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
}

function cloneConfiguredTexture(sourceTexture) {
  if (!sourceTexture) return null
  const clonedTexture = sourceTexture.clone()
  clonedTexture.colorSpace = THREE.SRGBColorSpace
  clonedTexture.flipY = false
  clonedTexture.needsUpdate = true
  return clonedTexture
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
  const faceSlotMeshRef = useRef(null)
  const activeActionRef = useRef(null)
  const currentAnimationNameRef = useRef('')
  const faceSlotFoundRef = useRef(false)
  const faceSlotMaterialNameRef = useRef('')
  const faceImageLoadedRef = useRef(false)
  const fallbackFaceTexture = useMemo(() => createFallbackFaceTexture(), [])

  const characterGltf = useGLTF(CHARACTER_GLB_URL)
  const clips = useMemo(() => {
    return Array.isArray(characterGltf?.animations) ? characterGltf.animations : []
  }, [characterGltf])
  const meshNames = useMemo(() => {
    if (!characterGltf?.scene) return []
    return collectMeshNames(characterGltf.scene)
  }, [characterGltf])
  const animationNames = useMemo(() => collectAnimationNames(clips), [clips])

  const clonedScene = useMemo(() => {
    if (!characterGltf?.scene) return null
    return SkeletonUtils.clone(characterGltf.scene)
  }, [characterGltf])

  const targetClipName = useMemo(() => {
    return resolveAnimationClipName(paradeAnimation, clips)
  }, [paradeAnimation, clips])

  const { actions } = useAnimations(clips, groupRef)

  const emitDebug = useCallback(() => {
    if (!onDebugInfoChange) return
    onDebugInfoChange({
      modelLoaded: Boolean(characterGltf?.scene),
      faceSlotFound: faceSlotFoundRef.current,
      faceSlotMaterialName: faceSlotMaterialNameRef.current,
      imageLoaded: faceImageLoadedRef.current,
      currentAnimationName: currentAnimationNameRef.current || targetClipName || '',
      meshNames,
      animationNames,
    })
  }, [onDebugInfoChange, characterGltf, targetClipName, meshNames, animationNames])

  useEffect(() => {
    if (!characterGltf?.scene || didLogGlbDebug) return
    didLogGlbDebug = true

    const sourceFaceSlotMesh = findFaceSlotMesh(characterGltf.scene)
    const isFound = Boolean(sourceFaceSlotMesh)
    const sourceFaceSlotMaterialName = getFaceSlotMaterialName(sourceFaceSlotMesh)

    console.log('[AlienGlbCharacter] GLB mesh names:', meshNames)
    console.log('[AlienGlbCharacter] FaceSlot found:', isFound)
    console.log('[AlienGlbCharacter] FaceSlot material name:', sourceFaceSlotMaterialName || '(none)')
    console.log('[AlienGlbCharacter] GLB animation names:', animationNames)
    if (!isFound) {
      console.warn('[AlienGlbCharacter] FaceSlot mesh not found in /models/character.glb')
    }
  }, [characterGltf, meshNames, animationNames])

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
      createdTexture = cloneConfiguredTexture(faceTexture)
      applyFaceTexture(createdTexture, true)
      return () => {
        disposed = true
        if (createdTexture?.dispose) {
          createdTexture.dispose()
        }
      }
    }

    if (faceTextureUrl && !forceFallbackFace) {
      const loader = new THREE.TextureLoader()
      createdTexture = loader.load(
        faceTextureUrl,
        () => {
          if (!createdTexture) return
          createdTexture.colorSpace = THREE.SRGBColorSpace
          createdTexture.flipY = false
          createdTexture.needsUpdate = true
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
    if (!actions) return
    Object.values(actions).forEach((action) => {
      action.enabled = true
      action.setEffectiveWeight(1)
      action.setEffectiveTimeScale(Math.max(0.1, animationSpeed))
    })
  }, [actions, animationSpeed])

  useEffect(() => {
    if (!actions) return undefined

    const allActions = Object.values(actions)
    if (allActions.length === 0) return undefined
    const nextAction = actions[targetClipName] || allActions[0]
    if (!nextAction) return undefined

    if (activeActionRef.current && activeActionRef.current !== nextAction) {
      activeActionRef.current.fadeOut(0.2)
    }

    nextAction.reset()
    nextAction.fadeIn(0.2)
    nextAction.play()
    activeActionRef.current = nextAction
    currentAnimationNameRef.current = String(nextAction.getClip()?.name || targetClipName || '')
    emitDebug()

    return undefined
  }, [actions, targetClipName, emitDebug])

  useEffect(() => {
    return () => {
      if (!actions) return
      Object.values(actions).forEach((action) => {
        action.stop()
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

export default AlienGlbCharacter
