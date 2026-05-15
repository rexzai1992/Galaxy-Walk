import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const FALLBACK_FACE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7+1q8AAAAASUVORK5CYII='

const STYLE_BY_TYPE = {
  astronaut: {
    bodyColor: '#e8edf8',
    accentColor: '#4a8dff',
    legColor: '#d0d8ea',
    headColor: '#f4f7ff',
    faceScale: [0.68, 0.74],
    helmet: true,
    antenna: false,
    robotEye: false,
    shoulderPads: true,
  },
  alien: {
    bodyColor: '#78d760',
    accentColor: '#3f7f42',
    legColor: '#67bd55',
    headColor: '#98f080',
    faceScale: [0.62, 0.7],
    helmet: false,
    antenna: true,
    robotEye: false,
    shoulderPads: false,
  },
  human: {
    bodyColor: '#4e6ca8',
    accentColor: '#f0c197',
    legColor: '#283757',
    headColor: '#f0c197',
    faceScale: [0.64, 0.74],
    helmet: false,
    antenna: false,
    robotEye: false,
    shoulderPads: false,
  },
  robot: {
    bodyColor: '#8d96ac',
    accentColor: '#4ef2ff',
    legColor: '#646d82',
    headColor: '#9fa8be',
    faceScale: [0.66, 0.7],
    helmet: false,
    antenna: true,
    robotEye: true,
    shoulderPads: true,
  },
}

function normalizeType(characterType) {
  return String(characterType || 'human').trim().toLowerCase()
}

function createFaceTexture(faceTextureUrl) {
  const loader = new THREE.TextureLoader()
  const texture = loader.load(faceTextureUrl || FALLBACK_FACE_DATA_URL)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearFilter
  texture.magFilter = THREE.LinearFilter
  return texture
}

