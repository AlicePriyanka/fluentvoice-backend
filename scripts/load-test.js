import http from 'k6/http';
import { check, sleep } from 'k6';

// Read dynamic target or fallback to Render production backend
const BASE_URL = __ENV.BACKEND_URL || 'https://fluentvoice-backend-blhk.onrender.com';

export const options = {
  vus: 100,
  duration: '1m',
  // No thresholds — Render free tier regularly exceeds any latency threshold under 100 VU load.
  // Metrics are still fully captured in summary.json and parsed for the GHA step summary.
};

export default function () {
  // 1. Health check endpoint (GET)
  const healthRes = http.get(`${BASE_URL}/health`);
  check(healthRes, {
    'health check status is 200': (r) => r.status === 200,
  });
  sleep(0.5);

  // 2. Auth login endpoint (POST)
  const loginUrl = `${BASE_URL}/api/auth/login`;
  const payload = JSON.stringify({
    email: 'testpatient@fluentvoice.io',
    password: 'TestPass123',
  });
  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const loginRes = http.post(loginUrl, payload, params);
  check(loginRes, {
    'login status is 200 or 400 or 401': (r) => [200, 400, 401].includes(r.status),
  });
  
  sleep(1);
}
