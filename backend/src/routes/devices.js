/**
 * POST /api/gps-update  — GPS telemetry from Arduino/ESP32 (every ~1 second)
 * POST /api/devices/arrival-confirm — ESP32 geofence arrival events (steps 10, 11, 16, 17)
 */
const express   = require('express');
const router    = express.Router();
const { getDb } = require('../db/database');
const { activateCorridorForAmbulance, getAllSignalStates, clearCorridorForRequest } = require('../services/trafficSignal');

const GPS_API_KEY = process.env.GPS_API_KEY || 'arduino-bridge-secret';

router.post('/', (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.body.api_key;
  if (apiKey !== GPS_API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const {
    device_id,
    ambulance_id,
    lat,
    lng,
    speed_kmh   = 0,
    heading     = 0,
    altitude    = 0,
    hdop        = 0,
    satellites  = 0,
    fix_quality = 0,
    source      = 'arduino',
  } = req.body;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  if (fix_quality === 0) {
    return res.json({ status: 'no_fix' });
  }

  const db = getDb();

  let amb = null;
  if (device_id) {
    amb = db.prepare('SELECT * FROM ambulances WHERE gps_device_id = ?').get(device_id);
  }
  if (!amb && ambulance_id) {
    amb = db.prepare('SELECT * FROM ambulances WHERE id = ?').get(ambulance_id);
  }
  if (!amb) {
    return res.status(404).json({ error: 'Device not registered. Check device_id or ambulance_id.' });
  }

  // Update live position
  db.prepare(`
    UPDATE ambulances
    SET current_lat          = ?,
        current_lng          = ?,
        current_speed_kmh    = ?,
        current_heading      = ?,
        gps_fix_quality      = ?,
        gps_satellites       = ?,
        gps_hdop             = ?,
        gps_source           = ?,
        last_location_update = datetime('now'),
        last_gps_fix         = datetime('now'),
        updated_at           = datetime('now')
    WHERE id = ?
  `).run(+lat, +lng, +speed_kmh, +heading, +fix_quality, +satellites, +hdop, source, amb.id);

  // Find active request for this ambulance
  const activeReq = db.prepare(`
    SELECT id FROM emergency_requests
    WHERE ambulance_id = ? AND status IN ('assigned','enroute','arrived','enroute_hospital')
    ORDER BY requested_at DESC LIMIT 1
  `).get(amb.id);

  // Log GPS point
  db.prepare(`
    INSERT INTO ambulance_location_logs
      (ambulance_id, request_id, lat, lng, speed_kmh, heading, altitude, hdop, satellites, fix_quality, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(amb.id, activeReq?.id || null, +lat, +lng, +speed_kmh, +heading, +altitude, +hdop, +satellites, +fix_quality, source);

  // Emit real-time GPS update via WebSocket
  if (global.io) {
    const locationPayload = {
      ambulance_id : amb.id,
      device_id    : amb.gps_device_id,
      lat          : +lat,
      lng          : +lng,
      speed_kmh    : +speed_kmh,
      heading      : +heading,
      satellites,
      fix_quality,
      source,
      timestamp    : new Date().toISOString(),
      request_id   : activeReq?.id || null,
    };
    global.io.to('admin').emit('ambulance:location', locationPayload);
    if (activeReq?.id) {
      global.io.to(`request:${activeReq.id}`).emit('ambulance:location', locationPayload);
    }
  }

  // Activate traffic signal corridor when ambulance is en-route
  if (activeReq?.id) {
    const changed = activateCorridorForAmbulance(+lat, +lng, activeReq.id, amb.id);
    if (global.io && changed.length > 0) {
      global.io.to('admin').emit('signal:update', getAllSignalStates());
    }
  }

  return res.json({
    status       : 'ok',
    ambulance_id : amb.id,
    request_id   : activeReq?.id || null,
  });
});

/**
 * POST /api/devices/arrival-confirm
 * Called by the ESP32 when it detects a geofence trigger (arrived at patient or hospital).
 * event: 'arrived_patient' | 'patient_onboard' | 'arrived_hospital' | 'completed'
 *
 * Architecture steps:
 *   Step 10 — Ambulance Arrives at Accident Zone
 *   Step 11 — Patient Onboard
 *   Step 16 — Ambulance Arrives at Hospital
 *   Step 17 — Reached (Ride Completed)
 */
router.post('/arrival-confirm', (req, res) => {
  const apiKey = req.headers['x-api-key'] || req.body.api_key;
  if (apiKey !== GPS_API_KEY) {
    return res.status(401).json({ error: 'Invalid API key' });
  }

  const { device_id, ambulance_id, event } = req.body;
  const validEvents = ['arrived_patient', 'patient_onboard', 'arrived_hospital', 'completed'];
  if (!validEvents.includes(event)) {
    return res.status(400).json({ error: `Invalid event. Must be one of: ${validEvents.join(', ')}` });
  }

  const db = getDb();

  let amb = null;
  if (device_id) amb = db.prepare('SELECT * FROM ambulances WHERE gps_device_id = ?').get(device_id);
  if (!amb && ambulance_id) amb = db.prepare('SELECT * FROM ambulances WHERE id = ?').get(ambulance_id);
  if (!amb) return res.status(404).json({ error: 'Device not registered' });

  const activeReq = db.prepare(`
    SELECT * FROM emergency_requests
    WHERE ambulance_id = ? AND status IN ('assigned','enroute','arrived','enroute_hospital')
    ORDER BY requested_at DESC LIMIT 1
  `).get(amb.id);
  if (!activeReq) return res.status(404).json({ error: 'No active request for this ambulance' });

  const statusMap = {
    arrived_patient : { status: 'arrived',          field: 'arrived_at',            note: 'ESP32: ambulance arrived at patient location' },
    patient_onboard : { status: 'enroute_hospital', field: 'enroute_at',            note: 'ESP32: patient onboard, en route to hospital' },
    arrived_hospital: { status: 'completed',        field: 'hospital_delivered_at', note: 'ESP32: arrived at hospital' },
    completed       : { status: 'completed',        field: 'completed_at',          note: 'ESP32: ride completed' },
  };

  const { status, field, note } = statusMap[event];
  db.prepare(`UPDATE emergency_requests SET status=?, ${field}=datetime('now') WHERE id=?`).run(status, activeReq.id);
  db.prepare(`INSERT INTO request_status_logs (request_id, status, note) VALUES (?,?,?)`).run(activeReq.id, status, note);

  if (status === 'completed') {
    db.prepare(`UPDATE ambulances SET status='available', gps_source='none', updated_at=datetime('now') WHERE id=?`).run(amb.id);
    db.prepare(`UPDATE drivers SET status='online', updated_at=datetime('now') WHERE id=?`).run(activeReq.driver_id);
    const cleared = clearCorridorForRequest(activeReq.id);
    if (global.io && cleared.length > 0) {
      global.io.to('admin').emit('signal:update', getAllSignalStates());
    }
  }

  if (global.io) {
    const payload = { requestId: activeReq.id, status, note, timestamp: new Date().toISOString() };
    global.io.to(`request:${activeReq.id}`).emit('request:status', payload);
    global.io.to('admin').emit('request:status', payload);
  }

  console.log(`[esp32] ${event} confirmed for request ${activeReq.id} → status=${status}`);
  return res.json({ success: true, requestId: activeReq.id, status });
});

module.exports = router;
