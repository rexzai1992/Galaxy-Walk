import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// Procedural space worlds for the parade wall (see worlds.js): galaxy sky,
// twinkling stars, planets, shooting stars, and a low-poly ridge with props
// that the parade walks on. Generated in code (no image/video files); each
// world is built once, the first time it is shown, and only the current world
// is drawn.

const SKY_SIZE = [2048, 512]
const LANE_Y = -0.27
// Middle of the parade lanes (z -2.3 .. 3.2); the ridge crest runs along it.
const LANE_CENTER_Z = 0.45
const WALKWAY_HALF_WIDTH = 4

function seededRandom(seed) {
  let state = seed % 2147483647
  if (state <= 0) state += 2147483646
  return () => {
    state = (state * 16807) % 2147483647
    return (state - 1) / 2147483646
  }
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return [canvas, canvas.getContext('2d')]
}

function canvasTexture(canvas) {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

// ---------- Sky ----------

function createSkyTexture(sky) {
  const [width, height] = SKY_SIZE
  const [canvas, ctx] = makeCanvas(width, height)
  const rand = seededRandom(sky.seed)
  ctx.fillStyle = sky.base
  ctx.fillRect(0, 0, width, height)

  // Milky-way band running diagonally across the sky.
  const bandY = (x) => height * (0.7 - 0.45 * (x / width))
  for (let i = 0; i < 90; i += 1) {
    const [rgb, alpha] = sky.nebula[i % sky.nebula.length]
    const x = rand() * width
    const y = bandY(x) + (rand() - 0.5) * height * 0.55
    const radius = 50 + rand() * 230
    const cloud = ctx.createRadialGradient(x, y, 0, x, y, radius)
    cloud.addColorStop(0, `rgba(${rgb}, ${alpha})`)
    cloud.addColorStop(1, `rgba(${rgb}, 0)`)
    ctx.fillStyle = cloud
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2)
  }

  // Stars: denser along the band.
  for (let i = 0; i < 4200; i += 1) {
    const x = rand() * width
    const inBand = rand() < 0.45
    const y = inBand ? bandY(x) + (rand() - 0.5) * height * 0.3 : rand() * height
    const big = rand() > 0.985
    const size = big ? 1.4 + rand() * 1.4 : 0.5 + rand() * 0.9
    const tint = rand()
    const color = tint > 0.85 ? '200, 220, 255' : tint > 0.75 ? '255, 230, 200' : '255, 255, 255'
    ctx.fillStyle = `rgba(${color}, ${0.25 + rand() * 0.75})`
    ctx.beginPath()
    ctx.arc(x, y, size, 0, Math.PI * 2)
    ctx.fill()
  }
  return canvasTexture(canvas)
}

// Crops the sky texture like CSS `background-size: cover` for the plane's aspect.
function fitCover(texture, planeAspect) {
  const textureAspect = SKY_SIZE[0] / SKY_SIZE[1]
  if (planeAspect > textureAspect) {
    texture.repeat.set(1, textureAspect / planeAspect)
  } else {
    texture.repeat.set(planeAspect / textureAspect, 1)
  }
  texture.offset.set((1 - texture.repeat.x) / 2, (1 - texture.repeat.y) / 2)
}

const TWINKLE_VERTEX = /* glsl */ `
attribute float aPhase;
attribute float aSize;
uniform float uTime;
uniform float uPixelRatio;
varying float vGlow;
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vGlow = 0.55 + 0.45 * sin(uTime * 2.2 + aPhase);
  gl_PointSize = aSize * uPixelRatio * (0.7 + 0.5 * vGlow);
}`

const TWINKLE_FRAGMENT = /* glsl */ `
varying float vGlow;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float core = smoothstep(0.5, 0.0, length(c));
  float sparkle = max(smoothstep(0.08, 0.0, abs(c.x)), smoothstep(0.08, 0.0, abs(c.y))) * smoothstep(0.5, 0.1, length(c));
  gl_FragColor = vec4(vec3(1.0), (core * core + sparkle * 0.6) * vGlow);
}`

