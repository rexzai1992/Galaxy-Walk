import { io } from 'socket.io-client'

const fallbackHost = window.location.protocol === 'file:' ? '127.0.0.1' : window.location.hostname || '127.0.0.1'
export const SOCKET_SERVER_URL = import.meta.env.VITE_SOCKET_URL || `http://${fallbackHost}:3000`

export const socket = io(SOCKET_SERVER_URL, {
  autoConnect: false,
  reconnection: true,
})
