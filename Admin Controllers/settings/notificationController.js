const Nottification = require("../../models/Admin/Nottification");

// ✅ Create a new notification
exports.createNotification = async (req, res) => {
  try {
    const { userId, title, description, image, type, priority, expireTime, scheduleTime, actions } = req.body;

    const newNotification = new Nottification({
      userId,
      title,
      description,
      image,
      type,
      priority,
      expireTime,
      scheduleTime,
      actions
    });

    await newNotification.save();
    res.status(201).json({ success: true, message: "Notification created successfully", notification: newNotification });
  } catch (error) {
    console.error("Error creating notification:", error);
    res.status(500).json({ success: false, message: "Failed to create notification", error: error.message });
  }
};

// ✅ Get all notifications (with optional filters)
exports.getNotifications = async (req, res) => {
  try {
    const { userId, type, isRead } = req.query;
    let filter = {};

    if (userId) filter.userId = userId;
    if (type) filter.type = type;
    if (isRead !== undefined) filter.isRead = isRead === "true";

    const notifications = await Nottification.find(filter).sort({ createdAt: -1 });

    res.status(200).json({ success: true, notifications });
  } catch (error) {
    console.error("Error fetching notifications:", error);
    res.status(500).json({ success: false, message: "Failed to fetch notifications", error: error.message });
  }
};

// ✅ Get a single notification by ID
exports.getNotificationById = async (req, res) => {
  try {
    const { id } = req.params;
    const notification = await Nottification.findById(id);

    if (!notification) return res.status(404).json({ success: false, message: "Notification not found" });

    res.status(200).json({ success: true, notification });
  } catch (error) {
    console.error("Error fetching notification:", error);
    res.status(500).json({ success: false, message: "Failed to fetch notification", error: error.message });
  }
};

// ✅ Mark a notification as read
exports.markAsRead = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedNotification = await Nottification.findByIdAndUpdate(id, { isRead: true }, { new: true });

    if (!updatedNotification) return res.status(404).json({ success: false, message: "Notification not found" });

    res.status(200).json({ success: true, message: "Notification marked as read", notification: updatedNotification });
  } catch (error) {
    console.error("Error marking notification as read:", error);
    res.status(500).json({ success: false, message: "Failed to update notification", error: error.message });
  }
};

// ✅ Delete a notification
exports.deleteNotification = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedNotification = await Nottification.findByIdAndDelete(id);

    if (!deletedNotification) return res.status(404).json({ success: false, message: "Notification not found" });

    res.status(200).json({ success: true, message: "Notification deleted successfully" });
  } catch (error) {
    console.error("Error deleting notification:", error);
    res.status(500).json({ success: false, message: "Failed to delete notification", error: error.message });
  }
};

// ✅ Send scheduled notifications
exports.sendScheduledNotifications = async () => {
  try {
    const now = new Date();
    const notifications = await Nottification.find({ scheduleTime: { $lte: now }, isActive: true });

    if (notifications.length === 0) return;

    for (let notification of notifications) {
      console.log("Sending notification:", notification.title);
      // Integrate push notifications using Expo or Firebase here

      notification.isActive = false; // Mark as sent
      await notification.save();
    }
  } catch (error) {
    console.error("Error sending scheduled notifications:", error);
  }
};
