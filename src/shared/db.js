'use strict';
/**
 * Tiny document store shared by all services.
 * In-memory by default; persisted to a JSON file when DB_FILE is set.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const COLLECTIONS = ['users', 'vehicles', 'telemetry', 'notifications'];
let state;

function empty() {
  return Object.fromEntries(COLLECTIONS.map((c) => [c, []]));
}

function load() {
  state = empty();
  if (config.dbFile && fs.existsSync(config.dbFile)) {
    Object.assign(state, JSON.parse(fs.readFileSync(config.dbFile, 'utf8')));
  }
}

function persist() {
  if (!config.dbFile) return;
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
  fs.writeFileSync(config.dbFile, JSON.stringify(state, null, 2));
}

const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : o);

const db = {
  all: (c) => clone(state[c]),
  find: (c, pred) => clone(state[c].filter(pred)),
  findOne: (c, pred) => clone(state[c].find(pred)),
  findById: (c, id) => clone(state[c].find((d) => d.id === id)),
  insert(c, doc) {
    const now = new Date().toISOString();
    const rec = { id: crypto.randomUUID(), ...doc, createdAt: now, updatedAt: now };
    state[c].push(rec);
    persist();
    return clone(rec);
  },
  update(c, id, patch) {
    const rec = state[c].find((d) => d.id === id);
    if (!rec) return null;
    Object.assign(rec, patch, { updatedAt: new Date().toISOString() });
    persist();
    return clone(rec);
  },
  remove(c, id) {
    const i = state[c].findIndex((d) => d.id === id);
    if (i === -1) return false;
    state[c].splice(i, 1);
    persist();
    return true;
  },
  reset() {
    state = empty();
    persist();
  },
};

load();
module.exports = db;
