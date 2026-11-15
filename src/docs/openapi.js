'use strict';
/* OpenAPI 3.0 specification for the Fleet Management System (served via Swagger UI at /docs). */

const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const json = (schema, example) => ({ 'application/json': { schema, ...(example !== undefined && { example }) } });
const err = (status, message, extra) => ({ description: message, content: json(ref('Error'), { error: { status, message, ...extra } }) });

const E = {
  400: err(400, 'Validation failed', { details: ['vin is required'] }),
  401: err(401, 'Missing or malformed Authorization header'),
  403: err(403, 'Forbidden: requires role admin'),
  404: err(404, 'Resource not found'),
  409: err(409, 'Conflict - resource already exists'),
  429: err(429, 'Rate limit exceeded: max 100 requests per 60s. Retry in 42s.'),
  502: err(502, 'Upstream provider (geolocation / SMS) failed'),
  503: err(503, 'Service unavailable: /api/vehicles could not be reached', { service: '/api/vehicles' }),
};
const gatewayErrors = { 401: { description: 'Missing JWT, or missing API key at the gateway', content: json(ref('Error'), { error: { status: 401, message: 'API key required. Send it in the "x-api-key" header.' } }) }, 429: E[429], 503: E[503] };
const secured = [{ ApiKeyAuth: [], BearerAuth: [] }];
const idParam = (name = 'id', d = 'Resource UUID') => ({ name, in: 'path', required: true, description: d, schema: { type: 'string', format: 'uuid' }, example: '3fa85f64-5717-4562-b3fc-2c963f66afa6' });
const roles = (...r) => `\n\n**Roles:** ${r.map((x) => `\`${x}\``).join(', ')}`;

const vehicleExample = {
  id: '3fa85f64-5717-4562-b3fc-2c963f66afa6', vin: '1HGCM82633A004352', plateNumber: 'KA05MN2024', make: 'Tata', model: 'Ace', year: 2023, type: 'truck',
  status: 'active', address: 'MG Road, Bengaluru', latitude: 12.9756, longitude: 77.6066, assignedDriverId: null,
  lastLocationAt: '2026-11-15T10:00:00.000Z', createdAt: '2026-11-15T10:00:00.000Z', updatedAt: '2026-11-15T10:00:00.000Z',
};
const smsExample = {
  id: '9b2f1c7e-1e2d-4d0a-a0c4-6f3e1c2b9a11', channel: 'sms', provider: 'sms-stub', to: '+15551230001', recipientId: 'b7e0c1d2-...', type: 'critical_event',
  vehicleId: vehicleExample.id, message: '[FLEET ALERT] ENGINE FAULT reported by vehicle KA05MN2024 at (12.97560, 77.60660). Immediate attention required.',
  status: 'sent', attempts: 1, providerMessageId: 'SM5f0c2b...', error: null, meta: { event: 'engine_fault' }, createdAt: '2026-11-15T10:05:00.000Z', sentAt: '2026-11-15T10:05:00.010Z',
};

module.exports = {
  openapi: '3.0.3',
  info: {
    title: 'Fleet Management System API',
    version: '1.0.0',
    description: [
      'REST API for monitoring vehicles, telemetry, geolocation and SMS notifications.',
      '',
      'All `/api/*` traffic goes through the **API Gateway**, which:',
      '* verifies the **API key** (`x-api-key` header) — `401` if missing, `403` if invalid;',
      '* applies **rate limiting** per API key (default 100 req/min) — `429` with `Retry-After` when exceeded;',
      '* forwards the request to the right backend service and returns `503` if that service is down, `400` for malformed JSON.',
      '',
      'Most endpoints additionally require a **JWT** (`Authorization: Bearer <token>`) obtained from `POST /api/users/login`.',
      'Role-based access control uses three roles: `admin`, `fleet_manager`, `driver`.',
      '',
      '**Demo credentials** — API key `fleet-demo-key-123`; users `admin@fleet.com / admin123`, `manager@fleet.com / manager123`, `driver@fleet.com / driver123`.',
    ].join('\n'),
  },
  servers: [{ url: '/', description: 'API Gateway (this server)' }, { url: 'http://localhost:3000', description: 'Local gateway' }],
  tags: [
    { name: 'Gateway', description: 'Gateway health. Route table: `/api/users/*` → User Service, `/api/vehicles/*` → Vehicle Service, `/api/telemetry/*` → Telemetry Service, `/api/maps/*` → Geolocation Service, `/api/notifications/*` → Notification Service.' },
    { name: 'Users', description: 'Authentication (JWT) and user management — User Service' },
    { name: 'Vehicles', description: 'Vehicle registry and operational status — Vehicle/Fleet Service' },
    { name: 'Telemetry', description: 'GPS + sensor data from vehicles — Telemetry Service' },
    { name: 'Maps', description: 'Geocoding (OpenStreetMap Nominatim / Google Maps) and radius search — Geolocation Service' },
    { name: 'Notifications', description: 'SMS notifications (Twilio sandbox or local stub) with delivery status — Notification Service' },
  ],
  security: secured,
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key', description: 'Gateway API key, e.g. `fleet-demo-key-123`' },
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'JWT from `POST /api/users/login`. Payload contains `sub`, `email`, `role`, `name`.' },
    },
    schemas: {
      Error: {
        type: 'object', required: ['error'],
        properties: { error: { type: 'object', required: ['status', 'message'], properties: { status: { type: 'integer' }, message: { type: 'string' }, details: { type: 'array', items: { type: 'string' } } } } },
      },
      Role: { type: 'string', enum: ['admin', 'fleet_manager', 'driver'] },
      User: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, email: { type: 'string', format: 'email' }, phone: { type: 'string', nullable: true, example: '+15551230001' }, role: ref('Role'), createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } },
      },
      LoginRequest: { type: 'object', required: ['email', 'password'], properties: { email: { type: 'string', format: 'email', example: 'admin@fleet.com' }, password: { type: 'string', example: 'admin123' } } },
      LoginResponse: { type: 'object', properties: { token: { type: 'string' }, tokenType: { type: 'string', example: 'Bearer' }, expiresIn: { type: 'string', example: '8h' }, user: ref('User') } },
      RegisterRequest: {
        type: 'object', required: ['name', 'email', 'password'],
        properties: { name: { type: 'string', example: 'New Driver' }, email: { type: 'string', format: 'email', example: 'new.driver@fleet.com' }, password: { type: 'string', minLength: 6, example: 'secret123' }, phone: { type: 'string', description: 'E.164', example: '+15551239999' }, role: { allOf: [ref('Role')], default: 'driver', description: 'Only admins may create non-driver accounts' } },
      },
      VehicleStatus: { type: 'string', enum: ['active', 'idle', 'maintenance', 'out_of_service'] },
      VehicleInput: {
        type: 'object', required: ['vin', 'plateNumber', 'make', 'model'],
        description: 'Supply either `latitude`+`longitude` or an `address` — an address without coordinates is geocoded automatically.',
        properties: {
          vin: { type: 'string', minLength: 17, maxLength: 17, example: '1HGCM82633A004352' }, plateNumber: { type: 'string', example: 'KA05MN2024' }, make: { type: 'string', example: 'Tata' }, model: { type: 'string', example: 'Ace' },
          year: { type: 'integer', example: 2023 }, type: { type: 'string', enum: ['car', 'van', 'truck', 'bus', 'motorcycle', 'other'], example: 'truck' }, status: ref('VehicleStatus'),
          address: { type: 'string', example: 'MG Road, Bengaluru' }, latitude: { type: 'number', minimum: -90, maximum: 90 }, longitude: { type: 'number', minimum: -180, maximum: 180 }, assignedDriverId: { type: 'string', format: 'uuid', nullable: true },
        },
      },
      Vehicle: {
        allOf: [ref('VehicleInput'), {
          type: 'object',
          properties: { id: { type: 'string', format: 'uuid' }, status: ref('VehicleStatus'), geocodedAddress: { type: 'string' }, lastLocationAt: { type: 'string', format: 'date-time' }, statusReason: { type: 'string', nullable: true }, createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } },
        }],
      },
      StatusUpdate: { type: 'object', required: ['status'], properties: { status: ref('VehicleStatus'), reason: { type: 'string', example: 'Scheduled brake service' } } },
      TelemetryInput: {
        type: 'object', required: ['vehicleId', 'latitude', 'longitude'],
        properties: {
          vehicleId: { type: 'string', format: 'uuid' }, latitude: { type: 'number', example: 12.9716 }, longitude: { type: 'number', example: 77.5946 },
          speed: { type: 'number', description: 'km/h', example: 42.5 }, heading: { type: 'number', example: 180 }, fuelLevel: { type: 'number', description: '%', example: 64 },
          batteryLevel: { type: 'number', description: '% — below 15 auto-raises `low_battery`', example: 88 }, engineTemp: { type: 'number', description: '°C — above 120 auto-raises `overheat`', example: 92 }, odometer: { type: 'number', example: 15230 },
          event: { type: 'string', description: 'Critical events trigger SMS to admins', enum: ['engine_fault', 'low_battery', 'emergency_stop', 'collision', 'overheat', 'low_fuel', 'ignition_on', 'ignition_off'] },
          recordedAt: { type: 'string', format: 'date-time' },
        },
      },
      Telemetry: {
        allOf: [ref('TelemetryInput'), { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, criticalEvents: { type: 'array', items: { type: 'string' } }, reportedBy: { type: 'string', format: 'uuid' }, createdAt: { type: 'string', format: 'date-time' } } }],
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' }, channel: { type: 'string', example: 'sms' }, provider: { type: 'string', enum: ['sms-stub', 'twilio'] }, to: { type: 'string' }, recipientId: { type: 'string', nullable: true },
          type: { type: 'string', enum: ['critical_event', 'status_change', 'manual'] }, vehicleId: { type: 'string', nullable: true }, message: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'sent', 'failed'] }, attempts: { type: 'integer' }, providerMessageId: { type: 'string', nullable: true }, error: { type: 'string', nullable: true }, meta: { type: 'object' },
          createdAt: { type: 'string', format: 'date-time' }, sentAt: { type: 'string', format: 'date-time' },
        },
        example: smsExample,
      },
      NearbyVehicle: { allOf: [ref('Vehicle'), { type: 'object', properties: { distanceKm: { type: 'number', example: 1.234 } } }] },
      GeocodeResult: { type: 'object', properties: { latitude: { type: 'number' }, longitude: { type: 'number' }, displayName: { type: 'string' }, provider: { type: 'string', enum: ['openstreetmap', 'google', 'mock'] } } },
    },
  },
  paths: {
    '/health': { get: { tags: ['Gateway'], summary: 'Gateway health', security: [], responses: { 200: { description: 'Gateway up', content: json({ type: 'object' }, { service: 'api-gateway', status: 'ok', routes: ['/api/users', '/api/vehicles', '/api/telemetry', '/api/maps', '/api/notifications'] }) } } } },
    '/health/services': { get: { tags: ['Gateway'], summary: 'Health of every backend service', security: [], responses: { 200: { description: 'All services up' }, 503: { description: 'At least one service is down', content: json({ type: 'object' }, { services: [{ prefix: '/api/vehicles', target: 'http://127.0.0.1:4002', status: 'down' }] }) } } } },

    '/api/users/login': {
      post: {
        tags: ['Users'], summary: 'Log in and obtain a JWT', security: [{ ApiKeyAuth: [] }],
        requestBody: { required: true, content: json(ref('LoginRequest')) },
        responses: {
          200: { description: 'Authenticated', content: json(ref('LoginResponse'), { token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...', tokenType: 'Bearer', expiresIn: '8h', user: { id: 'b7e0...', name: 'Alice Admin', email: 'admin@fleet.com', role: 'admin', phone: '+15551230001' } }) },
          400: err(400, '"email" and "password" are required'), 401: err(401, 'Invalid email or password'), 429: E[429], 503: E[503],
        },
      },
    },
    '/api/users/verify': {
      post: {
        tags: ['Users'], summary: 'Verify a JWT', security: [{ ApiKeyAuth: [] }], description: 'Token may be passed in the body or the Authorization header.',
        requestBody: { content: json({ type: 'object', properties: { token: { type: 'string' } } }) },
        responses: { 200: { description: 'Valid token', content: json({ type: 'object' }, { valid: true, payload: { sub: 'b7e0...', email: 'admin@fleet.com', role: 'admin', iat: 1763200000, exp: 1763228800 } }) }, 401: { description: 'Invalid / expired', content: json({ type: 'object' }, { valid: false, error: { status: 401, message: 'invalid signature' } }) } },
      },
    },
    '/api/users/register': {
      post: {
        tags: ['Users'], summary: 'Register a user', security: [{ ApiKeyAuth: [] }, { ApiKeyAuth: [], BearerAuth: [] }],
        description: 'Anyone can self-register as a `driver`. Creating `admin` or `fleet_manager` accounts requires an admin JWT.',
        requestBody: { required: true, content: json(ref('RegisterRequest')) },
        responses: { 201: { description: 'Created', content: json(ref('User')) }, 400: E[400], 403: err(403, 'Only admins can create non-driver accounts'), 409: err(409, 'Email already registered') },
      },
    },
    '/api/users/me': { get: { tags: ['Users'], summary: 'Current user profile', responses: { 200: { description: 'OK', content: json(ref('User')) }, ...gatewayErrors } } },
    '/api/users': {
      get: {
        tags: ['Users'], summary: 'List users' + '', description: roles('admin', 'fleet_manager'),
        parameters: [{ name: 'role', in: 'query', schema: ref('Role') }],
        responses: { 200: { description: 'OK', content: json({ type: 'object', properties: { count: { type: 'integer' }, users: { type: 'array', items: ref('User') } } }) }, 401: E[401], 403: E[403] },
      },
    },
    '/api/users/{id}': {
      get: { tags: ['Users'], summary: 'Get user by id', description: 'Drivers may only fetch their own profile.', parameters: [idParam()], responses: { 200: { description: 'OK', content: json(ref('User')) }, 401: E[401], 403: E[403], 404: E[404] } },
      delete: { tags: ['Users'], summary: 'Delete user', description: roles('admin'), parameters: [idParam()], responses: { 204: { description: 'Deleted' }, 401: E[401], 403: E[403], 404: E[404] } },
    },

    '/api/vehicles': {
      post: {
        tags: ['Vehicles'], summary: 'Register a vehicle', description: `If only \`address\` is given, coordinates are obtained from the geolocation provider.${roles('admin', 'fleet_manager')}`,
        requestBody: { required: true, content: { 'application/json': { schema: ref('VehicleInput'), examples: { withAddress: { summary: 'Geocode from address', value: { vin: '1HGCM82633A004352', plateNumber: 'KA05MN2024', make: 'Tata', model: 'Ace', year: 2023, type: 'truck', address: 'MG Road, Bengaluru' } }, withCoords: { summary: 'Explicit GPS coordinates', value: { vin: '2T1BURHE0JC000001', plateNumber: 'KA05MN2025', make: 'Toyota', model: 'Innova', year: 2022, type: 'van', latitude: 12.9716, longitude: 77.5946 } } } } } },
        responses: { 201: { description: 'Created', headers: { Location: { schema: { type: 'string' } } }, content: json(ref('Vehicle'), vehicleExample) }, 400: E[400], 401: E[401], 403: E[403], 409: err(409, 'A vehicle with this VIN already exists'), 429: E[429], 503: E[503] },
      },
      get: {
        tags: ['Vehicles'], summary: 'List vehicles', description: 'Drivers only see vehicles assigned to them.',
        parameters: [{ name: 'status', in: 'query', schema: ref('VehicleStatus') }, { name: 'type', in: 'query', schema: { type: 'string' } }],
        responses: { 200: { description: 'OK', content: json({ type: 'object', properties: { count: { type: 'integer' }, vehicles: { type: 'array', items: ref('Vehicle') } } }, { count: 1, vehicles: [vehicleExample] }) }, ...gatewayErrors },
      },
    },
    '/api/vehicles/{id}': {
      get: { tags: ['Vehicles'], summary: 'Get vehicle', parameters: [idParam()], responses: { 200: { description: 'OK', content: json(ref('Vehicle'), vehicleExample) }, 401: E[401], 403: E[403], 404: err(404, 'Vehicle not found') } },
      put: { tags: ['Vehicles'], summary: 'Update vehicle details', description: `Status cannot be changed here — use PATCH /status.${roles('admin', 'fleet_manager')}`, parameters: [idParam()], requestBody: { content: json(ref('VehicleInput'), { model: 'Ace Gold', address: 'Whitefield, Bengaluru' }) }, responses: { 200: { description: 'Updated', content: json(ref('Vehicle')) }, 400: E[400], 401: E[401], 403: E[403], 404: E[404] } },
      delete: { tags: ['Vehicles'], summary: 'Delete vehicle', description: `Only admins. A \`fleet_manager\` or \`driver\` receives **403**.${roles('admin')}`, parameters: [idParam()], responses: { 204: { description: 'Deleted' }, 401: E[401], 403: err(403, 'Forbidden: requires role admin'), 404: E[404] } },
    },
    '/api/vehicles/{id}/status': {
      patch: {
        tags: ['Vehicles'], summary: 'Update operational status (triggers SMS)', description: `Sends an SMS to all admins, fleet managers and the assigned driver. Response includes the notification records with their delivery status.${roles('admin', 'fleet_manager')}`,
        parameters: [idParam()], requestBody: { required: true, content: json(ref('StatusUpdate')) },
        responses: {
          200: { description: 'Status updated', content: json({ type: 'object', properties: { vehicle: ref('Vehicle'), changed: { type: 'boolean' }, previousStatus: ref('VehicleStatus'), notifications: { type: 'array', items: ref('Notification') } } }, { vehicle: { ...vehicleExample, status: 'maintenance' }, changed: true, previousStatus: 'active', notifications: [{ ...smsExample, type: 'status_change', message: '[FLEET] Vehicle KA05MN2024 status changed: active -> maintenance (Scheduled brake service).' }] }) },
          400: err(400, 'status must be one of active, idle, maintenance, out_of_service'), 401: E[401], 403: E[403], 404: E[404],
        },
      },
    },

    '/api/telemetry': {
      post: {
        tags: ['Telemetry'], summary: 'Submit vehicle telemetry (GPS + sensors)', description: 'Stores the reading, updates the vehicle\'s last known location and sends SMS to admins for critical events (`engine_fault`, `low_battery`, `emergency_stop`, `collision`, `overheat`, `low_fuel`, battery < 15%, engine temp > 120°C). Drivers may only report for their assigned vehicles.',
        requestBody: { required: true, content: { 'application/json': { schema: ref('TelemetryInput'), examples: { normal: { value: { vehicleId: vehicleExample.id, latitude: 12.9716, longitude: 77.5946, speed: 42.5, fuelLevel: 64, batteryLevel: 88, engineTemp: 92 } }, critical: { summary: 'Engine fault (sends SMS)', value: { vehicleId: vehicleExample.id, latitude: 12.9716, longitude: 77.5946, speed: 0, event: 'engine_fault' } } } } } },
        responses: { 201: { description: 'Stored', content: json({ type: 'object', properties: { telemetry: ref('Telemetry'), criticalEvents: { type: 'array', items: { type: 'string' } }, notifications: { type: 'array', items: ref('Notification') } } }, { telemetry: { id: 'c1d2...', vehicleId: vehicleExample.id, latitude: 12.9716, longitude: 77.5946, speed: 0, event: 'engine_fault', criticalEvents: ['engine_fault'], recordedAt: '2026-11-15T10:05:00.000Z' }, criticalEvents: ['engine_fault'], notifications: [smsExample] }) }, 400: E[400], 401: E[401], 403: E[403], 404: err(404, 'Vehicle not found'), 429: E[429], 503: E[503] },
      },
    },
    '/api/telemetry/vehicle/{vehicleId}': {
      get: { tags: ['Telemetry'], summary: 'Telemetry history for a vehicle (newest first)', description: roles('admin', 'fleet_manager'), parameters: [idParam('vehicleId', 'Vehicle UUID'), { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 1000 } }], responses: { 200: { description: 'OK', content: json({ type: 'object', properties: { vehicleId: { type: 'string' }, count: { type: 'integer' }, telemetry: { type: 'array', items: ref('Telemetry') } } }) }, 401: E[401], 403: E[403], 404: E[404] } },
    },
    '/api/telemetry/vehicle/{vehicleId}/latest': { get: { tags: ['Telemetry'], summary: 'Latest telemetry reading', parameters: [idParam('vehicleId', 'Vehicle UUID')], responses: { 200: { description: 'OK', content: json(ref('Telemetry')) }, 401: E[401], 404: E[404] } } },
    '/api/telemetry/events': { get: { tags: ['Telemetry'], summary: 'Telemetry readings that raised critical events', description: roles('admin', 'fleet_manager'), responses: { 200: { description: 'OK' }, 401: E[401], 403: E[403] } } },

    '/api/maps/geocode': {
      get: { tags: ['Maps'], summary: 'Address → coordinates', parameters: [{ name: 'address', in: 'query', required: true, schema: { type: 'string' }, example: 'MG Road, Bengaluru' }], responses: { 200: { description: 'OK', content: json(ref('GeocodeResult'), { latitude: 12.9756, longitude: 77.6066, displayName: 'Mahatma Gandhi Road, Bengaluru, Karnataka, India', provider: 'openstreetmap' }) }, 400: E[400], 401: E[401], 404: err(404, 'Address not found: Atlantis'), 502: E[502] } },
    },
    '/api/maps/reverse': {
      get: { tags: ['Maps'], summary: 'Coordinates → address', parameters: [{ name: 'lat', in: 'query', required: true, schema: { type: 'number' }, example: 12.9716 }, { name: 'lng', in: 'query', required: true, schema: { type: 'number' }, example: 77.5946 }], responses: { 200: { description: 'OK', content: json({ type: 'object' }, { latitude: 12.9716, longitude: 77.5946, address: 'Bengaluru, Karnataka, India', provider: 'openstreetmap' }) }, 400: E[400], 401: E[401], 502: E[502] } },
    },
    '/api/maps/nearby': {
      get: {
        tags: ['Maps'], summary: 'Vehicles within X km of a location', description: 'Provide `lat`+`lng` **or** `address`. Distances use the Haversine formula; results are sorted nearest-first.',
        parameters: [
          { name: 'lat', in: 'query', schema: { type: 'number' }, example: 12.9716 }, { name: 'lng', in: 'query', schema: { type: 'number' }, example: 77.5946 },
          { name: 'address', in: 'query', schema: { type: 'string' } }, { name: 'radius', in: 'query', description: 'Radius in km (default 5, max 1000)', schema: { type: 'number', default: 5 }, example: 5 },
          { name: 'status', in: 'query', schema: ref('VehicleStatus') },
        ],
        responses: { 200: { description: 'OK', content: json({ type: 'object', properties: { center: { type: 'object' }, radiusKm: { type: 'number' }, count: { type: 'integer' }, vehicles: { type: 'array', items: ref('NearbyVehicle') } } }, { center: { latitude: 12.9716, longitude: 77.5946 }, radiusKm: 5, count: 1, vehicles: [{ ...vehicleExample, distanceKm: 0.511 }] }) }, 400: err(400, 'Provide valid "lat" and "lng" or an "address"'), 401: E[401], 404: E[404], 502: E[502] },
      },
    },
    '/api/maps/vehicles': { get: { tags: ['Maps'], summary: 'All vehicle positions as GeoJSON', responses: { 200: { description: 'GeoJSON FeatureCollection', content: json({ type: 'object' }, { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [77.5946, 12.9716] }, properties: { id: vehicleExample.id, plateNumber: 'KA05MN2024', status: 'active' } }] }) }, 401: E[401] } } },
    '/api/maps/distance': { get: { tags: ['Maps'], summary: 'Distance between two points (km)', parameters: ['lat1', 'lng1', 'lat2', 'lng2'].map((n) => ({ name: n, in: 'query', required: true, schema: { type: 'number' } })), responses: { 200: { description: 'OK', content: json({ type: 'object' }, { distanceKm: 3.42 }) }, 400: E[400] } } },

    '/api/notifications': {
      get: {
        tags: ['Notifications'], summary: 'List notification records', description: `Delivery log for every SMS (sent / failed).${roles('admin', 'fleet_manager')}`,
        parameters: [{ name: 'status', in: 'query', schema: { type: 'string', enum: ['sent', 'failed', 'pending'] } }, { name: 'type', in: 'query', schema: { type: 'string', enum: ['critical_event', 'status_change', 'manual'] } }, { name: 'vehicleId', in: 'query', schema: { type: 'string' } }, { name: 'limit', in: 'query', schema: { type: 'integer', default: 100 } }],
        responses: { 200: { description: 'OK', content: json({ type: 'object', properties: { count: { type: 'integer' }, notifications: { type: 'array', items: ref('Notification') } } }, { count: 1, notifications: [smsExample] }) }, 401: E[401], 403: E[403] },
      },
    },
    '/api/notifications/stats': { get: { tags: ['Notifications'], summary: 'Counts by status and type', description: roles('admin', 'fleet_manager'), responses: { 200: { description: 'OK', content: json({ type: 'object' }, { total: 5, byStatus: { sent: 4, failed: 1 }, byType: { critical_event: 2, status_change: 3 }, provider: 'sms-stub' }) }, 401: E[401], 403: E[403] } } },
    '/api/notifications/{id}': { get: { tags: ['Notifications'], summary: 'Get a notification', description: roles('admin', 'fleet_manager'), parameters: [idParam()], responses: { 200: { description: 'OK', content: json(ref('Notification')) }, 401: E[401], 403: E[403], 404: E[404] } } },
    '/api/notifications/sms': {
      post: {
        tags: ['Notifications'], summary: 'Send a manual / test SMS', description: `With the stub provider, numbers ending in \`0000\` simulate a carrier failure.${roles('admin')}`,
        requestBody: { required: true, content: json({ type: 'object', required: ['to', 'message'], properties: { to: { type: 'string', example: '+15551230001' }, message: { type: 'string', example: 'Test alert' }, vehicleId: { type: 'string' } } }) },
        responses: { 201: { description: 'Sent', content: json(ref('Notification')) }, 400: E[400], 401: E[401], 403: E[403], 502: { description: 'Provider failed — record stored with status `failed`', content: json(ref('Notification'), { ...smsExample, type: 'manual', to: '+15550000000', status: 'failed', error: 'Carrier rejected message (simulated failure)', providerMessageId: null }) } },
      },
    },
    '/api/notifications/{id}/retry': { post: { tags: ['Notifications'], summary: 'Retry a failed SMS', description: roles('admin'), parameters: [idParam()], responses: { 200: { description: 'Retried — check `status`', content: json(ref('Notification')) }, 401: E[401], 403: E[403], 404: E[404] } } },
  },
};
