import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { fetchPublicStats } from '../services/api';
import { useLanguage } from '../context/LanguageContext';

const STEPS = [
  {
    title: 'Call 108 or Request Online',
    desc: 'Call 108 (free from any phone) or submit a request on this website with your location and emergency type.',
  },
  {
    title: 'Nearest Ambulance Dispatched',
    desc: 'The closest available ICU, ALS, or BLS unit is assigned automatically. You can track it live on a map.',
  },
  {
    title: 'Delivered to Hospital',
    desc: 'Traffic signals along the route are cleared. Patient is transported to the nearest equipped hospital.',
  },
];

const FEATURES = [
  { label: 'Automatic Dispatch', desc: 'Nearest ambulance assigned in under 1 second using GPS coordinates', icon: 'dispatch' },
  { label: 'Live GPS Tracking', desc: 'Real-time ambulance position on map, updated every second', icon: 'gps' },
  { label: 'Green Signal Corridor', desc: 'Traffic signals along the route automatically switch to green', icon: 'signal' },
  { label: 'ICU / ALS / BLS Fleet', desc: '15 ambulances of three types matched to emergency severity', icon: 'fleet' },
];

const PORTALS = [
  { to: '/request', label: 'Request Ambulance', desc: 'Submit an emergency request online and get the nearest unit dispatched instantly.', icon: 'dispatch' },
  { to: '/driver',  label: 'Driver Portal',     desc: 'Registered ambulance drivers sign in here to receive and manage dispatch assignments.', icon: 'fleet' },
  { to: '/admin',   label: 'Control Room',      desc: 'Fleet operations, live tracking, and traffic signal management for authorized staff.', icon: 'signal' },
];

function FeatureIcon({ icon }) {
  if (icon === 'dispatch') return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--tn-red)" strokeWidth="2.5" strokeLinecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;
  if (icon === 'gps')      return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinecap="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
  if (icon === 'signal')   return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="2.5" strokeLinecap="round"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="7" r="1.5" fill="var(--green)"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="17" r="1.5"/></svg>;
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2.5" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
}

function ServiceIcon({ icon }) {
  if (icon === 'dispatch') return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tn-red)" strokeWidth="2.2" strokeLinecap="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>;
  if (icon === 'fleet')    return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tn-red)" strokeWidth="2.2" strokeLinecap="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 4v4h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>;
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--tn-red)" strokeWidth="2.2" strokeLinecap="round"><rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="7" r="1.5" fill="var(--tn-red)"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="17" r="1.5"/></svg>;
}

