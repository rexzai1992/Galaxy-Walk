import { useEffect, useMemo, useRef } from 'react'
import { createPortal, useFrame } from '@react-three/fiber'
import { useAnimations, useGLTF } from '@react-three/drei'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import * as THREE from 'three'
import { DEFAULT_ALIEN_FACE_CALIBRATION } from '../../lib/alienFaceCalibration'
import { ANIMATED_CHARACTER_GLB_URLS, CHARACTER_GLB_URL } from '../main/alienGlbConfig'
import { applyVariantToBodyMaterial, createAvatarBodyMaterial, findHeadJointIndices } from './bodyMaterial'
import { resolveCharacterVariant } from './characterVariants'
import { createProceduralBodyMaterial, getProceduralBodyGeometry, setProceduralBodySkin } from './proceduralBodies'
import SelfieHead from './SelfieHead.jsx'
import { useSelfieFace } from './useSelfieFace'

const DEFAULT_ANIMATION_INTENT = 'idle'
const ANIMATION_INTENTS = ['idle', 'wave', 'dance', 'pose']
const ANIMATION_URLS = ANIMATION_INTENTS.map((intent) => ANIMATED_CHARACTER_GLB_URLS[intent] || CHARACTER_GLB_URL)
const CROSSFADE_SECONDS = 0.35
// Bobblehead: the selfie head wobbles on its neck, more while dancing.
const HEAD_WOBBLE = { idle: 0.05, wave: 0.07, dance: 0.16, pose: 0.13 }
const HEAD_WOBBLE_SPEED = 5.2
// Neck pivot below the head centre, in head units.
const HEAD_PIVOT_DROP = 0.95
const MODEL_BASE_SCALE = 2.05
// Where the selfie head sits on the body, in model space at rest pose (metres).
const HEAD_ANCHOR = new THREE.Vector3(0, 1.3, 0.04)
const HEAD_BASE_SIZE = 0.3
const STATIC_CLIP_DURATION_EPSILON = 0.05

const DEFAULT_HEAD_CALIBRATION = DEFAULT_ALIEN_FACE_CALIBRATION.head

function resolveAnimationIntent(paradeAnimation) {
  const intent = String(paradeAnimation || DEFAULT_ANIMATION_INTENT).toLowerCase()
  return ANIMATION_INTENTS.includes(intent) ? intent : DEFAULT_ANIMATION_INTENT
}

function hasMotionTrack(clip) {
  if (!clip || !Array.isArray(clip.tracks)) return false
  if (!Number.isFinite(clip.duration) || clip.duration <= STATIC_CLIP_DURATION_EPSILON) return false
  return clip.tracks.some((track) => Number(track?.times?.length || 0) > 1)
}

// One clip per intent, renamed to the intent so actions are addressable by move.
function buildIntentClips(animationGltfs) {
  return ANIMATION_INTENTS.map((intent, index) => {
    const source = (animationGltfs[index]?.animations || []).find(hasMotionTrack)
    if (!source) return null
    const clip = source.clone()
    clip.name = intent
    return clip
  }).filter(Boolean)
}

function crossfadeTo(previous, next, speed, restart) {
  if (previous === next) {
    if (restart) next.reset().play()
    next.setEffectiveTimeScale(speed)
    return
  }
  next.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1).play()
  if (previous) previous.crossFadeTo(next, CROSSFADE_SECONDS, false)
  else next.fadeIn(CROSSFADE_SECONDS)
}

