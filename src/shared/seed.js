'use strict';
const bcrypt = require('bcryptjs');
const db = require('./db');

const USERS = [
  { name: 'Alice Admin', email: 'admin@fleet.com', password: 'admin123', role: 'admin', phone: '+15551230001' },
  { name: 'Manny Manager', email: 'manager@fleet.com', password: 'manager123', role: 'fleet_manager', phone: '+15551230002' },
  { name: 'Dave Driver', email: 'driver@fleet.com', password: 'driver123', role: 'driver', phone: '+15551230003' },
];

// Sample vehicles around Bengaluru, India
const VEHICLES = [
  { vin: '1HGCM82633A000001', plateNumber: 'KA01AB1001', make: 'Tata', model: 'Ace', year: 2022, type: 'truck', latitude: 12.9716, longitude: 77.5946 },
  { vin: '1HGCM82633A000002', plateNumber: 'KA01AB1002', make: 'Mahindra', model: 'Bolero', year: 2021, type: 'van', latitude: 12.9352, longitude: 77.6245 },
  { vin: '1HGCM82633A000003', plateNumber: 'KA01AB1003', make: 'Ashok Leyland', model: 'Dost', year: 2023, type: 'truck', latitude: 12.9784, longitude: 77.6408 },
  { vin: '1HGCM82633A000004', plateNumber: 'KA01AB1004', make: 'Tata', model: 'Nexon EV', year: 2024, type: 'car', latitude: 13.0358, longitude: 77.597 },
  { vin: '1HGCM82633A000005', plateNumber: 'KA01AB1005', make: 'Eicher', model: 'Pro 2049', year: 2020, type: 'truck', latitude: 12.8456, longitude: 77.6603 },
];

function seed() {
  if (db.all('users').length) return;
  const users = USERS.map(({ password, ...u }) => db.insert('users', { ...u, passwordHash: bcrypt.hashSync(password, 8) }));
  const driver = users.find((u) => u.role === 'driver');
  VEHICLES.forEach((v, i) =>
    db.insert('vehicles', {
      ...v,
      status: 'active',
      assignedDriverId: i === 0 ? driver.id : null,
      lastLocationAt: new Date().toISOString(),
    })
  );
}

module.exports = { seed, USERS };
