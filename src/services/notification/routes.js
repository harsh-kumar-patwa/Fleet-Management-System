'use strict';
const express = require('express');
const db = require('../../shared/db');
const { authenticate, authorize, ROLES } = require('../../shared/auth');
const { asyncHandler } = require('../../shared/service-app');
const { badRequest, notFound } = require('../../shared/errors');
const notifier = require('./notifier');

const router = express.Router();
router.use(authenticate, authorize(ROLES.ADMIN, ROLES.MANAGER));

router.get('/', (req, res) => {
  const { status, type, vehicleId } = req.query;
  const limit = Math.min(parseInt(req.query.limit, 10) || 100, 500);
  const items = db
    .find('notifications', (n) => (!status || n.status === status) && (!type || n.type === type) && (!vehicleId || n.vehicleId === vehicleId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  res.json({ count: items.length, notifications: items });
});

router.get('/stats', (req, res) => {
  const all = db.all('notifications');
  const by = (k) => all.reduce((acc, n) => ({ ...acc, [n[k]]: (acc[n[k]] || 0) + 1 }), {});
  res.json({ total: all.length, byStatus: by('status'), byType: by('type'), provider: notifier.getProvider().name });
});

router.get('/:id', (req, res) => {
  const n = db.findById('notifications', req.params.id);
  if (!n) throw notFound('Notification not found');
  res.json(n);
});

router.post('/sms', authorize(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const { to, message, vehicleId } = req.body || {};
  if (!to || !message) throw badRequest('"to" and "message" are required');
  const n = await notifier.sendSms({ to, message, type: 'manual', vehicleId, recipientId: null, meta: { sentBy: req.user.sub } });
  res.status(n.status === 'sent' ? 201 : 502).json(n);
}));

router.post('/:id/retry', authorize(ROLES.ADMIN), asyncHandler(async (req, res) => {
  const n = await notifier.retry(req.params.id);
  if (!n) throw notFound('Notification not found');
  res.json(n);
}));

module.exports = router;
