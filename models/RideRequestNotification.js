const mongoose = require('mongoose');

const RideRequestNotificationSchema = new mongoose.Schema({
    rideRequestId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'RideRequest',
        required: true
    },
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Riders',
        required: true
    },
    status: {
        type: String,
        enum: ['sent', 'accepted', 'cancelled', 'expired'],
        default: 'sent'
    },
    notifiedAt: {
        type: Date,
        default: Date.now
    },
    acceptedAt: Date,
    cancelledAt: Date,
    cancellationReason: String
}, { timestamps: true });

// Create compound index to ensure a driver gets only one notification per ride
RideRequestNotificationSchema.index({ rideRequestId: 1, driverId: 1 }, { unique: true });

const RideRequestNotification = mongoose.model('RideRequestNotification', RideRequestNotificationSchema);
module.exports = RideRequestNotification;