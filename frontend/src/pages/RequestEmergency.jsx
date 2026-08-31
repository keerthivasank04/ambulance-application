import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapContainer, TileLayer, Marker, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import { submitRequest } from '../services/api';

const EMERGENCY_TYPES = [
  { value: 'cardiac',   label: 'Cardiac Arrest',         priority: 1, color: '#DC2626', ambulance: 'ICU/ALS' },
  { value: 'accident',  label: 'Trauma / Accident',      priority: 1, color: '#D97706', ambulance: 'ICU/ALS' },
  { value: 'stroke',    label: 'Stroke',                 priority: 1, color: '#9333EA', ambulance: 'ICU/ALS' },
  { value: 'breathing', label: 'Breathing Difficulty',   priority: 1, color: '#2563EB', ambulance: 'ICU/ALS' },
  { value: 'maternity', label: 'Maternity / Labour',     priority: 2, color: '#DB2777', ambulance: 'ALS' },
  { value: 'burns',     label: 'Severe Burns',           priority: 2, color: '#EA580C', ambulance: 'ALS' },
  { value: 'general',   label: 'Medical Transport',      priority: 3, color: '#16A34A', ambulance: 'BLS' },
  { value: 'fever',     label: 'High Fever',             priority: 3, color: '#0891B2', ambulance: 'BLS' },
];

const STEPS = [
  { n: 1, label: 'Your Location' },
  { n: 2, label: 'Emergency Type' },
  { n: 3, label: 'Your Details' },
];

const PICKER_ICON = L.divIcon({
  className: '',
  html: `<div style="width:26px;height:26px;border-radius:50%;background:white;border:2.5px solid #DC2626;box-shadow:0 2px 8px rgba(0,0,0,0.3);display:flex;align-items:center;justify-content:center;color:#DC2626;">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="7.5" r="4" fill="currentColor"/><path d="M4.5 21c0-4.1 3.4-7.5 7.5-7.5s7.5 3.4 7.5 7.5" fill="currentColor"/></svg>
  </div>`,
  iconSize: [26, 26], iconAnchor: [13, 13],
});

function MapClickPicker({ onPick }) {
  useMapEvents({
    click(e) { onPick(e.latlng.lat, e.latlng.lng); },
  });
  return null;
}

// Service bounds covering all Tamil Nadu districts
const TN_BOUNDS = { minLat: 8.0, maxLat: 14.5, minLng: 76.0, maxLng: 81.5 };
const isWithinServiceArea = (lat, lng) =>
  lat >= TN_BOUNDS.minLat && lat <= TN_BOUNDS.maxLat &&
  lng >= TN_BOUNDS.minLng && lng <= TN_BOUNDS.maxLng;