function ParadeCharacter({
  characterType = 'human',
  faceTextureUrl = '',
  position = [0, 0, 0],
  isWalking = false,
  walkSpeed = 1,
  paradeAnimation = 'idle',
}) {
  const normalizedType = normalizeType(characterType)
  const style = STYLE_BY_TYPE[normalizedType] || STYLE_BY_TYPE.human

  const faceTexture = useMemo(() => createFaceTexture(faceTextureUrl), [faceTextureUrl])

  const bobGroupRef = useRef(null)
  const leftArmRef = useRef(null)
  const rightArmRef = useRef(null)
  const leftLegRef = useRef(null)
  const rightLegRef = useRef(null)
  const walkPhaseRef = useRef(0)

  useEffect(() => {
    walkPhaseRef.current = Math.random() * Math.PI * 2
  }, [])

  useFrame((_, delta) => {
    const speedScale = Math.max(0.65, walkSpeed)
    walkPhaseRef.current += delta * (3.5 + speedScale * 1.6)

    if (isWalking) {
      const swingAmount = normalizedType === 'robot' ? 0.34 : 0.52
      const swing = Math.sin(walkPhaseRef.current) * swingAmount
      const bob = Math.abs(Math.sin(walkPhaseRef.current * 2)) * 0.08

      if (bobGroupRef.current) bobGroupRef.current.position.y = bob
      if (leftArmRef.current) leftArmRef.current.rotation.x = swing
      if (rightArmRef.current) rightArmRef.current.rotation.x = -swing
      if (leftLegRef.current) leftLegRef.current.rotation.x = -swing
      if (rightLegRef.current) rightLegRef.current.rotation.x = swing
      return
    }

    const sway = Math.sin(walkPhaseRef.current)
    const swayFast = Math.sin(walkPhaseRef.current * 1.8)

    if (paradeAnimation === 'wave') {
      if (bobGroupRef.current) bobGroupRef.current.position.y = Math.abs(swayFast) * 0.04
      if (leftArmRef.current) leftArmRef.current.rotation.x = sway * 0.12
      if (rightArmRef.current) rightArmRef.current.rotation.x = 1.15 + swayFast * 0.55
      if (leftLegRef.current) leftLegRef.current.rotation.x = 0
      if (rightLegRef.current) rightLegRef.current.rotation.x = 0
      return
    }

    if (paradeAnimation === 'dance') {
      if (bobGroupRef.current) bobGroupRef.current.position.y = Math.abs(swayFast) * 0.1
      if (leftArmRef.current) leftArmRef.current.rotation.x = swayFast * 0.72
      if (rightArmRef.current) rightArmRef.current.rotation.x = -swayFast * 0.72
      if (leftLegRef.current) leftLegRef.current.rotation.x = -sway * 0.28
      if (rightLegRef.current) rightLegRef.current.rotation.x = sway * 0.28
      return
    }

    if (paradeAnimation === 'pose') {
      if (bobGroupRef.current) bobGroupRef.current.position.y = 0.03 + Math.abs(sway) * 0.03
      if (leftArmRef.current) leftArmRef.current.rotation.x = 0.22
      if (rightArmRef.current) rightArmRef.current.rotation.x = 0.72
      if (leftLegRef.current) leftLegRef.current.rotation.x = -0.08
      if (rightLegRef.current) rightLegRef.current.rotation.x = 0.08
      return
    }

    if (bobGroupRef.current) bobGroupRef.current.position.y = Math.abs(sway) * 0.03
    if (leftArmRef.current) leftArmRef.current.rotation.x = sway * 0.1
    if (rightArmRef.current) rightArmRef.current.rotation.x = -sway * 0.1
    if (leftLegRef.current) leftLegRef.current.rotation.x = 0
    if (rightLegRef.current) rightLegRef.current.rotation.x = 0
  })

  const [faceW, faceH] = style.faceScale
  const usesFaceTexture = Boolean(faceTextureUrl)

  return (
    // Root group keeps position/scale contract stable so swapping to GLB later is straightforward.
    <group position={position}>
      <group ref={bobGroupRef}>
        <mesh position={[0, 2.3, 0]} castShadow>
          {normalizedType === 'robot' ? <boxGeometry args={[1.35, 1.2, 1.15]} /> : <dodecahedronGeometry args={[0.74, 0]} />}
          <meshStandardMaterial color={style.headColor} roughness={0.72} metalness={normalizedType === 'robot' ? 0.45 : 0.1} />
        </mesh>

        <mesh position={[0, 2.28, 0.59]} castShadow>
          <planeGeometry args={[faceW, faceH]} />
          <meshStandardMaterial
            color={usesFaceTexture ? '#ffffff' : '#dbe6ff'}
            map={usesFaceTexture ? faceTexture : null}
            roughness={0.8}
            metalness={0.02}
            transparent={usesFaceTexture}
          />
        </mesh>

        <mesh position={[0, 1.12, 0]} castShadow>
          <capsuleGeometry args={[0.47, 1.32, 4, 6]} />
          <meshStandardMaterial color={style.bodyColor} roughness={0.72} metalness={normalizedType === 'robot' ? 0.42 : 0.08} />
        </mesh>

        <group ref={leftArmRef} position={[-0.72, 1.16, 0]} rotation-z={0.1}>
          <mesh castShadow>
            <capsuleGeometry args={[0.17, 0.92, 4, 6]} />
            <meshStandardMaterial color={style.bodyColor} roughness={0.72} metalness={normalizedType === 'robot' ? 0.32 : 0.06} />
          </mesh>
        </group>

        <group ref={rightArmRef} position={[0.72, 1.16, 0]} rotation-z={-0.1}>
          <mesh castShadow>
            <capsuleGeometry args={[0.17, 0.92, 4, 6]} />
            <meshStandardMaterial color={style.bodyColor} roughness={0.72} metalness={normalizedType === 'robot' ? 0.32 : 0.06} />
          </mesh>
        </group>

        <group ref={leftLegRef} position={[-0.3, 0.14, 0.02]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.18, 0.98, 4, 6]} />
            <meshStandardMaterial color={style.legColor} roughness={0.84} metalness={normalizedType === 'robot' ? 0.36 : 0.08} />
          </mesh>
        </group>

        <group ref={rightLegRef} position={[0.3, 0.14, 0.02]}>
          <mesh castShadow>
            <capsuleGeometry args={[0.18, 0.98, 4, 6]} />
            <meshStandardMaterial color={style.legColor} roughness={0.84} metalness={normalizedType === 'robot' ? 0.36 : 0.08} />
          </mesh>
        </group>

        {style.shoulderPads ? (
          <>
            <mesh position={[-0.45, 1.7, 0]} castShadow>
              <boxGeometry args={[0.36, 0.22, 0.52]} />
              <meshStandardMaterial color={style.accentColor} roughness={0.58} metalness={0.3} />
            </mesh>
            <mesh position={[0.45, 1.7, 0]} castShadow>
              <boxGeometry args={[0.36, 0.22, 0.52]} />
              <meshStandardMaterial color={style.accentColor} roughness={0.58} metalness={0.3} />
            </mesh>
          </>
        ) : null}

        {style.helmet ? (
          <mesh position={[0, 2.34, 0]} scale={[1.28, 1.2, 1.24]}>
            <sphereGeometry args={[0.82, 20, 18]} />
            <meshStandardMaterial color="#9fd6ff" transparent opacity={0.18} roughness={0.1} metalness={0.18} />
          </mesh>
        ) : null}

        {style.antenna ? (
          <>
            <mesh position={[0, 3.02, 0]} castShadow>
              <cylinderGeometry args={[0.05, 0.05, 0.54, 8]} />
              <meshStandardMaterial color={style.accentColor} roughness={0.5} metalness={0.48} />
            </mesh>
            <mesh position={[0, 3.35, 0]} castShadow>
              <sphereGeometry args={[0.1, 12, 12]} />
              <meshStandardMaterial color={style.accentColor} emissive={style.accentColor} emissiveIntensity={0.45} />
            </mesh>
          </>
        ) : null}

        {style.robotEye ? (
          <mesh position={[0, 2.44, 0.59]}>
            <boxGeometry args={[0.58, 0.1, 0.02]} />
            <meshStandardMaterial color={style.accentColor} emissive={style.accentColor} emissiveIntensity={0.58} />
          </mesh>
        ) : null}
      </group>
    </group>
  )
}

export default ParadeCharacter
