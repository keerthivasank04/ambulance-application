import { useParams } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, Polyline, useMap } from 'react-leaflet';
import { usePolling } from '../hooks/usePolling';
import { useSmoothPosition, computeBearing } from '../hooks/useSmoothPosition';
import { ambulanceIcon, hospitalIcon, patientIcon, signalMarkerIcon, haversineKm } from '../utils/mapIcons';
import { fetchRequest, fetchSignals } from '../services/api';
import { getSocket, joinRequestRoom } from '../services/socket';

// Smoothly, continuously pans the camera to follow the (already-interpolated)
// ambulance position every animation frame, instead of jumping the view on
// each discrete GPS tick.
function MapFollower({ lat, lng }) {
  const map = useMap();
  useEffect(() => {
    if (lat == null || lng == null) return;
    map.panTo([lat, lng], { animate: true, duration: 0.3, easeLinearity: 1 });
  }, [map, lat, lng]);
  return null;
}

function MapRefCapture({ mapRef }) {
  const map = useMap();
  useEffect(() => { mapRef.current = map; }, [map, mapRef]);
  return null;
}

// Frames patient + ambulance + hospital together on first load, once, so a
// fixed zoom level can't cut off the hospital marker when it's a few km
// from the patient. MapFollower takes over smooth per-tick panning after.
function MapInitialFit({ positions }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || positions.length < 2) return;
    map.fitBounds(positions, { padding: [48, 48], maxZoom: 15 });
    fitted.current = true;
  }, [map, positions]);
  return null;
}

const STATUS_STEPS  = ['assigned', 'enroute', 'arrived', 'enroute_hospital', 'completed'];
const STATUS_LABELS = {
  assigned        : 'Ambulance Assigned',
  enroute         : 'En Route to You',
  arrived         : 'Arrived at Scene',
  enroute_hospital: 'En Route to Hospital',
  completed       : 'Patient Delivered',
  cancelled       : 'Dispatch Cancelled',
};
const STATUS_COLORS = {
  assigned        : '#2563EB',
  enroute         : '#9333EA',
  arrived         : '#0891B2',
  enroute_hospital: '#9333EA',
  completed       : '#16A34A',
  cancelled       : '#DC2626',
};

