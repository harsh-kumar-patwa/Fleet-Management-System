'use strict';
const config = require('../../shared/config');
const db = require('../../shared/db');
const { providers } = require('./providers');

let provider = providers[config.geo.provider] || providers.nominatim;

const EARTH_RADIUS_KM = 6371;
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance between two coordinates (Haversine formula). */
function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function isValidCoord(lat, lng) {
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/** Vehicles with a known position inside `radiusKm` of (lat,lng), nearest first. */
function findNearby(lat, lng, radiusKm, { status } = {}) {
  return db
    .find('vehicles', (v) => isValidCoord(v.latitude, v.longitude) && (!status || v.status === status))
    .map((v) => ({ ...v, distanceKm: +haversineKm(lat, lng, v.latitude, v.longitude).toFixed(3) }))
    .filter((v) => v.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

module.exports = {
  haversineKm,
  isValidCoord,
  findNearby,
  geocode: (address) => provider.geocode(address),
  reverseGeocode: (lat, lng) => provider.reverseGeocode(lat, lng),
  getProvider: () => provider,
  /** Swap provider at runtime (used by tests to inject mocks). */
  setProvider: (p) => {
    provider = typeof p === 'string' ? providers[p] : p;
  },
};
