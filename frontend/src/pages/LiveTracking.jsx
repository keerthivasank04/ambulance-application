import { useParams } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { usePolling } from '../hooks/usePolling';
import { fetchRequest, fetchSignals } from '../services/api';
import { getSocket, joinRequestRoom } from '../services/socket';

// ── Map icon glyphs ──────────────────────────────────────────────────────────
const AMBULANCE_SVG = `
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
    <rect x="1" y="8" width="15" height="8" rx="1.5" fill="currentColor"/>
    <rect x="15" y="10" width="7" height="6" rx="1" fill="currentColor"/>
    <rect x="6.2" y="10.2" width="5.6" height="1.6" fill="white"/>
    <rect x="8.2" y="8.2" width="1.6" height="5.6" fill="white"/>
    <circle cx="6" cy="17.5" r="1.8" fill="#1F2937"/>
    <circle cx="18" cy="17.5" r="1.8" fill="#1F2937"/>
  </svg>`;

const HOSPITAL_SVG = `
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
    <rect x="9.5" y="3" width="5" height="18" rx="1" fill="currentColor"/>
    <rect x="3" y="9.5" width="18" height="5" rx="1" fill="currentColor"/>
  </svg>`;

const PATIENT_SVG = `
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
    <circle cx="12" cy="7.5" r="4" fill="currentColor"/>
    <path d="M4.5 21c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5" fill="currentColor"/>
  </svg>`;

const makeBadge = (glyphSvg, color, size = 30, pulse = false) => L.divIcon({
  className: '',
  html: `
    <div style="position:relative;width:${size}px;height:${size}px">
      <div style="
        position:absolute;inset:0;
        background:white;
        border-radius:50%;
        border:2.5px solid ${color};
        box-shadow:0 2px 8px rgba(0,0,0,0.3);
        display:flex;align-items:center;justify-content:center;
        color:${color};
      ">${glyphSvg}</div>
      ${pulse ? `<div style="
        position:absolute;inset:-6px;
        border-radius:50%;
        border:2px solid ${color};
        opacity:0.55;
        animation:pulse-ring 1.6s ease-out infinite;
      "></div>` : ''}
    </div>
  `,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
});

const ambulanceIcon = (color, pulse) => makeBadge(AMBULANCE_SVG, color, 32, pulse);
const hospitalIcon  = () => makeBadge(HOSPITAL_SVG, '#16A34A', 28);
const patientIcon   = () => makeBadge(PATIENT_SVG, '#DC2626', 26);

const signalMarkerIcon = (status) => {
  const c = status === 'green_corridor' ? '#16A34A' : '#94A3B8';
  return L.divIcon({
    className: '',
    html: `<div style="width:11px;height:18px;background:${c};border-radius:3px;border:1.5px solid white;box-shadow:0 0 6px ${c}90;"></div>`,
    iconSize: [11, 18], iconAnchor: [5.5, 18],
  });
};

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function MapFollower({ lat, lng }) {
  const map = useMap();
  const last = useRef(null);
  useEffect(() => {
    if (!lat || !lng) return;
    const key = `${lat.toFixed(4)},${lng.toFixed(4)}`;
    if (key !== last.current) { map.panTo([lat, lng], { animate: true, duration: 0.8 }); last.current = key; }
  }, [map, lat, lng]);
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
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError]   = useState('');

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

  const ambLat      = ambPos?.lat ?? req.amb_lat;
  const ambLng      = ambPos?.lng ?? req.amb_lng;
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
              <MapContainer center={mapCenter} zoom={14} style={{ height: 480, width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
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
                  <Marker position={[ambLat, ambLng]} icon={ambulanceIcon('#2563EB', !isComplete && !isCancelled)}>
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
