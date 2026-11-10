import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// Code-built bodies for the Astronaut, Human and Robot, designed from
// assets/reference/characters. Every part is rigidly attached to a bone of the
// Meshy alien skeleton, so they play the same idle/wave/dance/pose clips.
//
// Lightweight by design: all parts of one character type are merged into a
// single skinned geometry (one draw call, vertex colours instead of textures)
// that is built once and shared by every instance of that type.

const COLORS = {
  white: '#eef1f6',
  offWhite: '#dfe4ec',
  gray: '#6c7380',
  darkGray: '#3d434f',
  orange: '#f0782a',
  yellow: '#f6c33b',
  mustard: '#e9a92c',
  blue: '#2f7de1',
  teal: '#1fb3ad',
  navy: '#1e2a45',
  denimDark: '#18213a',
  black: '#1a1d24',
}

// Marker for parts painted with the guest's skin tone (resolved in the shader).
const SKIN = 'skin'

// A point is a joint's rest position plus an offset (metres, model space; +x is
// the character's left, +z its front), or a blend between two joints.
const at = (joint, dx = 0, dy = 0, dz = 0) => ({ joint, offset: [dx, dy, dz] })
const between = (jointA, jointB, t, dx = 0, dy = 0, dz = 0) => ({ joint: jointA, jointB, t, offset: [dx, dy, dz] })

// Parts with `mirror: true` are defined for the left side and copied to the right.
const ASTRONAUT_PARTS = [
  // Torso
  { bone: 'Hips', shape: 'box', center: at('Hips', 0, -0.01, 0.01), size: [0.34, 0.17, 0.27], radius: 0.07, color: 'white' },
  { bone: 'Spine02', shape: 'box', center: at('Spine02', 0, -0.03, 0.01), size: [0.37, 0.05, 0.29], radius: 0.02, color: 'orange' },
  { bone: 'Spine01', shape: 'box', center: at('Spine01', 0, -0.01, 0.01), size: [0.38, 0.17, 0.29], radius: 0.07, color: 'white' },
  { bone: 'Spine', shape: 'box', center: at('Spine', 0, -0.01, 0.01), size: [0.44, 0.2, 0.31], radius: 0.08, color: 'white' },
  { bone: 'Spine', shape: 'torus', center: at('neck', 0, -0.02, 0), radius: 0.12, tube: 0.045, rotation: [Math.PI / 2, 0, 0], color: 'offWhite' },
  // Chest control panel
  { bone: 'Spine', shape: 'box', center: at('Spine', 0, -0.03, 0.17), size: [0.17, 0.1, 0.03], radius: 0.012, color: 'offWhite' },
  { bone: 'Spine', shape: 'box', center: at('Spine', -0.035, -0.03, 0.187), size: [0.055, 0.05, 0.012], radius: 0.006, color: 'blue' },
  { bone: 'Spine', shape: 'box', center: at('Spine', 0.04, -0.015, 0.187), size: [0.04, 0.02, 0.012], radius: 0.005, color: 'orange' },
  { bone: 'Spine', shape: 'box', center: at('Spine', 0.04, -0.045, 0.187), size: [0.04, 0.02, 0.012], radius: 0.005, color: 'teal' },
  // Backpack
  { bone: 'Spine', shape: 'box', center: at('Spine', 0, -0.05, -0.2), size: [0.34, 0.36, 0.15], radius: 0.05, color: 'white' },
  { bone: 'Spine', shape: 'box', center: at('Spine', 0, 0.06, -0.2), size: [0.35, 0.04, 0.16], radius: 0.015, color: 'orange' },
  { bone: 'Spine', shape: 'box', center: at('Spine', 0.13, -0.08, -0.2), size: [0.06, 0.2, 0.16], radius: 0.02, color: 'orange', mirror: true },
  // Arms
  { bone: 'LeftArm', shape: 'sphere', center: at('LeftArm', 0.005, 0.01, 0), radius: 0.08, color: 'white', mirror: true },
  { bone: 'LeftArm', shape: 'capsule', a: at('LeftArm'), b: at('LeftForeArm'), radius: 0.075, color: 'white', mirror: true },
  { bone: 'LeftArm', shape: 'cylinder', a: between('LeftArm', 'LeftForeArm', 0.7), b: between('LeftArm', 'LeftForeArm', 0.8), radius: 0.081, color: 'orange', mirror: true },
  { bone: 'LeftForeArm', shape: 'capsule', a: at('LeftForeArm'), b: between('LeftForeArm', 'LeftHand', 0.85), radius: 0.072, color: 'white', mirror: true },
  { bone: 'LeftForeArm', shape: 'cylinder', a: between('LeftForeArm', 'LeftHand', 0.78), b: between('LeftForeArm', 'LeftHand', 0.92), radius: 0.078, color: 'orange', mirror: true },
  { bone: 'LeftHand', shape: 'sphere', center: at('LeftHand', 0.01, -0.045, 0.01), radius: 0.07, scale: [0.9, 1.15, 0.85], color: 'gray', mirror: true },
  { bone: 'LeftHand', shape: 'capsule', a: at('LeftHand', -0.02, -0.03, 0.05), b: at('LeftHand', -0.035, -0.07, 0.07), radius: 0.024, color: 'gray', mirror: true },
  // Legs
  { bone: 'LeftUpLeg', shape: 'capsule', a: at('LeftUpLeg', 0, 0.02, 0), b: at('LeftLeg'), radius: 0.088, color: 'white', mirror: true },
  { bone: 'LeftLeg', shape: 'box', center: at('LeftLeg', 0, 0.005, 0.07), size: [0.12, 0.09, 0.05], radius: 0.02, color: 'gray', mirror: true },
  { bone: 'LeftLeg', shape: 'cylinder', a: between('LeftLeg', 'LeftFoot', 0.3), b: between('LeftLeg', 'LeftFoot', 0.4), radius: 0.087, color: 'yellow', mirror: true },
  { bone: 'LeftLeg', shape: 'capsule', a: at('LeftLeg'), b: at('LeftFoot', 0, 0.02, 0), radius: 0.082, color: 'white', mirror: true },
  { bone: 'LeftLeg', shape: 'cylinder', a: between('LeftLeg', 'LeftFoot', 0.7), b: at('LeftFoot', 0, -0.04, 0), radius: 0.092, color: 'white', mirror: true },
  { bone: 'LeftFoot', shape: 'box', center: at('LeftFoot', 0.01, -0.065, 0.05), size: [0.17, 0.16, 0.26], radius: 0.065, color: 'white', mirror: true },
  { bone: 'LeftFoot', shape: 'box', center: at('LeftFoot', 0.01, -0.135, 0.05), size: [0.18, 0.04, 0.27], radius: 0.018, color: 'orange', mirror: true },
]

