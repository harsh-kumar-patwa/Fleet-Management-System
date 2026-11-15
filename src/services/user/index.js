'use strict';
const { createServiceApp } = require('../../shared/service-app');
module.exports = () => createServiceApp('user-service', '/api/users', require('./routes'));
