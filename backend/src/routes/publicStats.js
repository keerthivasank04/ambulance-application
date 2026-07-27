const express = require('express');
const router  = express.Router();
const { getDb } = require('../db/database');

// GET /api/stats — Public, non-sensitive summary counts for the landing
// page. Deliberately excludes recent_requests (patient names) and anything
// else that could leak PII — that detail stays behind admin auth in
// /api/admin/stats.
router.get('/', (req, res) => {
  const db = getDb();
  const active    = db.prepare(`SELECT COUNT(*) as c FROM emergency_requests WHERE status IN ('assigned','enroute','arrived','enroute_hospital')`).get().c;
  const total     = db.prepare(`SELECT COUNT(*) as c FROM emergency_requests`).get().c;
  const completed = db.prepare(`SELECT COUNT(*) as c FROM emergency_requests WHERE status='completed'`).get().c;
  const available = db.prepare(`SELECT COUNT(*) as c FROM ambulances WHERE status='available'`).get().c;
  const assigned  = db.prepare(`SELECT COUNT(*) as c FROM ambulances WHERE status='assigned'`).get().c;
  const hospitals = db.prepare(`SELECT COUNT(*) as c FROM hospitals WHERE emergency_available=1`).get().c;

  res.json({
    requests: { active, total, completed },
    ambulances: { available, assigned },
    hospitals: { total: hospitals },
  });
});

module.exports = router;
