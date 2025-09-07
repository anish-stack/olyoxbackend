const mongoose = require('mongoose');

// Define a GeoJSON Schema for service areas
const serviceAreaSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    location: {
        type: {
            type: String,
            enum: ['Point'],
            required: true
        },
        coordinates: {
            type: [Number],
            required: true,
            validate: {
                validator: function (v) {
                    return v.length === 2;
                },
                message: props => `Coordinates should be an array of 2 numbers, but got ${props.value.length}.`
            }
        }
    }
});

// Define the call timing schema
const callTimingSchema = new mongoose.Schema({
    start_time: {
        type: String,
        required: true
    },

    end_time: {
        type: String,
        required: true

    }
});

const Heavy_vehicle_partners = new mongoose.Schema({
    Bh_Id: {
        type: String,
        required: true,
        unique: true,
    },
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        match: [/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9]{2,}$/, 'Please enter a valid email address!']
    },
    phone_number: {
        type: String,
        required: true,
        unique: true,
        match: [/^[0-9]{10}$/, 'Please enter a valid 10-digit phone number!']
    },
    vehicle_info: [{
        type: mongoose.Types.ObjectId,
        ref: 'Vehicle'
    }],
    service_areas: [serviceAreaSchema],
    call_timing: callTimingSchema,
    profile_image: {
        url: String,
        public_id: String
    },
    status: {
        type: String,
        default: 'Inactive',
        enum: ['Active', 'Inactive', 'Suspended']
    },
    is_blocked: {
        type: Boolean,
        default: false
    },
    documents: [{
        type: mongoose.Types.ObjectId,
        ref: 'HeavyVehicleDocuments'
    }],
    isAlldocumentsVerified: {
        type: Boolean,
        default: false
    },
    profile_shows_at_position: {
        type: Number,

        min: [1, 'Profile position must be greater than or equal to 1.']
    },
    isFreeMember: {
        type: Boolean,
        default: false
    },
    freeTierEndData: {
        type: Date,
        default: null
    },
    isPaid: {
        type: Boolean,
        default: false
    },
    RechargeData: {
        rechargePlan: String,
        expireData: Date,
        approveRecharge: Boolean,
        onHowManyEarning: String,
        whichDateRecharge: Date,

    },

    otp: {
        type: Number
    },
    otp_expires: {
        type: Date
    },
    profile_image: {
        type: String,
    },
    is_working: {
        type: Boolean,
        default: false
    },
    lastNotificationSent: {
        type: Date,
        default: null,
    },

}, { timestamps: true });

// Create index for location-based queries
Heavy_vehicle_partners.index({ 'service_areas.location': '2dsphere' });

module.exports = mongoose.model('Heavy_vehicle_partners', Heavy_vehicle_partners);