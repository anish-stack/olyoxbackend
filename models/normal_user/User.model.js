const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    number: { type: String, index: true, unique: true },
    currentRide: { type: mongoose.Schema.Types.ObjectId, ref: 'RideRequestNew', default: null },
    IntercityRide: { type: mongoose.Schema.Types.ObjectId, ref: 'IntercityRide', default: null },
    otp: { type: String },
    platform: { type: String },
    otpExpiresAt: { type: Date },
    isBlock: { type: Boolean, default: false },
    firstRideCompleted: { type: Boolean, default: false },
    isFirstRideBonusRecived: { type: Boolean, default: false },
    cashback: { type: Number, default: 0 },
    appDeleted: {
  type: Boolean,
  default: false,
},
    cashbackHistory: [
        {
            rideId: { type: mongoose.Schema.Types.ObjectId, ref: "RideBooking" },
            amount: { type: Number, required: true },
            date: { type: Date, default: Date.now }
        }
    ],
    email: { type: String, default: 'Please enter your email address' },
    notificationPermission: { type: Boolean, default: false },
    whatsapp_notification: { type: Boolean, default: false },
    name: { type: String, default: 'Guest' },
    isOtpVerify: { type: Boolean, default: false },
    profileImage: { image: String, publicId: String },

    referralCode: { type: String, unique: true },
    appliedReferralCode: { type: String, default: null },

    install_referrer: {
        raw: { type: mongoose.Schema.Types.Mixed },
        parsed: {
            utm_source: { type: String },
            utm_campaign: { type: String },
            utm_medium: { type: String },
        }
    },
    deviceId: { type: String },
    fcmToken: { type: String },
    fcmUpdated: { type: Date },
    AppVersion: { type: String },

    // **Location for geospatial queries**
    location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], default: [0, 0] } // [longitude, latitude]
    }

}, { timestamps: true });

// 2dsphere index for geospatial queries
userSchema.index({ location: '2dsphere' });

/**
 * Pre-save hook to generate unique referral code
 */
userSchema.pre('save', async function (next) {
    if (this.isNew && !this.referralCode) {
        let code;
        let userExists;
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
