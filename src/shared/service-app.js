'use strict';
const express = require('express');
const { HttpError } = require('./errors');

/** Builds a backend micro-service app with common JSON handling and error responses. */
function createServiceApp(name, mountPath, router) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use((req, res, next) => {
    res.set('X-Service', name);
    next();
  });
  app.get('/health', (_req, res) => res.json({ service: name, status: 'ok', uptime: process.uptime() }));
  app.use(mountPath, router);
  app.use((req, _res, next) => next(new HttpError(404, `Route ${req.method} ${req.path} not found in ${name}`)));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Invalid JSON body');
    const status = err.status || 500;
    if (status >= 500) console.error(`[${name}]`, err);
    res.status(status).json({
      error: { status, message: status >= 500 ? 'Internal server error' : err.message, ...(err.details && { details: err.details }) },
    });
  });
  return app;
}

const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { createServiceApp, asyncHandler };
