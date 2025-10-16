const mongoose = require('mongoose');
const Schema = mongoose.Schema;


const LocationSchema = new Schema({
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
            validator: function (coords) {
                return coords.length === 2 &&
                    coords[0] >= -180 && coords[0] <= 180 &&
                    coords[1] >= -90 && coords[1] <= 90;
            },
            message: 'Coordinates must be [longitude, latitude] with valid ranges'
        }
    }
}, { _id: false });




const chatSchema = new Schema(
    {
        from: { type: Schema.Types.ObjectId, ref: "User", required: true },
        fromType: { type: String, enum: ["driver", "user"], required: true },
        to: { type: Schema.Types.ObjectId, ref: "User" },
        message: {
            type: String,
            required: true,
            trim: true,
        },
        type: {
            type: String,
            enum: ["text", "image", "video", "audio", "file"],
            default: "text",
        },
        seen: {
            type: Boolean,
            default: false,
        },
    },
    { timestamps: true } // automatically adds createdAt & updatedAt
);



const AddressSchema = new Schema({
    formatted_address: { type: String, trim: true },
    street_number: { type: String, trim: true },
    route: { type: String, trim: true },
    locality: { type: String, trim: true },
    administrative_area: { type: String, trim: true },
    country: { type: String, trim: true },
    postal_code: { type: String, trim: true },
    place_id: { type: String, trim: true }
}, { _id: false });

// Pricing breakdown subdocument
const PricingSchema = new Schema({
    base_fare: { type: Number, min: 0, default: 0 },
    distance_fare: { type: Number, min: 0, default: 0 },
    time_fare: { type: Number, min: 0, default: 0 },
    original_fare: {
        type: Number, min: 0, default: 0
    },

    platform_fee: { type: Number, min: 0, default: 0 },
    night_charge: {
        type: Number, min: 0, default: 0
    },
    rain_charge: {
        type: Number, min: 0, default: 0
    },
    collected_amount: {
        type: Number, min: 0, default: 0
    },
    toll_charge: {
        type: Number, min: 0, default: 0
    },
    discount: { type: Number, min: 0, default: 0 },
    total_fare: { type: Number, min: 0, required: true },
    currency: { type: String, default: 'INR', uppercase: true }
}, { _id: false });

// Driver tracking subdocument
const DriverTrackingSchema = new Schema({
    current_location: LocationSchema,
    last_updated: { type: Date, default: Date.now },
    bearing: { type: Number, min: 0, max: 360 },
    speed: { type: Number, min: 0 } // km/h
}, { _id: false });

