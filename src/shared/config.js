'use strict';
const env = process.env;
const int = (v, d) => (v === undefined || v === '' ? d : parseInt(v, 10));

module.exports = {
  env: env.NODE_ENV || 'development',
  jwtSecret: env.JWT_SECRET || 'dev-only-change-me',
  jwtExpiresIn: env.JWT_EXPIRES_IN || '8h',
  dbFile: env.NODE_ENV === 'test' ? null : env.DB_FILE || null,
  ports: {
    gateway: int(env.PORT || env.GATEWAY_PORT, 3000),
    users: int(env.USER_SERVICE_PORT, 4001),
    vehicles: int(env.VEHICLE_SERVICE_PORT, 4002),
    telemetry: int(env.TELEMETRY_SERVICE_PORT, 4003),
    maps: int(env.GEO_SERVICE_PORT, 4004),
    notifications: int(env.NOTIFICATION_SERVICE_PORT, 4005),
  },
  gateway: {
    apiKeys: (env.API_KEYS || 'fleet-demo-key-123,fleet-admin-key-456').split(',').map((s) => s.trim()).filter(Boolean),
    rateLimitWindowMs: int(env.RATE_LIMIT_WINDOW_MS, 60_000),
    rateLimitMax: int(env.RATE_LIMIT_MAX, 100),
    upstreamTimeoutMs: int(env.UPSTREAM_TIMEOUT_MS, 10_000),
  },
  geo: {
    provider: env.GEO_PROVIDER || (env.GOOGLE_MAPS_API_KEY ? 'google' : 'nominatim'),
    googleApiKey: env.GOOGLE_MAPS_API_KEY || null,
    nominatimUrl: env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
    userAgent: env.NOMINATIM_USER_AGENT || 'fleet-management-system/1.0',
  },
  sms: {
    provider: env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN ? 'twilio' : 'stub',
    twilioSid: env.TWILIO_ACCOUNT_SID,
    twilioToken: env.TWILIO_AUTH_TOKEN,
    twilioFrom: env.TWILIO_FROM_NUMBER || '+15005550006', // Twilio magic test number
  },
};
