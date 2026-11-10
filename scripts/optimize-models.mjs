#!/usr/bin/env node
// Builds the lightweight runtime GLBs served by the frontend from the full-size
// Meshy exports kept in assets/models/source.
//
//   npm run optimize:models
//
// - character.glb  -> same mesh/rig, texture re-encoded to 2048px JPEG
// - alien/<anim>.glb -> animation clips + skeleton only (no mesh, no texture)
//
// The base character and every animation file must share the same skeleton
// (bone names), which is the case for Meshy "withSkin" animation exports.

import { mkdir, stat } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, prune } from '@gltf-transform/functions'
import sharp from 'sharp'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_DIR = join(ROOT, 'assets', 'models', 'source')
const OUTPUT_DIR = join(ROOT, 'apps', 'frontend', 'public', 'models')
const TEXTURE_MAX_SIZE = 2048
const TEXTURE_JPEG_QUALITY = 86

const BASE_CHARACTER = { from: 'character.glb', to: 'character.glb' }
const ANIMATIONS = ['idle', 'wave', 'dance', 'pose'].map((name) => ({
  from: join('alien', `${name}.glb`),
  to: join('alien', `${name}.glb`),
}))

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)

function formatMb(bytes) {
  return `${(bytes / 1e6).toFixed(2)} MB`
}

async function report(label, fromPath, toPath) {
  const [before, after] = await Promise.all([stat(fromPath), stat(toPath)])
  console.log(`${label.padEnd(20)} ${formatMb(before.size).padStart(10)} -> ${formatMb(after.size).padStart(10)}  ${relative(ROOT, toPath)}`)
}

async function optimizeBaseCharacter({ from, to }) {
  const fromPath = join(SOURCE_DIR, from)
  const toPath = join(OUTPUT_DIR, to)
  const document = await io.read(fromPath)

  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage()
    if (!image) continue
    const encoded = await sharp(image)
      .resize(TEXTURE_MAX_SIZE, TEXTURE_MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: TEXTURE_JPEG_QUALITY, mozjpeg: true })
      .toBuffer()
    texture.setImage(encoded).setMimeType('image/jpeg')
    if (texture.getURI()) texture.setURI(texture.getURI().replace(/\.png$/i, '.jpg'))
  }

  await document.transform(dedup(), prune())
  await mkdir(dirname(toPath), { recursive: true })
  await io.write(toPath, document)
  await report('character', fromPath, toPath)
}

async function extractAnimationOnly({ from, to }) {
  const fromPath = join(SOURCE_DIR, from)
  const toPath = join(OUTPUT_DIR, to)
  const document = await io.read(fromPath)
  const root = document.getRoot()

  root.listNodes().forEach((node) => {
    node.setMesh(null)
    node.setSkin(null)
  })
  root.listMeshes().forEach((mesh) => mesh.dispose())
  root.listSkins().forEach((skin) => skin.dispose())
  root.listMaterials().forEach((material) => material.dispose())
  root.listTextures().forEach((texture) => texture.dispose())

  if (root.listAnimations().length === 0) {
    throw new Error(`${from} has no animation clips`)
  }

  // keepLeaves: bones such as head_end have no children but are animation targets.
  await document.transform(prune({ keepLeaves: true }), dedup())
  await mkdir(dirname(toPath), { recursive: true })
  await io.write(toPath, document)
  await report(`anim:${to}`, fromPath, toPath)
}

await optimizeBaseCharacter(BASE_CHARACTER)
for (const animation of ANIMATIONS) {
  await extractAnimationOnly(animation)
}
