const ScheduleNotifications = require("../../models/Admin/ScheduleNotifications");
exports.addNotifications = async (req, res) => {
  try {
    const { date, notifications,type } = req.body;

    if (!date) {
      return res.status(400).json({ success: false, message: "Date is required" });
    }

    if (!Array.isArray(notifications) || notifications.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "At least one notification is required" });
    }

    // Validate all notifications
    for (const n of notifications) {
      if (!n.title || !n.message) {
        return res
          .status(400)
          .json({ success: false, message: "Each notification must have a title and message" });
      }
    }

    // Check if a schedule already exists for the given date
    let schedule = await ScheduleNotifications.findOne({ date: new Date(date) });

    if (schedule) {
      // Append to existing date schedule
      schedule.notifications.push(...notifications);
      await schedule.save();
      return res.status(201).json({
        success: true,
        message: "Notifications added to existing schedule",
        data: schedule,
      });
    }

    // Create new schedule for that date
    const newSchedule = new ScheduleNotifications({
      date: new Date(date),
      notifications,
      type
    });

    await newSchedule.save();

    res.status(201).json({
      success: true,
      message: "New schedule created and notifications added",
      data: newSchedule,
    });
  } catch (error) {
    console.error("Add Notifications Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error", error });
  }
};

// ✅ Get all notifications
exports.getAllNotifications = async (req, res) => {
  try {
    const schedules = await ScheduleNotifications.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, data: schedules });
  } catch (error) {
    console.error('Get Notifications Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error', error });
  }
};
exports.updateNotification = async (req, res) => {
  try {
    const { scheduleId, notificationId } = req.params;
    const { title, message, time_to_send } = req.body;

    const schedule = await ScheduleNotifications.findById(scheduleId);
    if (!schedule)
      return res.status(404).json({ success: false, message: "Schedule not found" });

    const notification = schedule.notifications.id(notificationId);
    if (!notification)
      return res.status(404).json({ success: false, message: "Notification not found" });

    if (title) notification.title = title;
    if (message) notification.message = message;
    if (time_to_send) notification.time_to_send = time_to_send;

    await schedule.save();
    res.status(200).json({
      success: true,
      message: "Notification updated successfully",
      data: notification,
    });
  } catch (error) {
    console.error("Update Notification Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error", error });
  }
};

// ✅ Delete a notification by ID
exports.deleteNotification = async (req, res) => {
  try {
    const { scheduleId, notificationId } = req.params;

    const schedule = await ScheduleNotifications.findById(scheduleId);
    if (!schedule)
      return res.status(404).json({ success: false, message: "Schedule not found" });

    const notification = schedule.notifications.id(notificationId);
    if (!notification)
      return res.status(404).json({ success: false, message: "Notification not found" });

    notification.deleteOne();
    await schedule.save();

    res.status(200).json({ success: true, message: "Notification deleted successfully" });
  } catch (error) {
    console.error("Delete Notification Error:", error);
    res.status(500).json({ success: false, message: "Internal Server Error", error });
  }
};

// ✅ Change send status
exports.changeSendStatus = async (req, res) => {
  try {
    const { scheduleId, notificationId } = req.params;
    const { isSendOrNot } = req.body;

    console.log("📩 Change Send Status Request Received:", req.body);
    console.log("➡️ Schedule ID:", scheduleId);
    console.log("➡️ Notification ID:", notificationId);
    console.log("➡️ New Status (isSendOrNot):", isSendOrNot);

    // Fetch the schedule
    const schedule = await ScheduleNotifications.findById(scheduleId);
    if (!schedule) {
      console.log("❌ Schedule not found for ID:", scheduleId);
      return res.status(404).json({ success: false, message: "Schedule not found" });
    }

    console.log("✅ Schedule found:", schedule.date);

    // Find the specific notification
    const notification = schedule.notifications.id(notificationId);
    if (!notification) {
      console.log("❌ Notification not found for ID:", notificationId);
      return res.status(404).json({ success: false, message: "Notification not found" });
    }

    console.log("📝 Current Notification Status:", notification.isSendOrNot);
    notification.isSendOrNot = isSendOrNot;
    console.log("🔄 Updated Notification Status:", notification.isSendOrNot);

    // Save the updated schedule
    await schedule.save();
    console.log("💾 Schedule saved successfully after updating notification status.");

    res.status(200).json({
      success: true,
      message: "Send status updated successfully",
      data: notification,
    });

  } catch (error) {
    console.error("🔥 Change Send Status Error:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message || error,
    });
  }
};
