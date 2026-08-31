import { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, Popup, Tooltip, useMap } from 'react-leaflet';
import L from 'leaflet';
import { usePolling } from '../hooks/usePolling';
import { ambulanceIcon, signalMarkerIcon as signalIcon } from '../utils/mapIcons';
import { fetchAdminStats, fetchLiveAmbulances, fetchSignals } from '../services/api';
import { getSocket, joinAdminRoom } from '../services/socket';
import { useToast } from '../context/ToastContext';


// Frames the map to show every marker once, on the first render after data
// arrives — not on every subsequent GPS update, so the view doesn't jump
// around every few seconds while the admin is actively looking at it.
function MapAutoFit({ positions }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || positions.length === 0) return;
    map.fitBounds(L.latLngBounds(positions), { padding: [32, 32], maxZoom: 13 });
    fitted.current = true;
  }, [map, positions]);
  return null;
}

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

const getBearingName = (deg) => {
  if (deg == null) return 'N';
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const idx = Math.round(deg / 45) % 8;
  return dirs[idx];
};

const DEFAULT_STATS = {
  requests: { total: 0, completed: 0, active: 0, cancelled: 0 },
  ambulances: { available: 0, assigned: 0, maintenance: 0, total: 0, arduino_active: 0, sim_active: 0 },
  drivers: { online: 0, on_duty: 0 },
  hospitals: { total: 0 },
  avg_response_time_min: null,
  by_type: [],
  recent_requests: [],
};

