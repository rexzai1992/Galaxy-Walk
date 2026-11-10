// Dance moves for the parade. Only four Meshy clips exist (idle, wave, dance,
// pose), so variety comes from code-driven layers on top of a clip, all on one
// shared beat. Each parade character picks its own random dance.

export const BEATS_PER_SECOND = 2

const quantize = (value, steps) => Math.round(value * steps) / steps

// Code-driven dance layers added on top of the clip each frame, on the shared
// beat. Each returns [bone, model-space axis, radians] turns. Model space: +x is
// the character's left, +y up, +z towards the audience.
export const DANCE_LAYERS = {
  hipSway: (beat) => {
    const sway = Math.sin(beat * Math.PI)
    return [['Spine02', 'z', 0.14 * sway], ['Spine', 'z', -0.2 * sway]]
  },
  twist: (beat) => {
    const twist = Math.sin(beat * Math.PI)
    return [['Spine02', 'y', 0.38 * twist], ['Spine', 'y', -0.22 * twist], ['LeftArm', 'z', 0.55], ['RightArm', 'z', -0.55]]
  },
  raiseRoof: (beat) => {
    const pump = 1.55 + 0.35 * Math.sin(beat * Math.PI * 2)
    return [['LeftArm', 'z', pump], ['RightArm', 'z', -pump]]
  },
  robot: (beat) => {
    const step = quantize(Math.sin(beat * Math.PI), 2)
    return [['LeftArm', 'x', -0.65 * step], ['RightArm', 'x', 0.65 * step], ['Spine', 'y', 0.25 * quantize(Math.sin(beat * Math.PI * 0.5), 2)]]
  },
  disco: (beat) => {
    const up = Math.sin(beat * Math.PI) > 0
    return [['RightArm', 'z', up ? -2.1 : -0.7], ['RightArm', 'x', up ? -0.3 : -0.9], ['LeftArm', 'z', 0.35], ['Spine02', 'z', up ? 0.08 : -0.08]]
  },
}

// Complete dances: a base clip plus optional layers.
export const PARADE_DANCES = [
  { id: 'funny-dance', clip: 'dance', layers: [] },
  { id: 'love-pop', clip: 'pose', layers: [] },
  { id: 'pop-sway', clip: 'pose', layers: ['hipSway'] },
  { id: 'robot', clip: 'idle', layers: ['robot'] },
  { id: 'disco', clip: 'idle', layers: ['disco'] },
  { id: 'raise-the-roof', clip: 'idle', layers: ['raiseRoof'] },
  { id: 'twist', clip: 'idle', layers: ['twist'] },
  { id: 'wave-sway', clip: 'wave', layers: ['hipSway'] },
  { id: 'crazy-twist', clip: 'dance', layers: ['twist'] },
]

export function pickDance(previousId) {
  const options = PARADE_DANCES.filter((dance) => dance.id !== previousId)
  return options[Math.floor(Math.random() * options.length)]
}

// Stable "random" dance for a seed (e.g. player + dance break), so every
// character gets its own dance without extra state.
export function pickDanceForSeed(seed) {
  let hash = 2166136261
  for (const char of String(seed)) {
    hash ^= char.charCodeAt(0)
    hash = Math.imul(hash, 16777619)
  }
  return PARADE_DANCES[(hash >>> 0) % PARADE_DANCES.length]
}
