import { useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { FACE_LAYOUT, FACE_OVAL } from '../../lib/faceLayout'

// Head geometry is authored in "head units": about 1.7 wide, 2.1 tall, front = +Z.
const HEAD_WIDTH = 0.83
const HEAD_DEPTH = 0.93
const HEAD_TOP = 1.02
const HEAD_CHIN = 1.05
const EYE_LINE_Y = 0.16
// How many head units one face-layout image width covers (orthographic projection).
const FACE_PROJECTION_SCALE = 0.33
// A touch of self-light keeps the photo readable on dark backgrounds while the
// scene lights still give the head its roundness.
const HEAD_SELF_LIGHT = 0.12
// Extra self-light on the photo so the guest's face stays bright and recognisable.
const FACE_SELF_LIGHT = 0.5

let sharedHeadGeometry = null

function getHeadGeometry() {
  if (sharedHeadGeometry) return sharedHeadGeometry
  const geometry = new THREE.SphereGeometry(1, 64, 48)
  const position = geometry.attributes.position
  const vertex = new THREE.Vector3()
  for (let i = 0; i < position.count; i += 1) {
    vertex.fromBufferAttribute(position, i)
    const isLower = vertex.y < 0
    // Rounder cranium, tapered jaw and a slightly flatter face.
    const jawTaper = isLower ? 1 - 0.2 * Math.pow(-vertex.y, 1.4) : 1
    const faceFlatten = vertex.z > 0 ? 1 - 0.06 * vertex.z : 1
    vertex.set(
      vertex.x * HEAD_WIDTH * jawTaper,
      vertex.y * (isLower ? HEAD_CHIN : HEAD_TOP),
      vertex.z * HEAD_DEPTH * jawTaper * faceFlatten,
    )
    position.setXYZ(i, vertex.x, vertex.y, vertex.z)
  }
  geometry.computeVertexNormals()
  sharedHeadGeometry = geometry
  return geometry
}

function createHeadMaterial() {
  const uniforms = {
    uFaceMap: { value: null },
    uSkin: { value: new THREE.Color('#d9a27e') },
    uHair: { value: new THREE.Color('#2b1d16') },
    uFaceScale: { value: FACE_PROJECTION_SCALE },
    uFaceOffset: { value: new THREE.Vector2(0, 0) },
    uSelfLight: { value: HEAD_SELF_LIGHT },
    uFaceLight: { value: FACE_SELF_LIGHT },
  }

  const material = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0 })
  material.name = 'SelfieHeadMaterial'
  material.userData.headUniforms = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHeadPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeadPos = position;')

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vHeadPos;
uniform sampler2D uFaceMap;
uniform vec3 uSkin;
uniform vec3 uHair;
uniform float uFaceScale;
uniform vec2 uFaceOffset;
uniform float uSelfLight;
uniform float uFaceLight;`,
      )
      .replace(
        '#include <map_fragment>',
        `float headFaceMask = 0.0;
{
  vec3 dir = normalize(vHeadPos);
  // Hair covers the crown and the back of the head; sides and nape stay skin.
  float hairSignal = dir.y + (-dir.z) * 0.55 + max(dir.y, 0.0) * max(-dir.z, 0.0) * 0.3;
  vec3 baseColor = mix(uSkin, uHair, smoothstep(0.08, 0.3, hairSignal));

  // Orthographic front projection of the aligned selfie (layout uv, y down).
  vec2 faceUv = vec2(
    ${FACE_LAYOUT.eyeCenterX.toFixed(3)} + vHeadPos.x * uFaceScale,
    ${FACE_LAYOUT.eyeCenterY.toFixed(3)} - (vHeadPos.y - ${EYE_LINE_Y.toFixed(3)}) * uFaceScale
  ) + uFaceOffset;
  vec2 oval = (faceUv - vec2(${FACE_OVAL.centerX.toFixed(3)}, ${FACE_OVAL.centerY.toFixed(3)}))
    / vec2(${FACE_OVAL.radiusX.toFixed(3)}, ${FACE_OVAL.radiusY.toFixed(3)});
  float faceMask = (1.0 - smoothstep(0.72, 1.0, length(oval))) * smoothstep(0.18, 0.5, dir.z);
  headFaceMask = faceMask;
  vec3 photo = texture2D(uFaceMap, vec2(faceUv.x, 1.0 - faceUv.y)).rgb;
  diffuseColor.rgb = mix(baseColor, photo, faceMask);
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        'totalEmissiveRadiance += diffuseColor.rgb * (uSelfLight + headFaceMask * uFaceLight);',
      )
  }
  material.customProgramCacheKey = () => 'selfie-head-v2'
  return material
}