export default function Landing() {
  const [stats, setStats] = useState(null);
  const { t } = useLanguage();

  useEffect(() => {
    fetchPublicStats().then(setStats).catch(() => {});
  }, []);

  return (
    <div>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <div className="hero-eyebrow">{t('govtOfTN')} — {t('nhm')}</div>

            <div className="hero-title-row">
              <span className="hero-number">108</span>
              <span className="hero-subtitle">{t('heroEmergencyWord')}<br />{t('heroAmbulanceWord')}</span>
            </div>

            <p className="hero-desc">
              {t('heroDesc')} Call <strong style={{ color: 'white' }}>108</strong> {t('heroDescTail')}
            </p>

            <div className="hero-actions">
              <Link to="/request" className="btn btn-danger btn-lg">{t('heroCTA')}</Link>
              <a href="tel:108" className="btn btn-ghost btn-lg" style={{ color: 'white', borderColor: 'rgba(255,255,255,0.25)' }}>{t('callBtn')}</a>
              <Link to="/driver" className="btn btn-ghost btn-lg" style={{ color: 'rgba(255,255,255,0.8)', borderColor: 'rgba(255,255,255,0.15)' }}>{t('heroDriverCTA')}</Link>
            </div>
          </div>

          <div className="hero-side">
            <div className="hero-side-number">108</div>
            <div className="hero-side-label">Free · 24/7</div>
          </div>
        </div>
      </section>

      {stats && (
        <section className="stats-bar">
          <div className="container stats-bar-inner">
            {[
              { label: 'Active Emergencies',   value: stats.requests.active,                                    color: 'var(--tn-red)' },
              { label: 'Units Available',       value: stats.ambulances.available + stats.ambulances.assigned,   color: 'var(--green)' },
              { label: 'Government Hospitals',  value: stats.hospitals.total,                                    color: 'var(--tn-navy)' },
              { label: 'Total Dispatches',      value: stats.requests.total,                                     color: 'var(--amber)' },
              { label: 'Completed Today',       value: stats.requests.completed,                                 color: 'var(--blue)' },
            ].map(({ label, value, color }) => (
              <div key={label} className="stats-bar-item">
                <div className="stats-bar-value" style={{ color }}>{value ?? '—'}</div>
                <div className="stats-bar-label">{label}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="container">
          <div className="section-header">
            <p className="section-eyebrow">How it works</p>
            <h2 className="section-heading">Emergency to hospital in 3 steps</h2>
          </div>

          <div className="step-grid">
            {STEPS.map(({ title, desc }, i) => (
              <div key={title} className="card">
                <div className="step-num">{String(i + 1).padStart(2, '0')}</div>
                <h3 style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text)', marginBottom: '0.5rem', lineHeight: 1.3 }}>{title}</h3>
                <p style={{ fontSize: '0.875rem', color: 'var(--text-2)', lineHeight: 1.65 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="section" style={{ background: 'var(--surface)', borderTop: '1px solid var(--border)' }}>
        <div className="container">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3rem', alignItems: 'center', maxWidth: 1100, margin: '0 auto' }}>
            <div>
              <p className="section-eyebrow">Platform capabilities</p>
              <h2 className="section-heading" style={{ marginBottom: '1rem' }}>Built for speed.<br />Designed to save lives.</h2>
              <p style={{ fontSize: '0.9375rem', color: 'var(--text-2)', lineHeight: 1.7, marginBottom: '1.75rem' }}>
                The system connects citizens, drivers, hospitals, and traffic signals into one real-time network.
                Every second counts — the platform is engineered to cut response time and keep drivers informed.
              </p>
              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <Link to="/request" className="btn btn-danger">Request Ambulance</Link>
                <Link to="/admin" className="btn btn-ghost">Control Room</Link>
              </div>
            </div>

            <div className="feature-list">
              {FEATURES.map(({ label, desc, icon }) => (
                <div key={label} className="feature-row">
                  <div className="feature-icon-box"><FeatureIcon icon={icon} /></div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '0.875rem', color: 'var(--text)', marginBottom: '0.2rem' }}>{label}</div>
                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-2)', lineHeight: 1.5 }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="section" style={{ background: 'var(--bg)' }}>
        <div className="container">
          <div className="section-header">
            <p className="section-eyebrow">{t('ourServices')}</p>
            <h2 className="section-heading">Everything you need, in one place</h2>
          </div>

          <div className="portal-grid">
            {PORTALS.map(({ to, label, desc, icon }) => (
              <Link key={to} to={to} className="service-card">
                <div className="service-card-icon"><ServiceIcon icon={icon} /></div>
                <div className="service-card-title">{label}</div>
                <div className="service-card-desc">{desc}</div>
                <div className="service-card-cta">
                  View Service
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <footer className="site-footer">
        <div className="container site-footer-columns">
          <div className="site-footer-col">
            <div className="site-footer-col-title">108 Ambulance</div>
            <span>Tamil Nadu's emergency medical response service for Chennai. Free, 24/7, and dispatched in seconds.</span>
          </div>
          <div className="site-footer-col">
            <div className="site-footer-col-title">Quick Links</div>
            <Link to="/request">Request Ambulance</Link>
            <Link to="/driver">Driver Portal</Link>
            <Link to="/admin">Control Room</Link>
          </div>
          <div className="site-footer-col">
            <div className="site-footer-col-title">Important Links</div>
            <a href="https://www.india.gov.in" target="_blank" rel="noreferrer">National Portal of India</a>
            <a href="https://www.tn.gov.in" target="_blank" rel="noreferrer">Government of Tamil Nadu</a>
            <a href="https://nhm.gov.in" target="_blank" rel="noreferrer">National Health Mission</a>
          </div>
          <div className="site-footer-col">
            <div className="site-footer-col-title">Accessibility</div>
            <span>This site follows GIGW accessibility guidelines.</span>
            <span>Screen Reader Access available</span>
          </div>
        </div>
        <div className="container site-footer-bottom">
          <span className="site-footer-item">
            {t('govtOfTN')} · {t('nhm')} · {t('footerHealthDept')}
          </span>
          <span className="site-footer-item">© {new Date().getFullYear()} 108 Emergency Services · Content last updated {new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
        </div>
      </footer>
    </div>
  );
}
