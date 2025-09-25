const mongoose = require('mongoose');

// Define the user schema
const userSchema = new mongoose.Schema({
    number: {
        type: String,
        index: true,
        unique: true,
    },
    currentRide: {
        type: mongoose.Schema.Types.ObjectId,
        required: false,
        default: null,
        ref: 'RideRequestNew',
    },
    IntercityRide: {
        type: mongoose.Schema.Types.ObjectId,
        required: false,
        default: null,
        ref: 'IntercityRide',
    },
    otp: {
        type: String,
    },
    platform: {
        type: String,
    },
    otpExpiresAt: {
        type: Date,
    },
    isBlock: {
        type: Boolean,
        default: false,
    },
    firstRideCompleted: {
        type: Boolean,
        default: false,
    },
    isFirstRideBonusRecived: {
        type: Boolean,
        default: false,
    },
    cashback: {
        type: Number,
        default: 0
    },
    cashbackHistory: [
        {
            rideId: { type: mongoose.Schema.Types.ObjectId, ref: "RideBooking" },
            amount: { type: Number, required: true },
            date: { type: Date, default: Date.now }
        }
    ],
    email: {
        type: String,
        default: 'Please enter your email address',
    },
    name: {
        type: String,
        default: 'Guest',
    },
    isOtpVerify: {
        type: Boolean,
        default: false
    },
    profileImage: {
        image: { type: String },
        publicId: { type: String }
    },

    // Auto-generated unique referral code
    referralCode: {
        type: String,
        unique: true
    },

    // Code that the user applied from another user
    appliedReferralCode: {
        type: String,
        default: null
    },
    install_referrer: {
        raw: { type: mongoose.Schema.Types.Mixed }, // <-- allows object or string
        parsed: {
            utm_source: { type: String },
            utm_campaign: { type: String },
            utm_medium: { type: String },
        }
    },

    fcmToken: {
        type: String
    }
}, { timestamps: true });

/**
 * Pre-save hook to generate a unique referral code
 */
userSchema.pre('save', async function (next) {
    if (this.isNew && !this.referralCode) {
        let code;
        let userExists;

        // keep generating until a unique code is found
        do {
            code = "OLY" + Math.floor(100000 + Math.random() * 900000);
            userExists = await mongoose.models.User.findOne({ referralCode: code });
        } while (userExists);

        this.referralCode = code;
    }
    next();
});

const User = mongoose.model('User', userSchema);

module.exports = User;
