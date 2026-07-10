import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { ToastProvider } from './context/ToastContext';
import Navbar from './components/Navbar';
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

function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <BrowserRouter>
          <div className="app-shell">
            <Navbar />
            <main className="page">
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
    </ThemeProvider>
  );
}

export default App;
