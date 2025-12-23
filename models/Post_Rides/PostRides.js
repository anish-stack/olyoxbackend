const mongoose = require('mongoose');

const postRidesSchema = new mongoose.Schema(
    {
        userName: {
            type: String,
            required: true,
            trim: true,
        },
        phone: {
            type: String,
            required: true,
            trim: true,
        },
        vehicleType: {
            type: String,
            required: true,
        },
        pickupLocation: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point',
            },
            coordinates: [Number], // [longitude, latitude]
            address: String,
        },
        dropLocation: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point',
            },
            coordinates: [Number], // [longitude, latitude]
            address: String,
        },
        pick_desc: String,
        drop_desc: String,
        fare: {
            type: Number,
            required: true,
        },
        tripType: {
            type: String,
            enum: ['oneway', 'roundTrip'],
            default: 'oneway',
        },
        isLater: {
            type: Boolean,
            default: false,
        },
        scheduledDate: Date,
        scheduledTime: String,
        distance: Number,
        couponCode: String,
        discount: {
            type: Number,
            default: 0,
        },
        status: {
            type: String,
            enum: ['pending', 'confirmed', 'inProgress', 'completed', 'cancelled'],
            default: 'pending',
        },
        driverAssignment: {
            driverId: mongoose.Schema.Types.ObjectId,
            driverName: String,
            driverPhone: String,
            driverRating: Number,
            vehiclePlate: String,
            assignedAt: Date,
        },
        estimatedTime: Number, // in minutes
        actualTime: Number,
        rideStartTime: Date,
        rideEndTime: Date,
        paymentStatus: {
            type: String,
            enum: ['pending', 'completed', 'failed'],
            default: 'pending',
        },
        paymentMethod: {
            type: String,
            enum: ['cash', 'card', 'wallet'],
        },
        specialRequests: String,
        cancellationReason: String,
        ratings: {
            driverRating: Number,
            rideRating: Number,
            feedback: String,
        },
    },
    {
        timestamps: true,
    }
);

// Index for geospatial queries
postRidesSchema.index({ 'pickupLocation.coordinates': '2dsphere' });
postRidesSchema.index({ 'dropLocation.coordinates': '2dsphere' });
postRidesSchema.index({ status: 1 });
postRidesSchema.index({ userName: 1 });

module.exports = mongoose.model('PostRides', postRidesSchema);