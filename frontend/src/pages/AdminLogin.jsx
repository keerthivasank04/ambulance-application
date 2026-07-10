import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { adminLogin } from '../services/api';

export default function AdminLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [showPwd, setShowPwd]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      const { token } = await adminLogin(username, password);
      localStorage.setItem('admin_token', token);
      navigate('/admin');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-brand-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>
              <line x1="12" y1="9" x2="12" y2="15"/><line x1="9" y1="12" x2="15" y2="12"/>
            </svg>
          </div>
          <div>
            <div className="auth-brand-title">108 Ambulance</div>
            <div className="auth-brand-sub">Control Room Portal</div>
          </div>
        </div>

        <h1 className="auth-heading">Sign in to Control Room</h1>
        <p className="auth-desc">Authorized personnel only. Access is logged.</p>

        {error && (
          <div className="alert alert-error" data-testid="admin-login-error" style={{ marginBottom: '1.25rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} data-testid="admin-login-form" style={{ display: 'flex', flexDirection: 'column', gap: '1.125rem' }}>
          <div className="field">
            <label className="label">Username</label>
            <input
              required type="text" className="input"
              data-testid="admin-username-input"
              autoComplete="username"
              placeholder="Enter your username"
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoFocus
            />
          </div>
          <div className="field">
            <label className="label">Password</label>
            <div className="password-field">
              <input
                required
                type={showPwd ? 'text' : 'password'}
                className="input"
                data-testid="admin-password-input"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                style={{ paddingRight: '3rem' }}
              />
              <button type="button" onClick={() => setShowPwd(s => !s)} className="password-toggle">
                {showPwd ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading} data-testid="admin-login-submit" className="btn btn-primary btn-lg btn-full">
            {loading ? 'Authenticating…' : 'Sign In to Control Room'}
          </button>
        </form>

        <div className="auth-demo">
          <div className="auth-demo-label">Demo Access</div>
          <div className="auth-demo-row">
            <div>
              <div className="auth-demo-key">Username</div>
              <code className="auth-demo-val">admin</code>
            </div>
            <div>
              <div className="auth-demo-key">Password</div>
              <code className="auth-demo-val">admin123</code>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
