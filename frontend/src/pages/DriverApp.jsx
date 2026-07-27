import { useState, useCallback, useEffect } from 'react';
import { usePolling } from '../hooks/usePolling';
import { driverLogin, toggleDriverStatus, fetchDriverAssignment, updateRequestStatus } from '../services/api';
import { getSocket } from '../services/socket';
import { useToast } from '../context/ToastContext';

const STATUS_FLOW = {
  assigned        : { next: 'enroute',          label: 'Accept — Go En Route to Patient', color: 'var(--tn-red)' },
  enroute         : { next: 'arrived',           label: 'Mark Arrived at Scene',           color: 'var(--amber)' },
  arrived         : { next: 'enroute_hospital',  label: 'Patient Onboard — To Hospital',   color: 'var(--blue)' },
  enroute_hospital: { next: 'completed',         label: 'Patient Delivered — Complete',    color: 'var(--green)' },
};

const STATUS_LABELS = {
  assigned        : 'Assignment Received',
  enroute         : 'En Route to Patient',
  arrived         : 'Arrived at Scene',
  enroute_hospital: 'En Route to Hospital',
  completed       : 'Completed',
  cancelled       : 'Cancelled',
};

export default function DriverApp() {
  const [driver, setDriver]   = useState(null);
  const [phone, setPhone]     = useState('');
  const [pwd, setPwd]         = useState('');
  const [err, setErr]         = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const { addToast } = useToast();

  const handleLogin = async (e) => {
    e.preventDefault();
    if (loading) return;
    setErr(''); setLoading(true);
    try {
      const res = await driverLogin(phone, pwd);
      setDriver(res.driver);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async () => {
    const next = driver.status === 'online' ? 'offline' : 'online';
    try {
      await toggleDriverStatus(driver.id, next);
      setDriver(d => ({ ...d, status: next }));
      addToast(next === 'online' ? 'green' : 'blue',
        next === 'online' ? 'You are now Online' : 'You are now Offline',
        'Availability updated');
    } catch (e) {
      addToast('red', 'Update Failed', e.message);
    }
  };

  const handleLogout = () => {
    setDriver(null); setPhone(''); setPwd('');
  };

  const isPolling = driver && (driver.status === 'online' || driver.status === 'on_duty');
  const fetcher   = useCallback(() => fetchDriverAssignment(driver?.id), [driver?.id]);
  const { data }  = usePolling(fetcher, 3000, isPolling);
  const req       = data?.assignment;

  // Socket listener for instant assignment notification
  useEffect(() => {
    if (!driver) return;
    const sock = getSocket();
    sock.on('request:new', () => {
      addToast('red', 'New Dispatch Assignment', 'An emergency has been assigned to you');
    });
    return () => sock.off('request:new');
  }, [driver, addToast]);

  const handleAction = async (status, note = '') => {
    if (!req) return;
    setActionLoading(true);
    try {
      await updateRequestStatus(req.id, status, note);

      // Step 5 — relay alarm signal to ESP32 hardware when driver accepts and goes en route
      if (status === 'enroute' && req.ambulance_id) {
        const sock = getSocket();
        sock.emit('driver:alarm', { requestId: req.id, ambulanceId: req.ambulance_id });
      }

      if (status === 'completed' || status === 'cancelled') {
        setDriver(d => ({ ...d, status: 'online' }));
        addToast('green',
          status === 'completed' ? 'Mission Complete' : 'Dispatch Cancelled',
          `Request #${req.id} closed`);
      } else {
        addToast('blue', `Status Updated: ${STATUS_LABELS[status] || status}`, `Request #${req.id}`);
      }
    } catch (e) {
      addToast('red', 'Action Failed', e.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = async () => {
    const reason = window.prompt('Reason for cancellation (required):');
    if (reason) await handleAction('cancelled', reason);
  };

  // ── Login screen ──────────────────────────────────────────────────────────
  if (!driver) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <div className="auth-brand">
            <div className="auth-brand-icon" style={{ background: 'var(--tn-navy)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
            </div>
            <div>
              <div className="auth-brand-title">Driver Portal</div>
              <div className="auth-brand-sub">108 Emergency Services</div>
            </div>
          </div>

          <h1 className="auth-heading">Sign in to Driver App</h1>
          <p className="auth-desc">Use your registered mobile number and password</p>

          {err && <div className="alert alert-error" data-testid="driver-login-error" style={{ marginBottom: '1.125rem' }}>{err}</div>}

          <form onSubmit={handleLogin} data-testid="driver-login-form" style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div className="field">
              <label className="label">Mobile Number</label>
              <input required type="tel" className="input"
                data-testid="driver-phone-input"
                placeholder="e.g. 9444001001"
                value={phone} onChange={e => setPhone(e.target.value)}
                autoFocus />
            </div>
            <div className="field">
              <label className="label">Password</label>
              <input required type="password" className="input"
                data-testid="driver-password-input"
                placeholder="••••••••"
                value={pwd} onChange={e => setPwd(e.target.value)} />
            </div>
            <button type="submit" disabled={loading} data-testid="driver-login-submit" className="btn btn-primary btn-lg btn-full">
              {loading ? 'Signing in…' : 'Sign In to Driver App'}
            </button>
          </form>

          <div className="auth-demo">
            <div className="auth-demo-label">Demo Driver Credentials</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--text-2)' }}>
              Phone: <code className="auth-demo-val">9444001001</code>
              &nbsp;·&nbsp; Password: <code className="auth-demo-val">pass123</code>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Driver dashboard ──────────────────────────────────────────────────────
  const action = req ? STATUS_FLOW[req.status] : null;
  const isOnline = driver.status === 'online' || driver.status === 'on_duty';

  return (
    <div style={{ background: 'var(--bg)', minHeight: 'calc(100vh - 95px)' }}>

      <div className="driver-header">
        <div className={`driver-avatar ${isOnline ? 'online' : 'offline'}`}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={isOnline ? 'var(--green)' : 'var(--text-3)'} strokeWidth="2" strokeLinecap="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        </div>

        <div className="driver-meta">
          <div className="driver-name-row" data-testid="driver-name">{driver.name}</div>
          <div className="driver-sub-row">
            {driver.registration_number && <span>{driver.registration_number}</span>}
            {driver.ambulance_type && <span className={`badge badge-${driver.ambulance_type?.toLowerCase()}`}>{driver.ambulance_type}</span>}
            <span style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
              <span className={`dot ${driver.gps_source === 'arduino' ? 'dot-green dot-pulse' : 'dot-amber'}`} />
              <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-3)' }}>
                {driver.gps_source === 'arduino' ? 'Hardware GPS' : 'GPS Simulation'}
              </span>
            </span>
          </div>
        </div>

        <div className="driver-actions">
          <span data-testid="driver-status-badge" className={`badge ${isOnline ? 'badge-available' : 'badge-offline'}`}>
            {driver.status === 'online' ? 'Online' : driver.status === 'on_duty' ? 'On Duty' : 'Offline'}
          </span>
          {driver.status !== 'on_duty' && (
            <button onClick={handleToggleStatus}
              data-testid="driver-toggle-status"
              className={`btn btn-sm ${driver.status === 'online' ? 'btn-ghost' : 'btn-success'}`}>
              {driver.status === 'online' ? 'Go Offline' : 'Go Online'}
            </button>
          )}
          <button onClick={handleLogout} data-testid="driver-signout" className="btn btn-sm btn-ghost" style={{ color: 'var(--text-3)' }}>
            Sign Out
          </button>
        </div>
      </div>

      <div style={{ padding: '1.5rem', maxWidth: 680, margin: '0 auto' }}>
        {req ? (
          <div className="card dispatch-card">
            <div className="dispatch-card-header">
              <div>
                <div className="dispatch-eyebrow">
                  <span className="dot dot-red dot-pulse" />
                  Active Dispatch Assignment
                </div>
                <div className="dispatch-patient-name">{req.patient_name}</div>
              </div>
              <span className={`badge badge-${req.status}`} style={{ flexShrink: 0 }}>
                {STATUS_LABELS[req.status] || req.status}
              </span>
            </div>

            <div className="dispatch-body">
              <div className="dispatch-detail-grid">
                {[
                  { label: 'Emergency Type', value: req.emergency_type, cap: true },
                  { label: 'Contact Number', value: req.patient_phone },
                  { label: 'Destination Hospital', value: req.hospital_name },
                  { label: 'Distance', value: req.distance_km != null ? `${req.distance_km} km` : null },
                ].map(({ label, value, cap }) => value ? (
                  <div key={label}>
                    <div className="dispatch-detail-label">{label}</div>
                    <div className="dispatch-detail-value" style={{ textTransform: cap ? 'capitalize' : 'none' }}>{value}</div>
                  </div>
                ) : null)}
              </div>

              <div className="dispatch-coords">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0 }}><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span style={{ color: 'var(--text-2)' }}>Patient:</span>
                <code style={{ color: 'var(--tn-navy)', fontWeight: 700 }}>
                  {req.patient_lat?.toFixed(5)}, {req.patient_lng?.toFixed(5)}
                </code>
                <a href={`https://maps.google.com/?q=${req.patient_lat},${req.patient_lng}`}
                  target="_blank" rel="noreferrer"
                  style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--blue)', fontWeight: 600, textDecoration: 'none' }}>
                  Open in Maps
                </a>
              </div>

              {req.patient_notes && (
                <div className="alert alert-warn" style={{ display: 'flex', gap: '0.625rem', alignItems: 'flex-start' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 2 }}><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                  <span><strong>Note:</strong> {req.patient_notes}</span>
                </div>
              )}

              {req.eta_minutes && req.status !== 'completed' && req.status !== 'cancelled' && (
                <div className="dispatch-eta">
                  <span style={{ color: 'var(--blue)', fontWeight: 700, fontSize: '0.9375rem' }}>
                    ETA: {req.eta_minutes} minutes
                  </span>
                </div>
              )}

              <div className="dispatch-actions">
                {action && (
                  <button onClick={() => handleAction(action.next)} disabled={actionLoading}
                    className="dispatch-action-btn" style={{ background: action.color }}>
                    {actionLoading ? 'Updating…' : action.label}
                  </button>
                )}
                {req.status !== 'completed' && req.status !== 'cancelled' && (
                  <button onClick={handleCancel} disabled={actionLoading}
                    className="btn btn-ghost btn-full"
                    style={{ color: 'var(--tn-red)', borderColor: 'rgba(200,16,46,0.3)' }}>
                    Cancel Dispatch
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="card state-empty">
            <h2 data-testid="driver-empty-state-heading" style={{ fontWeight: 800, fontSize: '1.25rem', color: 'var(--text)' }}>
              {driver.status === 'online' ? 'Waiting for Dispatch' : 'You are Offline'}
            </h2>
            <p style={{ color: 'var(--text-2)', fontSize: '0.9rem', lineHeight: 1.65, maxWidth: 340 }}>
              {driver.status === 'online'
                ? 'System is monitoring for emergencies near you. You will be automatically notified when dispatched.'
                : 'Go online to start receiving emergency dispatch assignments from the control room.'}
            </p>
            {driver.status !== 'online' && driver.status !== 'on_duty' && (
              <button onClick={handleToggleStatus} className="btn btn-success btn-lg">
                Go Online Now
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
