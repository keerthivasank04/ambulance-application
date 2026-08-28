# 🚑 TN 108 Emergency Ambulance Assistance & Automated Dispatch System
### Comprehensive Project Submission & Demonstration Manual

---

## 📌 1. Project Overview

The **TN 108 Emergency Ambulance Assistance System** is a full-stack IoT and dispatch platform designed for rapid medical response. It connects real-world IoT telemetry hardware inside ambulances to a real-time web portal, automatically calculating the closest emergency units using the **Haversine Algorithm** and activating intelligent **Green Traffic Corridors**.

### 🌟 Key Highlights:
- **Dual-Mode Telemetry Hardware**: Works over **USB Serial Bridge** (for lab evaluation/demos) and standalone **2G Cellular GPRS** (for real-world ambulance road tracking).
- **Sub-Second Dispatch Engine**: Computes distance, ambulance readiness (ALS / BLS / ICU), and assigns the optimal unit instantly.
- **Dynamic Green Corridor**: Automated traffic signal prioritization along the ambulance's route to the hospital.
- **Real-Time WebSockets**: Live tracking on OpenStreetMap with zero page reloads for Patients, Drivers, and Dispatch Administrators.

---

## 🛠️ 2. Hardware Architecture & Pinout

### Component Bill of Materials (BOM):
| Component | Function | Model / Spec |
|---|---|---|
| **Microcontroller** | Master In-Vehicle Telemetry Unit | Arduino UNO (ATmega328P DIP) |
| **GPS Receiver** | Satellite Latitude/Longitude/Speed/Heading | GY-NEO6MV2 (u-blox NEO-6M) |
| **Cellular Modem** | 2G GPRS Autonomous Cloud Uplink | SIM800L Module (with BSNL SIM) |
| **Power Converter** | 4.0V High-Current Supply (2A Peak) | LM2596 DC-DC Step-Down Buck |

### 🔌 Complete Pin-to-Pin Wiring:

```
                  ┌──────────────────────────────────────────────┐
                  │          ARDUINO UNO DIP (ATmega328P)        │
                  │                                              │
  GY-NEO6MV2 GPS  │   Pin 2 (RX) ◄───────── TX (Green Wire)     │
                  │   Pin 3 (TX) ─────────► RX (Blue Wire)      │
                  │   5V         ─────────► VCC (Red Wire)      │
                  │   GND        ─────────► GND (Black Wire)    │
                  │                                              │
  SIM800L 2G GPRS │   Pin 7 (RX) ◄───────── TX                   │
                  │   Pin 8 (TX) ─────────► RX (Voltage Divider) │
                  │   GND        ─────────► GND (Common Ground) │
                  │                                              │
  LM2596 BUCK     │   OUT+ (4.0V) ────────► SIM800L VCC         │
                  │   OUT- (GND)  ────────► SIM800L GND & Uno GND│
                  └──────────────────────────────────────────────┘
```

---

## 💻 3. Software Architecture & Tech Stack

```
   ┌─────────────────────────────────────────────────────────────┐
   │                     IOT HARDWARE LAYER                      │
   │  Arduino UNO DIP + NEO-6M GPS Receiver + SIM800L 2G Modem   │
   └──────────────────────────────┬──────────────────────────────┘
                                  │ (USB Bridge or 2G GPRS HTTP)
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                    NODE.JS BACKEND (PORT 5000)              │
   │  - Express REST API (`/api/gps-update`, `/api/requests`)    │
   │  - Synchronous SQLite3 Database (`ambulance.db`)            │
   │  - Socket.IO Real-Time Broadcasts                           │
   │  - Haversine Dispatch Engine & Traffic Corridor Engine      │
   └──────────────────────────────┬──────────────────────────────┘
                                  │ (WebSocket events + REST)
                                  ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                   REACT FRONTEND (PORT 5173)                │
   │  - Vite + React 18 + React-Leaflet OpenStreetMap            │
   │  - Admin Fleet Control, Driver Portal, Live Public Tracking │
   └─────────────────────────────────────────────────────────────┘
```

