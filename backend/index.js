require('dotenv').config();
const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const cors     = require('cors');
const path     = require('path');

const { getDb }    = require('./src/db/database');
const { seed }     = require('./src/db/seed');
const { resumeActiveSimulations } = require('./src/services/gpsSimulator');
const { initSignalOverrides }     = require('./src/services/trafficSignal');

const requestsRoute   = require('./src/routes/requests');
const ambulancesRoute = require('./src/routes/ambulances');
const driversRoute    = require('./src/routes/drivers');
const hospitalsRoute  = require('./src/routes/hospitals');
const adminRoute      = require('./src/routes/admin');
const devicesRoute    = require('./src/routes/devices');
const signalsRoute    = require('./src/routes/signals');
const publicStatsRoute = require('./src/routes/publicStats');

const app    = express();
const server = http.createServer(app);
const PORT   = process.env.PORT || 5000;

const ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:4173',
    ];

const io = new Server(server, {
  cors: { origin: ORIGINS, methods: ['GET', 'POST'], credentials: true },
  transports: ['websocket', 'polling'],
});

// Expose io globally so routes can emit events
global.io = io;

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(cors({ origin: ORIGINS, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ── Logging ────────────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  if (!req.url.includes('/api/gps-update')) {
    console.log(`[${new Date().toLocaleTimeString('en-IN')}] ${req.method} ${req.url}`);
  }
  next();
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/gps-update',    devicesRoute);   // GPS telemetry from hardware
app.use('/api/devices',       devicesRoute);   // arrival-confirm + device management
app.use('/api/requests',      requestsRoute);
app.use('/api/ambulances',    ambulancesRoute);
app.use('/api/drivers',       driversRoute);
app.use('/api/hospitals',     hospitalsRoute);
app.use('/api/admin',         adminRoute);
app.use('/api/signals',       signalsRoute);
app.use('/api/stats',         publicStatsRoute);

// ── Health check ───────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  const db   = getDb();
  const info = {
    status    : 'ok',
    timestamp : new Date().toISOString(),
    db_path   : path.resolve(__dirname, 'ambulance.db'),
    ambulances: db.prepare('SELECT COUNT(*) as c FROM ambulances').get().c,
    hospitals : db.prepare('SELECT COUNT(*) as c FROM hospitals').get().c,
    drivers   : db.prepare('SELECT COUNT(*) as c FROM drivers').get().c,
    requests  : db.prepare('SELECT COUNT(*) as c FROM emergency_requests').get().c,
    gps_active: db.prepare("SELECT COUNT(*) as c FROM ambulances WHERE gps_source='arduino'").get().c,
    ws_clients: io.engine.clientsCount,
  };
  res.json(info);
});

// ── 404 handler ────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Route not found' }));

// ── Error handler ──────────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', detail: err.message });
});

// ── Socket.io connection ───────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[WS] Client connected: ${socket.id}`);

  socket.on('join:request', (requestId) => {
    socket.join(`request:${requestId}`);
  });

  socket.on('join:admin', () => {
    socket.join('admin');
  });

  // ESP32 device joins its own room to receive alarm signals
  socket.on('join:device', (ambulanceId) => {
    socket.join(`device:${ambulanceId}`);
    console.log(`[WS] Device joined room: device:${ambulanceId}`);
  });

  // Step 5 — Driver accepts assignment; relay alarm signal to the ESP32 in the ambulance
  socket.on('driver:alarm', ({ requestId, ambulanceId }) => {
    if (ambulanceId) {
      io.to(`device:${ambulanceId}`).emit('alarm:activate', { requestId });
      console.log(`[WS] alarm:activate relayed → device:${ambulanceId} (request ${requestId})`);
    }
  });

  socket.on('disconnect', () => {
    console.log(`[WS] Client disconnected: ${socket.id}`);
  });
});

// ── Bootstrap ──────────────────────────────────────────────────────────────
function start() {
  getDb();
  seed();
  initSignalOverrides();    // restore persisted traffic signal overrides
  resumeActiveSimulations();

  server.listen(PORT, () => {
    console.log(`\nTN Ambulance Backend`);
    console.log(`  API       : http://localhost:${PORT}/api`);
    console.log(`  WebSocket : ws://localhost:${PORT}`);
    console.log(`  Health    : http://localhost:${PORT}/api/health`);
    console.log(`\n  GPS Bridge:`);
    console.log(`  npm run bridge:all  — simulate all 15 ambulances`);
    console.log(`  npm run bridge:sim  — simulate one device (ARD-001)\n`);
  });
}

start();
