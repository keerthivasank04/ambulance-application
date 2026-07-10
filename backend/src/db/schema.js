// schema.js — Create all DB tables (with full Arduino GPS telemetry support)
module.exports = function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS hospitals (
      id                  TEXT PRIMARY KEY,
      name                TEXT NOT NULL,
      city                TEXT NOT NULL,
      address             TEXT,
      lat                 REAL NOT NULL,
      lng                 REAL NOT NULL,
      phone               TEXT,
      emergency_available INTEGER DEFAULT 1,
      icu_beds            INTEGER DEFAULT 0,
      specialties         TEXT DEFAULT '[]',
      created_at          TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ambulances (
      id                    TEXT PRIMARY KEY,
      registration_number   TEXT UNIQUE NOT NULL,
      type                  TEXT NOT NULL CHECK(type IN ('ALS','BLS','ICU')),
      status                TEXT NOT NULL DEFAULT 'available'
                              CHECK(status IN ('available','assigned','maintenance','offline')),
      current_lat           REAL,
      current_lng           REAL,
      current_speed_kmh     REAL DEFAULT 0,
      current_heading       REAL DEFAULT 0,
      gps_fix_quality       INTEGER DEFAULT 0,
      gps_satellites        INTEGER DEFAULT 0,
      gps_hdop              REAL DEFAULT 0,
      gps_source            TEXT DEFAULT 'none' CHECK(gps_source IN ('arduino','simulation','none')),
      gps_device_id         TEXT UNIQUE,
      sim_number            TEXT,
      last_location_update  TEXT,
      last_gps_fix          TEXT,
      base_hospital_id      TEXT REFERENCES hospitals(id),
      created_at            TEXT DEFAULT (datetime('now')),
      updated_at            TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id                TEXT PRIMARY KEY,
      name              TEXT NOT NULL,
      phone             TEXT UNIQUE NOT NULL,
      email             TEXT,
      license_number    TEXT UNIQUE,
      experience_years  INTEGER DEFAULT 0,
      rating            REAL DEFAULT 5.0,
      ambulance_id      TEXT REFERENCES ambulances(id),
      status            TEXT NOT NULL DEFAULT 'offline'
                          CHECK(status IN ('online','offline','on_duty')),
      password          TEXT NOT NULL DEFAULT '1234',
      profile_photo     TEXT,
      created_at        TEXT DEFAULT (datetime('now')),
      updated_at        TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS emergency_requests (
      id                    TEXT PRIMARY KEY,
      patient_name          TEXT NOT NULL,
      patient_age           INTEGER,
      patient_phone         TEXT NOT NULL,
      patient_notes         TEXT,
      emergency_type        TEXT NOT NULL,
      priority              INTEGER DEFAULT 2,
      status                TEXT NOT NULL DEFAULT 'pending'
                              CHECK(status IN ('pending','assigned','enroute','arrived','enroute_hospital','completed','cancelled')),
      patient_lat           REAL NOT NULL,
      patient_lng           REAL NOT NULL,
      patient_address       TEXT,
      ambulance_id          TEXT REFERENCES ambulances(id),
      driver_id             TEXT REFERENCES drivers(id),
      assigned_hospital_id  TEXT REFERENCES hospitals(id),
      distance_km           REAL,
      eta_minutes           INTEGER,
      requested_at          TEXT DEFAULT (datetime('now')),
      assigned_at           TEXT,
      enroute_at            TEXT,
      arrived_at            TEXT,
      hospital_delivered_at TEXT,
      completed_at          TEXT,
      cancelled_at          TEXT,
      cancellation_reason   TEXT
    );

    CREATE TABLE IF NOT EXISTS request_status_logs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      request_id  TEXT NOT NULL REFERENCES emergency_requests(id),
      status      TEXT NOT NULL,
      note        TEXT,
      timestamp   TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ambulance_location_logs (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      ambulance_id  TEXT NOT NULL REFERENCES ambulances(id),
      request_id    TEXT REFERENCES emergency_requests(id),
      lat           REAL NOT NULL,
      lng           REAL NOT NULL,
      speed_kmh     REAL DEFAULT 0,
      heading       REAL DEFAULT 0,
      altitude      REAL DEFAULT 0,
      hdop          REAL DEFAULT 0,
      satellites    INTEGER DEFAULT 0,
      fix_quality   INTEGER DEFAULT 0,
      source        TEXT DEFAULT 'arduino' CHECK(source IN ('arduino','simulation')),
      timestamp     TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS signal_overrides (
      intersection_id   TEXT PRIMARY KEY,
      intersection_name TEXT NOT NULL,
      lat               REAL NOT NULL,
      lng               REAL NOT NULL,
      request_id        TEXT NOT NULL REFERENCES emergency_requests(id),
      ambulance_id      TEXT NOT NULL,
      status            TEXT NOT NULL DEFAULT 'green_corridor',
      overridden_at     TEXT DEFAULT (datetime('now'))
    );
  `);
};
