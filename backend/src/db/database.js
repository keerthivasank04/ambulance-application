const Database = require('better-sqlite3');
const path = require('path');
const createTables = require('./schema');

const DB_PATH = path.join(__dirname, '../../ambulance.db');

let db;

function runMigrations(db) {
  const cols = db.prepare('PRAGMA table_info(ambulances)').all().map(c => c.name);
  if (!cols.includes('sim_number')) {
    db.exec('ALTER TABLE ambulances ADD COLUMN sim_number TEXT');
  }
  if (!cols.includes('gps_device_id')) {
    db.exec('ALTER TABLE ambulances ADD COLUMN gps_device_id TEXT');
  }
}

function getDb() {
  if (!db) {
    db = new Database(DB_PATH, { verbose: null });
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createTables(db);
    runMigrations(db);
  }
  return db;
}

module.exports = { getDb };
