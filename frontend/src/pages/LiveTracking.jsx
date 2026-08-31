import { useParams } from 'react-router-dom';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, Polyline, useMap } from 'react-leaflet';
import { usePolling } from '../hooks/usePolling';
import { useSmoothPosition, computeBearing } from '../hooks/useSmoothPosition';
import { ambulanceIcon, hospitalIcon, patientIcon, signalMarkerIcon, haversineKm } from '../utils/mapIcons';
import { fetchRequest, fetchSignals } from '../services/api';
import { getSocket, joinRequestRoom } from '../services/socket';

// Smoothly pans camera to follow the ambulance position in 'follow' mode
function MapFollower({ lat, lng, enabled }) {
  const map = useMap();
  useEffect(() => {
    if (!enabled || lat == null || lng == null) return;
    map.panTo([lat, lng], { animate: true, duration: 0.4, easeLinearity: 1 });
  }, [map, lat, lng, enabled]);
  return null;
}

function MapRefCapture({ mapRef }) {
  const map = useMap();
  useEffect(() => { mapRef.current = map; }, [map, mapRef]);
  return null;
}

// Initial camera fit for patient + ambulance + hospital
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

const getBearingName = (deg) => {
  if (deg == null) return 'N';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx];
};

export default function LiveTracking() {
  const { id } = useParams();
  const [req, setReq]               = useState(null);
  const [ambPos, setAmbPos]         = useState(null);
  const [bearing, setBearing]       = useState(0);
  const [wsConnected, setWsConnected] = useState(false);
  const [error, setError]           = useState('');
  const [cameraMode, setCameraMode] = useState('follow'); // 'follow' | 'fit' | 'free'
  const [copied, setCopied]         = useState(false);
  const prevAmbRef = useRef(null);
  const mapRef     = useRef(null);

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
        if (prev && haversineKm(prev.lat, prev.lng, payload.lat, payload.lng) > 0.003) {
          setBearing(computeBearing(prev.lat, prev.lng, payload.lat, payload.lng));
        }
        prevAmbRef.current = { lat: payload.lat, lng: payload.lng };
        setAmbPos({
          lat: payload.lat,
          lng: payload.lng,
          speed: payload.speed_kmh,
          heading: payload.heading,
          satellites: payload.satellites,
          source: payload.source,
          ts: payload.timestamp
        });
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
  const sats        = ambPos?.satellites ?? req.gps_satellites ?? 6;
  const isEnRoute   = req.status === 'enroute';
  const isToHosp    = req.status === 'enroute_hospital';
  const isComplete  = req.status === 'completed';
  const isCancelled = req.status === 'cancelled';
  const statusColor = STATUS_COLORS[req.status] || '#2563EB';
  const stepIdx     = STATUS_STEPS.indexOf(req.status);

  const mapCenter = ambLat && ambLng ? [ambLat, ambLng]
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
    setCameraMode('follow');
    if (mapRef.current && ambLat && ambLng) {
      mapRef.current.panTo([ambLat, ambLng], { animate: true, duration: 0.5 });
    }
  };

  const fitAll = () => {
    setCameraMode('fit');
    if (mapRef.current && initialFitPositions.length >= 2) {
      mapRef.current.fitBounds(initialFitPositions, { padding: [48, 48], maxZoom: 15 });
    }
  };

  const shareTracking = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({
          title: `TN 108 Live Tracking: ${req.patient_name}`,
          text: `Track emergency ambulance for ${req.patient_name} in real-time.`,
          url: url,
        });
      } catch {
        // Fallback to clipboard
      }
    } else {
      navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: 'calc(100vh - 95px)' }}>

      {/* Top Banner with live state & connection health */}
      <div className="tracking-banner" style={{
        background: isCancelled ? '#FEF2F2' : isComplete ? '#F0FDF4' : `${statusColor}0D`,
        borderBottomColor: isCancelled ? '#FECACA' : isComplete ? '#BBF7D0' : `${statusColor}30`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {!isComplete && !isCancelled && <span className="dot dot-red dot-pulse" />}
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--text)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {isCancelled ? 'Dispatch Cancelled' : isComplete ? 'Mission Complete — Patient Delivered' : STATUS_LABELS[req.status] || req.status}
              {speed > 0 && !isComplete && !isCancelled && (
                <span style={{ fontSize: '0.75rem', padding: '0.15rem 0.5rem', borderRadius: 99, background: 'rgba(22,163,74,0.12)', color: 'var(--green)', fontWeight: 700 }}>
                  Moving Live
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-2)', marginTop: '0.1rem' }}>
              {req.patient_name} &nbsp;·&nbsp; {req.emergency_type} &nbsp;·&nbsp; {req.hospital_name || 'Designated Hospital'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={shareTracking}
            className="btn btn-ghost btn-sm"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', borderColor: 'var(--border)' }}
            title="Share live tracking link"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
            {copied ? 'Link Copied!' : 'Share Tracking'}
          </button>
          <span className={`badge badge-${req.status}`}>{STATUS_LABELS[req.status] || req.status}</span>
          <div className={`ws-indicator ${wsConnected ? 'connected' : 'disconnected'}`}>
            <span className={`dot ${wsConnected ? 'dot-green dot-pulse' : 'dot-amber'}`} />
            <span>{wsConnected ? 'Live Satellite GPS' : 'Polling'}</span>
          </div>
        </div>
      </div>

      {/* Progress timeline steps */}
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
                      border: curr ? `2.5px solid ${statusColor}` : '2.5px solid transparent',
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

      {/* Main Grid */}
      <div style={{ padding: '1.25rem 1.5rem' }}>
        <div className="tracking-grid">

          {/* Left Panel: Telemetrics & Contacts */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Live ETA Card (TrackIN Style) */}
            {!isComplete && !isCancelled && (
              <div className="card eta-card" style={{ borderTop: `4px solid ${statusColor}` }}>
                <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-3)', marginBottom: '0.25rem' }}>
                  {isEnRoute ? 'Ambulance Reaching In' : 'Arrival at Hospital In'}
                </div>
                <div className="eta-value" style={{ color: statusColor }}>{req.eta_minutes ?? '—'}</div>
                <div className="eta-unit">minutes remaining</div>
                
                <div style={{ display: 'flex', justifyContent: 'center', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.75rem' }}>
                  <div className="eta-speed">
                    <span className="dot dot-green dot-pulse" />
                    {speed} km/h
                  </div>
                  {routeDistanceKm && (
                    <div className="eta-speed">
                      Distance: {routeDistanceKm} km
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Quick Contact & Action Buttons */}
            <div className="card panel" style={{ padding: '0.875rem 1rem' }}>
              <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-3)', letterSpacing: '0.06em', marginBottom: '0.625rem' }}>
                Emergency Contacts
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {req.driver_phone && (
                  <a
                    href={`tel:${req.driver_phone}`}
                    className="btn btn-primary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textDecoration: 'none' }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    Call Driver ({req.driver_name || 'Assigned'})
                  </a>
                )}
                {req.hospital_phone && (
                  <a
                    href={`tel:${req.hospital_phone}`}
                    className="btn btn-ghost btn-sm"
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textDecoration: 'none', borderColor: 'var(--border)' }}
                  >
                    Call Hospital ({req.hospital_name})
                  </a>
                )}
                <a
                  href="tel:108"
                  className="btn btn-ghost btn-sm"
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', textDecoration: 'none', borderColor: 'var(--border)', color: 'var(--tn-red)' }}
                >
                  108 Emergency Control Room
                </a>
              </div>
            </div>

            {/* Vehicle & Mission Details */}
            <div className="card panel">
              <div className="panel-header" style={{ justifyContent: 'flex-start' }}>Vehicle & GPS Telemetry</div>
              <div className="unit-detail-row">
                {[
                  { label: 'Vehicle Number', value: req.registration_number ? `${req.registration_number} (${req.ambulance_type})` : null },
                  { label: 'Driver', value: req.driver_name },
                  { label: 'GPS Satellites', value: `${sats} Satellites Locked` },
                  { label: 'Compass Heading', value: `${getBearingName(bearing)} (${Math.round(bearing)}°)` },
                  { label: 'Assigned Hospital', value: req.hospital_name },
                  { label: 'Hospital Address', value: req.hospital_address },
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

            {/* Green Corridor Signals HUD */}
            {routeSignals.length > 0 && (
              <div className="card panel" style={{ borderColor: 'rgba(22,163,74,0.3)' }}>
                <div className="panel-header" style={{ justifyContent: 'flex-start', gap: '0.5rem', background: 'rgba(22,163,74,0.06)', borderBottomColor: 'rgba(22,163,74,0.2)', color: 'var(--green)' }}>
                  <span className="dot dot-green dot-pulse" />
                  Green Corridors Cleared ({routeSignals.length})
                </div>
                {routeSignals.map(s => (
                  <div key={s.id} className="signal-row">
                    <span className="dot dot-green dot-pulse" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.8125rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                      {s.distanceKm != null && <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>{s.distanceKm} km from ambulance</div>}
                    </div>
                    <span className="badge badge-completed" style={{ flexShrink: 0 }}>CLEARED</span>
                  </div>
                ))}
              </div>
            )}

            {/* Trip Timeline */}
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

          {/* Right Panel: Interactive Live Map */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
            <div className="map-panel" style={{ minHeight: 560 }}>

              {/* Floating TrackIN-Style HUD Controls */}
              <div style={{ position: 'absolute', top: 12, left: 12, zIndex: 1100, display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button
                  type="button"
                  onClick={recenter}
                  className={`btn btn-sm ${cameraMode === 'follow' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ background: cameraMode === 'follow' ? 'var(--tn-navy)' : 'var(--surface)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--border)' }}
                >
                  Follow Vehicle
                </button>
                <button
                  type="button"
                  onClick={fitAll}
                  className={`btn btn-sm ${cameraMode === 'fit' ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ background: cameraMode === 'fit' ? 'var(--tn-navy)' : 'var(--surface)', boxShadow: 'var(--card-shadow)', border: '1px solid var(--border)' }}
                >
                  Full Route
                </button>
              </div>


              {/* Live Speed & Satellite Pill */}
              <div className="map-live-pill">
                <span className="dot dot-green dot-pulse" />
                <span>{speed} km/h</span>
                <span style={{ color: 'var(--text-3)' }}>·</span>
                <span style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>{getBearingName(bearing)} ({Math.round(bearing)}°)</span>
              </div>

              {/* Recenter shortcut */}
              <button type="button" className="map-recenter-btn" onClick={recenter} title="Center on ambulance">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                  <circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3" fill="currentColor"/>
                  <line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="22"/>
                  <line x1="2" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="22" y2="12"/>
                </svg>
              </button>

              {/* Leaflet Map Canvas */}
              <MapContainer center={mapCenter} zoom={14} style={{ width: '100%', height: '100%', minHeight: 560 }}>
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapRefCapture mapRef={mapRef} />
                <MapInitialFit positions={initialFitPositions} />
                <MapFollower lat={ambLat} lng={ambLng} enabled={cameraMode === 'follow'} />

                {/* Patient location */}
                {req.patient_lat && req.patient_lng && (
                  <Marker position={[req.patient_lat, req.patient_lng]} icon={patientIcon()}>
                    <Popup>
                      <strong>Patient Location</strong><br />
                      {req.patient_name}<br />
                      {req.patient_address || `${req.patient_lat.toFixed(4)}, ${req.patient_lng.toFixed(4)}`}
                    </Popup>
                    <Tooltip permanent direction="top" offset={[0, -18]}>
                      Patient Location
                    </Tooltip>
                  </Marker>
                )}

                {/* Designated Hospital */}
                {req.hospital_lat && req.hospital_lng && (
                  <Marker position={[req.hospital_lat, req.hospital_lng]} icon={hospitalIcon()}>
                    <Popup>
                      <strong>{req.hospital_name}</strong><br />
                      {req.hospital_address}<br />
                      {req.hospital_phone && <a href={`tel:${req.hospital_phone}`}>{req.hospital_phone}</a>}
                    </Popup>
                    <Tooltip permanent direction="top" offset={[0, -18]}>
                      {req.hospital_name}
                    </Tooltip>
                  </Marker>
                )}

                {/* Active Live Ambulance */}
                {ambLat && ambLng && (
                  <Marker
                    position={[ambLat, ambLng]}
                    icon={ambulanceIcon(statusColor, !isComplete && !isCancelled, bearing, 34)}
                  >
                    <Popup>
                      <strong>{req.registration_number || 'Ambulance Unit'}</strong><br />
                      Driver: {req.driver_name || 'Assigned'}<br />
                      Speed: {speed} km/h<br />
                      Heading: {getBearingName(bearing)} ({Math.round(bearing)}°)<br />
                      Satellites: {sats}<br />
                      Status: {STATUS_LABELS[req.status] || req.status}
                    </Popup>
                  </Marker>
                )}

                {/* Traffic Signals on Route */}
                {routeSignals.map(s => (
                  <Marker key={s.id} position={[s.lat, s.lng]} icon={signalMarkerIcon(s.status)}>
                    <Popup>
                      <strong>{s.name}</strong><br />
                      Status: <span style={{ color: 'var(--green)', fontWeight: 700 }}>Green Corridor Active</span>
                    </Popup>
                  </Marker>
                ))}

                {/* Direct route polyline */}
                {routeTarget && ambLat && ambLng && (
                  <Polyline
                    positions={[[ambLat, ambLng], [routeTarget.lat, routeTarget.lng]]}
                    pathOptions={{ color: routeTarget.color, weight: 4, dashArray: '8, 8', opacity: 0.8 }}
                  />
                )}
              </MapContainer>
            </div>

            {/* Map Legend */}
            <div className="map-legend">
              <div className="map-legend-item">
                <span className="map-legend-dot" style={{ background: statusColor }} />
                <span>Ambulance ({speed} km/h)</span>
              </div>
              <div className="map-legend-item">
                <span className="map-legend-dot" style={{ background: '#DC2626' }} />
                <span>Patient Location</span>
              </div>
              <div className="map-legend-item">
                <span className="map-legend-dot" style={{ background: '#16A34A' }} />
                <span>Hospital Destination</span>
              </div>
              {routeSignals.length > 0 && (
                <div className="map-legend-item">
                  <span className="map-legend-dot" style={{ background: '#16A34A' }} />
                  <span>Green Corridor Active</span>
                </div>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
