const mongoose = require('mongoose');

const intercityRidesSchema = new mongoose.Schema({
    // Basic ride information
    rideId: {
        type: String,
        required: true,
        unique: true,
        default: () => 'RIDE_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9)
    },
    driverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Rider',
        required: false
    },
    passengerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    // Route information with GeoJSON
    route: {
        origin: {
            city: {
                type: String,
                required: true,
                trim: true
            },
            location: {
                type: {
                    type: String,
                    enum: ['Point'],
                    default: 'Point'
                },
                coordinates: {
                    type: [Number], // [longitude, latitude]
                    required: true,
                    validate: {
                        validator: function (coords) {
                            return coords.length === 2 &&
                                coords[0] >= -180 && coords[0] <= 180 && // longitude
                                coords[1] >= -90 && coords[1] <= 90;     // latitude
                        },
                        message: 'Invalid coordinates format'
                    }
                }
            },
            address: {
                type: String,
                required: true,
                trim: true
            }
        },
        destination: {
            city: {
                type: String,
                required: true,
                trim: true
            },
            location: {
                type: {
                    type: String,
                    enum: ['Point'],
                    default: 'Point'
                },
                coordinates: {
                    type: [Number], // [longitude, latitude]
                    required: true,
                    validate: {
                        validator: function (coords) {
                            return coords.length === 2 &&
                                coords[0] >= -180 && coords[0] <= 180 && // longitude
                                coords[1] >= -90 && coords[1] <= 90;     // latitude
                        },
                        message: 'Invalid coordinates format'
                    }
                }
            },
            address: {
                type: String,
                required: true,
                trim: true
            }
        },
        distance: {
            type: Number, // in kilometers
            required: true,
            min: 0
        },
        estimatedDuration: {
            type: Number, // in minutes
            required: true,
            min: 0
        }
    },

    // Timing information
    schedule: {
        departureTime: {
            type: Date,
            required: true
        },
        arrivalTime: {
            type: Date,
            required: true
        },
        isRecurring: {
            type: Boolean,
            default: false
        },
        recurringDays: [{
            type: String,
            enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
        }]
    },

    // Pricing information
    pricing: {
        basePrice: {
            type: Number,
            required: true,
            min: 0
        },
        additionalCharges: {
            type: Number,
            default: 0,
            min: 0
        },
        totalPrice: {
            type: Number,
            required: true,
            min: 0
        },
        currency: {
            type: String,
            default: 'INR',
            enum: ['INR', 'USD', 'EUR', 'GBP']
        }
    },

    // Vehicle information
    vehicle: {
        type: {
            type: String,
            required: true
        },
        capacity: {
            type: Number,
            required: true,
            min: 1
        }

    },

    // Ride status and tracking
    status: {
        type: String,
        enum: ['scheduled', 'driver_assigned', 'driver_reached', 'otp_verify', 'ride_in_progress', 'completed', 'cancelled', 'delayed'],
        default: 'scheduled'
    },

    // Status timeline with timestamps
    statusTimeline: [{
        status: {
            type: String,
            enum: ['scheduled', 'driver_assigned', 'driver_reached', 'otp_verify', 'ride_in_progress', 'completed', 'cancelled', 'delayed'],
            required: true
        },
        timestamp: {
            type: Date,
            default: Date.now
        },
        notes: {
            type: String,
            maxlength: 200
        }
    }],

    rideType: {
        type: String,
        enum: ['one_way', 'round_trip'],
        default: 'one_way'
    },
    rideCategory: {
        type: String,
        enum: ['leave-now', 'scheduled'],
        default: 'scheduled'
    },

    // OTP for verification
    otp: {
        code: {
            type: String,
            length: 6
        },
        generatedAt: {
            type: Date
        },
        verifiedAt: {
            type: Date
        },
        isVerified: {
            type: Boolean,
            default: false
        },
        expiresAt: {
            type: Date
        }
    },

    rejectedByDrivers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Riders'
    }],
    // Ratings and reviews
    reviews: [{
        reviewerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        rating: {
            type: Number,
            min: 1,
            max: 5,
            required: true
        },
        comment: {
            type: String,
            maxlength: 500
        },
        reviewDate: {
            type: Date,
            default: Date.now
        }
    }],

    // Payment information
    payment: {
        method: {
            type: String,
            enum: ['cash', 'card', 'upi', 'wallet'],
            default: 'cash'
        },
        status: {
            type: String,
            enum: ['pending', 'completed', 'failed', 'refunded'],
            default: 'pending'
        },

        paidAt: {
            type: Date
        }
    },

    cancellation: {
        by: { type: String, enum: ["driver", "user", "system"], required: false },
        reason: { type: String,  },
        at: { type: Date,  }
    },

  messageSendToDriver: [
  {
    driver_id: { type: mongoose.Schema.Types.ObjectId, ref: "Driver", required: true },
    at_time: { type: Date, default: Date.now }
  }
],


    // Metadata
    createdAt: {
        type: Date,
        default: Date.now
    },
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Create 2dsphere indexes for geospatial queries
intercityRidesSchema.index({ 'route.origin.location': '2dsphere' });
intercityRidesSchema.index({ 'route.destination.location': '2dsphere' });

