// scheduler.js
const Bull = require("bull");
const ScheduleNotifications = require("../models/Admin/ScheduleNotifications");
const User = require("../models/normal_user/User.model");
const Rider = require("../models/Rider.model");
const NotificationSentLog = require("../models/Admin/NotificationSentLog.model");
const sendNotification = require("../utils/sendNotification");

/* ============================= QUEUE CONFIG ============================= */
const notificationQueue = new Bull("Schedule-Notification", {
  redis: { host: "127.0.0.1", port: 6379 },
  settings: {
    stalledInterval: 60000,
    maxStalledCount: 3,
    lockDuration: 600000,
  },
  defaultJobOptions: {
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: { type: "exponential", delay: 10000 },
  },
});

/* ============================= WORKER PROCESS ============================= */
notificationQueue.process(10, async (job) => {
  const { notification, recipients, scheduleId } = job.data;
  console.log(
    `🚀 [Worker] Processing "${notification.title}" → ${recipients.length} recipients`
  );

  const failedTokens = [];
  let sentCount = 0;

  for (const token of recipients) {
    try {
      const alreadySent = await NotificationSentLog.exists({
        scheduleId,
        notificationId: notification._id,
        token,
      });
      if (alreadySent) continue;

      await sendNotification.sendNotification(
        token,
        notification.title,
        notification.message,
        {},
        "app-notification"
      );

      await NotificationSentLog.create({
        scheduleId,
        notificationId: notification._id,
        token,
        status: "sent",
      });
      sentCount++;
    } catch (err) {
      failedTokens.push(token);
      await NotificationSentLog.create({
        scheduleId,
        notificationId: notification._id,
        token,
        status: "failed",
        error: err.message,
      });
    }

    await new Promise((r) => setTimeout(r, 50));
  }

  console.log(
    `✅ [Worker] "${notification.title}" sent to ${sentCount} users (${failedTokens.length} failed)`
  );

  try {
    const schedule = await ScheduleNotifications.findById(scheduleId);
    if (schedule) {
      const notif = schedule.notifications.id(notification._id);
      if (notif && !notif.isSendOrNot) {
        notif.isSendOrNot = true;
        await schedule.save();
        console.log(`📦 [Worker] Marked "${notification.title}" as sent.`);
      }
    }
  } catch (err) {
    console.error("❌ [Worker] Failed to update schedule:", err);
  }

  return { sent: sentCount, failed: failedTokens.length };
});

/* ============================= CLEAN DUPLICATE JOBS ============================= */
const cleanDuplicateJobs = async (baseJobId) => {
  try {
    const allJobs = await notificationQueue.getJobs([
      "waiting",
      "active",
      "delayed",
    ]);

    // Find all jobs matching this notification
    const matchingJobs = allJobs.filter((job) =>
      job.id.startsWith(baseJobId)
    );

    if (matchingJobs.length > 1) {
      console.log(
        `🧹 [Cleanup] Found ${matchingJobs.length} duplicate jobs for ${baseJobId}`
      );

      // Keep the first job, remove others
      for (let i = 1; i < matchingJobs.length; i++) {
        await matchingJobs[i].remove();
        console.log(`🗑️ [Cleanup] Removed duplicate job: ${matchingJobs[i].id}`);
      }
    }
  } catch (err) {
    console.error(`❌ [Cleanup Error] for ${baseJobId}:`, err.message);
  }
};

