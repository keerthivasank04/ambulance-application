import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import { LanguageProvider } from './context/LanguageContext';
import Navbar from './components/Navbar';
import Breadcrumbs from './components/Breadcrumbs';
import Landing from './pages/Landing';
import RequestEmergency from './pages/RequestEmergency';
import LiveTracking from './pages/LiveTracking';
import AdminLogin from './pages/AdminLogin';
import AdminDashboard from './pages/AdminDashboard';
import DriverApp from './pages/DriverApp';

function RequireAdmin({ children }) {
  let token = null;
  try { token = localStorage.getItem('admin_token'); } catch { /* storage unavailable */ }
  if (!token) return <Navigate to="/admin/login" replace />;
  return children;
}

// Browsers can restore a page from the back/forward cache (bfcache) as a
// frozen snapshot — no React re-render, no auth re-check — so a signed-out
// admin dashboard or a driver's in-memory session can reappear untouched
// when the user hits Back/Forward. Forcing a reload on a bfcache restore
// makes every protected route re-evaluate its guard from scratch.
function useBfcacheReload() {
  useEffect(() => {
    const onPageShow = (e) => { if (e.persisted) window.location.reload(); };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);
}

function App() {
  useBfcacheReload();
  return (
    <ThemeProvider>
      <LanguageProvider>
        <ToastProvider>
          <BrowserRouter>
            <div className="app-shell">
              <Navbar />
              <Breadcrumbs />
              <main className="page" id="main-content">
                <Routes>
                  <Route path="/"            element={<Landing />} />
                  <Route path="/request"     element={<RequestEmergency />} />
                  <Route path="/track/:id"   element={<LiveTracking />} />
                  <Route path="/driver"      element={<DriverApp />} />
                  <Route path="/admin/login" element={<AdminLogin />} />
                  <Route path="/admin"       element={<RequireAdmin><AdminDashboard /></RequireAdmin>} />
                </Routes>
              </main>
            </div>
          </BrowserRouter>
        </ToastProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}

export default App;