function createTwinkleStars(count) {
  const rand = seededRandom(11)
  const positions = new Float32Array(count * 3)
  const phases = new Float32Array(count)
  const sizes = new Float32Array(count)
  for (let i = 0; i < count; i += 1) {
    positions.set([rand() - 0.5, rand() - 0.5, 0.001], i * 3)
    phases[i] = rand() * Math.PI * 2
    sizes[i] = 3 + rand() * 6
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1))
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1))
  const material = new THREE.ShaderMaterial({
    vertexShader: TWINKLE_VERTEX,
    fragmentShader: TWINKLE_FRAGMENT,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  return { geometry, material }
}

// ---------- Planets ----------

function createGasGiantTexture(palette, seed) {
  const [canvas, ctx] = makeCanvas(512, 256)
  const rand = seededRandom(seed)
  let y = 0
  while (y < 256) {
    const bandHeight = 6 + rand() * 26
    ctx.fillStyle = palette[Math.floor(rand() * palette.length)]
    ctx.fillRect(0, y, 512, bandHeight + 1)
    y += bandHeight
  }
  for (let i = 0; i < 40; i += 1) {
    ctx.fillStyle = `rgba(255, 255, 255, ${0.04 + rand() * 0.06})`
    ctx.beginPath()
    ctx.ellipse(rand() * 512, rand() * 256, 20 + rand() * 60, 3 + rand() * 6, 0, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = 'rgba(120, 40, 80, 0.45)'
  ctx.beginPath()
  ctx.ellipse(340, 150, 28, 14, 0, 0, Math.PI * 2)
  ctx.fill()
  return canvasTexture(canvas)
}

function createEarthTexture() {
  const [canvas, ctx] = makeCanvas(512, 256)
  const rand = seededRandom(31)
  ctx.fillStyle = '#2f6fe0'
  ctx.fillRect(0, 0, 512, 256)
  const blob = (color, count, minR, maxR, yMin, yMax) => {
    ctx.fillStyle = color
    for (let i = 0; i < count; i += 1) {
      const cx = rand() * 512
      const cy = yMin + rand() * (yMax - yMin)
      for (let j = 0; j < 7; j += 1) {
        ctx.beginPath()
        ctx.ellipse(cx + (rand() - 0.5) * maxR * 1.6, cy + (rand() - 0.5) * maxR, minR + rand() * maxR, minR + rand() * maxR * 0.7, rand() * Math.PI, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
  blob('#3cb36b', 7, 8, 30, 50, 210)
  blob('#e8c27a', 4, 4, 14, 80, 180)
  ctx.fillStyle = '#f4f8ff'
  ctx.fillRect(0, 0, 512, 14)
  ctx.fillRect(0, 242, 512, 14)
  blob('rgba(255, 255, 255, 0.55)', 10, 6, 22, 20, 236)
  return canvasTexture(canvas)
}

function createRockyTexture(color, seed) {
  const [canvas, ctx] = makeCanvas(256, 128)
  const rand = seededRandom(seed)
  ctx.fillStyle = color
  ctx.fillRect(0, 0, 256, 128)
  for (let i = 0; i < 60; i += 1) {
    ctx.fillStyle = `rgba(0, 0, 0, ${0.08 + rand() * 0.18})`
    ctx.beginPath()
    ctx.arc(rand() * 256, rand() * 128, 2 + rand() * 9, 0, Math.PI * 2)
    ctx.fill()
  }
  return canvasTexture(canvas)
}

function createRingGeometry(palette, seed) {
  const geometry = new THREE.RingGeometry(1.45, 2.35, 96, 12)
  const rand = seededRandom(seed)
  const bands = Array.from({ length: 13 }, () => new THREE.Color(palette[Math.floor(rand() * palette.length)]).lerp(new THREE.Color('#ffffff'), rand() * 0.4))
  const colors = []
  const position = geometry.attributes.position
  for (let i = 0; i < position.count; i += 1) {
    const radius = Math.hypot(position.getX(i), position.getY(i))
    const bandIndex = Math.floor(((radius - 1.45) / 0.9) * bands.length)
    const band = bands[THREE.MathUtils.clamp(bandIndex, 0, bands.length - 1)]
    colors.push(band.r, band.g, band.b)
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  return geometry
}

function createPlanetAssets(planet, index) {
  const seed = 23 + index * 13
  const texture = planet.kind === 'gas'
    ? createGasGiantTexture(planet.palette, seed)
    : planet.kind === 'earth'
      ? createEarthTexture()
      : createRockyTexture(planet.color, seed)
  const ring = planet.ring ? createRingGeometry(planet.palette, seed + 1) : null
  return { texture, ring }
}

function Planet({ planet, assets }) {
  const spinRef = useRef(null)
  useFrame((_, delta) => {
    if (spinRef.current) spinRef.current.rotation.y += delta * planet.spin
  })
  return (
    <group rotation={[0, 0, planet.tilt]}>
      <mesh ref={spinRef}>
        <sphereGeometry args={[1, 40, 24]} />
        <meshStandardMaterial map={assets.texture} roughness={0.9} metalness={0} emissive="#ffffff" emissiveMap={assets.texture} emissiveIntensity={0.18} />
      </mesh>
      {planet.atmosphere ? (
        <mesh scale={1.08}>
          <sphereGeometry args={[1, 32, 20]} />
          <meshBasicMaterial color={planet.atmosphere} transparent opacity={0.22} side={THREE.BackSide} depthWrite={false} />
        </mesh>
      ) : null}
      {assets.ring ? (
        <mesh geometry={assets.ring} rotation={[-1.25, 0.2, 0]}>
          <meshBasicMaterial vertexColors transparent opacity={0.8} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      ) : null}
    </group>
  )
}

function createShootingStarTexture() {
  const [canvas, ctx] = makeCanvas(256, 8)
  const tail = ctx.createLinearGradient(0, 0, 256, 0)
  tail.addColorStop(0, 'rgba(255, 255, 255, 0)')
  tail.addColorStop(0.85, 'rgba(190, 235, 255, 0.7)')
  tail.addColorStop(1, 'rgba(255, 255, 255, 1)')
  ctx.fillStyle = tail
  ctx.fillRect(0, 2, 256, 4)
  return canvasTexture(canvas)
}

// ---------- World asset cache ----------

const skyCache = new Map()

function getSkyAssets(world) {
  if (!skyCache.has(world.id)) {
    skyCache.set(world.id, {
      skyTexture: createSkyTexture(world.sky),
      planets: world.planets.map((planet, index) => createPlanetAssets(planet, index)),
    })
  }
  return skyCache.get(world.id)
}

// Per-frame placement of the camera-attached sky, planets and shooting star.
function updateSpaceSky(state, camera, gl, refs, assets, planets) {
  const { followRef, skyRef, planetRefs, shootingRef, shootingStateRef } = refs
  const { skyTexture, twinkle } = assets
  const follow = followRef.current
  if (!follow || !camera.isPerspectiveCamera) return
  follow.position.copy(camera.position)
  follow.quaternion.copy(camera.quaternion)

  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))
  const aspect = camera.aspect
  const skyDistance = camera.far * 0.9
  const sky = skyRef.current
  if (sky) {
    const height = 2 * skyDistance * tanHalf * 1.02
    sky.position.set(0, 0, -skyDistance)
    sky.scale.set(height * aspect, height, 1)
    fitCover(skyTexture, aspect)
  }
  twinkle.material.uniforms.uTime.value = state.clock.elapsedTime
  twinkle.material.uniforms.uPixelRatio.value = gl.getPixelRatio()

  const sceneDistance = camera.position.length()
  planets.forEach((planet, index) => {
    const node = planetRefs.current[index]
    if (!node) return
    const depth = sceneDistance + planet.depth
    const halfHeight = depth * tanHalf
    node.position.set(planet.ndc[0] * halfHeight * aspect, planet.ndc[1] * halfHeight, -depth)
    node.scale.setScalar(planet.size * halfHeight)
  })

  // Occasional shooting star across the upper sky.
  const shooting = shootingRef.current
  const shot = shootingStateRef.current
  const t = state.clock.elapsedTime
  if (!shooting) return
  if (t > shot.next) {
    shot.start = t
    shot.next = t + 5 + Math.random() * 7
    shot.from.set(-0.2 + Math.random() * 1.1, 0.45 + Math.random() * 0.45)
    shot.dir.set(-0.9 - Math.random() * 0.4, -0.35 - Math.random() * 0.25).normalize()
  }
  const progress = (t - shot.start) / 0.9
  shooting.visible = progress >= 0 && progress <= 1
  if (!shooting.visible) return
  const depth = sceneDistance + 85
  const halfHeight = depth * tanHalf
  const travel = progress * 0.9
  shooting.position.set(
    (shot.from.x + shot.dir.x * travel) * halfHeight * aspect,
    (shot.from.y + shot.dir.y * travel * aspect * 0.4) * halfHeight,
    -depth,
  )
  shooting.rotation.z = Math.atan2(shot.dir.y * aspect * 0.4, shot.dir.x * aspect) + Math.PI
  shooting.scale.set(halfHeight * 0.55, halfHeight * 0.02, 1)
  shooting.material.opacity = Math.sin(progress * Math.PI)
}

/**
 * Camera-attached sky for a world: always fills the view, whatever the screen shape.
 */
export function SpaceSky({ world }) {
  const camera = useThree((state) => state.camera)
  const gl = useThree((state) => state.gl)
  const followRef = useRef(null)
  const skyRef = useRef(null)
  const planetRefs = useRef([])
  const shootingRef = useRef(null)
  const shootingStateRef = useRef({ next: 3, start: -10, from: new THREE.Vector2(), dir: new THREE.Vector2() })

  const worldAssets = useMemo(() => getSkyAssets(world), [world])
  const twinkle = useMemo(() => createTwinkleStars(320), [])
  const shootingTexture = useMemo(() => createShootingStarTexture(), [])

  useEffect(() => () => {
    twinkle.geometry.dispose()
    twinkle.material.dispose()
    shootingTexture.dispose()
  }, [twinkle, shootingTexture])

  useFrame((state) => updateSpaceSky(
    state,
    camera,
    gl,
    { followRef, skyRef, planetRefs, shootingRef, shootingStateRef },
    { skyTexture: worldAssets.skyTexture, twinkle },
    world.planets,
  ))

  return (
    <group ref={followRef}>
      <mesh ref={skyRef} renderOrder={-10}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={worldAssets.skyTexture} depthWrite={false} toneMapped={false} />
        <points geometry={twinkle.geometry} material={twinkle.material} renderOrder={-9} />
      </mesh>
      {world.planets.map((planet, index) => (
        <group key={`${world.id}-${index}`} ref={(node) => { planetRefs.current[index] = node }}>
          <Planet planet={planet} assets={worldAssets.planets[index]} />
        </group>
      ))}
      <mesh ref={shootingRef} visible={false}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={shootingTexture} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </mesh>
    </group>
  )
}

// ---------- Ground ridge (the surface the parade walks on) ----------

function ridgeProfile(z) {
  const dz = z - LANE_CENTER_Z
  // Gentle slope towards the audience, falls away behind so the sky shows
  // right behind the parade.
  return dz < 0 ? -0.034 * dz * dz : -0.0035 * dz * dz
}

function createRidge(ground) {
  const rand = seededRandom(ground.seed)
  const geometry = new THREE.PlaneGeometry(440, 110, 220, 55)
  geometry.rotateX(-Math.PI / 2)
  geometry.translate(0, 0, 5)

  const craters = []
  while (craters.length < ground.craters) {
    // Denser near the middle of the screen and in front, where they are seen up close.
    const x = (rand() - 0.5) * (rand() < 0.5 ? 120 : 420)
    const z = -28 + rand() * 80
    if (Math.abs(z - LANE_CENTER_Z) < WALKWAY_HALF_WIDTH + 2) continue
    craters.push({ x, z, r: 0.8 + rand() * rand() * 6 })
  }

  const position = geometry.attributes.position
  const colors = new Float32Array(position.count * 3)
  const base = new THREE.Color(ground.base)
  const dark = new THREE.Color(ground.dark)
  const light = new THREE.Color(ground.light)
  const color = new THREE.Color()

  const heightAt = (x, z, jitter) => {
    const offWalkway = THREE.MathUtils.smoothstep(Math.abs(z - LANE_CENTER_Z), WALKWAY_HALF_WIDTH, WALKWAY_HALF_WIDTH + 3)
    let y = ridgeProfile(z) + jitter * ground.roughness * offWalkway
    if (ground.dunes) {
      y += (Math.sin(x * 0.09 + z * 0.05) * 0.6 + Math.sin(x * 0.031 - z * 0.08) * 0.8) * ground.dunes * offWalkway
    }
    let craterShade = 0
    for (const crater of craters) {
      const d = Math.hypot(x - crater.x, z - crater.z)
      if (d > crater.r * 1.4) continue
      if (d < crater.r) {
        const bowl = 1 - (d / crater.r) ** 2
        y -= crater.r * 0.22 * bowl
        craterShade -= bowl
      } else {
        const rim = 1 - (d - crater.r) / (crater.r * 0.4)
        y += crater.r * 0.08 * rim
        craterShade += rim * 0.6
      }
    }
    return { y: LANE_Y + y, craterShade }
  }

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i)
    const z = position.getZ(i)
    const jitter = rand() - 0.5
    const { y, craterShade } = heightAt(x, z, jitter)
    position.setY(i, y)
    color.copy(base).lerp(craterShade < 0 || jitter < 0 ? dark : light, Math.min(1, Math.abs(craterShade) * 0.8 + Math.abs(jitter) * 0.5))
    colors.set([color.r, color.g, color.b], i * 3)
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.computeVertexNormals()

  // Props: mostly right behind the walkway edge so they rise above the
  // horizon and frame the parade, a few small ones in front, none close to
  // the camera.
  const props = []
  const propColors = []
  const walkwayBack = LANE_CENTER_Z - WALKWAY_HALF_WIDTH - 1.2
  while (props.length < 64) {
    const behind = rand() < 0.75
    const x = (rand() - 0.5) * 400
    const z = behind ? walkwayBack - rand() * 2.5 : 9 + rand() * 18
    if (!behind && Math.abs(x) < 9) continue
    const size = behind ? 0.6 + rand() * rand() * 1.8 : 0.3 + rand() * 0.6
    props.push({ x, z, size, groundY: heightAt(x, z, 0).y, spin: rand() * Math.PI * 2, lean: (rand() - 0.5) * 0.4, variety: rand() })
    propColors.push(Math.floor(rand() * 1000))
  }
  return { geometry, props, propColors }
}

// Instanced prop shapes per world type: [geometry factory, transform for one prop].
const PROP_SHAPES = {
  rocks: {
    geometry: () => new THREE.IcosahedronGeometry(1, 0),
    place: (p) => ({
      position: [p.x, p.groundY + p.size * 0.25, p.z],
      rotation: [p.spin, p.spin * 1.7, p.lean],
      scale: [p.size * (0.8 + p.variety * 0.6), p.size * (0.6 + p.variety * 0.8), p.size * (1.2 - p.variety * 0.4)],
    }),
  },
  mesas: {
    geometry: () => new THREE.CylinderGeometry(0.75, 1, 1, 7).translate(0, 0.5, 0),
    place: (p) => ({
      position: [p.x, p.groundY - 0.1, p.z],
      rotation: [0, p.spin, 0],
      scale: [p.size * 1.3, p.size * (1.4 + p.variety * 2.6), p.size * 1.3],
    }),
  },
  crystals: {
    geometry: () => new THREE.ConeGeometry(0.5, 1, 6).translate(0, 0.5, 0),
    place: (p) => ({
      position: [p.x, p.groundY - 0.1, p.z],
      rotation: [p.lean, p.spin, p.lean * 0.7],
      scale: [p.size, p.size * (2.2 + p.variety * 3), p.size],
    }),
  },
  mushrooms: {
    // Cap (flattened half sphere) on a stem, merged into one shape.
    geometry: () => {
      const cap = new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.9, 0)
      const stem = new THREE.CylinderGeometry(0.14, 0.2, 0.9, 8).translate(0, 0.45, 0)
      const merged = new THREE.BufferGeometry()
      const parts = [cap.toNonIndexed(), stem.toNonIndexed()]
      const total = parts.reduce((sum, part) => sum + part.attributes.position.count, 0)
      const positions = new Float32Array(total * 3)
      const normals = new Float32Array(total * 3)
      let offset = 0
      parts.forEach((part) => {
        positions.set(part.attributes.position.array, offset * 3)
        normals.set(part.attributes.normal.array, offset * 3)
        offset += part.attributes.position.count
      })
      merged.setAttribute('position', new THREE.BufferAttribute(positions, 3))
      merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3))
      return merged
    },
    place: (p) => ({
      position: [p.x, p.groundY - 0.05, p.z],
      rotation: [p.lean * 0.5, p.spin, p.lean * 0.5],
      scale: [p.size * 1.7, p.size * (1.6 + p.variety * 1.6), p.size * 1.7],
    }),
  },
}

// Standard material whose instance colours also glow (crystals, mushrooms).
function createPropMaterial(glow) {
  const material = new THREE.MeshStandardMaterial({ flatShading: true, roughness: glow > 0 ? 0.35 : 0.9, metalness: 0 })
  if (glow > 0) {
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
#ifdef USE_COLOR
  totalEmissiveRadiance += vColor.rgb * ${glow.toFixed(2)};
#endif`,
      )
    }
    material.customProgramCacheKey = () => `glow-prop-${glow}`
  }
  return material
}

