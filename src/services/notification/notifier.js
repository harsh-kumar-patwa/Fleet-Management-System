'use strict';
const db = require('../../shared/db');
const config = require('../../shared/config');
const { providers } = require('./sms-providers');

let sms = providers[config.sms.provider] || providers.stub;

const CRITICAL_EVENTS = ['engine_fault', 'low_battery', 'emergency_stop', 'collision', 'overheat', 'low_fuel'];
const LOW_BATTERY_THRESHOLD = 15; // percent
const ENGINE_TEMP_THRESHOLD = 120; // celsius

/** Derive critical events from a telemetry payload (explicit event + threshold checks). */
function detectCriticalEvents(t) {
  const events = new Set();
  if (t.event && CRITICAL_EVENTS.includes(t.event)) events.add(t.event);
  if (typeof t.batteryLevel === 'number' && t.batteryLevel < LOW_BATTERY_THRESHOLD) events.add('low_battery');
  if (typeof t.engineTemp === 'number' && t.engineTemp > ENGINE_TEMP_THRESHOLD) events.add('overheat');
  return [...events];
}

/** Send one SMS and persist its delivery status (sent / failed). */
async function sendSms({ to, recipientId = null, message, type, vehicleId = null, meta = {} }) {
  const record = db.insert('notifications', {
    channel: 'sms', provider: sms.name, to, recipientId, message, type, vehicleId, meta,
    status: 'pending', attempts: 0, providerMessageId: null, error: null,
  });
  return deliver(record);
}

async function deliver(record) {
  const attempts = (record.attempts || 0) + 1;
  try {
    const { providerMessageId } = await sms.send({ to: record.to, body: record.message });
    return db.update('notifications', record.id, { status: 'sent', attempts, providerMessageId, error: null, sentAt: new Date().toISOString() });
  } catch (e) {
    return db.update('notifications', record.id, { status: 'failed', attempts, error: e.message });
  }
}

async function retry(id) {
  const rec = db.findById('notifications', id);
  if (!rec) return null;
  return deliver(rec);
}

const recipientsByRole = (...roles) => db.find('users', (u) => roles.includes(u.role) && u.phone);

/** Critical vehicle event -> SMS every fleet administrator. */
async function notifyCriticalEvent(vehicle, event, telemetry = {}) {
  const where = Number.isFinite(telemetry.latitude) ? ` at (${telemetry.latitude.toFixed(5)}, ${telemetry.longitude.toFixed(5)})` : '';
  const message = `[FLEET ALERT] ${event.replace(/_/g, ' ').toUpperCase()} reported by vehicle ${vehicle.plateNumber}${where}. Immediate attention required.`;
  return Promise.all(
    recipientsByRole('admin').map((u) =>
      sendSms({ to: u.phone, recipientId: u.id, message, type: 'critical_event', vehicleId: vehicle.id, meta: { event, telemetryId: telemetry.id } })
    )
  );
}

/** Operational status changed -> SMS admins, fleet managers and the assigned driver. */
async function notifyStatusChange(vehicle, oldStatus, newStatus, { reason, changedBy } = {}) {
  const message = `[FLEET] Vehicle ${vehicle.plateNumber} status changed: ${oldStatus} -> ${newStatus}${reason ? ` (${reason})` : ''}.`;
  const recipients = recipientsByRole('admin', 'fleet_manager');
  if (vehicle.assignedDriverId) {
    const driver = db.findById('users', vehicle.assignedDriverId);
    if (driver?.phone && !recipients.some((r) => r.id === driver.id)) recipients.push(driver);
  }
  return Promise.all(
    recipients.map((u) =>
      sendSms({ to: u.phone, recipientId: u.id, message, type: 'status_change', vehicleId: vehicle.id, meta: { oldStatus, newStatus, reason, changedBy } })
    )
  );
}

module.exports = {
  CRITICAL_EVENTS,
  detectCriticalEvents,
  sendSms,
  retry,
  notifyCriticalEvent,
  notifyStatusChange,
  getProvider: () => sms,
  setProvider: (p) => {
    sms = typeof p === 'string' ? providers[p] : p;
  },
};
