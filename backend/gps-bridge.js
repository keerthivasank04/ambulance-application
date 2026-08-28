#!/usr/bin/env node
/**
 * gps-bridge.js
 *
 * Development/testing tool that mimics what each real Arduino+SIM800L device does.
 *
 * Modes:
 *   Real hardware (one ambulance):
 *     node gps-bridge.js --port COM3 --device ARD-001 --server http://localhost:5000
 *
 *   Simulate one ambulance:
 *     node gps-bridge.js --simulate --device ARD-001
 *
 *   Simulate ALL registered ambulances (tests full fleet):
 *     node gps-bridge.js --simulate --all
 */

const args = require('./src/utils/args');
const http  = require('http');
const https = require('https');

const PORT       = args['port']   || 'COM3';
const DEVICE_ID  = args['device'] || args['ambulance'] || 'ARD-001';
const SERVER_URL = args['server'] || 'http://localhost:5000';
const API_KEY    = args['key']    || 'arduino-bridge-secret';
const SIMULATE   = args['simulate'] !== undefined;
const SIMULATE_ALL = args['all'] !== undefined;
const INTERVAL   = parseInt(args['interval'] || '2000', 10);

console.log('\nTN Ambulance GPS Bridge');
console.log('  Server   :', SERVER_URL);
console.log('  Mode     :', SIMULATE ? (SIMULATE_ALL ? 'SIMULATION (all ambulances)' : `SIMULATION (${DEVICE_ID})`) : `HARDWARE (${PORT})`);
console.log('─'.repeat(48));

// ── NMEA Parsers ──────────────────────────────────────────────────────────

function nmeaToDecimal(raw, direction) {
  if (!raw || raw === '') return null;
  const dot = raw.indexOf('.');
  const deg = parseFloat(raw.substring(0, dot - 2));
  const min = parseFloat(raw.substring(dot - 2));
  let decimal = deg + min / 60;
  if (direction === 'S' || direction === 'W') decimal = -decimal;
  return +decimal.toFixed(7);
}

function validateChecksum(sentence) {
  const star = sentence.indexOf('*');
  if (star === -1) return true;
  const payload  = sentence.slice(1, star);
  const expected = parseInt(sentence.slice(star + 1), 16);
  const actual   = payload.split('').reduce((acc, c) => acc ^ c.charCodeAt(0), 0);
  return actual === expected;
}

let latestGGA = {};
let latestRMC = {};

function parseGGA(parts) {
  return {
    time        : parts[1],
    lat         : nmeaToDecimal(parts[2], parts[3]),
    lng         : nmeaToDecimal(parts[4], parts[5]),
    fix_quality : parseInt(parts[6]) || 0,
    satellites  : parseInt(parts[7]) || 0,
    hdop        : parseFloat(parts[8]) || 0,
    altitude    : parseFloat(parts[9]) || 0,
  };
}

function parseRMC(parts) {
  const valid = parts[2] === 'A';
  return {
    valid,
    lat      : valid ? nmeaToDecimal(parts[3], parts[4]) : null,
    lng      : valid ? nmeaToDecimal(parts[5], parts[6]) : null,
    speed_kmh: valid ? +(parseFloat(parts[7]) * 1.852).toFixed(2) : 0,
    heading  : valid ? parseFloat(parts[8]) || 0 : 0,
  };
}

let sentenceCount = 0;
let lastHeartbeat = 0;

const DEBUG = args['debug'] !== undefined || args['verbose'] !== undefined;

function processSentence(line) {
  line = line.trim();
  if (!line.startsWith('$')) return;
  sentenceCount++;
  if (DEBUG) console.log('  [raw-nmea]', line);
  if (!validateChecksum(line)) { console.warn('  [warn] checksum fail:', line); return; }
  const parts = line.split('*')[0].split(',');
  const type  = parts[0];
  if (type === '$GPGGA' || type === '$GNGGA') {
    const p = parseGGA(parts);
    latestGGA = p;
  } else if (type === '$GPRMC' || type === '$GNRMC') {
    const p = parseRMC(parts);
    latestRMC = p;
  }

  // Periodic heartbeat every 3 seconds if waiting for fix
  const now = Date.now();
  if (now - lastHeartbeat > 3000) {
    lastHeartbeat = now;
    const hasFix = (latestGGA.lat && latestGGA.lng) || (latestRMC.lat && latestRMC.lng);
    if (!hasFix) {
      const sats = latestGGA.satellites || 0;
      process.stdout.write(`\r  [gps-status] Receiving NMEA data... Satellites locked: ${sats} (Searching for fix, point antenna towards open sky)   `);
    }
  }
}

// ── HTTP POST ─────────────────────────────────────────────────────────────

function postGPS(payload) {
  const body = JSON.stringify(payload);
  const url  = new URL('/api/gps-update', SERVER_URL);
  const lib  = url.protocol === 'https:' ? https : http;

  const req = lib.request({
    hostname: url.hostname,
    port    : url.port || (url.protocol === 'https:' ? 443 : 80),
    path    : url.pathname,
    method  : 'POST',
    headers : {
      'Content-Type'  : 'application/json',
      'x-api-key'     : API_KEY,
      'Content-Length': Buffer.byteLength(body),
    },
  }, (res) => {
    if (res.statusCode !== 200) {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => console.error(`  [error] server ${res.statusCode}: ${d}`));
    }
  });

  req.on('error', e => console.error('  [error] POST failed:', e.message));
  req.write(body);
  req.end();
}

