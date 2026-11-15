'use strict';
const { expect } = require('chai');
const request = require('supertest');
const { apps, resetState, tokens, auth, db, notifier, smsProviders } = require('./helpers');

describe('Flow 4 - Operational status update and notification triggering', () => {
  let t;
  let vehicle;
  beforeEach(async () => {
    resetState();
    t = await tokens();
    vehicle = db.findOne('vehicles', (v) => v.plateNumber === 'KA01AB1001'); // has assigned driver
  });

  it('updates status and SMSes admin, fleet manager and the assigned driver', async () => {
    const res = await request(apps.vehicles).patch(`/api/vehicles/${vehicle.id}/status`).set(auth(t.manager))
      .send({ status: 'maintenance', reason: 'Brake service' }).expect(200);
    expect(res.body).to.include({ changed: true, previousStatus: 'active' });
    expect(res.body.vehicle.status).to.equal('maintenance');
    expect(res.body.notifications).to.have.lengthOf(3);
    expect(res.body.notifications.map((n) => n.to)).to.have.members(['+15551230001', '+15551230002', '+15551230003']);
    res.body.notifications.forEach((n) => {
      expect(n).to.include({ status: 'sent', type: 'status_change', vehicleId: vehicle.id });
      expect(n.message).to.contain('active -> maintenance (Brake service)');
    });
    expect(smsProviders.stub.outbox).to.have.lengthOf(3);
  });

  it('records notifications and exposes them through the notification service', async () => {
    await request(apps.vehicles).patch(`/api/vehicles/${vehicle.id}/status`).set(auth(t.admin)).send({ status: 'idle' }).expect(200);
    const list = await request(apps.notifications).get(`/api/notifications?vehicleId=${vehicle.id}&type=status_change`).set(auth(t.admin)).expect(200);
    expect(list.body.count).to.equal(3);
    const stats = await request(apps.notifications).get('/api/notifications/stats').set(auth(t.manager)).expect(200);
    expect(stats.body.byStatus).to.deep.equal({ sent: 3 });
  });

  it('stores status "failed" when the SMS provider fails, and can retry', async () => {
    let calls = 0;
    notifier.setProvider({ name: 'flaky', async send() { calls += 1; if (calls <= 3) throw new Error('provider down'); return { providerMessageId: 'SM1' }; } });
    const res = await request(apps.vehicles).patch(`/api/vehicles/${vehicle.id}/status`).set(auth(t.admin)).send({ status: 'out_of_service' }).expect(200);
    expect(res.body.notifications.every((n) => n.status === 'failed' && n.error === 'provider down')).to.equal(true);
    const failed = await request(apps.notifications).get('/api/notifications?status=failed').set(auth(t.admin)).expect(200);
    expect(failed.body.count).to.equal(3);
    const retried = await request(apps.notifications).post(`/api/notifications/${failed.body.notifications[0].id}/retry`).set(auth(t.admin)).expect(200);
    expect(retried.body).to.include({ status: 'sent', attempts: 2, providerMessageId: 'SM1' });
  });

  it('simulated carrier failure for 0000 numbers via manual SMS', async () => {
    const res = await request(apps.notifications).post('/api/notifications/sms').set(auth(t.admin)).send({ to: '+15550000000', message: 'hi' }).expect(502);
    expect(res.body.status).to.equal('failed');
  });

  it('does not notify when status is unchanged, and rejects invalid statuses', async () => {
    const same = await request(apps.vehicles).patch(`/api/vehicles/${vehicle.id}/status`).set(auth(t.admin)).send({ status: 'active' }).expect(200);
    expect(same.body).to.include({ changed: false });
    expect(same.body.notifications).to.be.empty;
    await request(apps.vehicles).patch(`/api/vehicles/${vehicle.id}/status`).set(auth(t.admin)).send({ status: 'flying' }).expect(400);
  });

  it('drivers cannot change vehicle status', async () => {
    await request(apps.vehicles).patch(`/api/vehicles/${vehicle.id}/status`).set(auth(t.driver)).send({ status: 'idle' }).expect(403);
  });
});