const ROBOT_PARTS = [
  // Torso
  { bone: 'Hips', shape: 'box', center: at('Hips', 0, -0.02, 0), size: [0.28, 0.12, 0.22], radius: 0.04, color: 'gray' },
  { bone: 'Spine02', shape: 'cylinder', a: at('Hips'), b: at('Spine01'), radius: 0.09, color: 'darkGray' },
  { bone: 'Spine01', shape: 'box', center: at('Spine01', 0, 0.04, 0.005), size: [0.42, 0.32, 0.28], radius: 0.07, color: 'white' },
  { bone: 'Spine01', shape: 'box', center: at('Spine01', 0, 0.04, 0.142), size: [0.25, 0.2, 0.03], radius: 0.025, color: 'teal' },
  { bone: 'Spine01', shape: 'star', center: at('Spine01', 0, 0.035, 0.158), radius: 0.075, depth: 0.014, color: 'yellow' },
  { bone: 'Spine01', shape: 'box', center: at('Spine01', 0, 0.03, -0.155), size: [0.3, 0.24, 0.06], radius: 0.03, color: 'teal' },
  { bone: 'Spine', shape: 'cylinder', a: at('Spine', 0, 0.05, 0), b: at('neck', 0, 0.03, 0), radius: 0.07, color: 'darkGray' },
  // Arms
  { bone: 'LeftArm', shape: 'sphere', center: at('LeftArm', -0.01, 0.01, 0), radius: 0.075, color: 'white', mirror: true },
  { bone: 'LeftArm', shape: 'cylinder', a: at('LeftArm'), b: at('LeftForeArm'), radius: 0.042, color: 'gray', mirror: true },
  { bone: 'LeftForeArm', shape: 'sphere', center: at('LeftForeArm'), radius: 0.052, color: 'darkGray', mirror: true },
  { bone: 'LeftForeArm', shape: 'cylinder', a: at('LeftForeArm'), b: between('LeftForeArm', 'LeftHand', 0.82), radius: 0.055, radiusB: 0.068, color: 'white', mirror: true },
  { bone: 'LeftForeArm', shape: 'cylinder', a: between('LeftForeArm', 'LeftHand', 0.76), b: between('LeftForeArm', 'LeftHand', 0.92), radius: 0.074, color: 'teal', mirror: true },
  { bone: 'LeftHand', shape: 'sphere', center: at('LeftHand', 0, -0.02, 0), radius: 0.045, color: 'darkGray', mirror: true },
  { bone: 'LeftHand', shape: 'capsule', a: at('LeftHand', 0.025, -0.04, 0.0), b: at('LeftHand', 0.04, -0.1, 0.015), radius: 0.02, color: 'white', mirror: true },
  { bone: 'LeftHand', shape: 'capsule', a: at('LeftHand', -0.025, -0.04, 0.0), b: at('LeftHand', -0.04, -0.1, 0.015), radius: 0.02, color: 'white', mirror: true },
  // Legs
  { bone: 'LeftUpLeg', shape: 'sphere', center: at('LeftUpLeg'), radius: 0.06, color: 'darkGray', mirror: true },
  { bone: 'LeftUpLeg', shape: 'cylinder', a: at('LeftUpLeg'), b: at('LeftLeg'), radius: 0.05, color: 'gray', mirror: true },
  { bone: 'LeftLeg', shape: 'sphere', center: at('LeftLeg'), radius: 0.058, color: 'darkGray', mirror: true },
  { bone: 'LeftLeg', shape: 'box', center: between('LeftLeg', 'LeftFoot', 0.48), size: [0.13, 0.16, 0.14], radius: 0.04, color: 'white', mirror: true },
  { bone: 'LeftLeg', shape: 'cylinder', a: between('LeftLeg', 'LeftFoot', 0.8), b: at('LeftFoot', 0, -0.03, 0), radius: 0.062, color: 'darkGray', mirror: true },
  { bone: 'LeftFoot', shape: 'box', center: at('LeftFoot', 0.01, -0.07, 0.05), size: [0.17, 0.15, 0.25], radius: 0.06, color: 'teal', mirror: true },
]

