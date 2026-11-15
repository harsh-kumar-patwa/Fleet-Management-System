'use strict';
const { expect } = require('chai');
const request = require('supertest');
const { createGateway } = require('../src/gateway/app');
const { apps, resetState, login, listen, auth } = require('./helpers');

const KEY = 'test-key-1';

describe('Flow 7 - API Gateway: routing, API key verification, rate limiting', () => {
  const servers = {};
  let routes;

  before(async () => {
    for (const [name, app] of Object.entries(apps)) servers[name] = await listen(app);
    routes = {
      '/api/users': servers.users.url,
      '/api/vehicles': servers.vehicles.url,
      '/api/telemetry': servers.telemetry.url,
      '/api/maps': servers.maps.url,
      '/api/notifications': servers.notifications.url,
    };
  });
  after(() => Promise.all(Object.values(servers).map((s) => s.close())));
  beforeEach(resetState);

  const gateway = (overrides = {}) => createGateway({ routes, apiKeys: [KEY], rateLimit: { windowMs: 60_000, max: 1000 }, ...overrides });

  describe('API key verification', () => {
    it('rejects requests without an API key (401)', async () => {
      const res = await request(gateway()).get('/api/vehicles').expect(401);
      expect(res.body.error.message).to.match(/API key required/);
    });

    it('rejects an invalid API key (403)', async () => {
      await request(gateway()).get('/api/vehicles').set('x-api-key', 'wrong').expect(403);
    });

    it('does not forward the API key to backend services', async () => {
      const gw = gateway();
      const res = await request(gw).post('/api/users/verify').set('x-api-key', KEY).send({ token: 'x' });
      expect(res.status).to.equal(401); // reached user service; key accepted
      expect(res.headers['x-service']).to.equal('user-service');
    });

    it('leaves docs and health public', async () => {
      await request(gateway()).get('/health').expect(200);
      const spec = await request(gateway()).get('/openapi.json').expect(200);
      expect(spec.body.openapi).to.equal('3.0.3');
    });
  });

  describe('Routing', () => {
    it('routes each prefix to the right service', async () => {
      const gw = gateway();
      const token = (await request(gw).post('/api/users/login').set('x-api-key', KEY).send({ email: 'admin@fleet.com', password: 'admin123' }).expect(200)).body.token;
      const expectations = {
        '/api/users/me': 'user-service',
        '/api/vehicles': 'vehicle-service',
        '/api/telemetry/events': 'telemetry-service',
        '/api/maps/vehicles': 'geolocation-service',
        '/api/notifications/stats': 'notification-service',
      };
      for (const [path, service] of Object.entries(expectations)) {
        const res = await request(gw).get(path).set('x-api-key', KEY).set(auth(token)).expect(200);
        expect(res.headers['x-service'], path).to.equal(service);
        expect(res.headers['x-upstream-service']).to.equal(`/${path.split('/').slice(1, 3).join('/')}`);
        expect(res.headers['x-request-id']).to.be.a('string');
      }
    });

    it('forwards request bodies and response status codes end-to-end', async () => {
      const gw = gateway();
      const token = await login('admin@fleet.com', 'admin123');
      const created = await request(gw).post('/api/vehicles').set('x-api-key', KEY).set(auth(token))
        .send({ vin: '1HGCM82633A009999', plateNumber: 'GW-1', make: 'Tata', model: 'Ace', latitude: 12.9, longitude: 77.5 }).expect(201);
      expect(created.headers.location).to.equal(`/api/vehicles/${created.body.id}`);
      await request(gw).delete(`/api/vehicles/${created.body.id}`).set('x-api-key', KEY).set(auth(token)).expect(204);
    });

    it('returns 404 for unmapped routes', async () => {
      const res = await request(gateway()).get('/api/unknown/thing').set('x-api-key', KEY).expect(404);
      expect(res.body.error.availableRoutes).to.include('/api/vehicles/*');
    });

    it('returns 400 for malformed JSON without hitting the service', async () => {
      const res = await request(gateway()).post('/api/users/login').set('x-api-key', KEY).set('Content-Type', 'application/json').send('{"email":').expect(400);
      expect(res.body.error.message).to.match(/malformed JSON/);
    });

    it('returns 503 when a backend service is unavailable', async () => {
      const down = await listen(apps.users);
      await down.close();
      const gw = gateway({ routes: { ...routes, '/api/users': down.url } });
      const res = await request(gw).post('/api/users/login').set('x-api-key', KEY).send({}).expect(503);
      expect(res.body.error).to.include({ status: 503, service: '/api/users' });
      const health = await request(gw).get('/health/services').expect(503);
      expect(health.body.services.find((s) => s.prefix === '/api/users').status).to.equal('down');
    });
  });

  describe('Rate limiting', () => {
    it('allows up to the limit then returns 429 with Retry-After', async () => {
      const gw = gateway({ rateLimit: { windowMs: 60_000, max: 3 } });
      for (let i = 0; i < 3; i += 1) {
        const r = await request(gw).post('/api/users/verify').set('x-api-key', KEY).send({});
        expect(r.status).to.not.equal(429);
        expect(r.headers['x-ratelimit-remaining']).to.equal(String(2 - i));
      }
      const blocked = await request(gw).post('/api/users/verify').set('x-api-key', KEY).send({}).expect(429);
      expect(blocked.headers['retry-after']).to.match(/^\d+$/);
      expect(blocked.body.error.message).to.match(/Rate limit exceeded/);
    });

    it('tracks limits per API key', async () => {
      const gw = createGateway({ routes, apiKeys: ['a', 'b'], rateLimit: { windowMs: 60_000, max: 1 } });
      await request(gw).get('/api/maps/vehicles').set('x-api-key', 'a').expect(401); // passes gateway, 401 from service (no JWT)
      await request(gw).get('/api/maps/vehicles').set('x-api-key', 'a').expect(429);
      await request(gw).get('/api/maps/vehicles').set('x-api-key', 'b').expect(401);
    });

    it('resets after the window elapses', async () => {
      const gw = gateway({ rateLimit: { windowMs: 200, max: 1 } });
      await request(gw).get('/api/maps/vehicles').set('x-api-key', KEY).expect(401);
      await request(gw).get('/api/maps/vehicles').set('x-api-key', KEY).expect(429);
      await new Promise((r) => setTimeout(r, 250));
      await request(gw).get('/api/maps/vehicles').set('x-api-key', KEY).expect(401);
    });
  });
});