// ── Single-device simulation ──────────────────────────────────────────────

function simulateOne(deviceId, startLat, startLng, label) {
  let lat     = startLat  + (Math.random() - 0.5) * 0.04;
  let lng     = startLng  + (Math.random() - 0.5) * 0.04;
  let heading = Math.random() * 360;

  setInterval(() => {
    const radH = (heading * Math.PI) / 180;
    lat += Math.cos(radH) * 0.00025;
    lng += Math.sin(radH) * 0.00025;
    heading = (heading + (Math.random() - 0.5) * 15 + 360) % 360;

    const speed_kmh = +(30 + Math.random() * 25).toFixed(1);

    console.log(`  [gps] ${label}  ${lat.toFixed(5)}, ${lng.toFixed(5)}  ${speed_kmh} km/h`);

    postGPS({
      device_id  : deviceId,
      lat, lng,
      speed_kmh,
      heading    : +heading.toFixed(1),
      altitude   : 12,
      hdop       : 1.2,
      satellites : 8,
      fix_quality: 1,
      source     : 'simulation',
      api_key    : API_KEY,
    });
  }, INTERVAL);
}

// ── Simulate all ambulances via REST ─────────────────────────────────────

async function fetchAllAmbulances() {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/ambulances', SERVER_URL);
    const lib = url.protocol === 'https:' ? https : http;
    lib.get(url.toString(), (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(JSON.parse(d)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function runSimulateAll() {
  console.log('\n[sim] Fetching ambulance list from server...\n');
  let ambulances;
  try {
    ambulances = await fetchAllAmbulances();
  } catch (e) {
    console.error('[error] Could not fetch ambulances:', e.message);
    console.error('        Make sure the backend is running on', SERVER_URL);
    process.exit(1);
  }

  const active = ambulances.filter(a => a.gps_device_id && a.status !== 'maintenance');
  console.log(`[sim] Simulating ${active.length} devices:\n`);

  for (const a of active) {
    const lat = a.current_lat || 13.0827;
    const lng = a.current_lng || 80.2707;
    const label = `${a.gps_device_id} (${a.registration_number})`.padEnd(28);
    console.log(`  ${label} starting at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    // Stagger start times so POSTs don't all arrive at once
    const delay = active.indexOf(a) * 150;
    setTimeout(() => simulateOne(a.gps_device_id, lat, lng, label.trim()), delay);
  }
  console.log('');
}

// ── Real Arduino serial mode ──────────────────────────────────────────────

function runSerial() {
  let SerialPort, ReadlineParser;
  try {
    const sp = require('serialport');
    SerialPort     = sp.SerialPort;
    ReadlineParser = require('@serialport/parser-readline').ReadlineParser;
  } catch (e) {
    console.error('\n[error] Missing packages. Run: npm install serialport @serialport/parser-readline');
    process.exit(1);
  }

  const port   = new SerialPort({ path: PORT, baudRate: 9600 });
  const parser = port.pipe(new ReadlineParser({ delimiter: '\r\n' }));

  port.on('open', () => {
    console.log(`\n[ok] Serial port ${PORT} opened at 9600 baud`);
    console.log('     Device:', DEVICE_ID);
    console.log('     Waiting for NEO-6M fix...\n');
  });

  port.on('error', (err) => {
    console.error(`\n[error] Serial port error: ${err.message}`);
    console.log('        Check COM port and Arduino connection.');
    console.log('        Run with --simulate to test without hardware.\n');
    process.exit(1);
  });

  parser.on('data', processSentence);

  let checkCount = 0;
  setInterval(() => {
    checkCount++;
    if (checkCount === 3 && sentenceCount === 0) {
      console.log('\n  [tip] No GPS NMEA characters received yet.');
      console.log('        1. Ensure Arduino is running the latest sketch.');
      console.log('        2. If Green & Blue wires are reversed, swap Pin 2 and Pin 3 in the sketch.');
      console.log('        3. Check that NEO-6M power LED is lit.\n');
    }

    const lat = latestGGA.lat || latestRMC.lat;
    const lng = latestGGA.lng || latestRMC.lng;
    if (!lat || !lng) return;

    console.log(`\n  [gps] ${DEVICE_ID}  ${lat.toFixed(5)}, ${lng.toFixed(5)}  ${latestRMC.speed_kmh || 0} km/h  sat:${latestGGA.satellites || 0}`);

    postGPS({
      device_id  : DEVICE_ID,
      lat, lng,
      speed_kmh  : latestRMC.speed_kmh  || 0,
      heading    : latestRMC.heading     || 0,
      altitude   : latestGGA.altitude    || 0,
      hdop       : latestGGA.hdop        || 0,
      satellites : latestGGA.satellites  || 0,
      fix_quality: latestGGA.fix_quality || 0,
      source     : 'arduino',
      api_key    : API_KEY,
    });
  }, INTERVAL);
}

// ── Entry point ───────────────────────────────────────────────────────────

if (SIMULATE) {
  if (SIMULATE_ALL) {
    runSimulateAll();
  } else {
    console.log(`\n[sim] Single device: ${DEVICE_ID}\n`);
    simulateOne(DEVICE_ID, 13.0827, 80.2707, DEVICE_ID);
  }
} else {
  runSerial();
}
