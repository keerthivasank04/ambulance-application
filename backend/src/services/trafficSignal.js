/**
 * Traffic Signal Control
 * Manages green-corridor overrides for nearby intersections when an ambulance is en-route.
 * State is persisted to SQLite so it survives server restarts.
 * Step 9 (Control Server → Push Signal Change) and step 15 (Signal Update ack) from architecture.
 */

const { getDb } = require('../db/database');

const INTERSECTIONS = [
  { id: 'INT-001', name: 'Anna Salai × Mount Road',        lat: 13.0674, lng: 80.2456 },
  { id: 'INT-002', name: 'Guindy × GST Road',              lat: 13.0069, lng: 80.2197 },
  { id: 'INT-003', name: 'Egmore × Poonamallee High Road', lat: 13.0785, lng: 80.2601 },
  { id: 'INT-004', name: 'T Nagar × Usman Road',           lat: 13.0397, lng: 80.2342 },
  { id: 'INT-005', name: 'Adyar × LB Road',                lat: 12.9949, lng: 80.2564 },
  { id: 'INT-006', name: 'Tambaram × Old Mahabalipuram',   lat: 12.9249, lng: 80.1000 },
  { id: 'INT-007', name: 'Velachery × 100 Feet Road',      lat: 12.9761, lng: 80.2108 },
  { id: 'INT-008', name: 'Porur × Chennai Bypass',         lat: 13.0358, lng: 80.1571 },
  { id: 'INT-009', name: 'Koyambedu × CMBT',               lat: 13.0694, lng: 80.1948 },
  { id: 'INT-010', name: 'Sholinganallur × OMR',           lat: 12.9010, lng: 80.2279 },
  { id: 'INT-011', name: 'Chrompet × GST Road',            lat: 12.9520, lng: 80.1436 },
  { id: 'INT-012', name: 'Medavakkam × Perumbakkam Road',  lat: 12.9218, lng: 80.1964 },
];

// In-memory state for active signal overrides — loaded from DB on init
const activeOverrides = new Map();

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
          + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getNearbyIntersections(lat, lng, radiusKm = 2.5) {
  return INTERSECTIONS
    .map(i => ({ ...i, distanceKm: haversineKm(lat, lng, i.lat, i.lng) }))
    .filter(i => i.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

// Loads persisted overrides from DB into the in-memory map on server startup
function initSignalOverrides() {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT * FROM signal_overrides').all();
    for (const row of rows) {
      activeOverrides.set(row.intersection_id, {
        intersectionId  : row.intersection_id,
        intersectionName: row.intersection_name,
        lat             : row.lat,
        lng             : row.lng,
        status          : row.status,
        requestId       : row.request_id,
        ambulanceId     : row.ambulance_id,
        overriddenAt    : row.overridden_at,
        distanceKm      : null,
      });
    }
    if (rows.length) {
      console.log(`[signals] restored ${rows.length} active overrides from DB`);
    }
  } catch (e) {
    console.error('[signals] failed to restore overrides:', e.message);
  }
}

function activateCorridorForAmbulance(ambulanceLat, ambulanceLng, requestId, ambulanceId) {
  const nearby  = getNearbyIntersections(ambulanceLat, ambulanceLng, 2.5);
  const db      = getDb();
  const changed = [];

  for (const intersection of nearby) {
    const existing = activeOverrides.get(intersection.id);
    if (!existing || existing.requestId !== requestId) {
      const override = {
        intersectionId  : intersection.id,
        intersectionName: intersection.name,
        lat             : intersection.lat,
        lng             : intersection.lng,
        distanceKm      : +intersection.distanceKm.toFixed(2),
        status          : 'green_corridor',
        requestId,
        ambulanceId,
        overriddenAt    : new Date().toISOString(),
      };
      activeOverrides.set(intersection.id, override);

      db.prepare(`
        INSERT OR REPLACE INTO signal_overrides
          (intersection_id, intersection_name, lat, lng, request_id, ambulance_id, status, overridden_at)
        VALUES (?, ?, ?, ?, ?, ?, 'green_corridor', datetime('now'))
      `).run(intersection.id, intersection.name, intersection.lat, intersection.lng, requestId, ambulanceId);

      changed.push(override);
    }
  }

  // Clear overrides >5 km away that belong to this request
  for (const [id, override] of activeOverrides.entries()) {
    if (override.requestId === requestId) {
      const dist = haversineKm(ambulanceLat, ambulanceLng, override.lat, override.lng);
      if (dist > 5) {
        activeOverrides.delete(id);
        db.prepare('DELETE FROM signal_overrides WHERE intersection_id = ?').run(id);
        changed.push({ ...override, status: 'normal', clearedAt: new Date().toISOString() });
      }
    }
  }

  // Step 15 — emit acknowledgment that signal change was applied (bidirectional loop)
  if (global.io && changed.length > 0) {
    const activated = changed.filter(c => c.status === 'green_corridor');
    if (activated.length > 0) {
      global.io.to('admin').emit('signal:ack', {
        acknowledged: activated,
        timestamp   : new Date().toISOString(),
      });
    }
  }

  return changed;
}

function clearCorridorForRequest(requestId) {
  const db      = getDb();
  const cleared = [];

  for (const [id, override] of activeOverrides.entries()) {
    if (override.requestId === requestId) {
      cleared.push({ ...override, status: 'normal', clearedAt: new Date().toISOString() });
      activeOverrides.delete(id);
    }
  }

  if (cleared.length > 0) {
    db.prepare('DELETE FROM signal_overrides WHERE request_id = ?').run(requestId);
  }

  return cleared;
}

function getAllSignalStates() {
  return INTERSECTIONS.map(i => {
    const override = activeOverrides.get(i.id);
    return {
      id          : i.id,
      name        : i.name,
      lat         : i.lat,
      lng         : i.lng,
      status      : override ? override.status : 'normal',
      requestId   : override?.requestId || null,
      ambulanceId : override?.ambulanceId || null,
      overriddenAt: override?.overriddenAt || null,
      distanceKm  : override?.distanceKm || null,
    };
  });
}

module.exports = {
  activateCorridorForAmbulance,
  clearCorridorForRequest,
  getAllSignalStates,
  initSignalOverrides,
  INTERSECTIONS,
};