const HUMAN_PARTS = [
  // Trousers
  { bone: 'Hips', shape: 'box', center: at('Hips', 0, -0.03, 0), size: [0.33, 0.17, 0.24], radius: 0.06, color: 'navy' },
  { bone: 'Hips', shape: 'box', center: at('Hips', 0, 0.035, 0), size: [0.335, 0.035, 0.245], radius: 0.012, color: 'black' },
  // T-shirt and vest
  { bone: 'Spine01', shape: 'box', center: at('Spine01', 0, -0.03, 0), size: [0.33, 0.2, 0.23], radius: 0.07, color: 'white' },
  { bone: 'Spine', shape: 'box', center: at('Spine', 0, -0.02, 0), size: [0.38, 0.2, 0.24], radius: 0.07, color: 'white' },
  { bone: 'Spine01', shape: 'box', center: at('Spine01', 0.1, 0.02, 0.004), size: [0.13, 0.27, 0.242], radius: 0.045, color: 'mustard', mirror: true },
  { bone: 'Spine', shape: 'box', center: at('Spine', 0, -0.01, -0.025), size: [0.385, 0.15, 0.2], radius: 0.05, color: 'mustard' },
  { bone: 'Spine', shape: 'torus', center: at('neck', 0, -0.03, 0), radius: 0.1, tube: 0.035, rotation: [Math.PI / 2, 0, 0], color: 'navy' },
  // Cross-body bag
  { bone: 'Spine', shape: 'cylinder', a: at('RightArm', 0.03, 0.0, 0.11), b: at('LeftUpLeg', 0.02, 0.13, 0.15), radius: 0.016, color: 'black' },
  { bone: 'Hips', shape: 'box', center: at('LeftUpLeg', 0.02, 0.08, 0.17), size: [0.13, 0.11, 0.06], radius: 0.03, color: 'mustard' },
  // Arms: short white sleeve, bare arm, navy wristband
  { bone: 'LeftArm', shape: 'capsule', a: at('LeftArm', -0.01, 0.0, 0), b: between('LeftArm', 'LeftForeArm', 0.45), radius: 0.062, color: 'white', mirror: true },
  { bone: 'LeftArm', shape: 'capsule', a: at('LeftArm'), b: at('LeftForeArm'), radius: 0.05, color: SKIN, mirror: true },
  { bone: 'LeftForeArm', shape: 'capsule', a: at('LeftForeArm'), b: between('LeftForeArm', 'LeftHand', 0.9), radius: 0.048, color: SKIN, mirror: true },
  { bone: 'LeftForeArm', shape: 'cylinder', a: between('LeftForeArm', 'LeftHand', 0.7), b: between('LeftForeArm', 'LeftHand', 0.86), radius: 0.056, color: 'navy', mirror: true },
  { bone: 'LeftHand', shape: 'sphere', center: at('LeftHand', 0.005, -0.04, 0.005), radius: 0.058, scale: [0.85, 1.15, 0.7], color: SKIN, mirror: true },
  { bone: 'LeftHand', shape: 'capsule', a: at('LeftHand', -0.02, -0.03, 0.04), b: at('LeftHand', -0.03, -0.065, 0.06), radius: 0.018, color: SKIN, mirror: true },
  // Legs: cargo trousers and sneakers
  { bone: 'LeftUpLeg', shape: 'capsule', a: at('LeftUpLeg', 0, 0.02, 0), b: at('LeftLeg'), radius: 0.085, color: 'navy', mirror: true },
  { bone: 'LeftUpLeg', shape: 'box', center: between('LeftUpLeg', 'LeftLeg', 0.55, 0.075, 0, 0.01), size: [0.04, 0.09, 0.09], radius: 0.015, color: 'denimDark', mirror: true },
  { bone: 'LeftLeg', shape: 'capsule', a: at('LeftLeg'), b: at('LeftFoot', 0, 0.02, 0), radius: 0.08, color: 'navy', mirror: true },
  { bone: 'LeftLeg', shape: 'cylinder', a: between('LeftLeg', 'LeftFoot', 0.8), b: at('LeftFoot', 0, -0.03, 0), radius: 0.07, color: 'white', mirror: true },
  { bone: 'LeftFoot', shape: 'box', center: at('LeftFoot', 0.01, -0.07, 0.06), size: [0.15, 0.13, 0.26], radius: 0.055, color: 'white', mirror: true },
  { bone: 'LeftFoot', shape: 'box', center: at('LeftFoot', 0.01, -0.135, 0.06), size: [0.16, 0.04, 0.27], radius: 0.018, color: 'yellow', mirror: true },
  { bone: 'LeftFoot', shape: 'box', center: at('LeftFoot', 0.01, -0.03, 0.12), size: [0.09, 0.04, 0.1], radius: 0.015, color: 'navy', mirror: true },
]

