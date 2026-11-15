'use strict';
/**
 * Geocoding providers. Each provider implements:
 *   geocode(address)       -> { latitude, longitude, displayName, provider }
 *   reverseGeocode(lat,lng)-> { address, provider }
 */
const config = require('../../shared/config');
const { HttpError } = require('../../shared/errors');

async function getJson(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
  } catch (e) {
    throw new HttpError(502, `Geolocation provider unreachable: ${e.message}`);
  }
  if (!res.ok) throw new HttpError(502, `Geolocation provider error: HTTP ${res.status}`);
  return res.json();
}

/** OpenStreetMap Nominatim (free, no key; respect 1 req/sec usage policy). */
const nominatim = {
  name: 'openstreetmap',
  async geocode(address) {
    const url = `${config.geo.nominatimUrl}/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
    const data = await getJson(url, { 'User-Agent': config.geo.userAgent });
    if (!data.length) return null;
    return { latitude: +data[0].lat, longitude: +data[0].lon, displayName: data[0].display_name, provider: this.name };
  },
  async reverseGeocode(lat, lng) {
    const url = `${config.geo.nominatimUrl}/reverse?format=json&lat=${lat}&lon=${lng}`;
    const data = await getJson(url, { 'User-Agent': config.geo.userAgent });
    return { address: data.display_name || null, provider: this.name };
  },
};

/** Google Maps Geocoding API (requires GOOGLE_MAPS_API_KEY). */
const google = {
  name: 'google',
  async geocode(address) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${config.geo.googleApiKey}`;
    const data = await getJson(url);
    if (data.status === 'ZERO_RESULTS') return null;
    if (data.status !== 'OK') throw new HttpError(502, `Google geocoding failed: ${data.status}`);
    const r = data.results[0];
    return { latitude: r.geometry.location.lat, longitude: r.geometry.location.lng, displayName: r.formatted_address, provider: this.name };
  },
  async reverseGeocode(lat, lng) {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${config.geo.googleApiKey}`;
    const data = await getJson(url);
    return { address: data.results?.[0]?.formatted_address || null, provider: this.name };
  },
};

/** Offline mock provider - deterministic, used in tests and offline demos. */
const KNOWN = {
  'mg road, bengaluru': [12.9756, 77.6066],
  'koramangala, bengaluru': [12.9352, 77.6245],
  'whitefield, bengaluru': [12.9698, 77.75],
  'electronic city, bengaluru': [12.8456, 77.6603],
  'hebbal, bengaluru': [13.0358, 77.597],
  'connaught place, new delhi': [28.6315, 77.2167],
  'times square, new york': [40.758, -73.9855],
};
const mock = {
  name: 'mock',
  async geocode(address) {
    const key = String(address).trim().toLowerCase();
    const hit = KNOWN[key];
    if (!hit) return null;
    return { latitude: hit[0], longitude: hit[1], displayName: address, provider: this.name };
  },
  async reverseGeocode(lat, lng) {
    let best = null;
    for (const [name, [la, lo]] of Object.entries(KNOWN)) {
      const d = Math.hypot(la - lat, lo - lng);
      if (!best || d < best.d) best = { name, d };
    }
    return { address: best ? `Near ${best.name}` : null, provider: this.name };
  },
};

const providers = { nominatim, openstreetmap: nominatim, google, mock };
module.exports = { providers };