function applyFaceToMaterials(headMaterial, skinMaterial, face) {
  const uniforms = headMaterial.userData.headUniforms
  const skinHex = face?.skinHex || '#d9a27e'
  uniforms.uFaceMap.value = face?.texture || null
  uniforms.uSkin.value.set(skinHex)
  uniforms.uHair.value.set(face?.hairHex || '#2b1d16')
  setSkin(skinMaterial, skinHex)
}

function applyFaceFit(headMaterial, faceZoom, faceOffsetY) {
  const uniforms = headMaterial.userData.headUniforms
  uniforms.uFaceScale.value = FACE_PROJECTION_SCALE / Math.max(0.4, Number(faceZoom) || 1)
  uniforms.uFaceOffset.value.set(0, Number(faceOffsetY) || 0)
}

function createSkinMaterial() {
  return new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0, name: 'SelfieSkinMaterial' })
}

function setSkin(material, hex) {
  material.color.set(hex)
  material.emissive.set(hex)
  material.emissiveIntensity = HEAD_SELF_LIGHT
}

// Head props share geometry and materials across every character instance.
const propCache = new Map()

function cached(key, create) {
  if (!propCache.has(key)) propCache.set(key, create())
  return propCache.get(key)
}

function propMaterial(color, { roughness = 0.45, metalness = 0, emissive = null, emissiveIntensity = 0 } = {}) {
  return cached(`mat:${color}:${roughness}:${metalness}:${emissive}:${emissiveIntensity}`, () => new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness,
    emissive: emissive || '#000000',
    emissiveIntensity,
    side: THREE.DoubleSide,
  }))
}

// Helmet shell around the selfie head with a round face window at the front,
// as in the astronaut and robot concept art.
const SHELL_RADIUS = 1.34
const SHELL_OPENING = THREE.MathUtils.degToRad(56)

function shellGeometry() {
  return cached('geo:shell', () => {
    const points = []
    const steps = 20
    for (let i = 0; i <= steps; i += 1) {
      const theta = SHELL_OPENING + ((Math.PI - SHELL_OPENING) * i) / steps
      points.push(new THREE.Vector2(Math.sin(theta) * SHELL_RADIUS, Math.cos(theta) * SHELL_RADIUS))
    }
    const geometry = new THREE.LatheGeometry(points, 36)
    geometry.rotateX(Math.PI / 2)
    return geometry
  })
}

const rimGeometry = () => cached('geo:rim', () => new THREE.TorusGeometry(Math.sin(SHELL_OPENING) * SHELL_RADIUS, 0.09, 10, 40))
const earDiscGeometry = () => cached('geo:earDisc', () => new THREE.CylinderGeometry(0.42, 0.42, 0.2, 24).rotateZ(Math.PI / 2))
const earCapGeometry = () => cached('geo:earCap', () => new THREE.CylinderGeometry(0.25, 0.25, 0.12, 20).rotateZ(Math.PI / 2))
const stalkGeometry = () => cached('geo:stalk', () => new THREE.CylinderGeometry(0.05, 0.065, 0.76, 10))
const bulbGeometry = () => cached('geo:bulb', () => new THREE.SphereGeometry(0.15, 16, 12))

