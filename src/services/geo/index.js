'use strict';
const { createServiceApp } = require('../../shared/service-app');
module.exports = () => createServiceApp('geolocation-service', '/api/maps', require('./routes'));
