const mongoose = require('mongoose');

const { Schema } = mongoose;

// Notification schema
const NotificationSchema = new Schema({
  title: {
    type: String,
    required: true,
    trim: true,
  },
  message: {
    type: String,
    required: true,
  },
  time_to_send: {
    type: Date,
    default: Date.now,
  },
  isSendOrNot: {
    type: Boolean,
    default: false,
  },
});

// Schedule notifications schema
const ScheduleNotificationsSchema = new Schema(
  {
    date: {
      type: Date,
      default: Date.now,
    },
    jobAdded: {
      type: Boolean,
      default: false,
    },
    type: {
      type: String,
      default: "user",
      enum: ["user", "driver"]
    },
    notifications: [NotificationSchema],
  },
  { timestamps: true }
);

module.exports = mongoose.model('ScheduleNotifications', ScheduleNotificationsSchema);
