import express from 'express'
import cors from 'cors'
import { createServer } from 'node:http'
import { Server as SocketIOServer } from 'socket.io'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const MAIN_PC_SERVER_IP = process.env.MAIN_PC_SERVER_IP || '192.168.1.100'
const PORT = Number(process.env.SERVER_PORT || 3000)
const FACES_STORAGE_DIR = join(__dirname, '..', '..', 'storage', 'faces')
const QUEUE_SNAPSHOT_LIMIT = 100
const MAX_SERVER_QUEUE = Number(process.env.MAX_SERVER_QUEUE || 300)
const FACE_IMAGE_FILE_PATTERN = /\.(png|jpe?g)$/i

await mkdir(FACES_STORAGE_DIR, { recursive: true })

const playerQueue = []

function buildPublicFacePath(fileName) {
  return `/storage/faces/${encodeURIComponent(String(fileName || ''))}`
}

function buildQueuePlayerPayload(player) {
  const payload = {
    playerId: String(player?.playerId || ''),
    stationId: String(player?.stationId || 'station-unknown'),
    characterType: String(player?.characterType || 'Human'),
    createdAt: player?.createdAt || new Date().toISOString(),
    queuedAt: player?.queuedAt || new Date().toISOString(),
    faceImageFile: String(player?.faceImageFile || ''),
    faceImageUrl: player?.faceImageFile ? buildPublicFacePath(player.faceImageFile) : '',
  }

  return payload
}

function removeQueuedPlayer(playerId) {
  const index = playerQueue.findIndex((player) => player.playerId === playerId)
  if (index < 0) {
    return null
  }

  const [removed] = playerQueue.splice(index, 1)
  return removed || null
}

function isPrivateLanHost(hostname) {
  if (!hostname) return false
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true
  if (hostname === MAIN_PC_SERVER_IP) return true

  if (hostname.startsWith('192.168.')) return true
  if (hostname.startsWith('10.')) return true

  const secondOctet = Number(hostname.split('.')[1])
  if (hostname.startsWith('172.') && Number.isInteger(secondOctet) && secondOctet >= 16 && secondOctet <= 31) {
    return true
  }

  return false
}

function isAllowedOrigin(origin) {
  if (!origin) {
    // Allow native apps/tools where Origin header may not exist.
    return true
  }

  try {
    const url = new URL(origin)
    return isPrivateLanHost(url.hostname)
  } catch {
    return false
  }
}

function corsOriginHandler(origin, callback) {
  callback(null, isAllowedOrigin(origin))
}

function decodeBase64Image(imageDataUrl) {
  const match = String(imageDataUrl || '').match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/)
  if (!match) {
    throw new Error('faceImageBase64 must be a valid base64 data URL.')
  }

  const [, mimeExt, base64Data] = match
  return {
    mimeExt,
    buffer: Buffer.from(base64Data, 'base64'),
  }
}

async function saveFaceImageAsPng(faceImageBase64, playerId) {
  const { buffer } = decodeBase64Image(faceImageBase64)
  const fileName = `${playerId}.png`
  const filePath = join(FACES_STORAGE_DIR, fileName)

  await writeFile(filePath, buffer)

  return {
    fileName,
  }
}

function mimeTypeFromFileName(fileName) {
  const extension = extname(String(fileName || '')).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') {
    return 'image/jpeg'
  }
  return 'image/png'
}

async function getLatestStoredFace() {
  const dirEntries = await readdir(FACES_STORAGE_DIR, { withFileTypes: true })
  const candidateFiles = dirEntries
    .filter((entry) => entry.isFile() && FACE_IMAGE_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)

  if (candidateFiles.length === 0) {
    return null
  }

  const filesWithMtime = await Promise.all(
    candidateFiles.map(async (fileName) => {
      const filePath = join(FACES_STORAGE_DIR, fileName)
      const fileStats = await stat(filePath)
      return {
        fileName,
        filePath,
        mtimeMs: Number(fileStats.mtimeMs || 0),
        updatedAt: fileStats.mtime.toISOString(),
      }
    }),
  )

  filesWithMtime.sort((a, b) => b.mtimeMs - a.mtimeMs)
  const latest = filesWithMtime[0]
  if (!latest) {
    return null
  }

  const rawBuffer = await readFile(latest.filePath)
  const mimeType = mimeTypeFromFileName(latest.fileName)
  const faceImageBase64 = `data:${mimeType};base64,${rawBuffer.toString('base64')}`

  return {
    fileName: latest.fileName,
    updatedAt: latest.updatedAt,
    faceImageBase64,
  }
}

