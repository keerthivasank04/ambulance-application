import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useTheme } from '../context/ThemeContext';
import { getSocket } from '../services/socket';

const SunIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/>
    <line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
    <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/>
    <line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
    <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
  </svg>
);
const MoonIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
  </svg>
);
const MenuIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
  </svg>
);
const XIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
);

const LINKS = [
  { to: '/request', label: 'Request Ambulance', accent: 'accent-red' },
  { to: '/driver',  label: 'Driver Portal',     accent: 'accent-blue' },
  { to: '/admin',   label: 'Control Room',      accent: 'accent-navy' },
];

export default function Navbar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const [wsConnected, setWsConnected] = useState(false);
  const isAdmin = !!localStorage.getItem('admin_token');
  const onAdmin = pathname.startsWith('/admin') && pathname !== '/admin/login';

  useEffect(() => {
    const sock = getSocket();
    setWsConnected(sock.connected);
    const onConn = () => setWsConnected(true);
    const onDisc = () => setWsConnected(false);
    sock.on('connect', onConn);
    sock.on('disconnect', onDisc);
    return () => { sock.off('connect', onConn); sock.off('disconnect', onDisc); };
  }, []);

  const isActive = (to) => to !== '/' && pathname.startsWith(to);

  const signOut = () => {
    localStorage.removeItem('admin_token');
    navigate('/admin/login');
    setMenuOpen(false);
  };

  return (
    <header className="navbar">
      <div className="govt-banner">
        <span>Government of Tamil Nadu &nbsp;|&nbsp; National Health Mission &nbsp;|&nbsp; <strong>108 Emergency Services</strong></span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <span style={{ opacity: 0.6 }}>Free · 24/7 · Chennai City</span>
          <a href="tel:108" style={{ fontWeight: 700, fontSize: '0.82rem', color: '#FCD34D', letterSpacing: '0.04em' }}>
            Call 108
          </a>
        </div>
      </div>

      <nav className="navbar-nav">
        <div className="container navbar-inner">
          <Link to="/" className="navbar-brand">
            <div className="navbar-brand-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
                <line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/>
              </svg>
            </div>
            <div className="navbar-brand-text">
              <div className="navbar-brand-title">108</div>
              <div className="navbar-brand-sub">Ambulance TN</div>
            </div>
          </Link>

          <div className="navbar-spacer" />

          <div className="navbar-links">
            {LINKS.map(({ to, label, accent }) => (
              <Link key={to} to={to} data-testid={`nav-link-${to.replace('/', '')}`}
                className={`navbar-link ${isActive(to) ? `active ${accent}` : ''}`}>
                {label}
              </Link>
            ))}
          </div>

          <div className="navbar-spacer" />

          <div className="navbar-controls">
            <div className="ws-indicator" title={wsConnected ? 'Live connection active' : 'Connecting...'}>
              <span className={`dot ${wsConnected ? 'dot-green dot-pulse' : 'dot-amber'}`} />
              <span className={wsConnected ? 'text-green' : 'text-amber'}>{wsConnected ? 'Live' : '···'}</span>
            </div>

            <button onClick={toggle} data-testid="theme-toggle" className="icon-btn"
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}>
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>

            <a href="tel:108" className="call-pill">108</a>

            {isAdmin && onAdmin && (
              <button onClick={signOut} className="btn btn-sm btn-ghost" style={{ color: 'var(--tn-red)', borderColor: 'rgba(200,16,46,0.3)' }}>
                Sign Out
              </button>
            )}

            <button onClick={() => setMenuOpen(o => !o)} className="icon-btn navbar-mobile-toggle">
              {menuOpen ? <XIcon /> : <MenuIcon />}
            </button>
          </div>
        </div>

        {menuOpen && (
          <div className="navbar-mobile-menu">
            {LINKS.map(({ to, label }) => (
              <Link key={to} to={to} onClick={() => setMenuOpen(false)}
                className={`navbar-mobile-link ${isActive(to) ? 'active' : ''}`}>
                {label}
              </Link>
            ))}
            {isAdmin && onAdmin && (
              <button onClick={signOut} className="navbar-mobile-link" style={{ width: '100%', border: 'none', cursor: 'pointer', color: 'var(--tn-red)', background: 'var(--tn-red-l)' }}>
                Sign Out
              </button>
            )}
          </div>
        )}
      </nav>
    </header>
  );
}
