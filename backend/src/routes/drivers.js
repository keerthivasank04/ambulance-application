const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/database');

// POST /api/drivers/login
router.post('/login', (req, res) => {
  const { phone, password } = req.body;
  if (!phone || !password) return res.status(400).json({ error: 'Phone and password required' });

  const db = getDb();
  const driver = db.prepare(`
    SELECT d.*, a.id as ambulance_id, a.registration_number, a.type as ambulance_type,
           a.status as ambulance_status, a.current_lat as amb_lat, a.current_lng as amb_lng,
           a.gps_source, a.gps_fix_quality, a.gps_satellites
    FROM drivers d
    LEFT JOIN ambulances a ON a.id = d.ambulance_id
    WHERE d.phone = ?
  `).get(phone);

  if (!driver || driver.password !== password) {
    return res.status(401).json({ error: 'Invalid phone or password' });
  }

  const { password: _pw, ...safe } = driver;
  res.json({ success: true, driver: safe });
});

// GET /api/drivers — All drivers (admin)
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT d.id, d.name, d.phone, d.email, d.license_number, d.experience_years,
           d.rating, d.status, d.ambulance_id, d.created_at,
           a.registration_number, a.type as ambulance_type, a.status as ambulance_status
    FROM drivers d
    LEFT JOIN ambulances a ON a.id = d.ambulance_id
    ORDER BY d.name
  `).all();
  res.json(rows);
});

// GET /api/drivers/:id — Driver profile
router.get('/:id', (req, res) => {
  const db = getDb();
  const driver = db.prepare(`
    SELECT d.id, d.name, d.phone, d.email, d.license_number, d.experience_years,
           d.rating, d.status, d.created_at,
           a.id as ambulance_id, a.registration_number, a.type as ambulance_type,
           a.current_lat as amb_lat, a.current_lng as amb_lng,
           a.gps_fix_quality, a.gps_satellites, a.gps_source
    FROM drivers d
    LEFT JOIN ambulances a ON a.id = d.ambulance_id
    WHERE d.id = ?
  `).get(req.params.id);
  if (!driver) return res.status(404).json({ error: 'Driver not found' });
  res.json(driver);
});

// GET /api/drivers/:id/assignment — Poll for active assignment (called every 2s by driver app)
router.get('/:id/assignment', (req, res) => {
  const db = getDb();
  const assignment = db.prepare(`
    SELECT r.*,
           h.name as hospital_name, h.lat as hospital_lat, h.lng as hospital_lng,
           h.address as hospital_address, h.phone as hospital_phone,
           a.registration_number, a.type as ambulance_type,
           a.current_lat as amb_lat, a.current_lng as amb_lng,
           a.gps_fix_quality, a.gps_satellites, a.gps_source
    FROM emergency_requests r
    LEFT JOIN hospitals h  ON h.id = r.assigned_hospital_id
    LEFT JOIN ambulances a ON a.id = r.ambulance_id
    WHERE r.driver_id = ? AND r.status NOT IN ('completed','cancelled')
    ORDER BY r.requested_at DESC LIMIT 1
  `).get(req.params.id);

  if (!assignment) return res.json({ assignment: null });

  const logs = db.prepare(`
    SELECT * FROM request_status_logs WHERE request_id = ? ORDER BY timestamp ASC
  `).all(assignment.id);

  res.json({ assignment: { ...assignment, status_logs: logs } });
});

// POST /api/drivers/:id/accept — Driver accepts assignment
router.post('/:id/accept', (req, res) => {
  const db = getDb();
  const { request_id } = req.body;
  if (!request_id) return res.status(400).json({ error: 'request_id required' });

  const req2 = db.prepare('SELECT * FROM emergency_requests WHERE id = ? AND driver_id = ?').get(request_id, req.params.id);
  if (!req2) return res.status(404).json({ error: 'Assignment not found' });
  if (req2.status !== 'assigned') {
    return res.status(409).json({ error: `Request is already '${req2.status}', cannot accept` });
  }

  db.prepare(`UPDATE emergency_requests SET status='enroute', enroute_at=datetime('now') WHERE id=?`).run(request_id);
  db.prepare(`INSERT INTO request_status_logs (request_id, status, note) VALUES (?,?,?)`).run(request_id, 'enroute', 'Driver accepted and is en route');

  res.json({ success: true });
});

// PATCH /api/drivers/:id/availability — Toggle online/offline
router.patch('/:id/availability', (req, res) => {
  const db   = getDb();
  const { status } = req.body; // 'online' | 'offline'
  if (!['online','offline'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`UPDATE drivers SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  res.json({ success: true, status });
});

module.exports = router;
