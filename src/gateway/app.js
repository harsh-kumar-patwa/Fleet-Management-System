'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const swaggerUi = require('swagger-ui-express');
const rateLimiter = require('./rate-limiter');
const openapi = require('../docs/openapi');

const HOP_BY_HOP = ['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'te', 'trailer', 'host', 'content-length', 'x-api-key'];
const RESPONSE_SKIP = ['connection', 'keep-alive', 'transfer-encoding', 'content-encoding', 'content-length'];

const errorBody = (status, message, extra = {}) => ({ error: { status, message, ...extra } });

/**
 * Express API Gateway.
 * @param {object} opts
 * @param {Record<string,string>} opts.routes   prefix -> upstream base URL, e.g. { '/api/users': 'http://localhost:4001' }
 * @param {string[]} opts.apiKeys               accepted API keys
 * @param {{windowMs:number,max:number}} opts.rateLimit
 * @param {number} [opts.timeoutMs]             upstream timeout
 */
function createGateway({ routes, apiKeys, rateLimit, timeoutMs = 10_000, logger = console }) {
  const app = express();
  app.disable('x-powered-by');
  const keys = new Set(apiKeys);
  const limiter = rateLimiter(rateLimit);
  app.locals.limiter = limiter;

  // Request id + access log
  app.use((req, res, next) => {
    req.id = req.headers['x-request-id'] || crypto.randomUUID();
    res.set('X-Request-Id', req.id);
    const start = Date.now();
    res.on('finish', () => {
      if (process.env.NODE_ENV !== 'test') logger.log(`[gateway] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${res.get('X-Upstream-Service') || '-'} ${Date.now() - start}ms`);
    });
    next();
  });

  // Public endpoints (no API key)
  app.get('/health', (_req, res) => res.json({ service: 'api-gateway', status: 'ok', routes: Object.keys(routes) }));
  app.get('/health/services', async (_req, res) => {
    const checks = await Promise.all(
      Object.entries(routes).map(async ([prefix, target]) => {
        try {
          const r = await fetch(`${target}/health`, { signal: AbortSignal.timeout(2000) });
          return { prefix, target, status: r.ok ? 'up' : 'down' };
        } catch {
          return { prefix, target, status: 'down' };
        }
      })
    );
    res.status(checks.every((c) => c.status === 'up') ? 200 : 503).json({ services: checks });
  });
  app.get('/openapi.json', (_req, res) => res.json(openapi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'Fleet Management API Docs', swaggerOptions: { persistAuthorization: true } }));
  app.use(express.static(path.join(__dirname, '..', '..', 'public')));
  app.get('/', (_req, res) => res.redirect('/docs'));

  // API key verification
  app.use('/api', (req, res, next) => {
    const key = req.get('x-api-key') || req.query.api_key;
    if (!key) return res.status(401).json(errorBody(401, 'API key required. Send it in the "x-api-key" header.'));
    if (!keys.has(key)) return res.status(403).json(errorBody(403, 'Invalid API key'));
    req.apiKey = key;
    return next();
  });

  app.use('/api', limiter);

  // Raw body so we can forward byte-for-byte, and validate JSON early
  app.use('/api', express.raw({ type: () => true, limit: '1mb' }));
  app.use('/api', (req, res, next) => {
    const ct = req.get('content-type') || '';
    if (Buffer.isBuffer(req.body) && req.body.length && ct.includes('application/json')) {
      try {
        JSON.parse(req.body.toString('utf8'));
      } catch {
        return res.status(400).json(errorBody(400, 'Invalid request: malformed JSON body'));
      }
    }
    return next();
  });

  const table = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);

  // Proxy
  app.use('/api', async (req, res) => {
    const url = req.originalUrl;
    const match = table.find(([prefix]) => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`));
    if (!match) return res.status(404).json(errorBody(404, `No service is mapped to ${req.path === '/' ? '/api' : `/api${req.path}`}`, { availableRoutes: table.map(([p]) => `${p}/*`) }));

    const [prefix, target] = match;
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!HOP_BY_HOP.includes(k)) headers[k] = v;
    headers['x-forwarded-for'] = [req.headers['x-forwarded-for'], req.ip].filter(Boolean).join(', ');
    headers['x-forwarded-host'] = req.headers.host;
    headers['x-request-id'] = req.id;
    headers['x-gateway'] = 'fleet-api-gateway';

    const hasBody = !['GET', 'HEAD'].includes(req.method) && Buffer.isBuffer(req.body) && req.body.length > 0;
    let upstream;
    try {
      upstream = await fetch(`${target}${url}`, {
        method: req.method,
        headers,
        body: hasBody ? req.body : undefined,
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const timedOut = e.name === 'TimeoutError';
      const status = timedOut ? 504 : 503;
      return res.status(status).json(errorBody(status, timedOut ? `Upstream service ${prefix} timed out` : `Service unavailable: ${prefix} could not be reached`, { service: prefix }));
    }

    res.status(upstream.status);
    upstream.headers.forEach((v, k) => {
      if (!RESPONSE_SKIP.includes(k)) res.set(k, v);
    });
    res.set('X-Upstream-Service', prefix);
    const buf = Buffer.from(await upstream.arrayBuffer());
    return res.send(buf);
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    const status = err.status || 500;
    res.status(status).json(errorBody(status, status === 413 ? 'Payload too large' : status < 500 ? err.message : 'Gateway error'));
  });

  return app;
}

module.exports = { createGateway };
