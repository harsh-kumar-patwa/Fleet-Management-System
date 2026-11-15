'use strict';
const { expect } = require('chai');
const request = require('supertest');
const { apps, resetState, tokens, auth, geo } = require('./helpers');

describe('Flow 6 - Nearby vehicle search using mocked geolocation', () => {
  let t;
  beforeEach(async () => {
    resetState();
    t = await tokens();
  });

  it('haversine distance is accurate (Bengaluru -> Delhi ~1740 km)', () => {
    expect(geo.haversineKm(12.9716, 77.5946, 28.6139, 77.209)).to.be.closeTo(1740, 10);
    expect(geo.haversineKm(10, 10, 10, 10)).to.equal(0);
  });

  it('returns only vehicles within the radius, nearest first', async () => {
    const res = await request(apps.maps).get('/api/maps/nearby').query({ lat: 12.9716, lng: 77.5946, radius: 6 }).set(auth(t.admin)).expect(200);
    expect(res.body.radiusKm).to.equal(6);
    const plates = res.body.vehicles.map((v) => v.plateNumber);
    expect(plates).to.deep.equal(['KA01AB1001', 'KA01AB1003', 'KA01AB1002']);
    expect(res.body.vehicles[0].distanceKm).to.equal(0);
    res.body.vehicles.forEach((v) => expect(v.distanceKm).to.be.at.most(6));
    const d = res.body.vehicles.map((v) => v.distanceKm);
    expect(d).to.deep.equal([...d].sort((a, b) => a - b));
  });

  it('expanding the radius includes farther vehicles', async () => {
    const res = await request(apps.maps).get('/api/maps/nearby').query({ lat: 12.9716, lng: 77.5946, radius: 50 }).set(auth(t.admin)).expect(200);
    expect(res.body.count).to.equal(5);
  });

  it('resolves an address through an injected mock provider', async () => {
    const calls = [];
    geo.setProvider({ name: 'spy', async geocode(a) { calls.push(a); return { latitude: 12.8456, longitude: 77.6603, displayName: 'Electronic City', provider: 'spy' }; } });
    const res = await request(apps.maps).get('/api/maps/nearby').query({ address: 'Electronic City', radius: 2 }).set(auth(t.manager)).expect(200);
    expect(calls).to.deep.equal(['Electronic City']);
    expect(res.body.center.address).to.equal('Electronic City');
    expect(res.body.vehicles.map((v) => v.plateNumber)).to.deep.equal(['KA01AB1005']);
  });

  it('geocode endpoint returns coordinates and 404 for unknown addresses', async () => {
    const ok = await request(apps.maps).get('/api/maps/geocode').query({ address: 'Whitefield, Bengaluru' }).set(auth(t.driver)).expect(200);
    expect(ok.body).to.include({ latitude: 12.9698, longitude: 77.75, provider: 'mock' });
    await request(apps.maps).get('/api/maps/geocode').query({ address: 'Atlantis' }).set(auth(t.driver)).expect(404);
  });

  it('validates coordinates and radius', async () => {
    await request(apps.maps).get('/api/maps/nearby').query({ lat: 999, lng: 0 }).set(auth(t.admin)).expect(400);
    await request(apps.maps).get('/api/maps/nearby').query({ lat: 1, lng: 1, radius: -5 }).set(auth(t.admin)).expect(400);
    await request(apps.maps).get('/api/maps/nearby').query({ lat: 1, lng: 1 }).expect(401);
  });
});
