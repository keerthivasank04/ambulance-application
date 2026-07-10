import { useEffect, useState, useCallback, useRef } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import { usePolling } from '../hooks/usePolling';
import { fetchAdminStats, fetchLiveAmbulances, fetchSignals } from '../services/api';
import { getSocket, joinAdminRoom } from '../services/socket';
import { useToast } from '../context/ToastContext';

// ── Map icons ──────────────────────────────────────────────────────────────
const ambulanceIcon = (color, size = 14) => L.divIcon({
  className: '',
  html: `<div style="
    background:${color};width:${size}px;height:${size}px;
    border-radius:50%;border:2.5px solid white;
    box-shadow:0 2px 6px rgba(0,0,0,0.4),0 0 0 3px ${color}40;
  "></div>`,
  iconSize: [size, size],
  iconAnchor: [size / 2, size / 2],
});

const signalIcon = (status) => {
  const c = status === 'green_corridor' ? '#16A34A' : '#DC2626';
  return L.divIcon({
    className: '',
    html: `<div style="width:10px;height:16px;background:${c};border-radius:3px;border:1.5px solid white;box-shadow:0 0 6px ${c}90;"></div>`,
    iconSize: [10, 16], iconAnchor: [5, 16],
  });
};

const AMB_COLORS = {
  available:   '#16A34A',
  assigned:    '#2563EB',
  maintenance: '#D97706',
  offline:     '#6B7280',
};

const isGpsLive = (ts) => ts && (Date.now() - new Date(ts).getTime()) < 30000;

