'use strict';
const { expect } = require('chai');
const request = require('supertest');
const { apps, resetState, tokens, auth, db } = require('./helpers');

describe('Flow 5 - Role-based access control', () => {
  let t;
  let vehicle;
  beforeEach(async () => {
    resetState();
    t = await tokens();
    vehicle = db.findOne('vehicles', (v) => v.plateNumber === 'KA01AB1002');
  });

  it('forbids a driver from deleting a vehicle (403)', async () => {
    const res = await request(apps.vehicles).delete(`/api/vehicles/${vehicle.id}`).set(auth(t.driver)).expect(403);
    expect(res.body.error.message).to.match(/requires role admin/);
    expect(db.findById('vehicles', vehicle.id)).to.exist;
  });

  it('forbids a fleet manager from deleting a vehicle (403)', async () => {
    await request(apps.vehicles).delete(`/api/vehicles/${vehicle.id}`).set(auth(t.manager)).expect(403);
  });

  it('rejects an unauthenticated delete (401)', async () => {
    await request(apps.vehicles).delete(`/api/vehicles/${vehicle.id}`).expect(401);
  });

  it('allows an admin to delete a vehicle (204)', async () => {
    await request(apps.vehicles).delete(`/api/vehicles/${vehicle.id}`).set(auth(t.admin)).expect(204);
    expect(db.findById('vehicles', vehicle.id)).to.be.undefined;
  });

  it('forbids drivers from registering vehicles and reading notifications', async () => {
    await request(apps.vehicles).post('/api/vehicles').set(auth(t.driver)).send({}).expect(403);
    await request(apps.notifications).get('/api/notifications').set(auth(t.driver)).expect(403);
  });

  it('only admins may create privileged accounts', async () => {
    const body = { name: 'X', email: 'x@fleet.com', password: 'secret1', role: 'admin' };
    await request(apps.users).post('/api/users/register').send(body).expect(403);
    await request(apps.users).post('/api/users/register').set(auth(t.manager)).send(body).expect(403);
    const ok = await request(apps.users).post('/api/users/register').set(auth(t.admin)).send(body).expect(201);
    expect(ok.body.role).to.equal('admin');
  });
});
