// The parade wall rotates through these worlds. Each one is generated in code
// by GalaxyBackdrop.jsx (sky, planets, ground, props): no image or video files.
//
// sky.nebula:   [rgb, alpha] cloud colours painted into the sky texture
// ground:       colours of the low-poly ridge, crater count, surface roughness
//               and optional dunes
// props:        instanced scenery along the ridge (rocks, mesas, crystals,
//               mushrooms); glowing props light up in their own colours
// planets:      placed in screen terms (ndc x/y, size = fraction of screen height)

export const WORLDS = [
  {
    id: 'moon',
    name: 'The Moon',
    sky: {
      base: '#05061a',
      seed: 7,
      nebula: [['118, 74, 255', 0.11], ['255, 79, 163', 0.07], ['47, 214, 207', 0.06], ['70, 110, 255', 0.1]],
    },
    ground: { seed: 97, base: '#71768f', dark: '#3f4259', light: '#aeb2c8', craters: 420, roughness: 0.7 },
    props: { type: 'rocks', colors: ['#7d8199', '#6c7088', '#8f93ab'], glow: 0 },
    planets: [
      { kind: 'gas', palette: ['#ffb38a', '#ff7f8f', '#c784ff', '#ffd7ae', '#ff9f6b', '#a77bff'], ring: true, ndc: [-0.7, 0.64], size: 0.21, tilt: 0.35, spin: 0.05, depth: 70 },
      { kind: 'earth', ndc: [0.4, 0.8], size: 0.085, tilt: 0.4, spin: 0.08, depth: 80, atmosphere: '#7fc4ff' },
      { kind: 'rocky', color: '#4fd8d0', ndc: [0.88, 0.6], size: 0.045, tilt: 0.1, spin: 0.12, depth: 75, atmosphere: '#9ff7ef' },
    ],
  },
  {
    id: 'mars',
    name: 'Mars',
    sky: {
      base: '#150710',
      seed: 13,
      nebula: [['255, 120, 60', 0.1], ['255, 70, 120', 0.08], ['255, 190, 120', 0.06], ['140, 60, 200', 0.07]],
    },
    ground: { seed: 101, base: '#b5583a', dark: '#6e2c1d', light: '#e3946a', craters: 140, roughness: 0.55, dunes: 0.9 },
    props: { type: 'mesas', colors: ['#9c4630', '#b85a3c', '#7e3626'], glow: 0 },
    planets: [
      { kind: 'gas', palette: ['#7fd3ff', '#3d8bff', '#b5e6ff', '#5a6cff', '#9ad8ff'], ring: false, ndc: [0.62, 0.62], size: 0.24, tilt: 0.2, spin: 0.04, depth: 70, atmosphere: '#9fdcff' },
      { kind: 'rocky', color: '#a08070', ndc: [-0.55, 0.78], size: 0.05, tilt: 0, spin: 0.15, depth: 75 },
      { kind: 'rocky', color: '#8a7060', ndc: [-0.25, 0.6], size: 0.03, tilt: 0, spin: 0.2, depth: 78 },
    ],
  },
  {
    id: 'crystal',
    name: 'Crystal Planet',
    sky: {
      base: '#03101a',
      seed: 17,
      nebula: [['47, 214, 207', 0.12], ['120, 255, 200', 0.08], ['80, 140, 255', 0.1], ['200, 120, 255', 0.06]],
    },
    ground: { seed: 103, base: '#a9c6df', dark: '#5f7fa6', light: '#eef6ff', craters: 70, roughness: 0.45 },
    props: { type: 'crystals', colors: ['#3fe6ff', '#ff5fc8', '#9a6bff', '#4dffb0'], glow: 0.45 },
    planets: [
      { kind: 'gas', palette: ['#ff9ad5', '#ffc4e6', '#d77bff', '#ff7fb0', '#ffe0f2'], ring: true, ndc: [0.6, 0.62], size: 0.23, tilt: -0.3, spin: 0.05, depth: 70 },
      { kind: 'rocky', color: '#d6f6ff', ndc: [-0.62, 0.74], size: 0.07, tilt: 0.2, spin: 0.1, depth: 76, atmosphere: '#bff6ff' },
    ],
  },
  {
    id: 'neon',
    name: 'Neon Jungle',
    sky: {
      base: '#0d0418',
      seed: 19,
      nebula: [['255, 60, 200', 0.12], ['198, 244, 50', 0.05], ['120, 80, 255', 0.1], ['255, 140, 60', 0.05]],
    },
    ground: { seed: 107, base: '#5b2a86', dark: '#2f1550', light: '#8f56c6', craters: 160, roughness: 0.6 },
    props: { type: 'mushrooms', colors: ['#c6f432', '#ff5d73', '#2fd6cf', '#ffd23f'], glow: 0.7 },
    planets: [
      { kind: 'gas', palette: ['#c6f432', '#8be02f', '#f6ff9a', '#5fbf2a', '#e2ff6a'], ring: true, ndc: [-0.64, 0.62], size: 0.2, tilt: 0.45, spin: 0.06, depth: 70 },
      { kind: 'rocky', color: '#ff8ad8', ndc: [0.7, 0.76], size: 0.06, tilt: 0, spin: 0.12, depth: 76, atmosphere: '#ffb8ec' },
      { kind: 'rocky', color: '#ffd23f', ndc: [0.32, 0.58], size: 0.035, tilt: 0, spin: 0.18, depth: 78 },
    ],
  },
]

export function getWorld(index) {
  return WORLDS[((index % WORLDS.length) + WORLDS.length) % WORLDS.length]
}