const app = express()
const httpServer = createServer(app)
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: corsOriginHandler,
    methods: ['GET', 'POST'],
  },
})

app.use(
  cors({
    origin: corsOriginHandler,
    methods: ['GET', 'POST', 'OPTIONS'],
  }),
)
app.use(express.json({ limit: '15mb' }))
app.use('/storage/faces', express.static(FACES_STORAGE_DIR))

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    mode: 'offline-lan',
    serverIp: MAIN_PC_SERVER_IP,
    port: PORT,
    socketClients: io.engine.clientsCount,
    queueCount: playerQueue.length,
  })
})

app.get('/api/faces/latest', async (_req, res) => {
  try {
    const latestFace = await getLatestStoredFace()
    if (!latestFace) {
      res.status(404).json({
        ok: false,
        message: 'No stored faces found in /storage/faces yet.',
      })
      return
    }

    res.json({
      ok: true,
      ...latestFace,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown latest-face read error.'
    console.error(`[faces] latest read failed: ${message}`)
    res.status(500).json({
      ok: false,
      message,
    })
  }
})

io.on('connection', (socket) => {
  const rawIp = socket.handshake.address || 'unknown'
  const clientIp = rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp
  const clientOrigin = socket.handshake.headers.origin || 'none'

  console.log(`[socket] connected id=${socket.id} ip=${clientIp} origin=${clientOrigin} total=${io.engine.clientsCount}`)

  socket.emit('server:hello', {
    message: 'Connected to Moonwalk LAN server',
    serverTime: new Date().toISOString(),
  })

  socket.emit('queue:snapshot', {
    players: playerQueue.slice(-QUEUE_SNAPSHOT_LIMIT).map((player) => buildQueuePlayerPayload(player)),
    queueCount: playerQueue.length,
    sentAt: new Date().toISOString(),
  })

  socket.on('player:submit', async (payload, ack) => {
    try {
      const stationId = String(payload?.stationId || 'station-unknown')
      const faceImageBase64 = String(payload?.faceImageBase64 || '')
      const characterType = String(payload?.characterType || 'Human')
      const createdAt = payload?.createdAt || new Date().toISOString()

      if (!faceImageBase64) {
        throw new Error('faceImageBase64 is required.')
      }

      const playerId = randomUUID()
      const savedFace = await saveFaceImageAsPng(faceImageBase64, playerId)

      if (playerQueue.length >= MAX_SERVER_QUEUE) {
        throw new Error(`Queue is full (${MAX_SERVER_QUEUE}). Please wait and try again.`)
      }

      const queuedPlayer = {
        playerId,
        stationId,
        faceImageBase64,
        faceImageFile: savedFace.fileName,
        characterType,
        createdAt,
        queuedAt: new Date().toISOString(),
      }

      playerQueue.push(queuedPlayer)

      const playerQueuedPayload = {
        ...buildQueuePlayerPayload(queuedPlayer),
        queuePosition: playerQueue.length,
      }

      io.emit('player:queued', playerQueuedPayload)
      console.log(
        `[queue] queued playerId=${playerId} stationId=${stationId} characterType=${characterType} queueCount=${playerQueue.length}`,
      )

      if (typeof ack === 'function') {
        ack({ ok: true, playerId, queuePosition: playerQueue.length })
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown submission error.'
      console.error(`[queue] submit failed: ${message}`)

      if (typeof ack === 'function') {
        ack({ ok: false, message })
      }
    }
  })

  socket.on('player:dequeue', (payload, ack) => {
    const playerId = String(payload?.playerId || '')
    if (!playerId) {
      if (typeof ack === 'function') {
        ack({ ok: false, message: 'playerId is required.' })
      }
      return
    }

    const removed = removeQueuedPlayer(playerId)
    if (!removed) {
      if (typeof ack === 'function') {
        ack({ ok: false, message: 'player not found in queue.' })
      }
      return
    }

    io.emit('player:dequeued', {
      playerId,
      queueCount: playerQueue.length,
      dequeuedAt: new Date().toISOString(),
    })
    console.log(`[queue] dequeued playerId=${playerId} queueCount=${playerQueue.length}`)

    if (typeof ack === 'function') {
      ack({ ok: true, playerId, queueCount: playerQueue.length })
    }
  })

  socket.on('disconnect', (reason) => {
    console.log(`[socket] disconnected id=${socket.id} reason=${reason} total=${io.engine.clientsCount}`)
  })
})

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`Moonwalk LAN server running on http://0.0.0.0:${PORT}`)
  console.log(`Main PC IP (example/static): http://${MAIN_PC_SERVER_IP}:${PORT}`)
  console.log('Mini PCs should connect using the Main PC local IP above.')
})
