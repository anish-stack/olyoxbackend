const PushToken = require("../../models/PushNotification/PushTokenForCabAndParcel");
const Rider = require('../../models/Rider.model');
const { addJob, queue } = require("../../queues/sendNotificationQuee");
const { addJobUser, queue: userQueue } = require("../../queues/sendUserNotifications");
const sendNotification = require("../../utils/sendNotification");


exports.registerToken = async (req, res) => {
  try {
    const { userId, pushToken } = req.body;

    const existingToken = await PushToken.findOne({ userId });

    if (existingToken) {
      existingToken.pushToken = pushToken;
      await existingToken.save();
      return res.status(200).json({ message: 'Push token updated successfully' });
    }

    const newToken = new PushToken({ userId, pushToken });
    await newToken.save();
    res.status(201).json({ message: 'Push token registered successfully' });
  } catch (error) {
    console.error('Error registering token:', error);
    res.status(500).json({ error: 'Failed to register push token' });
  }
};

exports.sendNotification = async (req, res) => {
  try {
    const { userId, title, body, data } = req.body;

    const userToken = await PushToken.findOne({ userId });

    if (!userToken) {
      return res.status(404).json({ error: 'User not found or push token not registered' });
    }

    const message = {
      to: userToken.pushToken,
      sound: 'default',
      title: title,
      body: body,
      data: data,
    };

    // Send the notification using Expo's push notification service
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    });

    const responseData = await response.json();
    console.log('Push notification response:', responseData);

    if (responseData.errors) {
      console.error('Error sending notification:', responseData.errors);
      return res.status(500).json({ error: 'Failed to send push notification', details: responseData.errors });
    }

    res.status(200).json({ message: 'Push notification sent successfully', response: responseData });
  } catch (error) {
    console.error('Error sending notification:', error);
    res.status(500).json({ error: 'Failed to send push notification' });
  }
};




// Send notification using queue (async processing)
exports.DriverSendNotification = async (req, res) => {
  try {
    const {
      title,
      body,
      data = {},
      targetType = 'all',
      targetIds = [],
      priority = 'normal'
    } = req.body;

    console.log('Received notification request:', {
      title,
      body,
      data,
      targetType,
      targetIds,
      priority,
    });

    // Validate required fields
    if (!title || !body) {
      return res.status(400).json({
        error: 'Title and body are required fields',
      });
    }

    // Validate targetIds if targetType is 'specific'
    if (targetType === 'specific' && (!targetIds || targetIds.length === 0)) {
      return res.status(400).json({
        error: 'targetIds are required when targetType is specific',
      });
    }

    // Prepare job data
    const jobData = {
      title,
      body,
      data,
      targetType,
      targetIds,
      rideId: data?.rideId || null,
      timestamp: new Date().toISOString(),
    };

    // Set job options based on priority
    const jobOptions = {
      priority: priority === 'high' ? 1 : priority === 'low' ? 10 : 5,
      delay: priority === 'low' ? 5000 : 0,
    };

    let job;

    // Add job to the appropriate queue
    if (targetType === 'user') {
      job = await addJobUser(jobData, jobOptions);
      console.log(`Notification job added to user queue with ID: ${job.id}`);
    } else {
      job = await addJob(jobData, jobOptions);
      console.log(`Notification job added to queue with ID: ${job.id}`);
    }

    // Return immediate response
    res.status(202).json({
      message: 'Notification job queued successfully',
      jobId: job.id,
      status: 'processing',
      estimatedProcessingTime: '1-2 minutes',
      trackingUrl: `/api/notifications/status/${job.id}`,
    });

  } catch (error) {
    console.error('Error queuing notification job:', error);
    res.status(500).json({
      error: 'Server error while queuing notifications',
      details: error.message,
    });
  }
};


