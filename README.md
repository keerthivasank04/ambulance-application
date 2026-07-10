# Ambulance Assistance System

A full-stack Emergency Ambulance Assistance application designed for rapid dispatch and real-time tracking in Chennai. 

##  System Architecture

### 1. Frontend (React + Vite)
- **Framework:** React 18 powered by Vite.
- **Routing:** React Router v6 for navigation across 5 main portals (Landing, User Request, Live Tracking, Driver Portal, Admin Dashboard).
- **Mapping:** React-Leaflet integrated with OpenStreetMap for real-time visualization of ambulances, patients, and hospitals.
- **State & Data Fetching:** Custom React hooks (`usePolling`) to sync with the backend dynamically without full-page reloads. API interactions are managed by an Axios client module.

### 2. Backend (Node.js + Express)
- **Runtime:** Node.js with Express.
- **Database:** SQLite3 managed via `better-sqlite3` for synchronous, low-latency local queries without needing a bulky SQL server installation.
- **Algorithm (Haversine Dispatch):** The system uses the Haversine formula to calculate the great-circle distance between the patient's coordinates and all available ambulances. It factors in emergency type priorities (e.g., dispatching Advanced Life Support for Cardiac emergencies).
- **Endpoints:** RESTful API for handling assignments, fleet tracking, telemetry updates, and manual override status updates.

### 3. Hardware GPS Integration
- **Hardware Profile:** The system natively supports NMEA GPS streams (such as from an Arduino Uno paired with a NEO-6M GPS receiver). 
- **Telemetry Bridge:** A Node.js serial bridge script (`gps-bridge.js`) is included. It listens to the USB serial output, parses NMEA sentences ($GPGGA, $GPRMC), extracts latitude, longitude, speed, and active satellite count, and then POSTs the payload to the backend every 1-2 seconds.
- **Simulation Mode:** The same bridge can be run with a `--simulate` flag to provide mock driving data along mapped roads, allowing local testing without physical hardware.

### 4. Database Schema
- **Hospitals:** Seeded with major Chennai hospitals containing lat/lng precision bounding.
<<<<<<< HEAD
- **Ambulances & Drivers:** Relational mapping of fleet units to assigned driver personnel (via the unified `users` role table). Fleet units explicitly track Arduino metrics natively (`arduino_device_id`, `gps_fix_quality`, `gps_hdop`).
- **Emergency Requests:** Stores active (`ambulance_requests`) historical patient details, emergency severity, and multi-timestamp routing parameters.
- **Audit Logs:** Dedicated tables tracking rigorous state transitions (`trip_events`) and historical baseline GPS breadcrumb trails (`gps_tracking_logs`).