export const PROCEDURAL_BODY_PARTS = {
  astronaut: ASTRONAUT_PARTS,
  robot: ROBOT_PARTS,
  human: HUMAN_PARTS,
}

const UP = new THREE.Vector3(0, 1, 0)

function mirrorPart(part) {
  const swap = (name) => name.replace(/^Left/, 'Right')
  const mirrorPoint = (point) => point && {
    ...point,
    joint: swap(point.joint),
    jointB: point.jointB ? swap(point.jointB) : undefined,
    offset: [-point.offset[0], point.offset[1], point.offset[2]],
  }
  return {
    ...part,
    bone: swap(part.bone),
    center: mirrorPoint(part.center),
    a: mirrorPoint(part.a),
    b: mirrorPoint(part.b),
    rotation: part.rotation ? [part.rotation[0], -part.rotation[1], -part.rotation[2]] : undefined,
  }
}

function resolvePoint(point, joints) {
  const base = joints[point.joint]
  if (!base) throw new Error(`Unknown joint ${point.joint}`)
  const position = base.clone()
  if (point.jointB) position.lerp(joints[point.jointB], point.t)
  return position.add(new THREE.Vector3(...point.offset))
}

function createStarGeometry(radius, depth) {
  const shape = new THREE.Shape()
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 === 0 ? radius : radius * 0.45
    const angle = Math.PI / 2 + (i * Math.PI) / 5
    const x = Math.cos(angle) * r
    const y = Math.sin(angle) * r
    if (i === 0) shape.moveTo(x, y)
    else shape.lineTo(x, y)
  }
  shape.closePath()
  const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false })
  geometry.translate(0, 0, -depth / 2)
  return geometry
}

