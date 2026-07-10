const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/database');
const { requireAdminAuth } = require('../middleware/adminAuth');

const ADMIN_USER = process.env.ADMIN_USER     || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'admin123';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN   || 'tnadmin-secret-token';

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    return res.json({ success: true, token: ADMIN_TOKEN });
  }
  return res.status(401).json({ error: 'Invalid username or password' });
});

// GET /api/admin/stats — Dashboard statistics
router.get('/stats', requireAdminAuth, (req, res) => {
  const db = getDb();

  const total       = db.prepare(`SELECT COUNT(*) as c FROM emergency_requests`).get().c;
  const completed   = db.prepare(`SELECT COUNT(*) as c FROM emergency_requests WHERE status='completed'`).get().c;
  const active      = db.prepare(`SELECT COUNT(*) as c FROM emergency_requests WHERE status IN ('assigned','enroute','arrived','enroute_hospital')`).get().c;
  const cancelled   = db.prepare(`SELECT COUNT(*) as c FROM emergency_requests WHERE status='cancelled'`).get().c;
  const available   = db.prepare(`SELECT COUNT(*) as c FROM ambulances WHERE status='available'`).get().c;
  const assigned    = db.prepare(`SELECT COUNT(*) as c FROM ambulances WHERE status='assigned'`).get().c;
  const maintenance = db.prepare(`SELECT COUNT(*) as c FROM ambulances WHERE status='maintenance'`).get().c;
  const driversOnline  = db.prepare(`SELECT COUNT(*) as c FROM drivers WHERE status='online'`).get().c;
  const driversOnDuty  = db.prepare(`SELECT COUNT(*) as c FROM drivers WHERE status='on_duty'`).get().c;
  const totalHospitals = db.prepare(`SELECT COUNT(*) as c FROM hospitals WHERE emergency_available=1`).get().c;
  const arduinoActive  = db.prepare(`SELECT COUNT(*) as c FROM ambulances WHERE gps_source='arduino'`).get().c;
  const simActive      = db.prepare(`SELECT COUNT(*) as c FROM ambulances WHERE gps_source='simulation'`).get().c;

  const avgResp = db.prepare(`
    SELECT AVG((julianday(arrived_at) - julianday(requested_at)) * 24 * 60) as avg_min
    FROM emergency_requests
    WHERE arrived_at IS NOT NULL AND requested_at IS NOT NULL
  `).get();

  const byType = db.prepare(`
    SELECT emergency_type, COUNT(*) as count FROM emergency_requests
    GROUP BY emergency_type ORDER BY count DESC
  `).all();

  const recent = db.prepare(`
    SELECT r.id, r.patient_name, r.emergency_type, r.status, r.requested_at, r.eta_minutes,
           d.name as driver_name, h.name as hospital_name, h.city,
           a.registration_number, a.type as ambulance_type
    FROM emergency_requests r
    LEFT JOIN drivers d    ON d.id = r.driver_id
    LEFT JOIN hospitals h  ON h.id = r.assigned_hospital_id
    LEFT JOIN ambulances a ON a.id = r.ambulance_id
    ORDER BY r.requested_at DESC LIMIT 15
  `).all();

  res.json({
    requests  : { total, completed, active, cancelled },
    ambulances: { available, assigned, maintenance, total: available + assigned + maintenance, arduino_active: arduinoActive, sim_active: simActive },
    drivers   : { online: driversOnline, on_duty: driversOnDuty },
    hospitals : { total: totalHospitals },
    avg_response_time_min: avgResp?.avg_min ? +avgResp.avg_min.toFixed(1) : null,
    by_type   : byType,
    recent_requests: recent,
  });
});

// GET /api/admin/ambulances/live — All ambulances with live GPS for fleet map
router.get('/ambulances/live', requireAdminAuth, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT a.id, a.registration_number, a.type, a.status,
           a.current_lat, a.current_lng, a.current_speed_kmh, a.current_heading,
           a.gps_fix_quality, a.gps_satellites, a.gps_source,
           a.gps_device_id, a.last_location_update,
           d.name as driver_name, d.phone as driver_phone, d.status as driver_status,
           r.id as active_request_id, r.emergency_type, r.patient_name
    FROM ambulances a
    LEFT JOIN drivers d ON d.ambulance_id = a.id
    LEFT JOIN emergency_requests r
      ON r.ambulance_id = a.id AND r.status NOT IN ('completed','cancelled')
    ORDER BY a.id
  `).all();
  res.json(rows);
});

module.exports = router;
