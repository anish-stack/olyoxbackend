const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const NotificationSchema = new Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User", // Reference to the User model
        required: false, // If null, it's a global notification
    },
    title: {
        type: String,
        required: true,
        trim: true,
    },
    description: {
        type: String,
        required: true,
        trim: true,
    },
    image: {
        type: String, // URL to an image/icon for the notification
        required: false,
    },
    type: {
        type: String,
        enum: ["info", "warning", "success", "error", "promotion"],
        default: "info",
    },
    priority: {
        type: String,
        enum: ["low", "medium", "high"],
        default: "medium",
    },
    isRead: {
        type: Boolean,
        default: false,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    expireTime: {
        type: Date, // Auto-remove expired notifications
        required: false,
    },
    scheduleTime: {
        type: Date, // For scheduling notifications
        required: false,
    },
    actions: [
        {
            buttonText: { type: String, required: true },
            link: { type: String, required: true },
        }
    ],
    createdAt: {
        type: Date,
        default: Date.now,
    }
});

// Auto-delete expired notifications
NotificationSchema.index({ expireTime: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('Notification', NotificationSchema);
