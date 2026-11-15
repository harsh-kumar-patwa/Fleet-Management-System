'use strict';
const { expect } = require('chai');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const config = require('../src/shared/config');
const { apps, resetState, login, auth } = require('./helpers');

describe('Flow 1 - User login and JWT token verification', () => {
  beforeEach(resetState);

  it('logs in with valid credentials and returns a signed JWT with role claims', async () => {
    const res = await request(apps.users).post('/api/users/login').send({ email: 'admin@fleet.com', password: 'admin123' }).expect(200);
    expect(res.body).to.include.keys('token', 'tokenType', 'user');
    expect(res.body.tokenType).to.equal('Bearer');
    expect(res.body.user).to.not.have.property('passwordHash');
    const payload = jwt.verify(res.body.token, config.jwtSecret);
    expect(payload).to.include({ email: 'admin@fleet.com', role: 'admin' });
    expect(payload.exp).to.be.greaterThan(payload.iat);
  });

  it('rejects a wrong password with 401', async () => {
    const res = await request(apps.users).post('/api/users/login').send({ email: 'admin@fleet.com', password: 'nope' }).expect(401);
    expect(res.body.error.message).to.match(/invalid email or password/i);
  });

  it('rejects a login without credentials with 400', async () => {
    await request(apps.users).post('/api/users/login').send({}).expect(400);
  });

  it('verifies a valid token via /verify', async () => {
    const token = await login('driver@fleet.com', 'driver123');
    const res = await request(apps.users).post('/api/users/verify').send({ token }).expect(200);
    expect(res.body.valid).to.equal(true);
    expect(res.body.payload.role).to.equal('driver');
  });

  it('flags tampered and expired tokens as invalid', async () => {
    const forged = jwt.sign({ sub: 'x', role: 'admin' }, 'wrong-secret');
    const r1 = await request(apps.users).post('/api/users/verify').send({ token: forged }).expect(401);
    expect(r1.body.valid).to.equal(false);
    const expired = jwt.sign({ sub: 'x', role: 'admin', exp: Math.floor(Date.now() / 1000) - 10 }, config.jwtSecret);
    const r2 = await request(apps.users).get('/api/users/me').set(auth(expired)).expect(401);
    expect(r2.body.error.message).to.equal('Token expired');
  });

  it('allows access to a protected route with the token and denies it without', async () => {
    const token = await login('manager@fleet.com', 'manager123');
    const me = await request(apps.users).get('/api/users/me').set(auth(token)).expect(200);
    expect(me.body.email).to.equal('manager@fleet.com');
    await request(apps.users).get('/api/users/me').expect(401);
  });
});
