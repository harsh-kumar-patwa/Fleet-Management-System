'use strict';
const { expect } = require('chai');
const request = require('supertest');
const { apps, resetState, tokens, auth } = require('./helpers');

const NEW_VEHICLE = { vin: '1HGCM82633A004352', plateNumber: 'KA05MN2024', make: 'Tata', model: 'Ace', year: 2023, type: 'truck', latitude: 12.9716, longitude: 77.5946 };

describe('Flow 2 - Vehicle registration and retrieval', () => {
  let t;
  beforeEach(async () => {
    resetState();
    t = await tokens();
  });

  it('registers a vehicle and retrieves it by id', async () => {
    const created = await request(apps.vehicles).post('/api/vehicles').set(auth(t.admin)).send(NEW_VEHICLE).expect(201);
    expect(created.body).to.include({ vin: NEW_VEHICLE.vin, plateNumber: 'KA05MN2024', status: 'active' });
    expect(created.body.id).to.be.a('string');
    expect(created.headers.location).to.equal(`/api/vehicles/${created.body.id}`);

    const fetched = await request(apps.vehicles).get(`/api/vehicles/${created.body.id}`).set(auth(t.manager)).expect(200);
    expect(fetched.body).to.deep.equal(created.body);

    const list = await request(apps.vehicles).get('/api/vehicles').set(auth(t.admin)).expect(200);
    expect(list.body.count).to.equal(6);
    expect(list.body.vehicles.map((v) => v.id)).to.include(created.body.id);
  });

  it('geocodes the address when no coordinates are supplied (mocked geolocation)', async () => {
    const { latitude, longitude, ...rest } = NEW_VEHICLE;
    const res = await request(apps.vehicles).post('/api/vehicles').set(auth(t.manager)).send({ ...rest, address: 'MG Road, Bengaluru' }).expect(201);
    expect(res.body.latitude).to.be.closeTo(12.9756, 1e-6);
    expect(res.body.longitude).to.be.closeTo(77.6066, 1e-6);
  });

  it('returns 400 with details for invalid input', async () => {
    const res = await request(apps.vehicles).post('/api/vehicles').set(auth(t.admin)).send({ vin: 'short', latitude: 200 }).expect(400);
    expect(res.body.error.details).to.be.an('array').that.is.not.empty;
    expect(res.body.error.details.join(' ')).to.match(/vin/).and.match(/plateNumber/);
  });

  it('rejects duplicate VINs with 409', async () => {
    await request(apps.vehicles).post('/api/vehicles').set(auth(t.admin)).send(NEW_VEHICLE).expect(201);
    await request(apps.vehicles).post('/api/vehicles').set(auth(t.admin)).send({ ...NEW_VEHICLE, plateNumber: 'X' }).expect(409);
  });

  it('returns 404 for an unknown vehicle', async () => {
    await request(apps.vehicles).get('/api/vehicles/00000000-0000-0000-0000-000000000000').set(auth(t.admin)).expect(404);
  });

  it('drivers only see their assigned vehicles', async () => {
    const res = await request(apps.vehicles).get('/api/vehicles').set(auth(t.driver)).expect(200);
    expect(res.body.count).to.equal(1);
    expect(res.body.vehicles[0].plateNumber).to.equal('KA01AB1001');
  });
});
