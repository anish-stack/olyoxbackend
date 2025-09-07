// queues/ProcessRiderQue.js
const Bull = require('bull');
const { JobscheduleRideCancellationCheck } = require('../src/New-Rides-Controller/CreateNewRides');
const { createClient } = require('redis');

const rideCancellationQueue = new Bull('ride-cancellation-work', {
  redis: {
    host: '127.0.0.1',
    port: 6379,
  },
  settings: {
    lockDuration: 60000,
    stalledInterval: 30000,
  },
});

rideCancellationQueue.process(async (job) => {
  const { rideId } = job.data;

  console.info(`🚦 Processing ride cancellation job for rideId: ${rideId}`);

  // ⚠️ Create new Redis client inside the processor
  const redisClient = createClient({ url: 'redis://127.0.0.1:6379' });

  await redisClient.connect(); // Required in redis v4

  const result = await JobscheduleRideCancellationCheck(redisClient, rideId);

  await redisClient.quit(); // Clean up the connection

  return result;
});

rideCancellationQueue.on('completed', (job) => {
  console.log(`✅ Ride cancellation job completed for rideId: ${job.data.rideId}`);
});

rideCancellationQueue.on('failed', (job, err) => {
  console.error(`❌ Ride cancellation job failed for rideId: ${job.data.rideId}:`, err.message);
});

module.exports = rideCancellationQueue;
