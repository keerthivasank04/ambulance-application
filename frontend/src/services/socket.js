import { io } from 'socket.io-client';

// VITE_API_URL may be 'http://host:5000/api' — socket needs the server root only
function getServerRoot() {
  const raw = import.meta.env.VITE_API_URL || 'https://tn-ambulance-backend.onrender.com/api';
  // Strip trailing /api or /api/ so socket.io connects to the server root
  return raw.replace(/\/api\/?$/, '');
}

let socket = null;

export function getSocket() {
  if (!socket) {
    socket = io(getServerRoot(), {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1500,
      reconnectionDelayMax: 8000,
    });

    socket.on('connect', () => {
      console.log('[ws] connected:', socket.id);
    });
    socket.on('disconnect', (reason) => {
      console.log('[ws] disconnected:', reason);
    });
    socket.on('connect_error', (err) => {
      console.warn('[ws] error:', err.message);
    });
  }
  return socket;
}

export function joinRequestRoom(requestId) {
  getSocket().emit('join:request', String(requestId));
}

export function joinAdminRoom() {
  getSocket().emit('join:admin');
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
