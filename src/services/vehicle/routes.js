'use strict';
const express = require('express');
const db = require('../../shared/db');
const { authenticate, authorize, ROLES } = require('../../shared/auth');
const { asyncHandler } = require('../../shared/service-app');
const { badRequest, notFound, HttpError } = require('../../shared/errors');
const geo = require('../geo/geo');
const notifier = require('../notification/notifier');

const STATUSES = ['active', 'idle', 'maintenance', 'out_of_service'];
const TYPES = ['car', 'van', 'truck', 'bus', 'motorcycle', 'other'];
const router = express.Router();
router.use(authenticate);

function validate(body, partial = false) {
  const errors = [];
  const req = (k) => !partial && (body[k] === undefined || body[k] === '');
  if (req('vin')) errors.push('vin is required');
  else if (body.vin !== undefined && !/^[A-HJ-NPR-Z0-9]{17}$/i.test(body.vin)) errors.push('vin must be 17 characters (no I, O, Q)');
  if (req('plateNumber')) errors.push('plateNumber is required');
  if (req('make')) errors.push('make is required');
  if (req('model')) errors.push('model is required');
  if (body.year !== undefined && (!Number.isInteger(body.year) || body.year < 1980 || body.year > new Date().getFullYear() + 1)) errors.push('year must be a valid integer');
  if (body.type !== undefined && !TYPES.includes(body.type)) errors.push(`type must be one of ${TYPES.join(', ')}`);
  if (body.status !== undefined && !STATUSES.includes(body.status)) errors.push(`status must be one of ${STATUSES.join(', ')}`);
  const hasLat = body.latitude !== undefined;
  const hasLng = body.longitude !== undefined;
  if (hasLat !== hasLng || ((hasLat || hasLng) && !geo.isValidCoord(body.latitude, body.longitude))) errors.push('latitude and longitude must both be valid coordinates');
  if (errors.length) throw badRequest('Validation failed', errors);
}

const FIELDS = ['vin', 'plateNumber', 'make', 'model', 'year', 'type', 'address', 'latitude', 'longitude', 'assignedDriverId'];
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

/** If an address is provided without coordinates, geocode it via the geolocation provider. */
async function resolveCoordinates(data) {
  if (data.address && data.latitude === undefined) {
    const g = await geo.geocode(data.address);
    if (!g) throw badRequest(`Could not geocode address: ${data.address}`);
    Object.assign(data, { latitude: g.latitude, longitude: g.longitude, geocodedAddress: g.displayName, lastLocationAt: new Date().toISOString() });
  } else if (data.latitude !== undefined) {
    data.lastLocationAt = new Date().toISOString();
  }
  return data;
}

router.post('/', authorize(ROLES.ADMIN, ROLES.MANAGER), asyncHandler(async (req, res) => {
  const body = req.body || {};
  validate(body);
  if (db.findOne('vehicles', (v) => v.vin.toUpperCase() === body.vin.toUpperCase())) throw new HttpError(409, 'A vehicle with this VIN already exists');
  if (body.assignedDriverId && !db.findById('users', body.assignedDriverId)) throw badRequest('assignedDriverId does not reference a user');
  const data = await resolveCoordinates({ type: 'other', status: 'active', assignedDriverId: null, ...pick(body, FIELDS), vin: body.vin.toUpperCase() });
  if (body.status) data.status = body.status;
  const vehicle = db.insert('vehicles', data);
  res.status(201).location(`/api/vehicles/${vehicle.id}`).json(vehicle);
}));

router.get('/', (req, res) => {
  const { status, type } = req.query;
  let vehicles = db.find('vehicles', (v) => (!status || v.status === status) && (!type || v.type === type));
  if (req.user.role === ROLES.DRIVER) vehicles = vehicles.filter((v) => v.assignedDriverId === req.user.sub);
  res.json({ count: vehicles.length, vehicles });
});

router.get('/:id', (req, res) => {
  const v = db.findById('vehicles', req.params.id);
  if (!v) throw notFound('Vehicle not found');
  if (req.user.role === ROLES.DRIVER && v.assignedDriverId !== req.user.sub) throw new HttpError(403, 'Drivers can only view their assigned vehicles');
  res.json(v);
});

router.put('/:id', authorize(ROLES.ADMIN, ROLES.MANAGER), asyncHandler(async (req, res) => {
  const existing = db.findById('vehicles', req.params.id);
  if (!existing) throw notFound('Vehicle not found');
  const body = req.body || {};
  validate(body, true);
  if (body.status !== undefined) throw badRequest('Use PATCH /api/vehicles/{id}/status to change operational status');
  const data = await resolveCoordinates(pick(body, FIELDS.filter((f) => f !== 'vin')));
  res.json(db.update('vehicles', existing.id, data));
}));

/** Operational status update -> triggers SMS notifications. */
router.patch('/:id/status', authorize(ROLES.ADMIN, ROLES.MANAGER), asyncHandler(async (req, res) => {
  const { status, reason } = req.body || {};
  if (!STATUSES.includes(status)) throw badRequest(`status must be one of ${STATUSES.join(', ')}`);
  const existing = db.findById('vehicles', req.params.id);
  if (!existing) throw notFound('Vehicle not found');
  if (existing.status === status) return res.json({ vehicle: existing, changed: false, notifications: [] });
  const vehicle = db.update('vehicles', existing.id, { status, statusReason: reason || null, statusChangedAt: new Date().toISOString() });
  const notifications = await notifier.notifyStatusChange(vehicle, existing.status, status, { reason, changedBy: req.user.sub });
  res.json({ vehicle, changed: true, previousStatus: existing.status, notifications });
}));

router.delete('/:id', authorize(ROLES.ADMIN), (req, res) => {
  if (!db.remove('vehicles', req.params.id)) throw notFound('Vehicle not found');
  res.status(204).end();
});

module.exports = router;
module.exports.STATUSES = STATUSES;
