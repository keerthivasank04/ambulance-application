const { getDb } = require('../db/database');
const { haversine } = require('./dispatch');
const { syncLocationToFirebase } = require('./firebaseSync');

const activeSimulations = new Map();

function emitLocationUpdate(ambulanceId, requestId, lat, lng, speedKmh = 45) {
  if (!global.io) return;
  const payload = {
    ambulance_id : ambulanceId,
    lat, lng,
    speed_kmh    : speedKmh,
    heading      : 0,
    satellites   : 6,
    fix_quality  : 1,
    source       : 'simulation',
    timestamp    : new Date().toISOString(),
    request_id   : requestId,
  };
  global.io.to('admin').emit('ambulance:location', payload);
  if (requestId) {
    global.io.to(`request:${requestId}`).emit('ambulance:location', payload);
  }
  // Steps 8 & 14 — sync location to Firebase (non-blocking)
  syncLocationToFirebase(ambulanceId, lat, lng, requestId);
}

function emitStatusUpdate(requestId, status, note) {
  if (!global.io) return;
  const payload = { requestId, status, note, timestamp: new Date().toISOString() };
  global.io.to(`request:${requestId}`).emit('request:status', payload);
  global.io.to('admin').emit('request:status', payload);
}

function startSimulation(requestId) {
  if (activeSimulations.has(requestId)) return;

  const db = getDb();

  const interval = setInterval(() => {
    const req = db.prepare(`
      SELECT r.*, a.current_lat as amb_lat, a.current_lng as amb_lng
      FROM emergency_requests r
      JOIN ambulances a ON a.id = r.ambulance_id
      WHERE r.id = ?
    `).get(requestId);

    if (!req || ['completed','cancelled'].includes(req.status)) {
      clearInterval(interval);
      activeSimulations.delete(requestId);
      return;
    }

    let targetLat, targetLng;

    if (req.status === 'enroute') {
      targetLat = req.patient_lat;
      targetLng = req.patient_lng;
      const dist = haversine(req.amb_lat, req.amb_lng, targetLat, targetLng);
      if (dist < 0.08) {
        db.prepare(`UPDATE emergency_requests SET status='arrived', arrived_at=datetime('now') WHERE id=?`).run(requestId);
        db.prepare(`INSERT INTO request_status_logs (request_id, status, note) VALUES (?, ?, ?)`).run(requestId, 'arrived', 'Ambulance arrived at patient location');
        db.prepare(`UPDATE ambulances SET current_lat=?, current_lng=?, last_location_update=datetime('now') WHERE id=?`).run(targetLat, targetLng, req.ambulance_id);
        db.prepare(`INSERT INTO ambulance_location_logs (ambulance_id, request_id, lat, lng, source) VALUES (?,?,?,?,'simulation')`).run(req.ambulance_id, requestId, targetLat, targetLng);
        emitStatusUpdate(requestId, 'arrived', 'Ambulance arrived at patient location');
        emitLocationUpdate(req.ambulance_id, requestId, targetLat, targetLng, 0);
        return;
      }
    } else if (req.status === 'enroute_hospital') {
      const hosp = db.prepare('SELECT lat, lng FROM hospitals WHERE id=?').get(req.assigned_hospital_id);
      if (!hosp) return;
      targetLat = hosp.lat;
      targetLng = hosp.lng;
      const dist = haversine(req.amb_lat, req.amb_lng, targetLat, targetLng);
      if (dist < 0.08) {
        db.prepare(`UPDATE emergency_requests SET status='completed', hospital_delivered_at=datetime('now'), completed_at=datetime('now') WHERE id=?`).run(requestId);
        db.prepare(`UPDATE ambulances SET status='available', updated_at=datetime('now') WHERE id=?`).run(req.ambulance_id);
        db.prepare(`UPDATE drivers SET status='online', updated_at=datetime('now') WHERE id=?`).run(req.driver_id);
        db.prepare(`INSERT INTO request_status_logs (request_id, status, note) VALUES (?, ?, ?)`).run(requestId, 'completed', 'Patient delivered to hospital. Mission complete.');
        db.prepare(`UPDATE ambulances SET current_lat=?, current_lng=?, gps_source='none', last_location_update=datetime('now') WHERE id=?`).run(targetLat, targetLng, req.ambulance_id);
        emitStatusUpdate(requestId, 'completed', 'Patient delivered to hospital. Mission complete.');
        emitLocationUpdate(req.ambulance_id, requestId, targetLat, targetLng, 0);

        // Clear traffic corridor
        try {
          const { clearCorridorForRequest, getAllSignalStates } = require('./trafficSignal');
          clearCorridorForRequest(requestId);
          if (global.io) global.io.to('admin').emit('signal:update', getAllSignalStates());
        } catch {}

        clearInterval(interval);
        activeSimulations.delete(requestId);
        return;
      }
    } else {
      return;
    }

    const newLat = req.amb_lat + (targetLat - req.amb_lat) * 0.06;
    const newLng = req.amb_lng + (targetLng - req.amb_lng) * 0.06;
    const speedKmh = Math.floor(35 + Math.random() * 25);

    db.prepare(`UPDATE ambulances SET current_lat=?, current_lng=?, current_speed_kmh=?, gps_source='simulation', last_location_update=datetime('now') WHERE id=?`).run(newLat, newLng, speedKmh, req.ambulance_id);
    db.prepare(`INSERT INTO ambulance_location_logs (ambulance_id, request_id, lat, lng, speed_kmh, source) VALUES (?,?,?,?,?,'simulation')`).run(req.ambulance_id, requestId, newLat, newLng, speedKmh);

    emitLocationUpdate(req.ambulance_id, requestId, newLat, newLng, speedKmh);

    // Update traffic signals for new position
    try {
      const { activateCorridorForAmbulance, getAllSignalStates } = require('./trafficSignal');
      const changed = activateCorridorForAmbulance(newLat, newLng, requestId, req.ambulance_id);
      if (global.io && changed.length > 0) {
        global.io.to('admin').emit('signal:update', getAllSignalStates());
      }
    } catch {}

  }, 2000);

  activeSimulations.set(requestId, interval);
  console.log(`[gps] simulation started for request ${requestId}`);
}

function stopSimulation(requestId) {
  if (activeSimulations.has(requestId)) {
    clearInterval(activeSimulations.get(requestId));
    activeSimulations.delete(requestId);
  }
}

function resumeActiveSimulations() {
  const db = getDb();
  const active = db.prepare(`SELECT id FROM emergency_requests WHERE status IN ('enroute','enroute_hospital')`).all();
  active.forEach(r => startSimulation(r.id));
  if (active.length) console.log(`[gps] resumed ${active.length} active simulations`);
}

module.exports = { startSimulation, stopSimulation, resumeActiveSimulations };
