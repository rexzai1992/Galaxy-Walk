// All four parade characters share the rigged Meshy skeleton (character.glb) and
// its animations. The Alien shows the sculpted Meshy body; the Astronaut, Human
// and Robot have code-built bodies (proceduralBodies.js) designed from
// assets/reference/characters. Each variant also adds props to the selfie head.
//
// Palette recolouring (Meshy body only). The body texture has three colour bands (measured from the texture):
//   skin   ~70-110deg lime/green (hands)
//   trim   ~175deg cyan   (trousers, boots, belt, cuffs)
//   suit   ~275deg purple (jacket)
// A band target of null keeps the original colour. 'selfie-skin' uses the skin
// tone sampled from the guest's photo.
//
// `surface` sets how the body reacts to light. The Meshy export leaves the glTF
// defaults (metalness 1, roughness 1) and compensates with a full-strength
// emissive copy of the texture, which renders flat; these values replace that
// with a lit, solid-looking material. `glow` is the remaining emissive amount.

export const PALETTE_BANDS = [
  { key: 'skin', hueDegrees: 82, halfWidthDegrees: 28, referenceLuminance: 0.8 },
  { key: 'trim', hueDegrees: 175, halfWidthDegrees: 16, referenceLuminance: 0.73 },
  { key: 'suit', hueDegrees: 275, halfWidthDegrees: 16, referenceLuminance: 0.22 },
]

// `body`: 'meshy' renders the sculpted Meshy alien (character.glb); any other
// value is a code-built body from proceduralBodies.js riding the same skeleton.
export const CHARACTER_VARIANTS = {
  alien: {
    id: 'alien',
    label: 'Alien',
    body: 'meshy',
    palette: { skin: null, trim: null, suit: null },
    headProp: 'antennae',
    surface: { metalness: 0, roughness: 0.5, glow: 0.14 },
  },
  astronaut: {
    id: 'astronaut',
    label: 'Astronaut',
    body: 'astronaut',
    headProp: 'astronaut-helmet',
    surface: { metalness: 0, roughness: 0.5 },
  },
  human: {
    id: 'human',
    label: 'Human',
    body: 'human',
    headProp: null,
    surface: { metalness: 0, roughness: 0.72 },
  },
  robot: {
    id: 'robot',
    label: 'Robot',
    body: 'robot',
    headProp: 'robot-helmet',
    surface: { metalness: 0.35, roughness: 0.32 },
  },
}

export const DEFAULT_CHARACTER_VARIANT = 'alien'

export function resolveCharacterVariant(characterType) {
  const key = String(characterType || '').trim().toLowerCase()
  return CHARACTER_VARIANTS[key] || CHARACTER_VARIANTS[DEFAULT_CHARACTER_VARIANT]
}
