'use strict';
/**
 * Captures deliverable screenshots into docs/screenshots/.
 * Start the app first:  GEO_PROVIDER=mock npm start   (or plain `npm start` for live OpenStreetMap)
 * Then:                 npm run screenshots
 * Requires Playwright + Chromium (npm i -D playwright && npx playwright install chromium).
 */
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const KEY = process.env.API_KEY || 'fleet-demo-key-123';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

async function call(method, url, { body, token, key = KEY } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers['x-api-key'] = key;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(BASE + url, { method, headers, body: body && JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  const shown = ['x-upstream-service', 'x-service', 'x-ratelimit-limit', 'x-ratelimit-remaining', 'retry-after', 'x-request-id'].filter((h) => res.headers.get(h)).map((h) => `${h}: ${res.headers.get(h)}`);
  return { method, url, key, token: !!token, body, status: res.status, headers: shown, json };
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function page(title, steps) {
  const blocks = steps.map((s) => `
    <div class="step">
      <div class="note">${esc(s.note || '')}</div>
      <div class="req">$ curl -X ${s.method} ${esc(BASE + s.url)}${s.key ? ` \\\n    -H "x-api-key: ${esc(s.key)}"` : ''}${s.token ? ' \\\n    -H "Authorization: Bearer &lt;JWT&gt;"' : ''}${s.body ? ` \\\n    -d '${esc(JSON.stringify(s.body))}'` : ''}</div>
      <div class="status s${String(s.status)[0]}">HTTP ${s.status}${s.headers.length ? '   ' + esc(s.headers.join('   ')) : ''}</div>
      <pre>${esc(JSON.stringify(s.json, (k, v) => (k === 'token' ? String(v).slice(0, 40) + '…' : v), 2)).slice(0, s.max || 2500)}</pre>
    </div>`).join('');
  return `<!doctype html><html><head><style>
    body{margin:0;background:#0f172a;color:#e2e8f0;font:13px/1.45 ui-monospace,Menlo,monospace;padding:24px}
    h1{font:600 20px system-ui;margin:0 0 16px;color:#fff} .step{background:#1e293b;border-radius:8px;padding:14px;margin-bottom:14px}
    .note{font:600 13px system-ui;color:#93c5fd;margin-bottom:6px} .req{white-space:pre;color:#a5f3fc}
    .status{margin:8px 0 4px;font-weight:700} .s2{color:#4ade80}.s4{color:#fbbf24}.s5{color:#f87171}
    pre{margin:0;color:#cbd5e1;white-space:pre-wrap}</style></head><body><h1>${esc(title)}</h1>${blocks}</body></html>`;
}

(async () => {
  const login = await call('POST', '/api/users/login', { body: { email: 'admin@fleet.com', password: 'admin123' } });
  const token = login.json.token;
  const vehicles = (await call('GET', '/api/vehicles', { token })).json.vehicles;
  const v = vehicles[0];

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  const p = await ctx.newPage();
  const shot = async (name, html) => { await p.setContent(html); await p.screenshot({ path: path.join(OUT, name), fullPage: true }); console.log('saved', name); };

  // 1. Geolocation
  const reg = await call('POST', '/api/vehicles', { token, body: { vin: `1HGCM82633A${String(Date.now()).slice(-6)}`, plateNumber: 'KA05MN2024', make: 'Tata', model: 'Ace', year: 2023, type: 'truck', address: 'MG Road, Bengaluru' } });
  reg.note = 'Register vehicle with only an address → coordinates obtained from geocoding provider';
  const tel = await call('POST', '/api/telemetry', { token, body: { vehicleId: v.id, latitude: 12.9721, longitude: 77.5933, speed: 38, fuelLevel: 72 } });
  tel.note = 'Vehicle reports GPS position → stored in DB and vehicle location updated';
  const near = await call('GET', '/api/maps/nearby?lat=12.9716&lng=77.5946&radius=5', { token });
  near.note = 'Vehicles within 5 km of a point (Haversine, nearest first)';
  near.max = 1800;
  await shot('01-geolocation-nearby-api.png', page('Geolocation & nearby vehicle retrieval', [reg, tel, near]));

  // 2. SMS
  const crit = await call('POST', '/api/telemetry', { token, body: { vehicleId: v.id, latitude: 12.9716, longitude: 77.5946, speed: 0, event: 'engine_fault' } });
  crit.note = 'Critical event (engine_fault) → SMS to fleet administrators';
  const st = await call('PATCH', `/api/vehicles/${v.id}/status`, { token, body: { status: 'maintenance', reason: 'Engine inspection' } });
  st.note = 'Operational status change → SMS to admins, managers and assigned driver';
  st.max = 1600;
  const fail = await call('POST', '/api/notifications/sms', { token, body: { to: '+15550000000', message: 'Test alert' } });
  fail.note = 'Simulated carrier failure → record stored with status "failed"';
  const stats = await call('GET', '/api/notifications/stats', { token });
  stats.note = 'Notification delivery log summary (sent / failed)';
  await shot('02-sms-notifications.png', page('SMS notifications for vehicle events & status changes', [crit, st, fail, stats]));
  await call('PATCH', `/api/vehicles/${v.id}/status`, { token, body: { status: 'active' } });

  // 3. Gateway
  const noKey = await call('GET', '/api/vehicles', { key: null }); noKey.note = 'No API key → 401';
  const badKey = await call('GET', '/api/vehicles', { key: 'wrong-key' }); badKey.note = 'Invalid API key → 403';
  const routed = await Promise.all(['/api/users/me', '/api/vehicles?status=active', '/api/telemetry/events', '/api/maps/vehicles', '/api/notifications/stats'].map((u) => call('GET', u, { token })));
  routed.forEach((r) => { r.note = `Routed by prefix → ${r.headers.find((h) => h.startsWith('x-service'))}`; r.max = 260; });
  const unknown = await call('GET', '/api/fuel'); unknown.note = 'Unmapped route → 404';
  const badJson = await fetch(BASE + '/api/users/login', { method: 'POST', headers: { 'x-api-key': KEY, 'Content-Type': 'application/json' }, body: '{"email":' });
  const bj = { method: 'POST', url: '/api/users/login', key: KEY, body: '{"email":', status: badJson.status, headers: [], json: await badJson.json(), note: 'Malformed JSON → 400 (rejected at gateway)' };
  await shot('03-gateway-routing-apikey.png', page('API Gateway: API key verification, routing & error handling', [noKey, badKey, ...routed, unknown, bj]));

  // 4. Rate limiting (uses a dedicated key so normal demo traffic is unaffected)
  const rlKey = process.env.RL_KEY || 'fleet-admin-key-456';
  let last; const seen = [];
  for (let i = 0; i < 200; i += 1) {
    last = await call('GET', '/api/maps/distance?lat1=0&lng1=0&lat2=1&lng2=1', { key: rlKey, token });
    if (i < 2 || last.status === 429) seen.push({ ...last, note: last.status === 429 ? `Request #${i + 1} → rate limit exceeded` : `Request #${i + 1}` });
    if (last.status === 429) break;
  }
  await shot('04-gateway-rate-limit.png', page('API Gateway: rate limiting', seen));

  // 5. Swagger UI
  await p.goto(`${BASE}/docs`); await p.waitForSelector('.opblock'); await p.waitForTimeout(500);
  await p.screenshot({ path: path.join(OUT, '05-swagger-ui.png'), fullPage: true }); console.log('saved 05-swagger-ui.png');
  await p.click('#operations-Maps-get_api_maps_nearby .opblock-summary'); await p.waitForTimeout(500);
  const el = await p.$('#operations-Maps-get_api_maps_nearby');
  await el.screenshot({ path: path.join(OUT, '06-swagger-nearby-endpoint.png') }); console.log('saved 06-swagger-nearby-endpoint.png');

  // 6. Map UI
  await p.goto(`${BASE}/map.html`);
  await p.click('#loginBtn'); await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(OUT, '07-map-all-vehicles.png') }); console.log('saved 07-map-all-vehicles.png');
  await p.fill('#radius', '5'); await p.click('#searchBtn'); await p.waitForTimeout(2000);
  await p.screenshot({ path: path.join(OUT, '08-map-nearby-search.png') }); console.log('saved 08-map-nearby-search.png');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
