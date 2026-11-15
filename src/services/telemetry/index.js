'use strict';
const { createServiceApp } = require('../../shared/service-app');
module.exports = () => createServiceApp('telemetry-service', '/api/telemetry', require('./routes'));
