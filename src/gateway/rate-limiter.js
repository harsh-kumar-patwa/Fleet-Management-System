'use strict';
/**
 * Fixed-window rate limiter keyed by API key (falls back to client IP).
 * Sets standard X-RateLimit-* headers and returns 429 with Retry-After when exceeded.
 */
function rateLimiter({ windowMs, max, keyFn = (req) => req.apiKey || req.ip }) {
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  timer.unref();

  const middleware = (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    const remaining = Math.max(0, max - entry.count);
    res.set({
      'X-RateLimit-Limit': String(max),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.ceil(entry.resetAt / 1000)),
    });
    if (entry.count > max) {
      const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: { status: 429, message: `Rate limit exceeded: max ${max} requests per ${windowMs / 1000}s. Retry in ${retryAfter}s.` } });
    }
    return next();
  };
  middleware.reset = () => hits.clear();
  return middleware;
}

module.exports = rateLimiter;