---

## 🚀 4. How to Run the Project for Evaluation / Viva

### Option A: 1-Click Startup (Recommended)
Simply **double-click** [`start-dev.bat`](file:///g:/Zips/ambulance-app-main/start-dev.bat) in the project root folder. It opens:
- **Backend API**: `http://localhost:5000`
- **Frontend Dashboard**: `http://localhost:5173`

---

### Option B: Step-by-Step Terminal Execution

#### 1. Start Backend Server
```powershell
cd g:\Zips\ambulance-app-main\backend
npm run dev
```

#### 2. Start Frontend Web App
```powershell
cd g:\Zips\ambulance-app-main\frontend
npm run dev
```

#### 3. Connect Arduino Hardware via USB
1. Open [`arduino_uno/AMBULANCE_UNIT_FINAL/AMBULANCE_UNIT_FINAL.ino`](file:///g:/Zips/ambulance-app-main/arduino_uno/AMBULANCE_UNIT_FINAL/AMBULANCE_UNIT_FINAL.ino) in Arduino IDE.
2. Select **Board: Arduino Uno**, select your **COM Port**, and click **Upload**.
3. In a new terminal, launch the live USB GPS Bridge:
```powershell
cd g:\Zips\ambulance-app-main\backend
node gps-bridge.js --port COM5 --device ARD-001 --server https://tn-ambulance-backend.onrender.com
```

---

## 🔑 5. Access Credentials & Portals

| Portal | URL | Credentials |
|---|---|---|
| **Admin Fleet Control** | `http://localhost:5173/admin` | **User:** `admin` \| **Pass:** `admin123` |
| **Driver Interface** | `http://localhost:5173/driver` | **Phone:** `9444001001` \| **Pass:** `pass123` |
| **Emergency Booking** | `http://localhost:5173/request` | Public Access (No Login) |
| **Live Tracking Map** | `http://localhost:5173/tracking` | Public Tracking by Request ID |

---

## 📡 6. Telemetry Data Structure

Every 1–2 seconds, the hardware unit streams the following JSON payload to `POST /api/gps-update`:

```json
{
  "device_id": "ARD-001",
  "lat": 13.082710,
  "lng": 80.270720,
  "speed_kmh": 42.5,
  "heading": 185.0,
  "satellites": 8,
  "fix_quality": 1,
  "source": "arduino"
}
```

---

## 📁 7. Final Project Deliverables Structure

```
ambulance-app-main/
├── arduino_uno/
│   ├── AMBULANCE_UNIT_FINAL/          <-- Master Production Firmware for Device
│   │   └── AMBULANCE_UNIT_FINAL.ino
│   ├── ambulance_uno_usb/             <-- Clean USB Streaming Sketch
│   │   └── ambulance_uno_usb.ino
│   ├── sim_diagnostic_test/           <-- 2G SIM Card & Net Pack Validator
│   │   └── sim_diagnostic_test.ino
│   └── ambulance_remote_standalone/   <-- Standalone Road Tracking Firmware
│       └── ambulance_remote_standalone.ino
├── backend/
│   ├── src/                           <-- API, Database, Corridor & Dispatch Logic
│   ├── gps-bridge.js                  <-- USB Serial Hardware Bridge
│   ├── ambulance.db                   <-- Embedded SQLite Database
│   └── .env                           <-- Server Environment Config
├── frontend/
│   ├── src/                           <-- React Portals & Leaflet Map Views
│   └── index.html
├── start-dev.bat                      <-- 1-Click Launch Script
├── PROJECT_SUBMISSION_MANUAL.md       <-- Project Documentation Manual
└── package.json
```

---
**Project Status:** ✅ Fully Tested, Documented & Ready for Submission.
