// models/NotificationSentLog.model.js
const mongoose = require("mongoose");

const NotificationSentLogSchema = new mongoose.Schema(
  {
    scheduleId: { type: mongoose.Schema.Types.ObjectId, required: true },
    notificationId: { type: mongoose.Schema.Types.ObjectId, required: true },
    token: { type: String, required: true }, // FCM token
    status: { type: String, enum: ["sent", "failed"], default: "sent" },
    sentAt: { type: Date, default: Date.now },
    error: { type: String }, // optional error message
  },
  { timestamps: true }
);

// Compound index for fast lookup + cleanup
NotificationSentLogSchema.index({ scheduleId: 1, notificationId: 1, token: 1 }, { unique: true });
NotificationSentLogSchema.index({ sentAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // 30 days TTL

module.exports = mongoose.model("NotificationSentLog", NotificationSentLogSchema);