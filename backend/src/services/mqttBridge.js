/**
 * MQTT Bridge — SIM800L → HiveMQ Public Broker → Render Backend
 *
 * SIM800L on 2G cannot do TLS 1.2 (required by Render HTTPS).
 * Solution: SIM800L publishes plain-text JSON to a free MQTT broker
 * over TCP port 1883 (NO encryption needed). This service subscribes
 * to the same topic and processes GPS data exactly like the HTTP endpoint.
 *
 * Topic pattern: ambulance/<device_id>/gps
 * Broker: broker.hivemq.com:1883 (free, no auth, no TLS)
 */

const mqtt = require('mqtt');
const { getDb } = require('../db/database');
const { activateCorridorForAmbulance, getAllSignalStates } = require('./trafficSignal');

const GPS_API_KEY  = process.env.GPS_API_KEY || 'arduino-bridge-secret';
const MQTT_BROKER  = process.env.MQTT_BROKER  || 'mqtt://broker.hivemq.com:1883';
const MQTT_TOPIC   = 'ambulance/+/gps';  // '+' wildcard matches any device_id

let client = null;

function processGpsPayload(raw) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    console.warn('[MQTT] Could not parse GPS payload:', raw);
    return;
  }

  const {
    device_id,
    ambulance_id,
    lat,
    lng,
    speed_kmh   = 0,
    heading     = 0,
    altitude    = 0,
    hdop        = 0,
    satellites  = 0,
    fix_quality = 0,
    source      = 'arduino',
    api_key,
  } = data;

  // Validate API key
  if (api_key !== GPS_API_KEY && api_key !== 'arduino-bridge-secret') {
    console.warn('[MQTT] Invalid API key in payload, ignoring.');
    return;
  }

  if (!lat || !lng) {
    console.warn('[MQTT] Missing lat/lng, ignoring.');
    return;
  }

  if (fix_quality === 0) {
    // No satellite fix — indoor simulation still updates position
    console.log(`[MQTT] ${device_id} — no GPS fix (indoor sim), updating position anyway`);
  }

  const db = getDb();

  let amb = null;
  if (device_id) {
    amb = db.prepare('SELECT * FROM ambulances WHERE gps_device_id = ?').get(device_id);
  }
  if (!amb && ambulance_id) {
    amb = db.prepare('SELECT * FROM ambulances WHERE id = ?').get(ambulance_id);
  }
  if (!amb) {
    console.warn(`[MQTT] Device not registered: device_id=${device_id}`);
    return;
  }

  // Update live position in DB
  db.prepare(`
    UPDATE ambulances
    SET current_lat          = ?,
        current_lng          = ?,
        current_speed_kmh    = ?,
        current_heading      = ?,
        gps_fix_quality      = ?,
        gps_satellites       = ?,
        gps_hdop             = ?,
        gps_source           = ?,
        last_location_update = datetime('now'),
        last_gps_fix         = datetime('now'),
        updated_at           = datetime('now')
    WHERE id = ?
  `).run(+lat, +lng, +speed_kmh, +heading, +fix_quality, +satellites, +hdop, source, amb.id);

  // Find active request
  const activeReq = db.prepare(`
    SELECT id FROM emergency_requests
    WHERE ambulance_id = ? AND status IN ('assigned','enroute','arrived','enroute_hospital')
    ORDER BY requested_at DESC LIMIT 1
  `).get(amb.id);

  // Log GPS point
  db.prepare(`
    INSERT INTO ambulance_location_logs
      (ambulance_id, request_id, lat, lng, speed_kmh, heading, altitude, hdop, satellites, fix_quality, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(amb.id, activeReq?.id || null, +lat, +lng, +speed_kmh, +heading, +altitude, +hdop, +satellites, +fix_quality, source);

  // Emit real-time WebSocket update
  if (global.io) {
    const locationPayload = {
      ambulance_id : amb.id,
      device_id    : amb.gps_device_id,
      lat          : +lat,
      lng          : +lng,
      speed_kmh    : +speed_kmh,
      heading      : +heading,
      satellites,
      fix_quality,
      source,
      timestamp    : new Date().toISOString(),
      request_id   : activeReq?.id || null,
    };
    global.io.to('admin').emit('ambulance:location', locationPayload);
    if (activeReq?.id) {
      global.io.to(`request:${activeReq.id}`).emit('ambulance:location', locationPayload);
    }
  }

  // Activate traffic signal corridor if en-route
  if (activeReq?.id) {
    const changed = activateCorridorForAmbulance(+lat, +lng, activeReq.id, amb.id);
    if (global.io && changed.length > 0) {
      global.io.to('admin').emit('signal:update', getAllSignalStates());
    }
  }

  console.log(`[MQTT ✓] ${device_id} → lat=${lat}, lng=${lng}, speed=${speed_kmh} kmh, sats=${satellites}`);
}

function initMqttBridge() {
  console.log(`[MQTT] Connecting to ${MQTT_BROKER} ...`);

  client = mqtt.connect(MQTT_BROKER, {
    clientId     : `tn-ambulance-server-${Math.random().toString(16).slice(2, 8)}`,
    keepalive    : 60,
    reconnectPeriod: 5000,
    connectTimeout : 15000,
  });

  client.on('connect', () => {
    console.log(`[MQTT] ✅ Connected to ${MQTT_BROKER}`);
    client.subscribe(MQTT_TOPIC, { qos: 0 }, (err) => {
      if (err) {
        console.error('[MQTT] Subscribe error:', err.message);
      } else {
        console.log(`[MQTT] Subscribed to topic: ${MQTT_TOPIC}`);
        console.log(`[MQTT] Waiting for SIM800L telemetry...\n`);
      }
    });
  });

  client.on('message', (topic, message) => {
    const raw = message.toString();
    console.log(`[MQTT] Received on ${topic}: ${raw.substring(0, 80)}...`);
    processGpsPayload(raw);
  });

  client.on('error', (err) => {
    console.error('[MQTT] Connection error:', err.message);
  });

  client.on('reconnect', () => {
    console.log('[MQTT] Reconnecting...');
  });

  client.on('offline', () => {
    console.log('[MQTT] Broker offline, will retry...');
  });
}

module.exports = { initMqttBridge };
