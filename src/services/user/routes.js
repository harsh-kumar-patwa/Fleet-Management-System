'use strict';
const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../shared/db');
const { signToken, verifyToken, authenticate, authorize, ROLES } = require('../../shared/auth');
const { asyncHandler } = require('../../shared/service-app');
const { badRequest, notFound, HttpError } = require('../../shared/errors');
const { E164 } = require('../notification/sms-providers');

const router = express.Router();
const publicUser = ({ passwordHash, ...u }) => u;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/login', asyncHandler(async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) throw badRequest('"email" and "password" are required');
  const user = db.findOne('users', (u) => u.email === String(email).toLowerCase());
  if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) throw new HttpError(401, 'Invalid email or password');
  res.json({ token: signToken(user), tokenType: 'Bearer', expiresIn: require('../../shared/config').jwtExpiresIn, user: publicUser(user) });
}));

router.post('/verify', (req, res) => {
  const token = req.body?.token || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) throw badRequest('"token" is required');
  try {
    const payload = verifyToken(token);
    res.json({ valid: true, payload });
  } catch (e) {
    res.status(401).json({ valid: false, error: { status: 401, message: e.message } });
  }
});

/** Registration: admins may create any role; everyone else may only self-register as driver. */
router.post('/register', (req, res, next) => {
  if (req.headers.authorization) return authenticate(req, res, next);
  next();
}, asyncHandler(async (req, res) => {
  const { name, email, password, phone, role = ROLES.DRIVER } = req.body || {};
  const errors = [];
  if (!name) errors.push('name is required');
  if (!email || !EMAIL.test(email)) errors.push('a valid email is required');
  if (!password || String(password).length < 6) errors.push('password must be at least 6 characters');
  if (phone && !E164.test(phone)) errors.push('phone must be in E.164 format, e.g. +15551234567');
  if (!Object.values(ROLES).includes(role)) errors.push(`role must be one of ${Object.values(ROLES).join(', ')}`);
  if (errors.length) throw badRequest('Validation failed', errors);
  if (role !== ROLES.DRIVER && req.user?.role !== ROLES.ADMIN) throw new HttpError(403, 'Only admins can create non-driver accounts');
  if (db.findOne('users', (u) => u.email === email.toLowerCase())) throw new HttpError(409, 'Email already registered');
  const user = db.insert('users', { name, email: email.toLowerCase(), phone: phone || null, role, passwordHash: await bcrypt.hash(password, 8) });
  res.status(201).json(publicUser(user));
}));

router.get('/me', authenticate, (req, res) => {
  const user = db.findById('users', req.user.sub);
  if (!user) throw notFound('User not found');
  res.json(publicUser(user));
});

router.get('/', authenticate, authorize(ROLES.ADMIN, ROLES.MANAGER), (req, res) => {
  const users = db.find('users', (u) => !req.query.role || u.role === req.query.role).map(publicUser);
  res.json({ count: users.length, users });
});

router.get('/:id', authenticate, (req, res) => {
  if (req.user.role === ROLES.DRIVER && req.user.sub !== req.params.id) throw new HttpError(403, 'Drivers can only view their own profile');
  const user = db.findById('users', req.params.id);
  if (!user) throw notFound('User not found');
  res.json(publicUser(user));
});

router.delete('/:id', authenticate, authorize(ROLES.ADMIN), (req, res) => {
  if (!db.remove('users', req.params.id)) throw notFound('User not found');
  res.status(204).end();
});

module.exports = router;