// Geometry for one part, already placed in model space.
function buildPartGeometry(part, joints) {
  let geometry
  if (part.a && part.b) {
    const a = resolvePoint(part.a, joints)
    const b = resolvePoint(part.b, joints)
    const direction = b.clone().sub(a)
    const length = Math.max(0.001, direction.length())
    geometry = part.shape === 'capsule'
      ? new THREE.CapsuleGeometry(part.radius, length, 3, 10)
      : new THREE.CylinderGeometry(part.radiusB ?? part.radius, part.radius, length, 12)
    geometry.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, direction.normalize()))
    geometry.translate(...a.clone().lerp(b, 0.5).toArray())
    return geometry
  }

  const center = resolvePoint(part.center, joints)
  if (part.shape === 'box') {
    geometry = new RoundedBoxGeometry(...part.size, 2, part.radius ?? 0.02)
  } else if (part.shape === 'sphere') {
    geometry = new THREE.SphereGeometry(part.radius, 14, 10)
    if (part.scale) geometry.scale(...part.scale)
  } else if (part.shape === 'torus') {
    geometry = new THREE.TorusGeometry(part.radius, part.tube, 8, 20)
  } else if (part.shape === 'star') {
    geometry = createStarGeometry(part.radius, part.depth)
  } else {
    throw new Error(`Unknown part shape ${part.shape}`)
  }
  if (part.rotation) geometry.applyQuaternion(new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation)))
  geometry.translate(...center.toArray())
  return geometry
}

// Bakes colour, skin mask and a rigid bone binding into a part's vertices.
// Parts stay indexed (shared vertices) to keep the merged body small.
function finalizePart(geometry, part, boneIndex) {
  geometry.deleteAttribute('uv')
  const source = geometry.index ? geometry : mergeVertices(geometry)
  const count = source.attributes.position.count
  const isSkin = part.color === SKIN
  const color = new THREE.Color(isSkin ? '#ffffff' : COLORS[part.color] || part.color)
  const colors = new Float32Array(count * 3)
  const skinMask = new Float32Array(count)
  const skinIndex = new Uint16Array(count * 4)
  const skinWeight = new Float32Array(count * 4)
  for (let i = 0; i < count; i += 1) {
    colors.set([color.r, color.g, color.b], i * 3)
    skinMask[i] = isSkin ? 1 : 0
    skinIndex[i * 4] = boneIndex
    skinWeight[i * 4] = 1
  }
  const result = new THREE.BufferGeometry()
  result.setIndex(source.index)
  result.setAttribute('position', source.attributes.position)
  result.setAttribute('normal', source.attributes.normal)
  result.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  result.setAttribute('skinMask', new THREE.BufferAttribute(skinMask, 1))
  result.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  result.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4))
  return result
}

const geometryCache = new Map()

/**
 * Merged, skinned body geometry for a character type, in the same space as the
 * Meshy body's vertices. `joints` are rest-pose joint positions by bone name;
 * `boneIndexByName` maps bone names to skeleton indices. Cached per type.
 */
export function getProceduralBodyGeometry(type, joints, boneIndexByName) {
  if (geometryCache.has(type)) return geometryCache.get(type)
  const definition = PROCEDURAL_BODY_PARTS[type]
  if (!definition) return null

  const parts = definition.flatMap((part) => (part.mirror ? [part, mirrorPart(part)] : [part]))
  const geometries = parts.map((part) => {
    const boneIndex = boneIndexByName[part.bone]
    if (boneIndex === undefined) throw new Error(`Body part bone ${part.bone} not in skeleton`)
    return finalizePart(buildPartGeometry(part, joints), part, boneIndex)
  })
  const merged = mergeGeometries(geometries)
  merged.computeBoundingSphere()
  geometryCache.set(type, merged)
  return merged
}

/** Per-instance material: vertex colours plus the guest's skin tone for skin parts. */
export function createProceduralBodyMaterial({ roughness = 0.55, metalness = 0 } = {}) {
  const uniforms = { uSkinColor: { value: new THREE.Color('#d9a27e') } }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness })
  material.name = 'ProceduralBodyMaterial'
  material.userData.bodyUniforms = uniforms
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float skinMask;\nuniform vec3 uSkinColor;')
      .replace('#include <color_vertex>', '#include <color_vertex>\nvColor.rgb = mix(vColor.rgb, uSkinColor, skinMask);')
  }
  material.customProgramCacheKey = () => 'procedural-body-v1'
  return material
}

export function setProceduralBodySkin(material, hex) {
  material?.userData?.bodyUniforms?.uSkinColor.value.set(hex || '#d9a27e')
}
