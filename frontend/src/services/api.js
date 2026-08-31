const API_URL = import.meta.env.VITE_API_URL || 'https://tn-ambulance-backend.onrender.com/api';

function adminHeaders() {
  let token = null;
  try {
    token = sessionStorage.getItem('admin_token') || localStorage.getItem('admin_token');
  } catch { /* storage unavailable */ }
  return { 'Content-Type': 'application/json', ...(token ? { 'x-admin-token': token } : {}) };
}

function handleAuthError(res) {
  if (res.status === 401) {
    try {
      sessionStorage.removeItem('admin_token');
      localStorage.removeItem('admin_token');
    } catch { /* storage unavailable */ }
    if (window.location.pathname.startsWith('/admin') && window.location.pathname !== '/admin/login') {
      window.location.href = '/admin/login';
    }
  }
}

// ── Emergency requests ────────────────────────────────────────────────────

export const submitRequest = async (payload) => {
  const res = await fetch(`${API_URL}/requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Dispatch failed');
  return res.json();
};

export const fetchRequest = async (id) => {
  const res = await fetch(`${API_URL}/requests/${id}`);
  if (!res.ok) throw new Error('Request not found');
  return res.json();
};

// ── Public (unauthenticated) summary stats — used on the landing page ─────

export const fetchPublicStats = async () => {
  const res = await fetch(`${API_URL}/stats`);
  if (!res.ok) throw new Error('Failed to load stats');
  return res.json();
};

// ── Admin ─────────────────────────────────────────────────────────────────

export const adminLogin = async (username, password) => {
  const res = await fetch(`${API_URL}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error((await res.json()).error || 'Login failed');
  return res.json();
};

export const fetchAdminStats = async () => {
  const res = await fetch(`${API_URL}/admin/stats`, { headers: adminHeaders() });
  if (!res.ok) {
    handleAuthError(res);
    throw new Error('Failed to load stats');
  }
  return res.json();
};

export const fetchLiveAmbulances = async () => {
  const res = await fetch(`${API_URL}/admin/ambulances/live`, { headers: adminHeaders() });
  if (!res.ok) {
    handleAuthError(res);
    throw new Error('Failed to load ambulances');
  }
  return res.json();
};


// ── Driver ────────────────────────────────────────────────────────────────

export const driverLogin = async (phone, password) => {
  const res = await fetch(`${API_URL}/drivers/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, password }),
  });
  if (!res.ok) throw new Error('Invalid phone number or password');
  return res.json();
};

export const toggleDriverStatus = async (id, status) => {
  const res = await fetch(`${API_URL}/drivers/${id}/availability`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  if (!res.ok) throw new Error('Failed to update availability');
  return res.json();
};

export const fetchDriverAssignment = async (id) => {
  const res = await fetch(`${API_URL}/drivers/${id}/assignment`);
  if (!res.ok) throw new Error('Failed to poll assignment');
  return res.json();
};

export const updateRequestStatus = async (id, status, note) => {
  const res = await fetch(`${API_URL}/requests/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, note }),
  });
  if (!res.ok) throw new Error('Failed to update status');
  return res.json();
};

// ── Traffic signals ───────────────────────────────────────────────────────

export const fetchSignals = async () => {
  const res = await fetch(`${API_URL}/signals`);
  if (!res.ok) throw new Error('Failed to load signal states');
  return res.json();
};