const timeAgo = (ts) => {
  if (!ts) return '—';
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

function SignalLight({ status }) {
  const isGreen = status === 'green_corridor';
  return (
    <div style={{ display: 'flex', gap: 3, alignItems: 'center' }}>
      {['red', 'amber', 'green'].map(c => (
        <div key={c} style={{
          width: 9, height: 9, borderRadius: '50%',
          background: (isGreen && c === 'green') ? '#16A34A'
                    : (!isGreen && c === 'red')   ? '#DC2626'
                    : 'var(--border)',
          boxShadow: (isGreen && c === 'green') ? '0 0 5px #16A34A'
                   : (!isGreen && c === 'red')   ? '0 0 5px #DC2626'
                   : 'none',
        }} />
      ))}
    </div>
  );
}

const TABS = ['Fleet Map', 'Traffic Signals', 'Dispatch Log', 'GPS Devices'];

export default function AdminDashboard() {
  const [tab, setTab]         = useState(0);
  const [ambulances, setAmb]  = useState(null);
  const [stats, setStats]     = useState(null);
  const [signals, setSignals] = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const mapRef = useRef(null);
  const { addToast } = useToast();

  const statsFetcher = useCallback(() => fetchAdminStats(), []);
  const ambFetcher   = useCallback(() => fetchLiveAmbulances(), []);
  const { data: statsData } = usePolling(statsFetcher, 8000);
  const { data: ambData }   = usePolling(ambFetcher, 5000);

  useEffect(() => { if (statsData)  setStats(statsData); }, [statsData]);
  useEffect(() => { if (ambData)    setAmb(ambData); }, [ambData]);

  useEffect(() => {
    const load = () => fetchSignals().then(setSignals).catch(() => {});
    load();
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const sock = getSocket();
    joinAdminRoom();
    sock.on('connect', () => setWsConnected(true));
    sock.on('disconnect', () => setWsConnected(false));
    if (sock.connected) setWsConnected(true);

    sock.on('ambulance:location', (p) => {
      setAmb(prev => (prev || []).map(a =>
        a.id === p.ambulance_id
          ? { ...a, current_lat: p.lat, current_lng: p.lng, current_speed_kmh: p.speed_kmh, last_location_update: p.timestamp }
          : a
      ));
    });

    sock.on('request:new', (p) => {
      addToast('red', 'New Emergency', `${p.patient_name} — ${p.emergency_type}`);
    });

    sock.on('request:status', (p) => {
      const msgs = {
        arrived: 'Ambulance arrived at scene',
        enroute_hospital: 'En route to hospital',
        completed: 'Mission complete',
        cancelled: 'Dispatch cancelled',
      };
      if (msgs[p.status]) {
        addToast(p.status === 'completed' ? 'green' : p.status === 'cancelled' ? 'red' : 'blue',
          msgs[p.status], `Request ${p.requestId?.substring(0, 8)}...`);
      }
    });

    sock.on('signal:update', (data) => {
      setSignals(data);
      const active = data.filter(s => s.status === 'green_corridor').length;
      if (active > 0) addToast('amber', 'Signal Corridor Active', `${active} intersection${active > 1 ? 's' : ''} in green corridor mode`);
    });

    sock.on('signal:ack', (p) => {
      const n = p.acknowledged?.length || 0;
      if (n > 0) addToast('green', 'Signals Confirmed', `${n} intersection${n > 1 ? 's' : ''} acknowledged green corridor`);
    });

    return () => {
      sock.off('ambulance:location');
      sock.off('request:new');
      sock.off('request:status');
      sock.off('signal:update');
      sock.off('signal:ack');
    };
  }, [addToast]);

  const activeSignals = signals.filter(s => s.status === 'green_corridor');

  if (!stats || ambulances === null) {
    return (
      <div style={{ padding: '2rem 1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
          {[...Array(5)].map((_, i) => <div key={i} className="skeleton" style={{ height: 90, borderRadius: 14 }} />)}
        </div>
        <div className="skeleton" style={{ height: 440, borderRadius: 14 }} />
      </div>
    );
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: 'calc(100vh - 95px)' }}>

      {/* Control room header */}
      <div className="dashboard-header">
        <div>
          <h1 style={{ fontWeight: 800, fontSize: '1.125rem', letterSpacing: '-0.02em' }}>
            Fleet Operations Control Room
          </h1>
          <p style={{ fontSize: '0.8125rem', opacity: 0.7, marginTop: '0.1rem' }}>
            Live ambulance positions · Traffic signal management · Dispatch log
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
          <span className={`dot ${wsConnected ? 'dot-green dot-pulse' : 'dot-amber'}`} />
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: wsConnected ? '#86EFAC' : '#FCD34D' }}>
            {wsConnected ? 'Live Updates Connected' : 'Reconnecting...'}
          </span>
        </div>
      </div>

      <div className="container" style={{ padding: '1.5rem' }}>

        {/* Stats row */}
        {(() => {
          const rawAvg = stats.avg_response_time_min;
          const avgDisplay = !rawAvg || rawAvg > 120 ? '—' : `${Math.round(rawAvg)}m`;
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {[
                { label: 'Active Emergencies', value: stats.requests.active,                                          color: 'var(--tn-red)',  sub: `${stats.requests.total} total dispatches` },
                { label: 'Units Online',        value: stats.ambulances.available + stats.ambulances.assigned,         color: 'var(--green)',   sub: `${stats.ambulances.available} idle · ${stats.ambulances.assigned} on call` },
                { label: 'Signal Corridors',    value: activeSignals.length,                                           color: 'var(--amber)',   sub: `${signals.length} intersections monitored` },
                { label: 'Avg Response',        value: avgDisplay,                                                     color: 'var(--blue)',    sub: 'minutes to scene' },
                { label: 'GPS Hardware',        value: stats.ambulances.arduino_active,                               color: 'var(--purple)',  sub: 'active Arduino feeds' },
              ].map((s, i) => (
                <div key={i} className="card" style={{ borderTop: `3px solid ${s.color}`, padding: '1rem 1.25rem' }}>
                  <div className="stat-label">{s.label}</div>
                  <div className="stat-value" style={{ color: s.color, fontSize: '1.75rem' }}>{s.value}</div>
                  <div className="stat-sub">{s.sub}</div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Tabs */}
        <div style={{ marginBottom: '1.25rem' }}>
          <div className="tabs">
            {TABS.map((t, i) => (
              <button key={t} data-testid={`admin-tab-${i}`} className={`tab ${tab === i ? 'active' : ''}`} onClick={() => setTab(i)}>
                {t}
                {i === 1 && activeSignals.length > 0 && (
                  <span className="tab-badge" style={{ background: 'var(--amber)' }}>{activeSignals.length}</span>
                )}
                {i === 0 && stats.requests.active > 0 && (
                  <span className="tab-badge" style={{ background: 'var(--tn-red)' }}>{stats.requests.active}</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tab 0: Fleet Map ── */}
        {tab === 0 && (
          <div className="fleet-map-grid">

            {/* Map */}
            <div className="card panel" style={{ height: 520 }}>
              <div className="panel-header">
                <span>Live Fleet Map</span>
                <div style={{ display: 'flex', gap: '1.25rem' }}>
                  {[['#16A34A', 'Available'], ['#2563EB', 'On Call'], ['#D97706', 'Maintenance']].map(([c, l]) => (
                    <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: 'var(--text-3)' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }} />
                      {l}
                    </div>
                  ))}
                </div>
              </div>
              <MapContainer center={[13.0827, 80.2707]} zoom={11} style={{ height: 'calc(100% - 45px)', width: '100%' }} ref={mapRef}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
                {signals.map(s => s.lat && s.lng ? (
                  <Marker key={s.id} position={[s.lat, s.lng]} icon={signalIcon(s.status)}>
                    <Tooltip permanent={s.status === 'green_corridor'} direction="top">
                      <span style={{ fontSize: '0.72rem' }}>{s.name}</span>
                    </Tooltip>
                  </Marker>
                ) : null)}
                {ambulances.map(a => a.current_lat && a.current_lng ? (
                  <Marker key={a.id} position={[a.current_lat, a.current_lng]} icon={ambulanceIcon(AMB_COLORS[a.status] || '#6B7280')}>
                    <Popup>
                      <div style={{ fontSize: '0.8125rem', lineHeight: 1.75, minWidth: 160 }}>
                        <div style={{ fontWeight: 800, marginBottom: '0.25rem' }}>
                          {a.registration_number} <span style={{ fontWeight: 400, color: '#64748b' }}>({a.type})</span>
                        </div>
                        <div>Status: <strong style={{ textTransform: 'capitalize' }}>{a.status}</strong></div>
                        <div>Driver: {a.driver_name || '—'}</div>
                        <div>Speed: {a.current_speed_kmh ?? 0} km/h</div>
                        <div>GPS: {a.gps_source}</div>
                      </div>
                    </Popup>
                  </Marker>
                ) : null)}
              </MapContainer>
            </div>

            {/* Recent dispatches sidebar */}
            <div className="card panel" style={{ display: 'flex', flexDirection: 'column', height: 520 }}>
              <div className="panel-header" style={{ justifyContent: 'flex-start' }}>Recent Dispatches</div>
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {!stats.recent_requests.length ? (
                  <div className="state-empty" style={{ padding: '2rem 1rem' }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="12" cy="12" r="10"/></svg>
                    <span style={{ fontSize: '0.875rem' }}>No dispatches yet</span>
                  </div>
                ) : stats.recent_requests.map((r, i) => (
                  <div key={r.id || i} className="dispatch-row">
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-3)', fontWeight: 600, whiteSpace: 'nowrap', marginTop: '0.1rem' }}>
                      {new Date(r.requested_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '0.875rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.patient_name}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', textTransform: 'capitalize', marginTop: '0.1rem' }}>
                        {r.emergency_type}
                      </div>
                    </div>
                    <span className={`badge badge-${r.status}`} style={{ flexShrink: 0, fontSize: '0.65rem' }}>
                      {r.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 1: Traffic Signals ── */}
        {tab === 1 && (
          <div className="signals-grid">

            {/* Signal list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {activeSignals.length > 0 && (
                <div className="card panel" style={{ borderColor: 'rgba(22,163,74,0.3)' }}>
                  <div className="panel-header" style={{ justifyContent: 'flex-start', gap: '0.5rem', background: 'rgba(22,163,74,0.06)', borderBottomColor: 'rgba(22,163,74,0.2)', color: 'var(--green)' }}>
                    <span className="dot dot-green dot-pulse" />
                    Active Corridors ({activeSignals.length})
                  </div>
                  {activeSignals.map(s => (
                    <div key={s.id} className="signal-row">
                      <SignalLight status="green_corridor" />
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 700 }}>{s.id}</div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>{s.name}</div>
                        {s.distanceKm && <div style={{ fontSize: '0.7rem', color: 'var(--green)', fontWeight: 600 }}>{s.distanceKm} km</div>}
                      </div>
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 4, background: 'rgba(22,163,74,0.1)', color: 'var(--green)', border: '1px solid rgba(22,163,74,0.25)' }}>
                        OPEN
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="card panel">
                <div className="panel-header" style={{ justifyContent: 'flex-start' }}>All Intersections ({signals.length})</div>
                <div style={{ maxHeight: 380, overflowY: 'auto' }}>
                  {signals.map(s => (
                    <div key={s.id} className="signal-row" style={{ padding: '0.625rem 1.125rem' }}>
                      <SignalLight status={s.status} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.name}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--text-3)' }}>{s.id}</div>
                      </div>
                      <span style={{ fontSize: '0.65rem', fontWeight: 700, color: s.status === 'green_corridor' ? 'var(--green)' : 'var(--text-3)' }}>
                        {s.status === 'green_corridor' ? 'Open' : 'Normal'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Signal map */}
            <div className="card panel" style={{ height: 520 }}>
              <div className="panel-header" style={{ justifyContent: 'flex-start' }}>Signal Map</div>
              <MapContainer center={[13.0400, 80.2100]} zoom={11} style={{ height: 'calc(100% - 45px)', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
                {signals.map(s => (
                  <Marker key={s.id} position={[s.lat, s.lng]} icon={signalIcon(s.status)}>
                    <Popup>
                      <div style={{ fontSize: '0.8125rem', lineHeight: 1.75 }}>
                        <div style={{ fontWeight: 700 }}>{s.name}</div>
                        <div>ID: {s.id}</div>
                        <div>Status: <strong style={{ color: s.status === 'green_corridor' ? '#16A34A' : '#DC2626' }}>
                          {s.status === 'green_corridor' ? 'Green Corridor' : 'Normal'}
                        </strong></div>
                        {s.overriddenAt && <div style={{ fontSize: '0.75rem', color: 'var(--text-3)', marginTop: '0.25rem' }}>
                          Since {new Date(s.overriddenAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                        </div>}
                      </div>
                    </Popup>
                  </Marker>
                ))}
                {(ambulances || []).filter(a => ['assigned', 'enroute', 'enroute_hospital'].includes(a.status)).map(a =>
                  a.current_lat && a.current_lng ? (
                    <Marker key={a.id} position={[a.current_lat, a.current_lng]} icon={ambulanceIcon('#2563EB', 16)}>
                      <Tooltip direction="top" permanent>
                        <span style={{ fontSize: '0.75rem' }}>{a.registration_number}</span>
                      </Tooltip>
                    </Marker>
                  ) : null
                )}
              </MapContainer>
            </div>
          </div>
        )}

        {/* ── Tab 2: Dispatch Log ── */}
        {tab === 2 && (
          <div className="card panel">
            <div className="panel-header">
              <span>Dispatch History — Last {stats.recent_requests.length} Records</span>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                {[
                  { label: 'Total', value: stats.requests.total, color: 'var(--text)' },
                  { label: 'Completed', value: stats.requests.completed, color: 'var(--green)' },
                  { label: 'Active', value: stats.requests.active, color: 'var(--tn-red)' },
                  { label: 'Cancelled', value: stats.requests.cancelled, color: 'var(--amber)' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ fontSize: '0.8125rem', color: 'var(--text-3)' }}>
                    {label}: <strong style={{ color }}>{value ?? 0}</strong>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Patient</th>
                    <th>Emergency</th>
                    <th>Ambulance</th>
                    <th>Driver</th>
                    <th>Hospital</th>
                    <th>ETA</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.recent_requests.map((r, i) => (
                    <tr key={r.id || i}>
                      <td style={{ color: 'var(--text-3)', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                        {new Date(r.requested_at).toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{r.patient_name}</td>
                      <td style={{ textTransform: 'capitalize', color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{r.emergency_type}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                        {r.registration_number || '—'}
                        {r.ambulance_type && <span className={`badge badge-${r.ambulance_type?.toLowerCase()}`} style={{ marginLeft: '0.4rem' }}>{r.ambulance_type}</span>}
                      </td>
                      <td style={{ color: 'var(--text-2)', whiteSpace: 'nowrap' }}>{r.driver_name || '—'}</td>
                      <td style={{ color: 'var(--text-2)', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.hospital_name || '—'}
                      </td>
                      <td style={{ color: 'var(--text-2)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        {r.eta_minutes ? `${r.eta_minutes} min` : '—'}
                      </td>
                      <td><span className={`badge badge-${r.status}`}>{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Tab 3: GPS Devices ── */}
        {tab === 3 && (
          <div className="card panel">
            <div className="panel-header">
              <span>GPS Device Status</span>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.8125rem', color: 'var(--text-3)', textTransform: 'none', letterSpacing: 'normal', fontWeight: 400 }}>
                <span className="dot dot-green dot-pulse" />
                <span style={{ color: 'var(--green)', fontWeight: 600 }}>Live within 30s</span>
                <span className="dot dot-gray" style={{ marginLeft: '0.5rem' }} />
                <span>Offline / No device</span>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>Device ID</th>
                    <th>Ambulance</th>
                    <th>Type</th>
                    <th>Driver</th>
                    <th>GPS Feed</th>
                    <th>Last Update</th>
                    <th>Speed</th>
                    <th>Sats</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ambulances.map(a => {
                    const live = isGpsLive(a.last_location_update);
                    return (
                      <tr key={a.id}>
                        <td style={{ fontFamily: 'monospace', fontSize: '0.8125rem', fontWeight: 700, color: 'var(--tn-navy)', whiteSpace: 'nowrap' }}>
                          {a.gps_device_id || '—'}
                        </td>
                        <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{a.registration_number}</td>
                        <td><span className={`badge badge-${a.type?.toLowerCase()}`}>{a.type}</span></td>
                        <td style={{ color: 'var(--text-2)', whiteSpace: 'nowrap', fontSize: '0.875rem' }}>{a.driver_name || '—'}</td>
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                            <span className={`dot ${live ? 'dot-green dot-pulse' : 'dot-gray'}`} />
                            <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: live ? 'var(--green)' : 'var(--text-3)', whiteSpace: 'nowrap' }}>
                              {live ? `Live (${a.gps_source})` : a.gps_source === 'none' ? 'No device' : 'Offline'}
                            </span>
                          </div>
                        </td>
                        <td style={{ color: 'var(--text-3)', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
                          {timeAgo(a.last_location_update)}
                        </td>
                        <td style={{ fontWeight: 600, color: a.current_speed_kmh > 0 ? 'var(--text)' : 'var(--text-3)', whiteSpace: 'nowrap' }}>
                          {a.current_speed_kmh > 0 ? `${a.current_speed_kmh} km/h` : '—'}
                        </td>
                        <td style={{ color: 'var(--text-2)' }}>
                          {a.gps_satellites > 0 ? a.gps_satellites : '—'}
                        </td>
                        <td><span className={`badge badge-${a.status}`}>{a.status}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
