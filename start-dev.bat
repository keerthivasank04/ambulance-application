@echo off
title Ambulance App Launcher
echo ========================================================
echo   Starting Ambulance Assistance Backend and Frontend
echo ========================================================
echo.

echo Starting Backend Server on http://localhost:5000...
start "Ambulance Backend (Port 5000)" cmd /k "cd backend && npm run dev"

echo Starting Frontend Server on http://localhost:5173...
start "Ambulance Frontend (Port 5173)" cmd /k "cd frontend && npm run dev"

echo.
echo ========================================================
echo Both servers are launching in separate windows!
echo Backend:  http://localhost:5000
echo Frontend: http://localhost:5173
echo.
echo To connect your Arduino UNO GPS via USB, run:
echo   cd backend
echo   node gps-bridge.js --port COM3 --device ARD-001
echo ========================================================
echo.
pause