export default function RequestEmergency() {
  const navigate = useNavigate();
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState('');
  const [coords, setCoords]         = useState(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [geoError, setGeoError]     = useState('');
  const [selectedType, setSelectedType] = useState('cardiac');
  const [customType, setCustomType] = useState('');
  const [step, setStep]             = useState(1); // 1=location, 2=emergency, 3=details

  const [locationMethod, setLocationMethod] = useState('gps'); // 'gps' | 'search' | 'map'
  const [searchQuery, setSearchQuery]   = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching]       = useState(false);
  const [searchTried, setSearchTried]   = useState(false);
  const [mapPickPoint, setMapPickPoint] = useState(null); // tentative pin, before "Confirm"

  // Auto-detect location on mount
  useEffect(() => {
    detectLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detectLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation not supported on this device.');
      return;
    }
    setGeoLoading(true);
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        setCoords({ lat, lng });
        setGeoLoading(false);
        if (step === 1 && isWithinChennai(lat, lng)) setStep(2);
      },
      () => {
        setGeoError('Location access denied. Please enable location permissions in browser settings and try again.');
        setGeoLoading(false);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const searchAddress = async () => {
    if (!searchQuery.trim() || searching) return;
    setSearching(true);
    setSearchTried(true);
    setSearchResults([]);
    try {
      // Bias results to Chennai (service area) without hard-excluding everything else
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&countrycodes=in&viewbox=79.95,13.30,80.35,12.75&bounded=0&q=${encodeURIComponent(searchQuery)}`;
      const res = await fetch(url);
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch {
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const pickSearchResult = (result) => {
    setCoords({ lat: +result.lat, lng: +result.lon });
    setSearchResults([]);
  };

  const resetLocation = () => {
    setCoords(null);
    setMapPickPoint(null);
  };

  const handleNextStep = () => {
    setError('');
    if (step === 1) {
      if (!coords) return setError('Please detect or choose your location on the map first.');
      if (!isWithinServiceArea(coords.lat, coords.lng)) return setError('Please choose a location within Tamil Nadu service region.');
      return setStep(2);
    }
    setStep(step + 1);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (!coords) return setError('Please set a location before submitting.');
    if (!isWithinServiceArea(coords.lat, coords.lng)) return setError('This service currently operates only within Tamil Nadu.');
    setLoading(true);
    setError('');
    const fd = new FormData(e.target);
    try {
      const age = fd.get('age');
      const res = await submitRequest({
        patient_name:   fd.get('name'),
        patient_age:    age ? +age : undefined,
        patient_phone:  fd.get('phone'),
        emergency_type: isOther ? customType.trim() : selectedType,
        patient_notes:  fd.get('notes'),
        patient_lat:    coords.lat,
        patient_lng:    coords.lng,
      });
      navigate(`/track/${res.requestId}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const selected = EMERGENCY_TYPES.find(t => t.value === selectedType);
  const isOther  = selectedType === 'other';
  const selectedLabel = isOther ? (customType.trim() || 'Other emergency') : selected?.label;

  return (
    <div style={{ background: 'var(--bg)', minHeight: 'calc(100vh - 95px)' }}>

      <div className="emergency-banner">
        For life-threatening emergencies, <strong>call 108 immediately</strong> — do not wait to submit this form
      </div>

      <div className="request-page-inner">

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', marginBottom: '1.75rem' }}>
          <div className="request-header-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tn-red)" strokeWidth="2.5" strokeLinecap="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2"/>
            </svg>
          </div>
          <div>
            <h1 style={{ fontSize: '1.375rem', fontWeight: 800, letterSpacing: '-0.025em', color: 'var(--text)' }}>
              Request Emergency Ambulance
            </h1>
            <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', marginTop: '0.1rem' }}>
              Free service · Nearest unit dispatched in seconds
            </p>
          </div>
        </div>

        <div className="step-tabs">
          {STEPS.map(({ n, label }) => (
            <button key={n} type="button" onClick={() => n <= step && setStep(n)}
              className={`step-tab ${n === step ? 'current' : n < step ? 'done' : ''}`}>
              <span className="step-tab-dot">{n < step ? '✓' : n}</span>
              <span className="step-tab-label">{label}</span>
            </button>
          ))}
        </div>

        {error && (
          <div className="alert alert-error" style={{ marginBottom: '1.25rem' }}>{error}</div>
        )}

        <form onSubmit={handleSubmit}>

          {/* ── Step 1: Location ── */}
          <div style={{ display: step === 1 ? 'block' : 'none' }}>
            <div className="card" style={{ borderTop: '4px solid var(--tn-navy)', padding: '1.75rem' }}>
              <h2 style={{ fontWeight: 800, fontSize: '1.125rem', marginBottom: '0.375rem', color: 'var(--text)' }}>
                Your Location
              </h2>
              <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
                Use your current GPS location, search for an address, or drop a pin on the map — whichever is fastest.
              </p>

              {coords && !isWithinServiceArea(coords.lat, coords.lng) ? (
                <div className="location-status pending has-error">
                  <div style={{ color: '#991B1B', fontSize: '0.875rem', marginBottom: '0.875rem' }}>
                    This location is outside the Tamil Nadu emergency response network — please call <strong>108</strong> directly for immediate manual dispatch.
                  </div>
                  <button type="button" onClick={resetLocation} className="btn btn-primary btn-full">
                    Choose a Different Location
                  </button>
                </div>
              ) : coords ? (
                <div className="location-status detected">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--green-dark)" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  <div>
                    <div style={{ fontWeight: 700, color: 'var(--green-dark)' }}>Location set successfully</div>
                    <code style={{ fontSize: '0.8rem', color: 'var(--text-2)' }}>
                      {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                    </code>
                  </div>
                  <button type="button" onClick={resetLocation} className="btn btn-sm btn-ghost" style={{ marginLeft: 'auto', color: 'var(--green-dark)', borderColor: 'rgba(22,163,74,0.3)' }}>
                    Change Location
                  </button>
                </div>
              ) : (
                <>
                  <div className="location-method-tabs">
                    <button type="button" className={`location-method-tab ${locationMethod === 'gps' ? 'active' : ''}`} onClick={() => setLocationMethod('gps')}>
                      Use My Location
                    </button>
                    <button type="button" className={`location-method-tab ${locationMethod === 'search' ? 'active' : ''}`} onClick={() => setLocationMethod('search')}>
                      Search Address
                    </button>
                    <button type="button" className={`location-method-tab ${locationMethod === 'map' ? 'active' : ''}`} onClick={() => setLocationMethod('map')}>
                      Pick on Map
                    </button>
                  </div>

                  {locationMethod === 'gps' && (
                    <div className={`location-status pending ${geoError ? 'has-error' : ''}`}>
                      {geoError ? (
                        <div data-testid="geo-error" style={{ color: '#991B1B', fontSize: '0.875rem', marginBottom: '0.875rem' }}>
                          {geoError}
                        </div>
                      ) : (
                        <div style={{ color: 'var(--text-2)', fontSize: '0.875rem', marginBottom: '0.875rem' }}>
                          {geoLoading ? 'Detecting your location...' : 'Location not yet detected'}
                        </div>
                      )}
                      <button type="button" onClick={detectLocation} disabled={geoLoading}
                        data-testid="detect-location-btn" className="btn btn-primary btn-full">
                        {geoLoading ? 'Detecting...' : 'Allow Location Access'}
                      </button>
                    </div>
                  )}

                  {locationMethod === 'search' && (
                    <div>
                      <div className="field">
                        <label className="label">Search for an address or landmark</label>
                        <div className="input-group">
                          <input className="input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); searchAddress(); } }}
                            placeholder="e.g. Anna Salai, T Nagar, Chennai" data-testid="address-search-input" />
                          <button type="button" className="btn btn-primary" onClick={searchAddress} disabled={searching} data-testid="address-search-btn">
                            {searching ? 'Searching…' : 'Search'}
                          </button>
                        </div>
                      </div>
                      {searchResults.length > 0 && (
                        <div className="location-search-results" data-testid="address-search-results">
                          {searchResults.map((r, i) => (
                            <div key={i} className="location-search-result" onClick={() => pickSearchResult(r)}>
                              {r.display_name}
                            </div>
                          ))}
                        </div>
                      )}
                      {searchTried && !searching && searchResults.length === 0 && (
                        <div style={{ fontSize: '0.8125rem', color: 'var(--text-3)', marginTop: '0.625rem' }}>
                          No results found. Try a different search or use the map instead.
                        </div>
                      )}
                    </div>
                  )}

                  {locationMethod === 'map' && (
                    <div>
                      <div className="location-map-picker">
                        <MapContainer center={[13.0827, 80.2707]} zoom={12} style={{ height: '100%', width: '100%' }}>
                          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap" />
                          <MapClickPicker onPick={(lat, lng) => setMapPickPoint({ lat, lng })} />
                          {mapPickPoint && <Marker position={[mapPickPoint.lat, mapPickPoint.lng]} icon={PICKER_ICON} />}
                        </MapContainer>
                      </div>
                      <p style={{ fontSize: '0.8125rem', color: 'var(--text-3)', marginTop: '0.625rem' }}>
                        {mapPickPoint
                          ? 'Tap again to move the pin, or confirm below.'
                          : 'Tap anywhere on the map to drop a pin at the patient’s location.'}
                      </p>
                      {mapPickPoint && (
                        <button type="button" className="btn btn-danger btn-full" style={{ marginTop: '0.75rem' }}
                          onClick={() => setCoords(mapPickPoint)}>
                          Confirm This Location
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}

              {coords && isWithinServiceArea(coords.lat, coords.lng) && (
                <button type="button" onClick={() => setStep(2)} data-testid="step1-continue" className="btn btn-danger btn-full btn-lg" style={{ marginTop: '1.25rem' }}>
                  Continue →
                </button>
              )}

            </div>
          </div>

          {/* ── Step 2: Emergency Type ── */}
          <div style={{ display: step === 2 ? 'block' : 'none' }}>
            <div className="card" style={{ borderTop: '4px solid var(--tn-red)', padding: '1.75rem' }}>
              <h2 style={{ fontWeight: 800, fontSize: '1.125rem', marginBottom: '0.25rem', color: 'var(--text)' }}>
                Select Emergency Type
              </h2>
              <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                This determines ambulance priority and type (ICU/ALS/BLS) dispatched. If none of these match, describe it below.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
                {EMERGENCY_TYPES.map(({ value, label, priority, color, ambulance }) => {
                  const isSel = selectedType === value;
                  return (
                    <button key={value} type="button" onClick={() => setSelectedType(value)}
                      className={`etype-option ${isSel ? 'selected' : ''}`}
                      style={{ borderColor: isSel ? color : undefined, background: isSel ? `${color}08` : undefined }}>
                      <div className="etype-dot" style={{ background: color }} />
                      <div style={{ flex: 1, fontWeight: isSel ? 700 : 500, fontSize: '0.9rem', color: 'var(--text)' }}>
                        {label}
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                        {priority === 1 && <span className="etype-tag etype-tag-critical">CRITICAL</span>}
                        <span className="etype-tag" style={{ background: `${color}10`, color, border: `1px solid ${color}25` }}>
                          {ambulance}
                        </span>
                      </div>
                    </button>
                  );
                })}

                <button type="button" onClick={() => setSelectedType('other')}
                  data-testid="etype-other"
                  className={`etype-option ${isOther ? 'selected' : ''}`}
                  style={{ borderColor: isOther ? 'var(--tn-navy)' : undefined, background: isOther ? 'rgba(26,58,107,0.05)' : undefined }}>
                  <div className="etype-dot" style={{ background: 'var(--text-3)' }} />
                  <div style={{ flex: 1, fontWeight: isOther ? 700 : 500, fontSize: '0.9rem', color: 'var(--text)' }}>
                    Other — Not Listed
                  </div>
                </button>
              </div>

              {isOther && (
                <div className="field etype-other-input" style={{ marginBottom: '1.25rem' }}>
                  <label className="label">Describe the emergency *</label>
                  <input required={isOther} className="input" value={customType}
                    onChange={e => setCustomType(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
                    placeholder="e.g. Snake bite, electric shock, fall from height"
                    data-testid="etype-other-input" />
                </div>
              )}

              {(selected || isOther) && (
                <div style={{
                  padding: '0.75rem 1rem', background: isOther ? 'rgba(26,58,107,0.05)' : `${selected.color}08`,
                  border: `1.5px solid ${isOther ? 'rgba(26,58,107,0.2)' : `${selected.color}25`}`,
                  borderRadius: 9, marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem',
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: isOther ? 'var(--tn-navy)' : selected.color, flexShrink: 0 }} />
                  <div style={{ fontWeight: 600, color: 'var(--text)', fontSize: '0.875rem' }}>{selectedLabel}</div>
                  <div style={{ marginLeft: 'auto', fontSize: '0.8125rem', color: 'var(--text-2)' }}>
                    {isOther ? 'ALS dispatched — priority assessed on arrival'
                     : selected.priority === 1 ? 'ICU/ALS dispatched — critical priority'
                     : selected.priority === 2 ? 'ALS dispatched — high priority'
                     : 'BLS dispatched — standard priority'}
                  </div>
                </div>
              )}

              <button type="button" onClick={() => setStep(3)} disabled={isOther && !customType.trim()}
                data-testid="step2-continue" className="btn btn-danger btn-full btn-lg">
                Continue →
              </button>
            </div>
          </div>

          {/* ── Step 3: Patient Details ── */}
          <div style={{ display: step === 3 ? 'block' : 'none' }}>
            <div className="card" style={{ borderTop: '4px solid var(--green)', padding: '1.75rem' }}>
              <h2 style={{ fontWeight: 800, fontSize: '1.125rem', marginBottom: '0.25rem', color: 'var(--text)' }}>
                Patient Information
              </h2>
              <p style={{ color: 'var(--text-2)', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                Provide basic patient details so the ambulance crew can prepare.
              </p>

              <div className="summary-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem' }}>
                  <span className="dot dot-green dot-pulse" />
                  <span style={{ color: 'var(--green)', fontWeight: 700 }}>Location ready</span>
                </div>
                {(selected || isOther) && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.8125rem', color: 'var(--text-2)' }}>
                    <span>{selectedLabel}</span>
                    <button type="button" onClick={() => setStep(2)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem', color: 'var(--blue)', fontWeight: 600 }}>
                      Change
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="field" style={{ gridColumn: '1 / -1' }}>
                    <label className="label">Patient Full Name *</label>
                    <input required name="name" className="input" placeholder="Enter full name" />
                  </div>
                  <div className="field">
                    <label className="label">Contact Number *</label>
                    <input required name="phone" type="tel" className="input" placeholder="10-digit mobile number" />
                  </div>
                  <div className="field">
                    <label className="label">Age <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
                    <input name="age" type="number" min="0" max="120" className="input" placeholder="e.g. 45" />
                  </div>
                </div>

                <div className="field">
                  <label className="label">Additional Notes <span style={{ fontWeight: 400, color: 'var(--text-3)' }}>(optional)</span></label>
                  <textarea name="notes" className="input" rows={3} style={{ resize: 'vertical' }}
                    placeholder="Patient condition, floor number, gate access, known allergies, landmarks..." />
                </div>

                <div className="alert alert-info" style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start' }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink: 0, marginTop: 1 }}>
                    <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
                  </svg>
                  The nearest available ICU/ALS ambulance will be dispatched instantly. You'll receive a tracking link to monitor the ambulance in real time.
                </div>

                <button type="submit" disabled={loading || !coords} data-testid="submit-request-btn" className="btn btn-danger btn-lg btn-full">
                  {loading ? 'Dispatching Ambulance…' : 'Dispatch Ambulance'}
                </button>
              </div>
            </div>
          </div>

        </form>
      </div>
    </div>
  );
}