const groundCache = new Map()

function getGroundAssets(world) {
  if (!groundCache.has(world.id)) {
    const ridge = createRidge(world.ground)
    const shape = PROP_SHAPES[world.props.type] || PROP_SHAPES.rocks
    groundCache.set(world.id, {
      ridge,
      shape,
      propGeometry: shape.geometry(),
      propMaterial: createPropMaterial(world.props.glow || 0),
      ridgeMaterial: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95, metalness: 0 }),
    })
  }
  return groundCache.get(world.id)
}

function fillPropInstances(mesh, assets, world) {
  const matrix = new THREE.Matrix4()
  const quaternion = new THREE.Quaternion()
  const color = new THREE.Color()
  assets.ridge.props.forEach((prop, index) => {
    const placed = assets.shape.place(prop)
    quaternion.setFromEuler(new THREE.Euler(...placed.rotation))
    matrix.compose(new THREE.Vector3(...placed.position), quaternion, new THREE.Vector3(...placed.scale))
    mesh.setMatrixAt(index, matrix)
    const palette = world.props.colors
    mesh.setColorAt(index, color.set(palette[assets.ridge.propColors[index] % palette.length]))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

/** The ground strip and props for a world; place it inside the parade route group. */
export function WorldGround({ world }) {
  const assets = useMemo(() => getGroundAssets(world), [world])
  const propsRef = useRef(null)

  useEffect(() => {
    if (propsRef.current) fillPropInstances(propsRef.current, assets, world)
  }, [assets, world])

  return (
    <group>
      <mesh geometry={assets.ridge.geometry} material={assets.ridgeMaterial} renderOrder={-2} />
      <instancedMesh
        key={world.id}
        ref={propsRef}
        args={[assets.propGeometry, assets.propMaterial, assets.ridge.props.length]}
      />
    </group>
  )
}
