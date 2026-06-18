import { ref } from 'vue'
import { io } from 'socket.io-client'

function toSocketBase(httpBase) {
  if (!httpBase) return window.location.origin
  return httpBase
}

export function useRoomSocket({ apiBase, roomCode, token, onMessage }) {
  const socket = ref(null)
  const isConnected = ref(false)

  function connect() {
    if (!roomCode) return
    const socketClient = io(toSocketBase(apiBase), {
      auth: { roomCode, token },
      transports: ['websocket', 'polling'],
      withCredentials: true,
    })

    socketClient.on('connect', () => {
      isConnected.value = true
    })

    socketClient.on('disconnect', () => {
      isConnected.value = false
    })

    socketClient.on('connect_error', (err) => {
      isConnected.value = false
      onMessage?.({ type: 'error', message: err.message || 'Ошибка подключения' })
    })

    socketClient.on('message', (payload) => {
      onMessage?.(payload)
    })

    socket.value = socketClient
  }

  function send(payload) {
    if (!socket.value || !socket.value.connected) return
    socket.value.emit('message', payload)
  }

  function close() {
    if (socket.value) {
      socket.value.disconnect()
      socket.value = null
    }
  }

  return {
    socket,
    isConnected,
    connect,
    send,
    close,
  }
}
