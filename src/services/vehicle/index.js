'use strict';
const { createServiceApp } = require('../../shared/service-app');
module.exports = () => createServiceApp('vehicle-service', '/api/vehicles', require('./routes'));
