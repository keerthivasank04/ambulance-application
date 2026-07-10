export const BASE_URL = process.env.BASE_URL || 'http://localhost:5173';
export const BROWSER = process.env.BROWSER || 'MicrosoftEdge';
export const HEADLESS = process.env.HEADLESS !== 'false';

export const ADMIN_CREDS = { username: 'admin', password: 'admin123' };
export const ADMIN_CREDS_INVALID = { username: 'admin', password: 'wrongpassword' };

export const DRIVER_CREDS = { phone: '9444001001', password: 'pass123' };
export const DRIVER_CREDS_INVALID = { phone: '9444001001', password: 'wrongpassword' };