export default function AdminDashboard() {
  const [tab, setTab]                 = useState(0);
  const [ambulances, setAmb]          = useState([]);
  const [stats, setStats]             = useState(DEFAULT_STATS);
  const [signals, setSignals]         = useState([]);
  const [wsConnected, setWsConnected] = useState(false);
  const [selectedAmbId, setSelectedAmbId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode]   = useState('all'); // 'all' | 'active' | 'available' | 'hardware'
  const [showSignals, setShowSignals] = useState(true);
  const [coordsCopied, setCoordsCopied] = useState(false);
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
          ? {
              ...a,
              current_lat: p.lat,
              current_lng: p.lng,
              current_speed_kmh: p.speed_kmh,
              current_heading: p.heading,
              gps_source: p.source || a.gps_source,
              gps_satellites: p.satellites !== undefined ? p.satellites : a.gps_satellites,
              gps_fix_quality: p.fix_quality !== undefined ? p.fix_quality : a.gps_fix_quality,
              last_location_update: p.timestamp
            }
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

  const focusAmbulance = (amb) => {
    setSelectedAmbId(amb.id);
    if (mapRef.current && amb.current_lat && amb.current_lng) {
      mapRef.current.panTo([amb.current_lat, amb.current_lng], { animate: true, duration: 0.6 });
    }
  };

  const copyCoordinates = (lat, lng) => {
    if (!lat || !lng) return;
    navigator.clipboard.writeText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    setCoordsCopied(true);
    setTimeout(() => setCoordsCopied(false), 2000);
  };

  const centerAll = () => {
    if (mapRef.current && ambulances) {
      const valid = ambulances.filter(a => a.current_lat && a.current_lng).map(a => [a.current_lat, a.current_lng]);
      if (valid.length > 0) {
        mapRef.current.fitBounds(valid, { padding: [32, 32], maxZoom: 13 });
      }
    }
  };

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

  const selectedAmb = ambulances.find(a => a.id === selectedAmbId);

  // Filter fleet list
  const filteredAmbulances = ambulances.filter(a => {
    const q = searchQuery.toLowerCase().trim();
    const matchSearch = !q ||
      (a.registration_number && a.registration_number.toLowerCase().includes(q)) ||
      (a.driver_name && a.driver_name.toLowerCase().includes(q)) ||
      (a.gps_device_id && a.gps_device_id.toLowerCase().includes(q));

    if (!matchSearch) return false;
    if (filterMode === 'active') return ['assigned', 'enroute', 'enroute_hospital'].includes(a.status);
    if (filterMode === 'available') return a.status === 'available';
    if (filterMode === 'hardware') return a.gps_source === 'arduino' || (a.gps_device_id && a.gps_device_id.startsWith('ARD'));
    return true;
  });

  const navigate = useNavigate();

  const handleSignOut = () => {
    try {
      sessionStorage.removeItem('admin_token');
      localStorage.removeItem('admin_token');
    } catch { /* storage unavailable */ }
    navigate('/admin/login', { replace: true });
  };

  return (
    <div style={{ background: 'var(--bg)', minHeight: 'calc(100vh - 95px)' }}>

      {/* Control room header */}
      <div className="dashboard-header">
        <div>
          <h1 style={{ fontWeight: 800, fontSize: '1.125rem', letterSpacing: '-0.02em' }}>
            Fleet Operations Control Room
          </h1>
          <p style={{ fontSize: '0.8125rem', opacity: 0.7, marginTop: '0.1rem' }}>
            Live vehicle telematics · Traffic signal green corridors · Emergency dispatch
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span className={`dot ${wsConnected ? 'dot-green dot-pulse' : 'dot-amber'}`} />
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: wsConnected ? '#86EFAC' : '#FCD34D' }}>
              {wsConnected ? 'Live Feeds Active' : 'Reconnecting...'}
            </span>
          </div>
          <button
            onClick={handleSignOut}
            className="btn btn-sm btn-ghost"
            style={{ color: 'var(--tn-red)', borderColor: 'rgba(200,16,46,0.3)', padding: '0.25rem 0.75rem' }}
          >
            Sign Out
          </button>
        </div>
      </div>


      <div className="container" style={{ padding: '1.25rem 1.5rem' }}>

        {/* Stats row */}
        {(() => {
          const rawAvg = stats.avg_response_time_min;
          const avgDisplay = !rawAvg || rawAvg > 120 ? '—' : `${Math.round(rawAvg)}m`;
          return (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.25rem' }}>
              {[
                { label: 'Active Emergencies', value: stats.requests.active,                                          color: 'var(--tn-red)',  sub: `${stats.requests.total} total missions` },
                { label: 'Units Online',        value: stats.ambulances.available + stats.ambulances.assigned,         color: 'var(--green)',   sub: `${stats.ambulances.available} available · ${stats.ambulances.assigned} on call` },
                { label: 'Signal Corridors',    value: activeSignals.length,                                           color: 'var(--amber)',   sub: `${signals.length} intersections` },
                { label: 'Avg Response',        value: avgDisplay,                                                     color: 'var(--blue)',    sub: 'minutes to scene' },
                { label: 'GPS Hardware Feed',   value: stats.ambulances.arduino_active || '1 Active',                 color: 'var(--purple)',  sub: 'NEO-6M / SIM800L Live' },
              ].map((s, i) => (
                <div key={i} className="card" style={{ borderTop: `3px solid ${s.color}`, padding: '0.875rem 1.125rem' }}>
                  <div className="stat-label">{s.label}</div>
                  <div className="stat-value" style={{ color: s.color, fontSize: '1.65rem' }}>{s.value}</div>
                  <div className="stat-sub">{s.sub}</div>
                </div>
              ))}
            </div>
          );
        })()}

        {/* Tabs */}
        <div style={{ marginBottom: '1rem' }}>
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

        {/* ── Tab 0: Interactive TrackIN Fleet Map ── */}
        {tab === 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: '1.25rem' }}>

            {/* Main Map Container */}
            <div className="card panel" style={{ height: 600, position: 'relative' }}>
              <div className="panel-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span>Live Fleet Tracking</span>
                  <button
                    type="button"
                    onClick={centerAll}
                    className="btn btn-ghost btn-sm"
                    style={{ padding: '0.2rem 0.6rem', fontSize: '0.75rem', borderColor: 'var(--border)' }}
                    title="Fit all ambulances in view"
                  >
                    Fit All Fleet
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--text-2)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={showSignals}
                      onChange={e => setShowSignals(e.target.checked)}
                      style={{ cursor: 'pointer' }}
                    />
                    Show Traffic Signals
                  </label>
                  <div style={{ display: 'flex', gap: '0.75rem' }}>
                    {[['#16A34A', 'Available'], ['#2563EB', 'On Mission'], ['#D97706', 'Maint']].map(([c, l]) => (
                      <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.7rem', color: 'var(--text-3)' }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: c, display: 'inline-block' }} />
                        {l}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <MapContainer center={[13.0827, 80.2707]} zoom={11} style={{ height: 'calc(100% - 45px)', width: '100%' }} ref={mapRef}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
                <MapAutoFit positions={ambulances.filter(a => a.current_lat && a.current_lng).map(a => [a.current_lat, a.current_lng])} />

                {/* Traffic Signals Layer */}
                {showSignals && signals.map(s => s.lat && s.lng ? (
                  <Marker key={s.id} position={[s.lat, s.lng]} icon={signalIcon(s.status)}>
                    <Tooltip permanent={s.status === 'green_corridor'} direction="top">
                      <span style={{ fontSize: '0.72rem' }}>{s.name} ({s.status === 'green_corridor' ? 'GREEN' : 'Normal'})</span>
                    </Tooltip>
                  </Marker>
                ) : null)}

                {/* Fleet Ambulance Markers */}
                {ambulances.map(a => a.current_lat && a.current_lng ? (
                  <Marker
                    key={a.id}
                    position={[a.current_lat, a.current_lng]}
                    icon={ambulanceIcon(
                      AMB_COLORS[a.status] || '#6B7280',
                      selectedAmbId === a.id || ['assigned', 'enroute', 'enroute_hospital'].includes(a.status),
                      a.current_heading,
                      selectedAmbId === a.id ? 36 : 26
                    )}
                    eventHandlers={{
                      click: () => focusAmbulance(a)
                    }}
                  >
                    <Popup>
                      <div style={{ fontSize: '0.8125rem', lineHeight: 1.7, minWidth: 180 }}>
                        <div style={{ fontWeight: 800, color: 'var(--text)', borderBottom: '1px solid #e2e8f0', paddingBottom: '0.25rem', marginBottom: '0.35rem' }}>
                          {a.registration_number} <span style={{ fontWeight: 600, color: '#64748b' }}>({a.type})</span>
                        </div>
                        <div>Status: <strong style={{ textTransform: 'capitalize', color: AMB_COLORS[a.status] }}>{a.status}</strong></div>
                        <div>Driver: {a.driver_name || 'Assigned'}</div>
                        <div>Speed: <strong>{a.current_speed_kmh ?? 0} km/h</strong></div>
                        <div>Heading: {getBearingName(a.current_heading)} ({Math.round(a.current_heading || 0)}°)</div>
                        <div>GPS Source: <span className="badge badge-assigned" style={{ fontSize: '0.62rem' }}>{a.gps_source}</span></div>
                        <button
                          type="button"
                          onClick={() => focusAmbulance(a)}
                          className="btn btn-primary btn-sm"
                          style={{ width: '100%', marginTop: '0.5rem', fontSize: '0.72rem', padding: '0.25rem 0.5rem' }}
                        >
                          Inspect Live Telemetry
                        </button>
                      </div>
                    </Popup>
                  </Marker>
                ) : null)}
              </MapContainer>
            </div>

            {/* Right Sidebar: Fleet Selector & Telemetry Inspector */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', height: 600 }}>

              {/* Selected Ambulance Live Telemetry Inspector (TrackIN Style) */}
              {selectedAmb ? (
                <div className="card panel" style={{ borderTop: `4px solid ${AMB_COLORS[selectedAmb.status] || 'var(--blue)'}`, flexShrink: 0 }}>
                  <div className="panel-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span>Telemetry Inspector</span>
                    <button
                      type="button"
                      onClick={() => setSelectedAmbId(null)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-3)', fontSize: '0.9rem', fontWeight: 700 }}
                    >
                      ✕
                    </button>
                  </div>
                  <div style={{ padding: '0.875rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--text)' }}>
                          {selectedAmb.registration_number}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-2)' }}>
                          {selectedAmb.type} · Driver: {selectedAmb.driver_name || 'Assigned'}
                        </div>
                      </div>
                      <span className={`badge badge-${selectedAmb.status}`}>{selectedAmb.status}</span>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: 'var(--surface-2)', padding: '0.625rem', borderRadius: 8 }}>
                      <div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Speed</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: selectedAmb.current_speed_kmh > 0 ? 'var(--green)' : 'var(--text)' }}>
                          {selectedAmb.current_speed_kmh ?? 0} <span style={{ fontSize: '0.7rem' }}>km/h</span>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Heading</div>
                        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text)' }}>
                          {getBearingName(selectedAmb.current_heading)} <span style={{ fontSize: '0.7rem' }}>({Math.round(selectedAmb.current_heading || 0)}°)</span>
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>GPS Feed</div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--blue)' }}>
                          {selectedAmb.gps_source}
                        </div>
                      </div>
                      <div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase' }}>Satellites</div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--green)' }}>
                          {selectedAmb.gps_satellites || 6} Locked
                        </div>
                      </div>
                    </div>

                    {/* Coordinates & Copy */}
                    {selectedAmb.current_lat && selectedAmb.current_lng && (
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-3)' }}>
                        <span>GPS: {selectedAmb.current_lat.toFixed(5)}, {selectedAmb.current_lng.toFixed(5)}</span>
                        <button
                          type="button"
                          onClick={() => copyCoordinates(selectedAmb.current_lat, selectedAmb.current_lng)}
                          style={{ background: 'none', border: 'none', color: 'var(--blue)', cursor: 'pointer', fontWeight: 600, fontSize: '0.72rem' }}
                        >
                          {coordsCopied ? 'Copied' : 'Copy Coordinates'}
                        </button>
                      </div>
                    )}

                    {selectedAmb.current_request_id && (
                      <a
                        href={`/track/${selectedAmb.current_request_id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="btn btn-primary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.35rem', textDecoration: 'none', fontSize: '0.75rem' }}
                      >
                        Open Live Patient Tracking HUD
                      </a>
                    )}

                  </div>
                </div>
              ) : null}

              {/* Fleet List Sidebar (Search + Filter) */}
              <div className="card panel" style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
                <div style={{ padding: '0.75rem', borderBottom: '1px solid var(--border)' }}>
                  <input
                    type="text"
                    placeholder="Search vehicle, driver, or ID..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    style={{ width: '100%', padding: '0.4rem 0.625rem', borderRadius: 7, border: '1px solid var(--border)', fontSize: '0.8125rem' }}
                  />
                  <div style={{ display: 'flex', gap: '0.25rem', marginTop: '0.5rem', overflowX: 'auto' }}>
                    {[
                      ['all', 'All (15)'],
                      ['active', 'Active'],
                      ['available', 'Available'],
                      ['hardware', 'Hardware (ARD)']
                    ].map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setFilterMode(mode)}
                        className={`btn btn-sm ${filterMode === mode ? 'btn-primary' : 'btn-ghost'}`}
                        style={{ padding: '0.2rem 0.45rem', fontSize: '0.68rem', whiteSpace: 'nowrap' }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {filteredAmbulances.map(a => {
                    const isSelected = selectedAmbId === a.id;
                    return (
                      <div
                        key={a.id}
                        onClick={() => focusAmbulance(a)}
                        style={{
                          padding: '0.625rem 0.875rem',
                          borderBottom: '1px solid var(--border-light)',
                          cursor: 'pointer',
                          background: isSelected ? 'rgba(37,99,235,0.08)' : 'transparent',
                          borderLeft: isSelected ? '3px solid var(--blue)' : '3px solid transparent',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          gap: '0.5rem'
                        }}
                      >
                        <div>
                          <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: 'var(--text)' }}>
                            {a.registration_number}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-3)' }}>
                            {a.type} · {a.driver_name || 'Driver Assigned'}
                          </div>
                        </div>

                        <div style={{ textAlign: 'right' }}>
                          <span className={`badge badge-${a.status}`} style={{ fontSize: '0.62rem', padding: '0.1rem 0.35rem' }}>
                            {a.status}
                          </span>
                          <div style={{ fontSize: '0.68rem', fontWeight: 600, color: a.current_speed_kmh > 0 ? 'var(--green)' : 'var(--text-3)', marginTop: '0.15rem' }}>
                            {a.current_speed_kmh > 0 ? `${a.current_speed_kmh} km/h` : 'Idle'}
                          </div>

                        </div>
                      </div>
                    );
                  })}
                </div>
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
                        {s.distanceKm != null && <div style={{ fontSize: '0.7rem', color: 'var(--green)', fontWeight: 600 }}>{s.distanceKm} km</div>}
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
                <MapAutoFit positions={signals.filter(s => s.lat && s.lng).map(s => [s.lat, s.lng])} />
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
                    <Marker key={a.id} position={[a.current_lat, a.current_lng]} icon={ambulanceIcon('#2563EB', false, null, 20)}>
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