// Main RideRequest Schema
const RideRequestSchema = new Schema({

    pickup_location: {
        type: LocationSchema,
        required: [true, 'Pickup location is required']
    },
    pickup_address: AddressSchema,

    drop_location: {
        type: LocationSchema,
        required: [true, 'Drop location is required']
    },
    drop_address: AddressSchema,


    route_info: {
        distance: { type: Number, min: 0 },
        duration: { type: Number, min: 0 },
        polyline: { type: String },
        waypoints: [LocationSchema]
    },


    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        // required: [true, 'User reference is required'],
        // index: true
    },
    user_fcm_token: {
        type: String,
        trim: true
    },

    driver: {
        type: Schema.Types.ObjectId,
        ref: 'Rider',
        index: true
    },
    driver_tracking: DriverTrackingSchema,

    // Vehicle Information
    vehicle_type: {
        type: String,
        required: [true, 'Vehicle type is required'],
        lowercase: true
    },
    vehicle_details: {
        make: String,
        model: String,
        year: Number,
        color: String,
        license_plate: String
    },
    isFake: {
        type: Boolean,
        default: false
    },
    isFake: {
        type: Boolean,
        default: false
    },
    fake_rider_details: {
        name: {
            type: String,
            default: null
        },
        phone: {
            type: String,
            default: null
        }
    },

    chat: [chatSchema],

    ride_status: {
        type: String,
        enum: ['pending', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress', 'completed', 'cancelled'],
        default: 'pending',
        required: true,
        index: true
    },
    search_started_at: {
        type: Date
    },
    // OTP for ride verification
    ride_otp: {
        type: String,
        minlength: 4,
        maxlength: 6,
        match: /^\d{4,6}$/
    },

    // Timing Information
    requested_at: {
        type: Date,
        default: Date.now,
        required: true,
        index: true
    },
    scheduled_at: {
        type: Date,
        validate: {
            validator: function (date) {
                return !date || date > new Date();
            },
            message: 'Scheduled time must be in the future'
        }
    },
    driver_assigned_at: Date,
    driver_arrived_at: Date,
    ride_started_at: Date,
    ride_ended_at: Date,

    // Wait time in minutes
    wait_time: {
        type: Number,
        min: 0,
        default: 0
    },

    // ETA in minutes
    eta: {
        type: Number,
        min: 0
    },

    // Pricing Information
    pricing: {
        type: PricingSchema,
        required: true
    },

    // Payment Information
    payment_method: {
        type: String,
        enum: ['cash', 'card', 'wallet', 'digital', 'upi', 'paypal', 'online'],
        required: [true, 'Payment method is required'],
        lowercase: true
    },
    payment_status: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed', 'refunded', 'cancelled'],
        default: 'pending'
    },
    payment_transaction_id: String,

    // Rating and Feedback
    user_rating: {
        rating: { type: Number, min: 1, max: 5 },
        feedback: { type: String, maxlength: 500, trim: true },
        created_at: { type: Date, default: Date.now }
    },
    driver_rating: {
        rating: { type: Number, min: 1, max: 5 },
        feedback: { type: String, maxlength: 500, trim: true },
        created_at: { type: Date, default: Date.now }
    },

    // Cancellation Information
    cancelled_by: {
        type: String,
        enum: ['user', 'driver', 'system', 'admin']
    },
    cancelled_at: Date,
    cancellation_reason: {
        type: String,

    },
    cancellation_fee: {
        type: Number,
        min: 0,
        default: 0
    },

    // Driver Search and Assignment
    search_radius: {
        type: Number,
        default: 5,
        min: 1,
        max: 50
    },
    max_search_radius: {
        type: Number,
        default: 25,
        min: 5,
        max: 100
    },
    auto_increase_radius: {
        type: Boolean,
        default: true
    },
    rejected_by_drivers: [{
        driver: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Rider'
        },
        rejected_at: {
            type: Date,
            default: Date.now
        },
        byFake: {
            type: Boolean,
            default: false
        }

    }],

    // Retry and Error Handling
    retry_count: {
        type: Number,
        default: 0,
        min: 0,
        max: 5
    },
    last_retry_at: Date,
    last_error: {
        message: String,
        code: String,
        occurred_at: {
            type: Date,
            default: Date.now
        }
    },

    // Audit fields
    created_at: {
        type: Date,
        default: Date.now,
        immutable: true
    },
    updated_at: {
        type: Date,
        default: Date.now
    },
    last_notification_sent_at: {
        type: Date,
    },
    cashback: {
        type: Number,
        default: 0
    },
    isCashbackGet: {
        type: Boolean,
        default: true
    },
    // Add this to your RideBooking schema

    notified_riders: [{
        rider_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Rider',
            required: true,
            index: true // Add index for faster lookups
        },
        distance_from_pickup: {
            type: Number, // Distance in meters
            required: true
        },
        distance_from_pickup_km: {
            type: String, // Distance in km (formatted)
            required: true
        },
        notification_time: {
            type: Date,
            required: true,
            default: Date.now
        },
        notification_count: {
            type: Number,
            default: 1,
            min: 1
        },
        rider_location: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                required: false
            }
        },
        search_attempt: {
            type: Number, // Which retry attempt this notification was sent on
            default: 1,
            min: 1
        },
        search_radius: {
            type: Number, // Radius used for this search (in meters)
        },
        notification_failed: {
            type: Boolean,
            default: false
        },
        error_message: {
            type: String,
            required: false // Only present if notification_failed is true
        },
        error_code: {
            type: String,
            required: false // Only present if notification_failed is true
        },
        notification_history: [{
            time: {
                type: Date,
                required: true
            },
            distance: {
                type: Number, // Distance at time of notification
                required: true
            },
            attempt: {
                type: Number, // Search attempt number
                required: true
            },
            success: {
                type: Boolean,
                default: true
            },
            error: {
                type: String,
                required: false // Error message if success is false
            }
        }]
    }],


    isIntercityRides: {
        type: Boolean,
        default: true
    },

    IntercityPickupTime: {
        type: Date,
    },

    rideType: {
        type: String,
    },


    total_notifications_sent: {
        type: Number,
        default: 0
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    versionKey: false
});

// Indexes for performance optimization
RideRequestSchema.index({ pickup_location: '2dsphere' });
RideRequestSchema.index({ drop_location: '2dsphere' });
RideRequestSchema.index({ 'driver_tracking.current_location': '2dsphere' });

// Compound indexes
RideRequestSchema.index({ user: 1, ride_status: 1, created_at: -1 });
RideRequestSchema.index({ driver: 1, ride_status: 1, created_at: -1 });
RideRequestSchema.index({ ride_status: 1, vehicle_type: 1, created_at: -1 });
RideRequestSchema.index({ ride_status: 1, pickup_location: '2dsphere' });


// Virtual fields
RideRequestSchema.virtual('total_duration').get(function () {
    if (this.ride_started_at && this.ride_ended_at) {
        return Math.round((this.ride_ended_at - this.ride_started_at) / (1000 * 60)); // minutes
    }
    return null;
});

RideRequestSchema.virtual('is_active').get(function () {
    return ['pending', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress'].includes(this.ride_status);
});

// Instance methods
RideRequestSchema.methods.calculateDistance = function () {
    if (!this.pickup_location || !this.drop_location) return null;

    const [lng1, lat1] = this.pickup_location.coordinates;
    const [lng2, lat2] = this.drop_location.coordinates;

    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

RideRequestSchema.methods.canCancel = function () {
    return ['pending', 'searching', 'driver_assigned'].includes(this.ride_status);
};

RideRequestSchema.methods.generateOTP = function () {
    this.ride_otp = Math.floor(1000 + Math.random() * 9000).toString();
    return this.ride_otp;
};

// Static methods
RideRequestSchema.statics.findActiveRides = function (userId) {
    return this.find({
        user: userId,
        ride_status: { $in: ['pending', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress'] }
    }).populate('driver', 'name phone_number rating');
};



// Pre-save middleware
RideRequestSchema.pre('save', function (next) {
    // Auto-generate OTP for new rides
    if (this.isNew && !this.ride_otp) {
        this.generateOTP();
    }

    // Calculate distance if not provided
    if (!this.route_info?.distance && this.pickup_location && this.drop_location) {
        this.route_info = this.route_info || {};
        this.route_info.distance = this.calculateDistance();
    }



    next();
});

// Post-save middleware for notifications
RideRequestSchema.post('save', function (doc) {
    console.log(`Ride ${doc._id} status changed to: ${doc.ride_status}`);
});

module.exports = mongoose.model('RideRequestNew', RideRequestSchema);