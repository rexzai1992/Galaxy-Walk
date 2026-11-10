import * as THREE from 'three'
import { PALETTE_BANDS } from './characterVariants'

// Vertices driven by the head bones are hidden (the selfie head replaces them);
// vertices driven by the neck bone are kept but recoloured to the guest's skin.
const HEAD_BONE_NAMES = ['Head', 'head_end', 'headfront']
const NECK_BONE_NAME = 'neck'

const SHARED_GLSL = /* glsl */ `
uniform vec3 uPaletteTarget[3];
uniform float uPaletteMix[3];
uniform float uPaletteHue[3];
uniform float uPaletteWidth[3];
uniform float uPaletteRefLum[3];

vec3 avatarRgbToHsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

float avatarHueDistance(float a, float b) {
  float d = abs(a - b);
  return min(d, 1.0 - d);
}

// How strongly a texel belongs to band 0 (the painted skin colour).
float avatarSkinBandWeight(vec3 linearColor) {
  vec3 srgb = pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.2));
  vec3 hsv = avatarRgbToHsv(srgb);
  float colourful = smoothstep(0.12, 0.3, hsv.y) * smoothstep(0.04, 0.12, hsv.z);
  return (1.0 - smoothstep(uPaletteWidth[0], uPaletteWidth[0] + 0.04, avatarHueDistance(hsv.x, uPaletteHue[0]))) * colourful;
}

// Recolours the three texture bands while keeping the painted shading detail.
vec3 avatarPaletteRemap(vec3 linearColor) {
  vec3 srgb = pow(max(linearColor, vec3(0.0)), vec3(1.0 / 2.2));
  vec3 hsv = avatarRgbToHsv(srgb);
  float colourful = smoothstep(0.12, 0.3, hsv.y) * smoothstep(0.04, 0.12, hsv.z);
  float lum = dot(srgb, vec3(0.2126, 0.7152, 0.0722));
  vec3 result = srgb;
  for (int i = 0; i < 3; i++) {
    float inBand = 1.0 - smoothstep(uPaletteWidth[i], uPaletteWidth[i] + 0.04, avatarHueDistance(hsv.x, uPaletteHue[i]));
    float weight = inBand * colourful * uPaletteMix[i];
    float shade = clamp(lum / uPaletteRefLum[i], 0.35, 1.35);
    result = mix(result, uPaletteTarget[i] * shade, weight);
  }
  return pow(clamp(result, 0.0, 1.0), vec3(2.2));
}
`

function hexToSrgbVector(hex) {
  // The palette shader works in sRGB space, so keep the authored sRGB components.
  const color = new THREE.Color()
  color.setStyle(hex, THREE.SRGBColorSpace)
  const srgb = color.clone().convertLinearToSRGB()
  return new THREE.Vector3(srgb.r, srgb.g, srgb.b)
}

/** Returns (Head, head_end, headfront, neck) joint indices, or null without a Head bone. */
export function findHeadJointIndices(skinnedMesh) {
  const bones = skinnedMesh?.skeleton?.bones || []
  const indexOf = (name) => bones.findIndex((bone) => bone.name === name)
  const head = HEAD_BONE_NAMES.map(indexOf)
  if (head[0] < 0) return null
  // Missing optional head bones reuse the Head slot; a missing neck becomes -1 (never matches).
  return new THREE.Vector4(...head.map((index) => (index < 0 ? head[0] : index)), indexOf(NECK_BONE_NAME))
}

/**
 * Clones the GLB body material and patches it to
 *  - recolour the texture bands per character variant
 *  - discard the original (alien) head so the selfie head can replace it
 * Uniform values can be updated later through material.userData.avatarUniforms.
 */