// Get notification job status
exports.getNotificationStatus = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await queue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found'
      });
    }

    const state = await job.getState();
    const progress = job.progress();

    let response = {
      jobId: job.id,
      status: state,
      progress: progress,
      createdAt: new Date(job.timestamp).toISOString(),
      data: {
        title: job.data.title,
        targetType: job.data.targetType,
        rideId: job.data.rideId,
      }
    };

    // Add result data if job is completed
    if (state === 'completed') {
      response.result = job.returnvalue;
      response.completedAt = new Date(job.finishedOn).toISOString();
      response.processingTime = `${job.finishedOn - job.timestamp}ms`;
    }

    // Add error info if job failed
    if (state === 'failed') {
      response.error = job.failedReason;
      response.failedAt = new Date(job.failedOn).toISOString();
      response.attempts = job.attemptsMade;
    }

    res.status(200).json(response);

  } catch (error) {
    console.error('Error fetching job status:', error);
    res.status(500).json({
      error: 'Server error while fetching job status',
      details: error.message
    });
  }
};

// Send notification synchronously (for urgent notifications)
exports.DriverSendNotificationSync = async (req, res) => {
  try {
    const { title, body, data, targetType = 'all', targetIds = [] } = req.body;

    // Validate required fields
    if (!title || !body) {
      return res.status(400).json({
        error: 'Title and body are required fields'
      });
    }

    // For sync processing, we'll process directly without queue
    const Rider = require('../models/Rider.model');
    const sendNotification = require('../../utils/sendNotification');

    // Build query
    let query = { fcmToken: { $exists: true, $ne: null, $ne: '' } };

    if (targetType === 'specific' && targetIds.length > 0) {
      query._id = { $in: targetIds };
    }

    // Get riders (limit to 50 for sync processing)
    const riders = await Rider.find(query)
      .select('fcmToken')
      .limit(50)
      .lean();

    if (riders.length === 0) {
      return res.status(404).json({
        message: 'No riders found with valid FCM tokens'
      });
    }

    // Send notifications concurrently
    const results = [];
    const promises = riders.map(async (rider) => {
      try {
        const response = await sendNotification.sendNotification(
          rider.fcmToken,
          title,
          body,
          data || {}
        );
        return { token: rider.fcmToken, status: 'success', response };
      } catch (err) {
        console.error(`Failed to send to ${rider.fcmToken}:`, err.message);
        return { token: rider.fcmToken, status: 'failed', error: err.message };
      }
    });

    const notificationResults = await Promise.all(promises);

    const successes = notificationResults.filter(r => r.status === 'success').length;
    const failures = notificationResults.filter(r => r.status === 'failed').length;

    res.status(200).json({
      message: 'Notifications sent synchronously',
      total: notificationResults.length,
      successes,
      failures,
      successRate: `${((successes / notificationResults.length) * 100).toFixed(2)}%`,
      results: notificationResults,
    });

  } catch (error) {
    console.error('Error sending sync notifications:', error);
    res.status(500).json({
      error: 'Server error while sending notifications',
      details: error.message
    });
  }
};

// Get queue statistics
exports.getQueueStats = async (req, res) => {
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      queue.getWaiting(),
      queue.getActive(),
      queue.getCompleted(),
      queue.getFailed(),
      queue.getDelayed(),
    ]);

    res.status(200).json({
      queue: 'ride-notification-work',
      stats: {
        waiting: waiting.length,
        active: active.length,
        completed: completed.length,
        failed: failed.length,
        delayed: delayed.length,
      },
      health: {
        isReady: queue.client.status === 'ready',
        redisConnection: queue.client.status,
      }
    });

  } catch (error) {
    console.error('Error fetching queue stats:', error);
    res.status(500).json({
      error: 'Server error while fetching queue statistics',
      details: error.message
    });
  }
};

// Cancel a notification job
exports.cancelNotificationJob = async (req, res) => {
  try {
    const { jobId } = req.params;

    const job = await queue.getJob(jobId);

    if (!job) {
      return res.status(404).json({
        error: 'Job not found'
      });
    }

    const state = await job.getState();

    if (state === 'completed') {
      return res.status(400).json({
        error: 'Cannot cancel completed job'
      });
    }

    if (state === 'active') {
      return res.status(400).json({
        error: 'Cannot cancel active job'
      });
    }

    await job.remove();

    res.status(200).json({
      message: 'Job cancelled successfully',
      jobId: job.id,
    });

  } catch (error) {
    console.error('Error cancelling job:', error);
    res.status(500).json({
      error: 'Server error while cancelling job',
      details: error.message
    });
  }
};