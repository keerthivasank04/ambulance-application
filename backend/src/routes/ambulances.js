const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/database');
const { requireAdminAuth } = require('../middleware/adminAuth');

// GET /api/ambulances — All ambulances with live position + driver
router.get('/', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`
    SELECT a.*, d.name as driver_name, d.phone as driver_phone,
           d.status as driver_status, d.rating as driver_rating,
           h.name as base_hospital_name, h.city as base_hospital_city
    FROM ambulances a
    LEFT JOIN drivers d  ON d.ambulance_id = a.id
    LEFT JOIN hospitals h ON h.id = a.base_hospital_id
    ORDER BY a.id
  `).all();
  res.json(rows);
});

// GET /api/ambulances/:id — Single ambulance details
router.get('/:id', (req, res) => {
  const db = getDb();
  const row = db.prepare(`
    SELECT a.*, d.name as driver_name, d.phone as driver_phone,
           d.rating as driver_rating, d.experience_years,
           h.name as base_hospital_name
    FROM ambulances a
    LEFT JOIN drivers d  ON d.ambulance_id = a.id
    LEFT JOIN hospitals h ON h.id = a.base_hospital_id
    WHERE a.id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Ambulance not found' });

  const recentLogs = db.prepare(`
    SELECT lat, lng, speed_kmh, heading, altitude, hdop, satellites, fix_quality, source, timestamp
    FROM ambulance_location_logs WHERE ambulance_id = ?
    ORDER BY timestamp DESC LIMIT 50
  `).all(req.params.id);

  res.json({ ...row, location_history: recentLogs.reverse() });
});

// GET /api/ambulances/:id/location-history — GPS trail for a request
router.get('/:id/location-history', (req, res) => {
  const db = getDb();
  const { request_id, limit = 100 } = req.query;
  let query = `SELECT * FROM ambulance_location_logs WHERE ambulance_id = ?`;
  const params = [req.params.id];
  if (request_id) { query += ' AND request_id = ?'; params.push(request_id); }
  query += ' ORDER BY timestamp DESC LIMIT ?';
  params.push(+limit);
  res.json(db.prepare(query).all(...params).reverse());
});

// PATCH /api/ambulances/:id/status — Admin: change status
router.patch('/:id/status', requireAdminAuth, (req, res) => {
  const db  = getDb();
  const { status } = req.body;
  const valid = ['available','assigned','maintenance','offline'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Invalid status' });
  db.prepare(`UPDATE ambulances SET status=?, updated_at=datetime('now') WHERE id=?`).run(status, req.params.id);
  res.json({ success: true });
});

module.exports = router;