function HelmetShell({ shellColor, rimColor, earColor, earCapColor }) {
  const rimZ = Math.cos(SHELL_OPENING) * SHELL_RADIUS
  return (
    <group>
      <mesh geometry={shellGeometry()} material={propMaterial(shellColor, { roughness: 0.32 })} />
      <mesh geometry={rimGeometry()} material={propMaterial(rimColor, { roughness: 0.4 })} position={[0, 0, rimZ]} />
      {[-1, 1].map((side) => (
        <group key={side} position={[side * SHELL_RADIUS * 0.97, -0.05, 0]}>
          <mesh geometry={earDiscGeometry()} material={propMaterial(earColor, { roughness: 0.38 })} />
          {earCapColor ? (
            <mesh geometry={earCapGeometry()} material={propMaterial(earCapColor, { roughness: 0.4 })} position={[side * 0.1, 0, 0]} />
          ) : null}
        </group>
      ))}
    </group>
  )
}

function Antenna({ position, rotationZ = 0, stalkColor, bulbColor }) {
  return (
    <group position={position} rotation={[0, 0, rotationZ]}>
      <mesh geometry={stalkGeometry()} material={propMaterial(stalkColor, { roughness: 0.5 })} position={[0, 0.38, 0]} />
      <mesh
        geometry={bulbGeometry()}
        material={propMaterial(bulbColor, { roughness: 0.3, emissive: bulbColor, emissiveIntensity: 0.9 })}
        position={[0, 0.8, 0]}
      />
    </group>
  )
}

function HeadProp({ type }) {
  if (type === 'antennae') {
    return (
      <>
        <Antenna position={[-0.34, 0.88, -0.05]} rotationZ={0.38} stalkColor="#b8ec3c" bulbColor="#d9ff5c" />
        <Antenna position={[0.34, 0.88, -0.05]} rotationZ={-0.38} stalkColor="#b8ec3c" bulbColor="#d9ff5c" />
      </>
    )
  }
  if (type === 'astronaut-helmet') {
    return <HelmetShell shellColor="#eef1f6" rimColor="#3d434f" earColor="#eef1f6" earCapColor="#f0782a" />
  }
  if (type === 'robot-helmet') {
    return (
      <>
        <HelmetShell shellColor="#eef1f6" rimColor="#6c7380" earColor="#1fb3ad" />
        <Antenna position={[0, SHELL_RADIUS - 0.05, 0]} stalkColor="#9aa5b8" bulbColor="#2fd6cf" />
      </>
    )
  }
  return null
}

/**
 * A human-shaped head that wears the guest's aligned selfie. Rendered in head
 * units; the parent decides where it sits on the body and how big it is.
 */
function SelfieHead({ face, headProp = null, faceZoom = 1, faceOffsetY = 0 }) {
  const geometry = getHeadGeometry()
  const headMaterial = useMemo(() => createHeadMaterial(), [])
  const skinMaterial = useMemo(() => createSkinMaterial(), [])

  useEffect(() => {
    applyFaceToMaterials(headMaterial, skinMaterial, face)
  }, [face, headMaterial, skinMaterial])

  useEffect(() => {
    applyFaceFit(headMaterial, faceZoom, faceOffsetY)
  }, [faceZoom, faceOffsetY, headMaterial])

  useEffect(() => () => {
    headMaterial.dispose()
    skinMaterial.dispose()
  }, [headMaterial, skinMaterial])

  // Helmets cover the ears.
  const showEars = headProp !== 'astronaut-helmet' && headProp !== 'robot-helmet'

  return (
    <group>
      <mesh geometry={geometry} material={headMaterial} />
      {showEars
        ? [-1, 1].map((side) => (
          <mesh
            key={side}
            material={skinMaterial}
            position={[side * 0.82, -0.02, -0.02]}
            rotation={[0, side * 0.35, 0]}
            scale={[0.12, 0.25, 0.16]}
          >
            <sphereGeometry args={[1, 16, 12]} />
          </mesh>
        ))
        : null}
      {/* Short neck tucked behind the collar so it never pokes through the shirt. */}
      <mesh material={skinMaterial} position={[0, -1.02, -0.16]}>
        <cylinderGeometry args={[0.3, 0.33, 0.42, 20]} />
      </mesh>
      <HeadProp type={headProp} />
    </group>
  )
}

export default SelfieHead
