const express = require('express');
const router  = express.Router();
const { getAllSignalStates, activateCorridorForAmbulance, clearCorridorForRequest } = require('../services/trafficSignal');
const { requireAdminAuth } = require('../middleware/adminAuth');

// GET /api/signals — All intersection states
router.get('/', (_req, res) => {
  res.json(getAllSignalStates());
});

// POST /api/signals/corridor — Manually activate/test corridor (admin)
router.post('/corridor', requireAdminAuth, (req, res) => {
  const { lat, lng, requestId, ambulanceId } = req.body;
  if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });
  const changed = activateCorridorForAmbulance(+lat, +lng, requestId || 'manual', ambulanceId || 'manual');
  if (global.io && changed.length > 0) {
    global.io.to('admin').emit('signal:update', getAllSignalStates());
  }
  res.json({ changed, all: getAllSignalStates() });
});

// DELETE /api/signals/corridor/:requestId — Clear corridor for a request
router.delete('/corridor/:requestId', requireAdminAuth, (req, res) => {
  const cleared = clearCorridorForRequest(req.params.requestId);
  if (global.io && cleared.length > 0) {
    global.io.to('admin').emit('signal:update', getAllSignalStates());
  }
  res.json({ cleared, all: getAllSignalStates() });
});

module.exports = router;