// Clones the base GLB for one parade character and prepares it for a selfie head.
function buildAvatarRig(sourceScene) {
  const scene = SkeletonUtils.clone(sourceScene)
  const bodyMaterials = []
  let headBone = null
  let headJointIndices = null
  let bodyMesh = null

  scene.traverse((node) => {
    if (node.isBone && node.name === 'Head') headBone = node
    if (!node.isMesh) return
    if (node.name === 'FaceSlot') {
      // The selfie now lives on a full 3D head instead of the flat face slot.
      node.visible = false
      return
    }
    if (node.isSkinnedMesh) {
      const meshHeadJoints = findHeadJointIndices(node)
      headJointIndices = headJointIndices || meshHeadJoints
      const material = createAvatarBodyMaterial(node.material, { headJointIndices: meshHeadJoints })
      node.material = material
      bodyMaterials.push(material)
      bodyMesh = bodyMesh || node
    }
    node.frustumCulled = false
  })

  // Rest-pose joint positions (same space as the body vertices) for code-built bodies.
  scene.updateMatrixWorld(true)
  const joints = {}
  const boneIndexByName = {}
  bodyMesh?.skeleton?.bones.forEach((bone, index) => {
    joints[bone.name] = bone.getWorldPosition(new THREE.Vector3())
    boneIndexByName[bone.name] = index
  })

  let headAnchor = null
  if (headBone && headJointIndices) {
    const desired = new THREE.Matrix4().makeTranslation(HEAD_ANCHOR.x, HEAD_ANCHOR.y, HEAD_ANCHOR.z)
    const local = headBone.matrixWorld.clone().invert().multiply(desired)
    const position = new THREE.Vector3()
    const quaternion = new THREE.Quaternion()
    const scale = new THREE.Vector3()
    local.decompose(position, quaternion, scale)
    headAnchor = { position, quaternion, scale }
  } else {
    console.warn('[AvatarCharacter] Head bone not found; selfie head disabled for this model.')
  }

  return {
    scene,
    headBone: headAnchor ? headBone : null,
    headAnchor,
    bodyMaterials,
    bodyMesh,
    joints,
    boneIndexByName,
    dispose() {
      bodyMaterials.forEach((material) => material.dispose())
    },
  }
}

/**
 * Swaps the sculpted Meshy body for a code-built one (Astronaut, Human, Robot).
 * The new skinned mesh shares the rig's skeleton and bind matrix, so the same
 * animation clips drive it. Returns a cleanup function.
 */
function attachProceduralBody(rig, variant) {
  const bodyMesh = rig.bodyMesh
  if (!bodyMesh || variant.body === 'meshy') return { material: null, detach: () => {} }

  const geometry = getProceduralBodyGeometry(variant.body, rig.joints, rig.boneIndexByName)
  if (!geometry) return { material: null, detach: () => {} }

  const material = createProceduralBodyMaterial(variant.surface)
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.name = `${variant.id}-body`
  mesh.bind(bodyMesh.skeleton, bodyMesh.bindMatrix)
  mesh.frustumCulled = false
  bodyMesh.parent.add(mesh)
  bodyMesh.visible = false

  return {
    material,
    detach() {
      bodyMesh.parent?.remove(mesh)
      bodyMesh.visible = true
      material.dispose()
    },
  }
}

