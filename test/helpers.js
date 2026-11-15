'use strict';
process.env.NODE_ENV = 'test';
const http = require('http');
const request = require('supertest');
const db = require('../src/shared/db');
const { seed } = require('../src/shared/seed');
const geo = require('../src/services/geo/geo');
const notifier = require('../src/services/notification/notifier');
const { providers: geoProviders } = require('../src/services/geo/providers');
const { providers: smsProviders } = require('../src/services/notification/sms-providers');

const apps = {
  users: require('../src/services/user')(),
  vehicles: require('../src/services/vehicle')(),
  telemetry: require('../src/services/telemetry')(),
  maps: require('../src/services/geo')(),
  notifications: require('../src/services/notification')(),
};

/** Fresh seeded DB, mocked geolocation, stub SMS. */
function resetState() {
  db.reset();
  seed();
  geo.setProvider(geoProviders.mock);
  smsProviders.stub.outbox.length = 0;
  notifier.setProvider(smsProviders.stub);
}

async function login(email, password) {
  const res = await request(apps.users).post('/api/users/login').send({ email, password }).expect(200);
  return res.body.token;
}

const tokens = async () => ({
  admin: await login('admin@fleet.com', 'admin123'),
  manager: await login('manager@fleet.com', 'manager123'),
  driver: await login('driver@fleet.com', 'driver123'),
});

/** Start an express app on an ephemeral port; returns { url, close }. */
function listen(app) {
  return new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://127.0.0.1:${port}`, port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

const auth = (t) => ({ Authorization: `Bearer ${t}` });

module.exports = { apps, resetState, login, tokens, listen, auth, db, geo, notifier, smsProviders };
