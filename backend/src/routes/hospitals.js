const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/database');

// GET /api/hospitals — All hospitals
router.get('/', (req, res) => {
  const db = getDb();
  const { city } = req.query;
  let query  = 'SELECT * FROM hospitals';
  const params = [];
  if (city) { query += ' WHERE city LIKE ?'; params.push(`%${city}%`); }
  query += ' ORDER BY city, name';
  const rows = db.prepare(query).all(...params);
  res.json(rows.map(h => ({ ...h, specialties: JSON.parse(h.specialties || '[]') })));
});

// GET /api/hospitals/:id
router.get('/:id', (req, res) => {
  const db  = getDb();
  const row = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Hospital not found' });
  res.json({ ...row, specialties: JSON.parse(row.specialties || '[]') });
});

module.exports = router;