function AvatarCharacter({
  position = [0, 0, 0],
  characterType = 'alien',
  paradeAnimation = DEFAULT_ANIMATION_INTENT,
  animationSpeed = 1,
  faceTextureUrl = '',
  faceTexture = null,
  modelScale = 1,
  headCalibration = DEFAULT_HEAD_CALIBRATION,
  // Changing this restarts the current move from frame 0 (synchronised group dances).
  syncKey = 0,
  onDebugInfoChange,
}) {
  const groupRef = useRef(null)
  const wobbleRef = useRef(null)
  const activeActionRef = useRef(null)
  const syncKeyRef = useRef(syncKey)
  const motionPhaseRef = useRef(0)
  const variant = resolveCharacterVariant(characterType)
  const animationIntent = resolveAnimationIntent(paradeAnimation)

  const baseGltf = useGLTF(CHARACTER_GLB_URL)
  // All moves are loaded once and cross-faded, so switching moves is instant.
  const animationGltfs = useGLTF(ANIMATION_URLS)
  const clips = useMemo(() => buildIntentClips(animationGltfs), [animationGltfs])
  const hasClipAnimation = clips.length > 0

  const rig = useMemo(() => buildAvatarRig(baseGltf.scene), [baseGltf])
  useEffect(() => () => rig.dispose(), [rig])

  const face = useSelfieFace({ faceTextureUrl, faceTexture })

  useEffect(() => {
    rig.bodyMaterials.forEach((material) => applyVariantToBodyMaterial(material, variant, face.skinHex))
  }, [rig, variant, face.skinHex])

  const proceduralBodyRef = useRef(null)
  useEffect(() => {
    const attached = attachProceduralBody(rig, variant)
    proceduralBodyRef.current = attached
    return attached.detach
  }, [rig, variant])

  // Declared after the attach effect so it also runs right after a body swap.
  useEffect(() => {
    setProceduralBodySkin(proceduralBodyRef.current?.material, face.skinHex)
  }, [rig, variant, face.skinHex])

  const { actions } = useAnimations(clips, groupRef)

  useEffect(() => {
    const nextAction = actions?.[animationIntent] || actions?.[DEFAULT_ANIMATION_INTENT]
    if (!nextAction) return
    const restart = syncKeyRef.current !== syncKey
    syncKeyRef.current = syncKey
    crossfadeTo(activeActionRef.current, nextAction, Math.max(0.1, animationSpeed), restart)
    activeActionRef.current = nextAction
  }, [actions, animationIntent, animationSpeed, syncKey])

  useEffect(() => () => {
    Object.values(actions || {}).forEach((action) => action?.stop())
  }, [actions])

  useEffect(() => {
    if (!onDebugInfoChange) return
    onDebugInfoChange({
      modelLoaded: Boolean(baseGltf?.scene),
      headBoneFound: Boolean(rig.headBone),
      imageLoaded: Boolean(face.isPhoto),
      characterVariant: variant.label,
      currentAnimationName: hasClipAnimation ? animationIntent : `procedural:${animationIntent}`,
      animationNames: clips.map((clip) => String(clip?.name || '')),
    })
  }, [onDebugInfoChange, baseGltf, rig, face.isPhoto, variant, clips, hasClipAnimation, animationIntent, actions])

  useFrame((_, delta) => {
    motionPhaseRef.current += delta
    const t = motionPhaseRef.current
    // Bobblehead wobble on the neck pivot.
    const wobble = wobbleRef.current
    if (wobble) {
      const amount = HEAD_WOBBLE[animationIntent] ?? 0.06
      wobble.rotation.z = Math.sin(t * HEAD_WOBBLE_SPEED) * amount
      wobble.rotation.x = Math.sin(t * HEAD_WOBBLE_SPEED * 0.5 + 1.3) * amount * 0.5
    }
    // Gentle procedural bounce for models without usable animation clips.
    if (!hasClipAnimation && groupRef.current) {
      groupRef.current.position.y = Number(position?.[1] || 0) + Math.abs(Math.sin(t * (2 + animationSpeed))) * 0.05
    }
  })

  const head = { ...DEFAULT_HEAD_CALIBRATION, ...(headCalibration || {}) }
  const headSize = HEAD_BASE_SIZE * head.scale
  const scale = MODEL_BASE_SCALE * modelScale

  return (
    <group ref={groupRef} position={position} scale={[scale, scale, scale]}>
      <primitive object={rig.scene} />
      {rig.headBone
        ? createPortal(
          <group position={rig.headAnchor.position} quaternion={rig.headAnchor.quaternion} scale={rig.headAnchor.scale}>
            <group ref={wobbleRef} position={[head.x, head.y - HEAD_PIVOT_DROP * headSize, head.z]}>
              <group position={[0, HEAD_PIVOT_DROP * headSize, 0]} scale={[headSize, headSize, headSize]}>
                <SelfieHead
                  face={face}
                  headProp={variant.headProp}
                  faceZoom={head.faceZoom}
                  faceOffsetY={head.faceY}
                />
              </group>
            </group>
          </group>,
          rig.headBone,
        )
        : null}
    </group>
  )
}

useGLTF.preload(CHARACTER_GLB_URL)
ANIMATION_URLS.forEach((url) => useGLTF.preload(url))

export default AvatarCharacter
