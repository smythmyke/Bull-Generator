const isProd = process.env.NODE_ENV === 'production';

// Base URL for success/cancel redirects
export const BASE_URL = 'https://solicitation-matcher-extension.web.app';

// API base URL
const API_BASE = 'https://us-central1-solicitation-matcher-extension.cloudfunctions.net/api';

export const ENDPOINTS = {
  API: API_BASE,
  STRIPE_PORTAL: API_BASE, // Using the same base URL since it's handled by the same function
  STRIPE_WEBHOOK: `${API_BASE}/webhook`
};