export default function LiveTracking() {
  const { id } = useParams();
  const [req, setReq]       = useState(null);
  const [ambPos, setAmbPos] = useState(null);
  const [bearing, setBearing] = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError]   = useState('');
  const prevAmbRef = useRef(null);
  const mapRef = useRef(null);

  const fetcher = useCallback(() => fetchRequest(id), [id]);
  const { data: polledReq, error: pollErr } = usePolling(fetcher, 4000);
  useEffect(() => { if (polledReq) setReq(polledReq); }, [polledReq]);
  useEffect(() => { if (pollErr) setError(pollErr); }, [pollErr]);

  const signalsFetcher = useCallback(() => fetchSignals(), []);
  const { data: signalsData } = usePolling(signalsFetcher, 8000);
  const signals = signalsData || [];
  const routeSignals = signals.filter(s => String(s.requestId) === String(id) && s.status === 'green_corridor');

  useEffect(() => {
    const sock = getSocket();
    joinRequestRoom(id);
    const onConnect = () => setWsConnected(true);
    const onDisconnect = () => setWsConnected(false);
    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    if (sock.connected) setWsConnected(true);
    sock.on('ambulance:location', payload => {
      if (String(payload.request_id) === String(id)) {
        const prev = prevAmbRef.current;
        if (prev && haversineKm(prev.lat, prev.lng, payload.lat, payload.lng) > 0.005) {
          setBearing(computeBearing(prev.lat, prev.lng, payload.lat, payload.lng));
        }
        prevAmbRef.current = { lat: payload.lat, lng: payload.lng };
        setAmbPos({ lat: payload.lat, lng: payload.lng, speed: payload.speed_kmh, ts: payload.timestamp });
      }
    });
    sock.on('request:status', payload => {
      if (String(payload.requestId) === String(id)) {
        setReq(prev => prev ? { ...prev, status: payload.status } : prev);
        fetchRequest(id).then(setReq).catch(() => {});
      }
    });
    return () => {
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('ambulance:location');
      sock.off('request:status');
    };
  }, [id]);

  // Hooks must run unconditionally, so the smoothing hook is called here,
  // before the loading/error early-returns below.
  const ambLatRaw = ambPos?.lat ?? req?.amb_lat;
  const ambLngRaw = ambPos?.lng ?? req?.amb_lng;
  const smoothPos = useSmoothPosition(ambLatRaw, ambLngRaw, 1800);

  if (error) return (
    <div className="container" style={{ padding: '2rem 1.5rem' }}>
      <div className="alert alert-error">Unable to load tracking data: {error}</div>
    </div>
  );

  if (!req) return (
    <div className="container" style={{ padding: '2rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div className="skeleton" style={{ height: 48, width: 280, borderRadius: 10 }} />
      <div className="skeleton" style={{ height: 60, borderRadius: 10 }} />
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.25rem' }}>
        <div className="skeleton" style={{ height: 480, borderRadius: 14 }} />
        <div className="skeleton" style={{ height: 480, borderRadius: 14 }} />
      </div>
    </div>
  );

  const ambLat      = smoothPos?.lat ?? ambLatRaw;
  const ambLng      = smoothPos?.lng ?? ambLngRaw;
  const speed       = ambPos?.speed ?? req.current_speed_kmh ?? 0;
  const isEnRoute   = req.status === 'enroute';
  const isToHosp    = req.status === 'enroute_hospital';
  const isComplete  = req.status === 'completed';
  const isCancelled = req.status === 'cancelled';
  const statusColor = STATUS_COLORS[req.status] || '#2563EB';
  const stepIdx     = STATUS_STEPS.indexOf(req.status);
  const mapCenter   = ambLat && ambLng ? [ambLat, ambLng]
    : req.patient_lat ? [req.patient_lat, req.patient_lng]
    : [13.0827, 80.2707];

  const routeTarget = isEnRoute && req.patient_lat ? { lat: req.patient_lat, lng: req.patient_lng, color: '#2563EB', label: 'to patient' }
    : isToHosp && req.hospital_lat ? { lat: req.hospital_lat, lng: req.hospital_lng, color: '#16A34A', label: 'to hospital' }
    : null;
  const routeDistanceKm = routeTarget && ambLat && ambLng
    ? haversineKm(ambLat, ambLng, routeTarget.lat, routeTarget.lng).toFixed(1)
    : null;

  const initialFitPositions = [
    ambLat && ambLng ? [ambLat, ambLng] : null,
    req.patient_lat ? [req.patient_lat, req.patient_lng] : null,
    req.hospital_lat ? [req.hospital_lat, req.hospital_lng] : null,
  ].filter(Boolean);

  const recenter = () => {
    if (mapRef.current && ambLat && ambLng) {
      mapRef.current.panTo([ambLat, ambLng], { animate: true, duration: 0.5 });
    }
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: 'calc(100vh - 95px)' }}>

      {/* Status banner */}
      <div className="tracking-banner" style={{
        background: isCancelled ? '#FEF2F2' : isComplete ? '#F0FDF4' : `${statusColor}0D`,
        borderBottomColor: isCancelled ? '#FECACA' : isComplete ? '#BBF7D0' : `${statusColor}30`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {!isComplete && !isCancelled && <span className="dot dot-red dot-pulse" />}
          <div>
            <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)' }}>
              {isCancelled ? 'Dispatch Cancelled' : isComplete ? 'Mission Complete — Patient Delivered' : STATUS_LABELS[req.status] || req.status}
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-2)', marginTop: '0.1rem' }}>
              {req.patient_name} &nbsp;·&nbsp; {req.emergency_type} &nbsp;·&nbsp; {req.hospital_name || 'Hospital TBD'}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <span className={`badge badge-${req.status}`}>{STATUS_LABELS[req.status] || req.status}</span>
          <div className={`ws-indicator ${wsConnected ? 'connected' : 'disconnected'}`}>
            <span className={`dot ${wsConnected ? 'dot-green dot-pulse' : 'dot-amber'}`} />
            <span>{wsConnected ? 'Live' : 'Polling'}</span>
          </div>
        </div>
      </div>

      {/* Progress bar */}
      {!isCancelled && (
        <div className="tracking-progress">
          <div className="tracking-progress-inner">
            {STATUS_STEPS.map((s, i) => {
              const done = i < stepIdx;
              const curr = i === stepIdx;
              return (
                <div key={s} style={{ display: 'flex', alignItems: 'center', flex: i < STATUS_STEPS.length - 1 ? 1 : 'none' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.375rem' }}>
                    <div className="tracking-step-dot" style={{
                      background: done || curr ? statusColor : 'var(--border)',
                      color: done || curr ? 'white' : 'var(--text-3)',
                      border: curr ? `2px solid ${statusColor}` : '2px solid transparent',
                    }}>
                      {done ? '✓' : i + 1}
                    </div>
                    <div className="tracking-step-label" style={{
                      fontWeight: curr ? 700 : 500,
                      color: curr ? statusColor : done ? 'var(--text-2)' : 'var(--text-3)',
                    }}>
                      {STATUS_LABELS[s]}
                    </div>
                  </div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div className="tracking-step-line" style={{ background: done ? statusColor : 'var(--border)' }} />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main content */}
      <div style={{ padding: '1.5rem' }}>
        <div className="tracking-grid">

          {/* Left panel */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {!isComplete && !isCancelled && (
              <div className="card eta-card" style={{ borderTop: `4px solid ${statusColor}` }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--text-3)', marginBottom: '0.5rem' }}>
                  Estimated Arrival
                </div>
                <div className="eta-value" style={{ color: statusColor }}>{req.eta_minutes ?? '—'}</div>
                <div className="eta-unit">minutes</div>
                {speed > 0 && <div className="eta-speed">{speed} km/h</div>}
              </div>
            )}

            <div className="card panel">
              <div className="panel-header" style={{ justifyContent: 'flex-start' }}>Assigned Unit</div>
              <div className="unit-detail-row">
                {[
                  { label: 'Ambulance', value: req.registration_number ? `${req.registration_number} · ${req.ambulance_type}` : null },
                  { label: 'Driver', value: req.driver_name },
                  { label: 'Hospital', value: req.hospital_name },
                  { label: 'Address', value: req.hospital_address },
                  { label: 'Hospital Phone', value: req.hospital_phone },
                  { label: 'Patient Age', value: req.patient_age ? `${req.patient_age} years` : null },
                ].map(({ label, value }) => value ? (
                  <div key={label}>
                    <div style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.15rem' }}>
                      {label}
                    </div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text)' }}>{value}</div>
                  </div>
                ) : null)}
              </div>
            </div>

            {routeSignals.length > 0 && (
              <div className="card panel" style={{ borderColor: 'rgba(22,163,74,0.3)' }}>
                <div className="panel-header" style={{ justifyContent: 'flex-start', gap: '0.5rem', background: 'rgba(22,163,74,0.06)', borderBottomColor: 'rgba(22,163,74,0.2)', color: 'var(--green)' }}>
                  <span className="dot dot-green dot-pulse" />
                  Signals Cleared Along Route ({routeSignals.length})
                </div>
                {routeSignals.map(s => (
                  <div key={s.id} className="signal-row">
                    <span className="dot dot-green dot-pulse" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                      {s.distanceKm != null && <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{s.distanceKm} km from ambulance</div>}
                    </div>
                    <span className="badge badge-completed" style={{ flexShrink: 0 }}>OPEN</span>
                  </div>
                ))}
              </div>
            )}

            {req.status_logs?.length > 0 && (
              <div className="card panel">
                <div className="panel-header" style={{ justifyContent: 'flex-start' }}>Trip Timeline</div>
                <div className="timeline">
                  {req.status_logs.map((log, i) => {
                    const c = STATUS_COLORS[log.status] || 'var(--text-3)';
                    return (
                      <div key={log.id || i} className="timeline-item">
                        <div className="timeline-dot" style={{ background: c, boxShadow: `0 0 6px ${c}60` }} />
                        <div className="timeline-content">
                          <div className="timeline-status">{STATUS_LABELS[log.status] || log.status}</div>
                          <div className="timeline-time">
                            {new Date(log.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </div>
                          {log.note && <div className="timeline-note">{log.note}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Map */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div className="map-panel">
              {!isComplete && !isCancelled && speed > 0 && (
                <div className="map-live-pill">
                  <span className="dot dot-green dot-pulse" />
                  {speed} km/h
                </div>
              )}
              <button type="button" className="map-recenter-btn" onClick={recenter} title="Recenter on ambulance">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
              </button>
              <MapContainer center={mapCenter} zoom={14} style={{ height: 480, width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
                <MapRefCapture mapRef={mapRef} />
                <MapInitialFit positions={initialFitPositions} />
                {ambLat && ambLng && <MapFollower lat={ambLat} lng={ambLng} />}

                {routeSignals.filter(s => s.lat && s.lng).map(s => (
                  <Marker key={s.id} position={[s.lat, s.lng]} icon={signalMarkerIcon(s.status)}>
                    <Tooltip direction="top">{s.name} — cleared</Tooltip>
                  </Marker>
                ))}

                {req.patient_lat && (
                  <Marker position={[req.patient_lat, req.patient_lng]} icon={patientIcon()}>
                    <Tooltip direction="top" offset={[0, -14]}>Patient Location</Tooltip>
                    <Popup><strong>Patient Location</strong><br />{req.patient_name}</Popup>
                  </Marker>
                )}
                {req.hospital_lat && (
                  <Marker position={[req.hospital_lat, req.hospital_lng]} icon={hospitalIcon()}>
                    <Tooltip direction="top" offset={[0, -14]} permanent>{req.hospital_name || 'Destination Hospital'}</Tooltip>
                    <Popup><strong>{req.hospital_name}</strong><br />{req.hospital_address}</Popup>
                  </Marker>
                )}
                {ambLat && ambLng && (
                  <Marker position={[ambLat, ambLng]} icon={ambulanceIcon('#2563EB', !isComplete && !isCancelled, bearing)}>
                    <Popup>
                      <strong>{req.registration_number || 'Ambulance'}</strong>
                      {speed > 0 && <><br />{speed} km/h</>}
                    </Popup>
                  </Marker>
                )}

                {routeTarget && ambLat && ambLng && (
                  <Polyline positions={[[ambLat, ambLng], [routeTarget.lat, routeTarget.lng]]}
                    color={routeTarget.color} dashArray="10 14" weight={3.5} opacity={0.8}>
                    {routeDistanceKm && (
                      <Tooltip direction="center" permanent>{routeDistanceKm} km {routeTarget.label}</Tooltip>
                    )}
                  </Polyline>
                )}
              </MapContainer>
            </div>

            <div className="map-legend">
              {[
                { color: '#2563EB', label: 'Ambulance (live)' },
                { color: '#DC2626', label: 'Patient Location' },
                { color: '#16A34A', label: 'Destination Hospital' },
              ].map(({ color, label }) => (
                <div key={label} className="map-legend-item">
                  <span className="map-legend-dot" style={{ background: color }} />
                  {label}
                </div>
              ))}
              {routeSignals.length > 0 && (
                <div className="map-legend-item">
                  <span className="map-legend-dot" style={{ background: '#16A34A', borderRadius: 2, width: 6, height: 12 }} />
                  Signal Cleared
                </div>
              )}
              {!isComplete && !isCancelled && (
                <div style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-3)', fontWeight: 600 }}>
                  Map auto-follows ambulance
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
