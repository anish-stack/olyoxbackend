const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const GeoPointSchema = {
    type: {
        type: String,
        enum: ['Point'],
        required: true,
        default: 'Point'
    },
    coordinates: {
        type: [Number],
        required: true,
        validate: {
            validator: function (value) {
                return value.length === 2;
            },
            message: 'Coordinates must be an array of [longitude, latitude]'
        }
    }
};

const ParcelRequestSchema = new Schema({
    customerId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },

    status: {
        type: String,
        default: 'pending'
    },
    deliveryOtp:{
        type: String,
    },
    driver_accept: { type: Boolean, default: false },
    driver_accept_time: { type: Date },
    driver_deliver_time: { type: Date },
    driver_rating: { type: Number, min: 0, max: 5 },
    otp: { type: Number },
    otpFieldTime: {
        type: Date
    },
    money_collected: { type: Number, default: 0 },
    money_collected_mode: { type: String, enum: ['cash', 'online', 'wallet'], default: 'cash' },

    is_parcel_delivered: { type: Boolean, default: false },
    is_parcel_delivered_time: { type: Date },

    is_driver_reached: { type: Boolean, default: false },
    is_driver_reached_time: { type: Date },
    is_driver_reached_at_deliver_place: { type: Boolean, default: false },
    is_driver_reached_at_deliver_place_time: { type: Date },
    is_parcel_picked: { type: Boolean, default: false },
    is_parcel_picked_time: { type: Date },

    is_parcel_cancel_by_user:{
        type: Boolean,
        default: false
    },
    is_parcel_cancel_by_user_time:{
        type: Date
    },


    locations: {
        pickup: {
            address: { type: String },
            location: GeoPointSchema
        },
        dropoff: {
            address: { type: String },
            location: GeoPointSchema
        },
        stops: [{
            address: { type: String },
            location: GeoPointSchema
        }]
    },

    apartment: { type: String },
    name: { type: String },
    phone: { type: String },
    useMyNumber: { type: Boolean, default: false },
    savedAs: { type: String, default: null },

    vehicle_id: { type: Schema.Types.ObjectId, ref: 'VehicleForParcel' },


    fares: {
        baseFare: { type: Number, default: 0 },
        netFare: { type: Number, default: 0 },
        couponApplied: { type: Boolean, default: false },
        discount: { type: Number, default: 0 },
        payableAmount: { type: Number, default: 0 }
    },

    is_rider_assigned: { type: Boolean, default: false },
    rider_id: {
        type: Schema.Types.ObjectId, ref: 'Rider'
    },
    ride_id: { type: String },
    km_of_ride: { type: Number, default: 0 },

    is_booking_completed: { type: Boolean, default: false },
    is_booking_cancelled: { type: Boolean, default: false },
    is_booking_cancelled_time: { type: Date },
    is_pickup_complete: { type: Boolean, default: false },
    is_dropoff_complete: { type: Boolean, default: false }
}, {
    timestamps: true
});

// 🔍 Create 2dsphere indexes for geo-queries
ParcelRequestSchema.index({ 'locations.pickup.location': '2dsphere' });
ParcelRequestSchema.index({ 'locations.dropoff.location': '2dsphere' });
ParcelRequestSchema.index({ 'locations.stops.location': '2dsphere' });

module.exports = mongoose.model('ParcelRequest', ParcelRequestSchema);
