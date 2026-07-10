const { getDb } = require('../db/database');

// Haversine distance in km
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const PRIORITY_MAP = {
  cardiac: 1, accident: 1, stroke: 1, breathing: 1, burns: 1,
  maternity: 2, fever: 3, general: 3,
};

// TN urban ambulance average speed (km/h) accounting for traffic + sirens
const ETA_SPEED = { ICU: 28, ALS: 38, BLS: 45 };

function generateId(prefix) {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 6).toUpperCase();
}

/**
 * Dispatch: find nearest available ambulance and create a request
 */
function dispatchAmbulance({ patient_name, patient_age, patient_phone, patient_notes,
  emergency_type, patient_lat, patient_lng, patient_address, hospital_id }) {
  const db = getDb();

  // Get all available ambulances with online driver
  const ambulances = db.prepare(`
    SELECT a.*, d.id as driver_id, d.name as driver_name, d.phone as driver_phone
    FROM ambulances a
    JOIN drivers d ON d.ambulance_id = a.id AND d.status = 'online'
    WHERE a.status = 'available'
  `).all();

  if (!ambulances.length) {
    return { success: false, error: 'No ambulances available. Please call 108 immediately.' };
  }

  // Rank: ALS/ICU preferred for high-priority, all sorted by distance
  const priority = PRIORITY_MAP[emergency_type] || 2;
  const ranked = ambulances
    .map(a => ({ ...a, dist: haversine(patient_lat, patient_lng, a.current_lat, a.current_lng) }))
    .sort((a, b) => {
      // For high priority, prefer ALS/ICU
      if (priority === 1) {
        const typeScore = t => ({ ICU: 0, ALS: 1, BLS: 2 }[t] ?? 3);
        const tDiff = typeScore(a.type) - typeScore(b.type);
        if (tDiff !== 0) return tDiff;
      }
      return a.dist - b.dist;
    });

  const best = ranked[0];

  // Choose hospital
  let hospital;
  if (hospital_id) {
    hospital = db.prepare('SELECT * FROM hospitals WHERE id = ?').get(hospital_id);
  }
  if (!hospital) {
    const allHospitals = db.prepare('SELECT * FROM hospitals WHERE emergency_available = 1').all();
    hospital = allHospitals.reduce((prev, h) => {
      const d = haversine(patient_lat, patient_lng, h.lat, h.lng);
      return (!prev || d < prev._d) ? { ...h, _d: d } : prev;
    }, null);
  }
  // Fallback: if every hospital is flagged unavailable, still send the patient
  // somewhere rather than dispatching with no destination at all.
  if (!hospital) {
    const anyHospital = db.prepare('SELECT * FROM hospitals').all();
    hospital = anyHospital.reduce((prev, h) => {
      const d = haversine(patient_lat, patient_lng, h.lat, h.lng);
      return (!prev || d < prev._d) ? { ...h, _d: d } : prev;
    }, null);
  }

  const avgSpeed = ETA_SPEED[best.type] || 38;
  const etaMin  = Math.ceil((best.dist / avgSpeed) * 60);
  const reqId   = generateId('REQ');

  const insertRequest = db.prepare(`
    INSERT INTO emergency_requests
      (id, patient_name, patient_age, patient_phone, patient_notes, emergency_type, priority,
       patient_lat, patient_lng, patient_address, ambulance_id, driver_id, assigned_hospital_id,
       distance_km, eta_minutes, status, requested_at, assigned_at)
    VALUES
      (@id, @patient_name, @patient_age, @patient_phone, @patient_notes, @emergency_type, @priority,
       @patient_lat, @patient_lng, @patient_address, @ambulance_id, @driver_id, @assigned_hospital_id,
       @distance_km, @eta_minutes, 'assigned', datetime('now'), datetime('now'))
  `);

  const updateAmbulance = db.prepare(`UPDATE ambulances SET status='assigned', updated_at=datetime('now') WHERE id=?`);
  const updateDriver    = db.prepare(`UPDATE drivers SET status='on_duty', updated_at=datetime('now') WHERE id=?`);
  const insertLog       = db.prepare(`INSERT INTO request_status_logs (request_id, status, note) VALUES (?, ?, ?)`);

  const doDispatch = db.transaction(() => {
    insertRequest.run({
      id: reqId,
      patient_name, patient_age: patient_age || null, patient_phone,
      patient_notes: patient_notes || null, emergency_type,
      priority, patient_lat, patient_lng, patient_address: patient_address || null,
      ambulance_id: best.id, driver_id: best.driver_id,
      assigned_hospital_id: hospital?.id || null,
      distance_km: +best.dist.toFixed(2), eta_minutes: etaMin,
    });
    updateAmbulance.run(best.id);
    updateDriver.run(best.driver_id);
    insertLog.run(reqId, 'assigned', `Ambulance ${best.registration_number} assigned (${best.dist.toFixed(1)} km away)`);
  });

  doDispatch();

  const request = db.prepare(`
    SELECT r.*, h.name as hospital_name, h.lat as hospital_lat, h.lng as hospital_lng,
           h.address as hospital_address, h.phone as hospital_phone,
           a.registration_number, a.type as ambulance_type, a.current_lat as amb_lat, a.current_lng as amb_lng,
           d.name as driver_name, d.phone as driver_phone, d.rating as driver_rating, d.experience_years
    FROM emergency_requests r
    LEFT JOIN hospitals h   ON h.id = r.assigned_hospital_id
    LEFT JOIN ambulances a  ON a.id = r.ambulance_id
    LEFT JOIN drivers d     ON d.id = r.driver_id
    WHERE r.id = ?
  `).get(reqId);

  return { success: true, requestId: reqId, request };
}

module.exports = { dispatchAmbulance, haversine };
