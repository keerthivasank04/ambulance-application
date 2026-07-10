const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'tnadmin-secret-token';

// Verifies the x-admin-token header the frontend already sends on every
// admin request (see frontend/src/services/api.js adminHeaders()) — routes
// mounted behind this previously trusted the client with no server check.
function requireAdminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized — admin token required' });
  }
  next();
}

module.exports = { requireAdminAuth };
