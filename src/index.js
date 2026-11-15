'use strict';
/**
 * Boots every backend micro-service on its own port, then the API Gateway in front of them.
 * Services share one data store (in-memory, or JSON-file persisted via DB_FILE).
 */
const config = require('./shared/config');
const { seed } = require('./shared/seed');
const { createGateway } = require('./gateway/app');

const SERVICES = {
  '/api/users': ['users', require('./services/user')],
  '/api/vehicles': ['vehicles', require('./services/vehicle')],
  '/api/telemetry': ['telemetry', require('./services/telemetry')],
  '/api/maps': ['maps', require('./services/geo')],
  '/api/notifications': ['notifications', require('./services/notification')],
};

seed();
const host = process.env.SERVICE_HOST || '127.0.0.1';
const routes = {};
for (const [prefix, [key, create]] of Object.entries(SERVICES)) {
  const port = config.ports[key];
  create().listen(port, host, () => console.log(`[${key}-service] listening on http://${host}:${port}${prefix}`));
  routes[prefix] = process.env[`${key.toUpperCase()}_SERVICE_URL`] || `http://${host}:${port}`;
}

createGateway({
  routes,
  apiKeys: config.gateway.apiKeys,
  rateLimit: { windowMs: config.gateway.rateLimitWindowMs, max: config.gateway.rateLimitMax },
  timeoutMs: config.gateway.upstreamTimeoutMs,
}).listen(config.ports.gateway, () => {
  console.log(`\n[api-gateway] http://localhost:${config.ports.gateway}`);
  console.log(`  Swagger UI : http://localhost:${config.ports.gateway}/docs`);
  console.log(`  Map UI     : http://localhost:${config.ports.gateway}/map.html`);
  console.log(`  Geo provider: ${config.geo.provider} | SMS provider: ${config.sms.provider}`);
});
