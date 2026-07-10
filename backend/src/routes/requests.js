const express  = require('express');
const router   = express.Router();
const { getDb }              = require('../db/database');
const { dispatchAmbulance }  = require('../services/dispatch');
const { startSimulation }    = require('../services/gpsSimulator');
const { clearCorridorForRequest } = require('../services/trafficSignal');
const { syncRequestToFirebase, syncRideCompletedToFirebase } = require('../services/firebaseSync');

// POST /api/requests — Submit emergency request
router.post('/', (req, res) => {
  const { patient_name, patient_age, patient_phone, patient_notes,
          emergency_type, patient_lat, patient_lng, patient_address, hospital_id } = req.body;

  if (!patient_name || !patient_phone || !emergency_type || !patient_lat || !patient_lng) {
    return res.status(400).json({ error: 'Missing required fields: patient_name, patient_phone, emergency_type, patient_lat, patient_lng' });
  }

  const lat = +patient_lat, lng = +patient_lng;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: 'patient_lat/patient_lng must be valid coordinates' });
  }
  if (patient_age !== undefined && patient_age !== null && patient_age !== '') {
    const age = +patient_age;
    if (!Number.isFinite(age) || age < 0 || age > 130) {
      return res.status(400).json({ error: 'patient_age must be a realistic age' });
    }
  }

  const result = dispatchAmbulance({
    patient_name, patient_age, patient_phone, patient_notes,
    emergency_type, patient_lat: +patient_lat, patient_lng: +patient_lng,
    patient_address, hospital_id,
  });

  if (!result.success) return res.status(503).json({ error: result.error });

  // Notify admin room of new emergency
  if (global.io) {
    global.io.to('admin').emit('request:new', {
      requestId     : result.requestId,
      patient_name,
      emergency_type,
      status        : 'assigned',
      requested_at  : new Date().toISOString(),
    });
  }

  // Steps 2 & 3 — mirror accident location to Firebase
  syncRequestToFirebase({
    id            : result.requestId,
    patient_name,
    emergency_type,
    patient_lat   : +patient_lat,
    patient_lng   : +patient_lng,
    status        : 'assigned',
    requested_at  : new Date().toISOString(),
  });

  return res.status(201).json(result);
});

// GET /api/requests — List all (admin)
router.get('/', (req, res) => {
  const db = getDb();
  const { status, limit = 50, offset = 0 } = req.query;
  let query = `
    SELECT r.*, h.name as hospital_name,
           a.registration_number, a.type as ambulance_type,
           a.current_lat as amb_lat, a.current_lng as amb_lng,
           a.current_speed_kmh, a.gps_fix_quality, a.gps_satellites, a.gps_source,
           d.name as driver_name, d.phone as driver_phone
    FROM emergency_requests r
    LEFT JOIN hospitals h  ON h.id = r.assigned_hospital_id
    LEFT JOIN ambulances a ON a.id = r.ambulance_id
    LEFT JOIN drivers d    ON d.id = r.driver_id
  `;
  const params = [];
  if (status) { query += ' WHERE r.status = ?'; params.push(status); }
  query += ' ORDER BY r.requested_at DESC LIMIT ? OFFSET ?';
  params.push(+limit, +offset);
  res.json(db.prepare(query).all(...params));
});

// GET /api/requests/:id — Live request details + ambulance position
router.get('/:id', (req, res) => {
  const db = getDb();
  const request = db.prepare(`
    SELECT r.*,
           h.name as hospital_name, h.lat as hospital_lat, h.lng as hospital_lng,
           h.address as hospital_address, h.phone as hospital_phone,
           a.registration_number, a.type as ambulance_type,
           a.current_lat as amb_lat, a.current_lng as amb_lng,
           a.current_speed_kmh, a.current_heading, a.gps_fix_quality,
           a.gps_satellites, a.gps_hdop, a.gps_source, a.last_location_update,
           d.name as driver_name, d.phone as driver_phone, d.rating as driver_rating,
           d.experience_years as driver_experience
    FROM emergency_requests r
    LEFT JOIN hospitals h  ON h.id = r.assigned_hospital_id
    LEFT JOIN ambulances a ON a.id = r.ambulance_id
    LEFT JOIN drivers d    ON d.id = r.driver_id
    WHERE r.id = ?
  `).get(req.params.id);

  if (!request) return res.status(404).json({ error: 'Request not found' });

  const logs = db.prepare(`
    SELECT * FROM request_status_logs WHERE request_id = ? ORDER BY timestamp ASC
  `).all(req.params.id);

  res.json({ ...request, status_logs: logs });
});

// Allowed forward transitions in the dispatch state machine — prevents a
// stale/duplicate client request from driving a trip backward (e.g. moving
// a 'completed' request back to 'enroute').
const ALLOWED_NEXT_STATUS = {
  assigned         : ['enroute', 'cancelled'],
  enroute          : ['arrived', 'cancelled'],
  arrived          : ['enroute_hospital', 'cancelled'],
  enroute_hospital : ['completed', 'cancelled'],
  completed        : [],
  cancelled        : [],
};

// PATCH /api/requests/:id/status — Driver updates status
router.patch('/:id/status', (req, res) => {
  const db = getDb();
  const { status, note } = req.body;
  const validStatuses = ['enroute','arrived','enroute_hospital','completed','cancelled'];

  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
  }

  const request = db.prepare('SELECT * FROM emergency_requests WHERE id = ?').get(req.params.id);
  if (!request) return res.status(404).json({ error: 'Request not found' });

  const allowedNext = ALLOWED_NEXT_STATUS[request.status] || [];
  if (!allowedNext.includes(status)) {
    return res.status(409).json({ error: `Cannot move request from '${request.status}' to '${status}'` });
  }

  const timeFields = {
    enroute          : 'enroute_at',
    arrived          : 'arrived_at',
    enroute_hospital : 'enroute_at',
    completed        : 'completed_at',
    cancelled        : 'cancelled_at',
  };

  const field = timeFields[status];
  db.prepare(`UPDATE emergency_requests SET status=?, ${field}=datetime('now') WHERE id=?`).run(status, req.params.id);
  db.prepare(`INSERT INTO request_status_logs (request_id, status, note) VALUES (?,?,?)`).run(req.params.id, status, note || null);

  // Start simulation when driver goes enroute
  if (status === 'enroute' || status === 'enroute_hospital') {
    const amb = db.prepare('SELECT * FROM ambulances WHERE id = ?').get(request.ambulance_id);
    if (amb && amb.gps_source !== 'arduino') {
      startSimulation(req.params.id);
    }
  }

  // Clear traffic corridor when trip ends
  if (status === 'completed' || status === 'cancelled') {
    db.prepare(`UPDATE ambulances SET status='available', gps_source='none', updated_at=datetime('now') WHERE id=?`).run(request.ambulance_id);
    db.prepare(`UPDATE drivers SET status='online', updated_at=datetime('now') WHERE id=?`).run(request.driver_id);
    clearCorridorForRequest(req.params.id);
    // Step 18 — store ride completed in Firebase
    if (status === 'completed') syncRideCompletedToFirebase(req.params.id, new Date().toISOString());
  }

  // Emit status update to watchers of this request and admin room
  if (global.io) {
    const payload = { requestId: req.params.id, status, note: note || null, timestamp: new Date().toISOString() };
    global.io.to(`request:${req.params.id}`).emit('request:status', payload);
    global.io.to('admin').emit('request:status', payload);
  }

  res.json({ success: true, status });
});

module.exports = router;
