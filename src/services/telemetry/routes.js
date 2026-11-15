'use strict';
const express = require('express');
const db = require('../../shared/db');
const { authenticate, authorize, ROLES } = require('../../shared/auth');
const { asyncHandler } = require('../../shared/service-app');
const { badRequest, notFound, HttpError } = require('../../shared/errors');
const geo = require('../geo/geo');
const notifier = require('../notification/notifier');

const router = express.Router();
router.use(authenticate);

const NUMERIC = { speed: [0, 400], fuelLevel: [0, 100], batteryLevel: [0, 100], engineTemp: [-50, 300], odometer: [0, 1e8], heading: [0, 360] };

/** Vehicle reports GPS position + sensor readings. Stored, vehicle location updated, critical events -> SMS. */
router.post('/', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const errors = [];
  if (!b.vehicleId) errors.push('vehicleId is required');
  if (!geo.isValidCoord(b.latitude, b.longitude)) errors.push('latitude and longitude are required and must be valid numbers');
  for (const [k, [min, max]] of Object.entries(NUMERIC)) {
    if (b[k] !== undefined && (typeof b[k] !== 'number' || b[k] < min || b[k] > max)) errors.push(`${k} must be a number between ${min} and ${max}`);
  }
  if (b.event !== undefined && typeof b.event !== 'string') errors.push('event must be a string');
  if (errors.length) throw badRequest('Validation failed', errors);

  const vehicle = db.findById('vehicles', b.vehicleId);
  if (!vehicle) throw notFound('Vehicle not found');
  if (req.user.role === ROLES.DRIVER && vehicle.assignedDriverId !== req.user.sub) throw new HttpError(403, 'Drivers can only report telemetry for their assigned vehicles');

  const recordedAt = b.recordedAt && !Number.isNaN(Date.parse(b.recordedAt)) ? new Date(b.recordedAt).toISOString() : new Date().toISOString();
  const criticalEvents = notifier.detectCriticalEvents(b);
  const telemetry = db.insert('telemetry', {
    vehicleId: vehicle.id,
    latitude: b.latitude,
    longitude: b.longitude,
    ...Object.fromEntries(Object.keys(NUMERIC).filter((k) => b[k] !== undefined).map((k) => [k, b[k]])),
    event: b.event || null,
    criticalEvents,
    recordedAt,
    reportedBy: req.user.sub,
  });
  db.update('vehicles', vehicle.id, { latitude: b.latitude, longitude: b.longitude, lastLocationAt: recordedAt, lastTelemetryId: telemetry.id });

  const notifications = (await Promise.all(criticalEvents.map((e) => notifier.notifyCriticalEvent(vehicle, e, telemetry)))).flat();
  res.status(201).json({ telemetry, criticalEvents, notifications });
}));

router.get('/vehicle/:vehicleId', authorize(ROLES.ADMIN, ROLES.MANAGER), (req, res) => {
  if (!db.findById('vehicles', req.params.vehicleId)) throw notFound('Vehicle not found');
  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 1000);
  const items = db
    .find('telemetry', (t) => t.vehicleId === req.params.vehicleId)
    .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
    .slice(0, limit);
  res.json({ vehicleId: req.params.vehicleId, count: items.length, telemetry: items });
});

router.get('/vehicle/:vehicleId/latest', (req, res) => {
  const vehicle = db.findById('vehicles', req.params.vehicleId);
  if (!vehicle) throw notFound('Vehicle not found');
  if (req.user.role === ROLES.DRIVER && vehicle.assignedDriverId !== req.user.sub) throw new HttpError(403, 'Forbidden');
  const [latest] = db.find('telemetry', (t) => t.vehicleId === vehicle.id).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  if (!latest) throw notFound('No telemetry for this vehicle yet');
  res.json(latest);
});

router.get('/events', authorize(ROLES.ADMIN, ROLES.MANAGER), (req, res) => {
  const items = db.find('telemetry', (t) => t.criticalEvents?.length).sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  res.json({ count: items.length, events: items });
});

module.exports = router;
