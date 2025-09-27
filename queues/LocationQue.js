const Bull = require('bull');
const locationQueue = new Bull('location-updates', {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  },
});

module.exports = locationQueue;