export function createAvatarBodyMaterial(sourceMaterial, { headJointIndices }) {
  const material = sourceMaterial.clone()
  material.name = `${sourceMaterial.name || 'body'}-avatar`

  const uniforms = {
    uPaletteTarget: { value: PALETTE_BANDS.map(() => new THREE.Vector3(1, 1, 1)) },
    uPaletteMix: { value: PALETTE_BANDS.map(() => 0) },
    uPaletteHue: { value: PALETTE_BANDS.map((band) => band.hueDegrees / 360) },
    uPaletteWidth: { value: PALETTE_BANDS.map((band) => band.halfWidthDegrees / 360) },
    uPaletteRefLum: { value: PALETTE_BANDS.map((band) => band.referenceLuminance) },
    uHeadJoints: { value: headJointIndices || new THREE.Vector4(-1, -1, -1, -1) },
    uHideHead: { value: headJointIndices ? 1 : 0 },
    uNeckSkin: { value: new THREE.Color('#d9a27e') },
  }
  material.userData.avatarUniforms = uniforms

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec4 uHeadJoints;
varying float vAvatarHeadWeight;
varying float vAvatarNeckWeight;`,
      )
      .replace(
        '#include <skinning_vertex>',
        `#include <skinning_vertex>
#ifdef USE_SKINNING
  vAvatarHeadWeight = dot(skinWeight, vec4(equal(skinIndex, vec4(uHeadJoints.x))))
    + dot(skinWeight, vec4(equal(skinIndex, vec4(uHeadJoints.y))))
    + dot(skinWeight, vec4(equal(skinIndex, vec4(uHeadJoints.z))));
  vAvatarNeckWeight = dot(skinWeight, vec4(equal(skinIndex, vec4(uHeadJoints.w))));
#else
  vAvatarHeadWeight = 0.0;
  vAvatarNeckWeight = 0.0;
#endif`,
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uHideHead;
uniform vec3 uNeckSkin;
varying float vAvatarHeadWeight;
varying float vAvatarNeckWeight;
${SHARED_GLSL}
// The body's own neck keeps its geometry but takes the guest's skin tone. Only
// texels painted as skin change, so the edge follows the texture, not triangles.
vec3 avatarBodyColor(vec3 texel) {
  float neckMix = smoothstep(0.05, 0.35, vAvatarNeckWeight) * avatarSkinBandWeight(texel) * uHideHead;
  return mix(avatarPaletteRemap(texel), uNeckSkin, neckMix);
}`,
      )
      .replace(
        'void main() {',
        `void main() {
  if (uHideHead > 0.5 && vAvatarHeadWeight > 0.5) discard;`,
      )
      .replace(
        '#include <map_fragment>',
        `#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D(map, vMapUv);
  sampledDiffuseColor.rgb = avatarBodyColor(sampledDiffuseColor.rgb);
  diffuseColor *= sampledDiffuseColor;
#endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#ifdef USE_EMISSIVEMAP
  vec4 emissiveColor = texture2D(emissiveMap, vEmissiveMapUv);
  totalEmissiveRadiance *= avatarBodyColor(emissiveColor.rgb);
#endif`,
      )
  }
  material.customProgramCacheKey = () => 'avatar-body-v4'
  material.needsUpdate = true
  return material
}

/** Applies a character variant palette (and selfie skin tone) to a patched body material. */
export function applyVariantToBodyMaterial(material, variant, selfieSkinHex) {
  const uniforms = material?.userData?.avatarUniforms
  if (!uniforms) return
  uniforms.uNeckSkin.value.set(selfieSkinHex || '#d9a27e')
  PALETTE_BANDS.forEach((band, index) => {
    let target = variant?.palette?.[band.key] || null
    if (target === 'selfie-skin') target = selfieSkinHex || '#d9a27e'
    uniforms.uPaletteMix.value[index] = target ? 1 : 0
    if (target) uniforms.uPaletteTarget.value[index].copy(hexToSrgbVector(target))
  })
  const surface = variant?.surface || {}
  material.metalness = Number.isFinite(surface.metalness) ? surface.metalness : 0
  material.roughness = Number.isFinite(surface.roughness) ? surface.roughness : 0.6
  material.emissiveIntensity = Number.isFinite(surface.glow) ? surface.glow : 0.12
  // The export doubles the specular colour (2,2,2), which looks plastic-wrapped once lit.
  if (material.specularColor) material.specularColor.setScalar(1)
  if ('specularIntensity' in material) material.specularIntensity = 0.6
}
