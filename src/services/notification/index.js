'use strict';
const { createServiceApp } = require('../../shared/service-app');
module.exports = () => createServiceApp('notification-service', '/api/notifications', require('./routes'));
