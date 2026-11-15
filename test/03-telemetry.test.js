'use strict';
const { expect } = require('chai');
const request = require('supertest');
const { apps, resetState, tokens, auth, db, smsProviders } = require('./helpers');

describe('Flow 3 - Vehicle telemetry submission and storage', () => {
  let t;
  let vehicle;
  beforeEach(async () => {
    resetState();
    t = await tokens();
    vehicle = db.findOne('vehicles', (v) => v.plateNumber === 'KA01AB1001');
  });

  it('stores telemetry and updates the vehicle GPS position', async () => {
    const payload = { vehicleId: vehicle.id, latitude: 12.98, longitude: 77.6, speed: 55, fuelLevel: 70, batteryLevel: 90, engineTemp: 85 };
    const res = await request(apps.telemetry).post('/api/telemetry').set(auth(t.driver)).send(payload).expect(201);
    expect(res.body.telemetry).to.include({ vehicleId: vehicle.id, latitude: 12.98, longitude: 77.6, speed: 55 });
    expect(res.body.criticalEvents).to.deep.equal([]);
    expect(res.body.notifications).to.deep.equal([]);

    const stored = db.findById('telemetry', res.body.telemetry.id);
    expect(stored).to.include({ vehicleId: vehicle.id, fuelLevel: 70 });
    const v = db.findById('vehicles', vehicle.id);
    expect(v).to.include({ latitude: 12.98, longitude: 77.6, lastTelemetryId: stored.id });

    const history = await request(apps.telemetry).get(`/api/telemetry/vehicle/${vehicle.id}`).set(auth(t.manager)).expect(200);
    expect(history.body.count).to.equal(1);
    const latest = await request(apps.telemetry).get(`/api/telemetry/vehicle/${vehicle.id}/latest`).set(auth(t.admin)).expect(200);
    expect(latest.body.id).to.equal(stored.id);
  });

  it('sends SMS to admins on a critical engine_fault event and records status', async () => {
    const res = await request(apps.telemetry).post('/api/telemetry').set(auth(t.admin))
      .send({ vehicleId: vehicle.id, latitude: 12.97, longitude: 77.59, event: 'engine_fault' }).expect(201);
    expect(res.body.criticalEvents).to.deep.equal(['engine_fault']);
    expect(res.body.notifications).to.have.lengthOf(1); // one admin seeded
    expect(res.body.notifications[0]).to.include({ status: 'sent', type: 'critical_event', to: '+15551230001' });
    expect(smsProviders.stub.outbox[0].body).to.match(/ENGINE FAULT/).and.match(/KA01AB1001/);
  });

  it('derives low_battery from sensor thresholds', async () => {
    const res = await request(apps.telemetry).post('/api/telemetry').set(auth(t.admin))
      .send({ vehicleId: vehicle.id, latitude: 12.97, longitude: 77.59, batteryLevel: 8 }).expect(201);
    expect(res.body.criticalEvents).to.include('low_battery');
    expect(db.find('notifications', (n) => n.meta.event === 'low_battery')).to.have.lengthOf(1);
  });

  it('validates the payload (400) and the vehicle (404)', async () => {
    const bad = await request(apps.telemetry).post('/api/telemetry').set(auth(t.admin)).send({ vehicleId: vehicle.id, latitude: 'x', speed: -4 }).expect(400);
    expect(bad.body.error.details).to.have.length.greaterThan(1);
    await request(apps.telemetry).post('/api/telemetry').set(auth(t.admin)).send({ vehicleId: 'nope', latitude: 1, longitude: 1 }).expect(404);
  });

  it('prevents a driver from reporting for a vehicle not assigned to them', async () => {
    const other = db.findOne('vehicles', (v) => v.plateNumber === 'KA01AB1002');
    await request(apps.telemetry).post('/api/telemetry').set(auth(t.driver)).send({ vehicleId: other.id, latitude: 1, longitude: 1 }).expect(403);
  });
});
