// queues/ProcessRiderQueue.js
const Bull = require('bull');
const Rider = require('../models/Rider.model');
const sendNotification = require('../utils/sendNotification');

// Configuration
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: process.env.REDIS_DB || 0,
};

const QUEUE_SETTINGS = {
    lockDuration: 60000, // 1 minute
    stalledInterval: 30000, // 30 seconds
    maxStalledCount: 3,
};

const JOB_OPTIONS = {
    removeOnComplete: 50, // Keep last 50 completed jobs
    removeOnFail: 100, // Keep last 100 failed jobs
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 2000,
    },
};

// Create queue
const notificationQueue = new Bull('ride-notification-work', {
    redis: REDIS_CONFIG,
    settings: QUEUE_SETTINGS,
    defaultJobOptions: JOB_OPTIONS,
});

// Batch size for processing notifications
const BATCH_SIZE = 100;
const CONCURRENT_NOTIFICATIONS = 10;

// Job data validation
const validateJobData = (data) => {
    const { title, body } = data;

    if (!title || typeof title !== 'string') {
        throw new Error('Title is required and must be a string');
    }

    if (!body || typeof body !== 'string') {
        throw new Error('Body is required and must be a string');
    }

    return true;
};

// Process notifications in batches
const processNotificationBatch = async (riders, title, body, data) => {
    const tokens = riders
        .map(rider => rider.fcmToken)
        .filter(token => token && token.trim() !== '');

    if (tokens.length === 0) {
        return { successes: 0, failures: 0, results: [] };
    }

    // Process notifications concurrently with limit
    const chunks = [];
    for (let i = 0; i < tokens.length; i += CONCURRENT_NOTIFICATIONS) {
        chunks.push(tokens.slice(i, i + CONCURRENT_NOTIFICATIONS));
    }

    const results = [];
    let successes = 0;
    let failures = 0;

    for (const chunk of chunks) {
        const promises = chunk.map(async (token) => {
            try {
                const response = await sendNotification.sendNotification(token, title, body, data || {});
                successes++;
                return { token, status: 'success', response };
            } catch (err) {
                failures++;
                console.error(`Failed to send notification to ${token}:`, err.message);
                return { token, status: 'failed', error: err.message };
            }
        });

        const chunkResults = await Promise.all(promises);
        results.push(...chunkResults);
    }

    return { successes, failures, results };
};

// Main queue processor
notificationQueue.process(async (job) => {
  const { title, body, data = {}, targetType = 'rider', targetIds = [] } = job.data;

  console.log('📨 Rider Notification Job Received:', job.data);

  try {
    // Step 1: Validate job data
    validateJobData(job.data);
    job.progress(10);

    // Step 2: Ensure we're targeting specific rider IDs only
    if (targetType !== 'rider') {
      throw new Error('Unsupported targetType for this queue. Only "rider" is allowed.');
    }

    if (!Array.isArray(targetIds) || targetIds.length === 0) {
      throw new Error('targetIds must be provided for rider notifications');
    }

    // Step 3: Build query to fetch riders with valid FCM tokens
    const query = {
      _id: { $in: targetIds },
      fcmToken: { $exists: true, $ne: null, $ne: '' },
    };

    const totalCount = await Rider.countDocuments(query);

    if (totalCount === 0) {
      console.warn('🚫 No riders with valid FCM tokens found');
      return {
        message: 'No riders found with valid FCM tokens',
        total: 0,
        successes: 0,
        failures: 0,
        results: [],
      };
    }

    console.log(`🔔 Sending notifications to ${totalCount} riders`);
    job.progress(20);

    const BATCH_SIZE = 100;
    let allResults = [];
    let totalSuccesses = 0;
    let totalFailures = 0;
    let processedCount = 0;
    let batch = [];

    const cursor = Rider.find(query).select('fcmToken').lean().cursor();

    for (let rider = await cursor.next(); rider != null; rider = await cursor.next()) {
      batch.push(rider);

      if (batch.length >= BATCH_SIZE) {
        const batchResult = await processNotificationBatch(batch, title, body, data);
        allResults.push(...batchResult.results);
        totalSuccesses += batchResult.successes;
        totalFailures += batchResult.failures;
        processedCount += batch.length;

        const progress = Math.min(90, 20 + (processedCount / totalCount) * 70);
        job.progress(progress);

        console.log(`📦 Processed batch: ${processedCount}/${totalCount} riders`);
        batch = [];
      }
    }

    // Step 4: Process any remaining riders
    if (batch.length > 0) {
      const batchResult = await processNotificationBatch(batch, title, body, data);
      allResults.push(...batchResult.results);
      totalSuccesses += batchResult.successes;
      totalFailures += batchResult.failures;
      processedCount += batch.length;
    }

    job.progress(100);

    const result = {
      message: 'Rider notification processing completed',
      total: totalCount,
      processed: processedCount,
      successes: totalSuccesses,
      failures: totalFailures,
      successRate: ((totalSuccesses / totalCount) * 100).toFixed(2) + '%',
      results: allResults,
    };

    console.log(`✅ Rider Notification Job Completed — Success: ${totalSuccesses}, Failed: ${totalFailures}`);
    return result;

  } catch (error) {
    console.error('❌ Error processing rider notification job:', error);
    throw error;
  }
});



// Event listeners
notificationQueue.on('completed', (job, result) => {
    console.log(`✅ Notification job ${job.id} completed:`, {
        rideId: job.data.rideId,
        total: result.total,
        successes: result.successes,
        failures: result.failures,
        successRate: result.successRate,
    });
});

notificationQueue.on('failed', (job, err) => {
    console.error(`❌ Notification job ${job.id} failed:`, {
        rideId: job.data.rideId,
        error: err.message,
        attempt: job.attemptsMade,
        maxAttempts: job.opts.attempts,
    });
});

notificationQueue.on('stalled', (job) => {
    console.warn(`⚠️ Notification job ${job.id} stalled:`, {
        rideId: job.data.rideId,
    });
});

// Helper function to add jobs
const addNotificationJob = async (jobData, options = {}) => {
    try {
        const job = await notificationQueue.add(jobData, {
            ...JOB_OPTIONS,
            ...options,
        });

        console.log(`📧 Notification job ${job.id} added to queue`);
        return job;
    } catch (error) {
        console.error('Failed to add notification job:', error);
        throw error;
    }
};

// Graceful shutdown
const gracefulShutdown = async () => {
    console.log('Shutting down notification queue...');
    await notificationQueue.close();
    console.log('Notification queue closed');
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

module.exports = {
    queue: notificationQueue,
    addJob: addNotificationJob,
    shutdown: gracefulShutdown,
};