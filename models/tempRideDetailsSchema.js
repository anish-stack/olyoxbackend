const mongoose = require('mongoose');

const tempRideDetailsSchema = new mongoose.Schema({
    driver: {
        name: String,
        carModel: String,
        carNumber: String,
        vehicleType: String,
        rating: Number,
        trips: Number,
        distance: String,
        price: String,
        otp: String,
        pickup_desc: String,
        drop_desc: String,
        eta: String,
        rideStatus: String,
    },
    rideDetails: {
        _id: mongoose.Schema.Types.ObjectId,
        RideOtp: String,
        rideStatus: String,
        ride_is_started: Boolean,
        ride_otp_verified: Boolean,
        eta: String,
        is_ride_cancel: Boolean,
        EtaOfRide: String,
        is_ride_paid: Boolean,
        kmOfRide: String,
        pickup_desc: String,
        drop_desc: String,
        createdAt: Date,
        ride_start_time:Date,
        otp_verify_time:Date,
        isOtpVerify:Boolean,
        ride_end_time:Date,
        updatedAt: Date,
        currentLocation: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point',
            },
            coordinates: {
                type: [Number],
                default: [0, 0],
            },
        },
        dropLocation: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point',
            },
            coordinates: {
                type: [Number],
                default: [0, 0],
            },
        },
        pickupLocation: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point',
            },
            coordinates: {
                type: [Number],
                default: [0, 0],
            },
        },
        retryCount: { type: Number, default: 0 },
        currentSearchRadius: { type: Number, default: 0 },
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rider: {
            _id: mongoose.Schema.Types.ObjectId,
            name: String,
            phone: String,
            Ratings: Number,
            TotalRides: Number,
            isActive: Boolean,
            isAvailable: Boolean,
            isPaid: Boolean,
            isProfileComplete: Boolean,
            DocumentVerify: Boolean,
            BH: String,
            YourQrCodeToMakeOnline: String,
        },
    },
    message: String,
});


tempRideDetailsSchema.index({ 'rideDetails.currentLocation': '2dsphere' });
tempRideDetailsSchema.index({ 'rideDetails.pickupLocation': '2dsphere' });
tempRideDetailsSchema.index({ 'rideDetails.dropLocation': '2dsphere' });

module.exports = mongoose.model('TempRideDetails', tempRideDetailsSchema);
