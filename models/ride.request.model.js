const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const RideRequestSchema = new Schema({
    pickupLocation: {
        type: {
            type: String,
            enum: ['Point'],
            required: true
        },
        coordinates: {
            type: [Number],
            required: true
        }
    },
    dropLocation: {
        type: {
            type: String,
            enum: ['Point'],
            required: true
        },
        coordinates: {
            type: [Number],
            required: true
        }
    },
    currentLocation: {
        type: {
            type: String,
            enum: ['Point'],
            required: true
        },
        coordinates: {
            type: [Number],
            required: true
        }
    },
    priceOfRide: {
        type: Number,
    },
    waitTingTime: {
        type: Number,
    },
    rideStart: {
        type: Date,
    },
    RideOtp: {
        type: String,
    },
    RideEnd: {
        type: Date,
    },
    isPaymentDone: {
        type: Boolean,
    },
    kmOfRide: {
        type: String,
    },
    EtaOfRide: {
        type: String,
    },
    RatingOfRide: {
        type: Number,
    },
    vehicleType: {
        type: String,
    },
    rideStatus: {
        type: String,
        enum: ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'],
        default: 'pending'
    },
    paymentMethod: {
        type: String,
    },
    rideCancelBy: {
        type: String,
    },
    rideCancelTime: {
        type: Date,
    },
    lastError: {
        type: String,

    },
    lastErrorAt: {
        type: Date
    },
    rideCancelReason: {
        type: Schema.Types.ObjectId,
        ref: 'Settings',
    },
    pickup_desc: {
        type: String,
    },
    drop_desc: {
        type: String,
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
    },
    ride_is_started: {
        type: Boolean,
        default: false
    },
    ride_start_time: {
        type: Date,
    },
    is_ride_paid: {
        type: Boolean,
        default: false
    },
    ride_end_time: {
        type: Date,

    },
    retryCount: {
        type: Number,
        default: 0
    },
    lastRetryAt: {
        type: Date
    },
    maxSearchRadius: {
        type: String
    },
    currentSearchRadius: {
        type: Number,
        default: 0
    },
    rejectedByDrivers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Riders'
    }],
    searchRadius: {
        type: Number,
        default: 5
    },
    autoIncreaseRadius: {
        type: Boolean,
        default: true
    },
    rider: {
        type: Schema.Types.ObjectId,
        ref: 'Rider',
    },
    userFcm:{
        type:String,
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Create 2dsphere indexes for location fields
RideRequestSchema.index({ pickupLocation: '2dsphere' });
RideRequestSchema.index({ dropLocation: '2dsphere' });
RideRequestSchema.index({ currentLocation: '2dsphere' });

// Update the updatedAt field before saving
RideRequestSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

module.exports = mongoose.model('RideRequest', RideRequestSchema);
