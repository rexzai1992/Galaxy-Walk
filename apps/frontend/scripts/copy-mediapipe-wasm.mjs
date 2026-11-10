// Copies the MediaPipe vision WASM runtime into public/ so face detection works
// fully offline (no CDN). Runs automatically before `npm run dev` / `npm run build`.
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FRONTEND_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE_DIR = join(FRONTEND_DIR, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm')
const TARGET_DIR = join(FRONTEND_DIR, 'public', 'mediapipe', 'wasm')
const FILES = [
  'vision_wasm_internal.js',
  'vision_wasm_internal.wasm',
  'vision_wasm_nosimd_internal.js',
  'vision_wasm_nosimd_internal.wasm',
]

await mkdir(TARGET_DIR, { recursive: true })

for (const fileName of FILES) {
  const from = join(SOURCE_DIR, fileName)
  const to = join(TARGET_DIR, fileName)
  const [source, target] = await Promise.all([stat(from), stat(to).catch(() => null)])
  if (target && target.size === source.size && target.mtimeMs >= source.mtimeMs) continue
  await copyFile(from, to)
}
