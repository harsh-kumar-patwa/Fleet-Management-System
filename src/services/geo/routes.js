'use strict';
const express = require('express');
const db = require('../../shared/db');
const { authenticate } = require('../../shared/auth');
const { asyncHandler } = require('../../shared/service-app');
const { badRequest, notFound } = require('../../shared/errors');
const geo = require('./geo');

const router = express.Router();
router.use(authenticate);

router.get('/geocode', asyncHandler(async (req, res) => {
  const { address } = req.query;
  if (!address) throw badRequest('Query parameter "address" is required');
  const result = await geo.geocode(address);
  if (!result) throw notFound(`Address not found: ${address}`);
  res.json(result);
}));

router.get('/reverse', asyncHandler(async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lng = parseFloat(req.query.lng);
  if (!geo.isValidCoord(lat, lng)) throw badRequest('Valid "lat" and "lng" query parameters are required');
  res.json({ latitude: lat, longitude: lng, ...(await geo.reverseGeocode(lat, lng)) });
}));

router.get('/nearby', asyncHandler(async (req, res) => {
  let lat = parseFloat(req.query.lat);
  let lng = parseFloat(req.query.lng);
  const radiusKm = req.query.radius === undefined ? 5 : parseFloat(req.query.radius);
  let resolvedAddress;
  if (req.query.address) {
    const g = await geo.geocode(req.query.address);
    if (!g) throw notFound(`Address not found: ${req.query.address}`);
    ({ latitude: lat, longitude: lng } = g);
    resolvedAddress = g.displayName;
  }
  if (!geo.isValidCoord(lat, lng)) throw badRequest('Provide valid "lat" and "lng" or an "address"');
  if (!Number.isFinite(radiusKm) || radiusKm <= 0 || radiusKm > 1000) throw badRequest('"radius" must be a number of km between 0 and 1000');
  const vehicles = geo.findNearby(lat, lng, radiusKm, { status: req.query.status });
  res.json({ center: { latitude: lat, longitude: lng, ...(resolvedAddress && { address: resolvedAddress }) }, radiusKm, count: vehicles.length, vehicles });
}));

router.get('/vehicles', (req, res) => {
  const vehicles = db.find('vehicles', (v) => geo.isValidCoord(v.latitude, v.longitude));
  res.json({
    type: 'FeatureCollection',
    features: vehicles.map((v) => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [v.longitude, v.latitude] },
      properties: { id: v.id, plateNumber: v.plateNumber, status: v.status, make: v.make, model: v.model, lastLocationAt: v.lastLocationAt },
    })),
  });
});

router.get('/distance', (req, res) => {
  const [lat1, lng1, lat2, lng2] = ['lat1', 'lng1', 'lat2', 'lng2'].map((k) => parseFloat(req.query[k]));
  if (!geo.isValidCoord(lat1, lng1) || !geo.isValidCoord(lat2, lng2)) throw badRequest('lat1,lng1,lat2,lng2 are required');
  res.json({ distanceKm: +geo.haversineKm(lat1, lng1, lat2, lng2).toFixed(3) });
});

module.exports = router;