// Other indexes for better query performance
intercityRidesSchema.index({ 'route.origin.city': 1, 'route.destination.city': 1 });
intercityRidesSchema.index({ 'schedule.departureTime': 1 });
intercityRidesSchema.index({ status: 1 });
intercityRidesSchema.index({ driverId: 1 });
intercityRidesSchema.index({ passengerId: 1 });
intercityRidesSchema.index({ createdAt: -1 });

// Virtual for calculating total revenue
intercityRidesSchema.virtual('totalRevenue').get(function () {
    return this.pricing.totalPrice;
});

// Pre-save middleware to update the updatedAt field and calculate total price
intercityRidesSchema.pre('save', function (next) {
    this.updatedAt = Date.now();

    // Calculate total price
    this.pricing.totalPrice = this.pricing.basePrice + this.pricing.additionalCharges;

    // Calculate arrival time if not set
    if (!this.schedule.arrivalTime && this.schedule.departureTime && this.route.estimatedDuration) {
        this.schedule.arrivalTime = new Date(this.schedule.departureTime.getTime() + (this.route.estimatedDuration * 60000));
    }

    next();
});

// Method to calculate distance between two coordinates using Haversine formula
intercityRidesSchema.statics.calculateDistance = function (lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// Method to estimate travel time (basic calculation)
intercityRidesSchema.statics.estimateTime = function (distance) {
    const averageSpeed = 60; // km/h for intercity travel
    const totalMinutes = Math.round((distance / averageSpeed) * 60);

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    let timeString = "";
    if (hours > 0) {
        timeString += `${hours} hour${hours > 1 ? "s" : ""} `;
    }
    if (minutes > 0) {
        timeString += `${minutes} min`;
    }

    return timeString.trim();
};


// Method to update ride status with timestamp
intercityRidesSchema.methods.updateStatus = function (newStatus, notes = '') {
    this.status = newStatus;
    this.statusTimeline.push({
        status: newStatus,
        timestamp: new Date(),
        notes: notes
    });
    return this.save();
};

// Method to generate OTP with expiration
intercityRidesSchema.methods.generateOTP = function () {
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expirationTime = new Date(Date.now() + 200 * 60 * 1000); // 10 minutes

    this.otp = {
        code: otpCode,
        generatedAt: new Date(),
        expiresAt: expirationTime,
        isVerified: false
    };
    return this.save();
};

// Method to verify OTP
intercityRidesSchema.methods.verifyOTP = function (inputOTP) {
    if (this.otp.code === inputOTP &&
        !this.otp.isVerified) {

        this.otp.verifiedAt = new Date();
        this.otp.isVerified = true;
        this.updateStatus('ride_in_progress', 'OTP verified, ride started');
        return true;
    }
    return false;
};

// Method to check if ride can be cancelled
intercityRidesSchema.methods.canBeCancelled = function () {
    const now = new Date();
    const departureTime = new Date(this.schedule.departureTime);
    const timeDiff = departureTime - now;
    const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds

    return timeDiff > oneHour && ['scheduled', 'driver_assigned'].includes(this.status);
};

const IntercityRide = mongoose.model("IntercityRide", intercityRidesSchema);
module.exports = IntercityRide;