/* ============================= SCHEDULER ============================= */
const startNotificationScheduler = () => {
  console.log("🕒 Notification scheduler started (checks every 60 seconds)");

  setInterval(async () => {
    const now = new Date();
    const today = now.toISOString().split("T")[0];

    try {
      const schedules = await ScheduleNotifications.find({
        date: { $gte: new Date(today) },
        jobAdded: false,
      });

      console.log("schedules", schedules);

      if (!schedules.length) return;

      for (const schedule of schedules) {
        let allQueued = true;

        for (const notif of schedule.notifications) {
          if (notif.isSendOrNot) continue;

          const sendTime = new Date(notif.time_to_send);
          const sendDateStr = sendTime.toISOString().split("T")[0];
          const isTodayOrFuture = sendDateStr >= today;
          const isDue = Math.abs(sendTime - now) <= 2 * 60 * 1000;

          if (!isTodayOrFuture || !isDue) {
            allQueued = false;
            continue;
          }

          const baseJobId = `${schedule._id}-${notif._id}`;

          // Check if ANY job with this base ID exists
          const existingJobs = await notificationQueue.getJobs([
            "waiting",
            "active",
            "delayed",
          ]);

          const hasExistingJob = existingJobs.some((job) =>
            job.id.startsWith(baseJobId)
          );

          if (hasExistingJob) {
            console.log(`⏸ [Skip] Job ${baseJobId} already exists`);
            // Clean duplicates if any
            await cleanDuplicateJobs(baseJobId);
            continue;
          }

          console.log(`📤 [Queue] Queuing notification "${notif.title}"`);

          // Get recipients
          let recipients = [];
          if (schedule.type === "user") {
            const users = await User.find(
              { fcmToken: { $exists: true, $ne: null },appDeleted:false },
              { fcmToken: 1 }
            ).lean();
            recipients = users.map((u) => u.fcmToken);
          } else if (schedule.type === "driver") {
            const riders = await Rider.find(
              { fcmToken: { $exists: true, $ne: null },appDeleted:false },
              { fcmToken: 1 }
            ).lean();
            recipients = riders.map((r) => r.fcmToken);
          }

          if (!recipients.length) {
            console.log(`⚠️ [Skip] No recipients found for ${schedule.type}`);
            allQueued = false;
            continue;
          }

          // Add single job with all recipients (or batch if needed)
          const batchSize = 500;
          let batchIndex = 0;

          for (let i = 0; i < recipients.length; i += batchSize) {
            const batch = recipients.slice(i, i + batchSize);
            const jobId = `${baseJobId}-batch-${batchIndex}`;

            // Double-check before adding
            const jobExists = await notificationQueue.getJob(jobId);
            if (!jobExists) {
              await notificationQueue.add(
                {
                  notification: notif,
                  recipients: batch,
                  scheduleId: schedule._id,
                },
                { jobId, removeOnComplete: true }
              );
              console.log(`✅ [Queued] Batch ${batchIndex} with ${batch.length} recipients`);
            } else {
              console.log(`⏭️ [Skip] Batch job ${jobId} already exists`);
            }

            batchIndex++;
          }

          console.log(
            `✅ [Queued] "${notif.title}" (${recipients.length} total recipients)`
          );
        }

        if (allQueued) {
          schedule.jobAdded = true;
          await schedule.save();
          console.log(
            `🗓 [Updated] Schedule ${schedule._id} marked as jobAdded ✅`
          );
        }
      }
    } catch (err) {
      console.error("🔥 [Scheduler Error]:", err);
    }
  }, 4000);
};

/* ============================= RETRY FAILED TOKENS ============================= */
const retryFailedTokens = async () => {
  console.log("🔁 Retrying failed notifications...");

  const failedLogs = await NotificationSentLog.find({ status: "failed" })
    .limit(1000)
    .lean();
  if (!failedLogs.length) {
    console.log("No failed deliveries to retry.");
    return;
  }

  for (const log of failedLogs) {
    try {
      await sendNotification.sendNotification(
        log.token,
        "Retry: " + (log.title || "Notification"),
        log.message || "You have a pending notification.",
        {},
        "app-notification"
      );

      await NotificationSentLog.updateOne(
        { _id: log._id },
        { status: "sent", error: null, sentAt: new Date() }
      );
      console.log(`✅ Retried for ${log.token.slice(0, 10)}...`);
    } catch (err) {
      await NotificationSentLog.updateOne(
        { _id: log._id },
        { error: err.message }
      );
      console.error(
        `❌ Retry failed for ${log.token.slice(0, 10)}...: ${err.message}`
      );
    }

    await new Promise((r) => setTimeout(r, 200));
  }
};

setInterval(retryFailedTokens, 24 * 60 * 60 * 1000);

/* ============================= EXPORTS ============================= */
module.exports = {
  scheduleNotificationQueue: notificationQueue,
  startNotificationScheduler,
  retryFailedTokens,
};