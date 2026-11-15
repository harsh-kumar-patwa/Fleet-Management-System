'use strict';
const jwt = require('jsonwebtoken');
const config = require('./config');
const { HttpError } = require('./errors');

const ROLES = Object.freeze({ ADMIN: 'admin', MANAGER: 'fleet_manager', DRIVER: 'driver' });

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

/** Requires a valid `Authorization: Bearer <jwt>` header. */
function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(new HttpError(401, 'Missing or malformed Authorization header'));
  try {
    req.user = verifyToken(token);
    return next();
  } catch (e) {
    return next(new HttpError(401, e.name === 'TokenExpiredError' ? 'Token expired' : 'Invalid token'));
  }
}

/** Role-based access control: only the listed roles may pass. */
function authorize(...roles) {
  return (req, _res, next) => {
    if (!req.user) return next(new HttpError(401, 'Not authenticated'));
    if (!roles.includes(req.user.role)) {
      return next(new HttpError(403, `Forbidden: requires role ${roles.join(' or ')}`));
    }
    return next();
  };
}

module.exports = { ROLES, signToken, verifyToken, authenticate, authorize };
