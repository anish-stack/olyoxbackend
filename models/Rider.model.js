const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const UpdateLogSchema = new Schema(
    {
        field: { type: String, required: true },
        oldValue: { type: Schema.Types.Mixed },
        newValue: { type: Schema.Types.Mixed },
        changedAt: { type: Date, default: Date.now },
        changedBy: { type: String, default: "system" },
    },
    { _id: false }
);

const PreferenceHistorySchema = new Schema(
    {
        enabled: {
            type: Boolean,
            required: true,
        },
        changedAt: {
            type: Date,
            default: Date.now,
        },
        changedBy: {
            type: String, // Could be 'rider', 'admin', 'system'
            default: "rider",
        },
        reason: {
            type: String, // Optional reason for the change
        },
    },
    { _id: false }
);

const PreferenceSchema = new Schema(
    {
        enabled: {
            type: Boolean,
            required: true,
        },
        lastChanged: {
            type: Date,
            default: Date.now,
        },
        history: [PreferenceHistorySchema],
        totalEnabledDuration: {
            type: Number,
            default: 0,
        },
        enabledCount: {
            type: Number, // How many times this preference was enabled
            default: 0,
        },
        disabledCount: {
            type: Number, // How many times this preference was disabled
            default: 0,
        },
    },
    { _id: false }
);

const RiderSchema = new Schema({
    name: {
        type: String,
        required: true,
    },
    rideVehicleInfo: {
        vehicleName: {
            type: String,
            required: true,
        },
        vehicleType: {
            type: String,
        },
        PricePerKm: {
            type: Number,
        },
        RcExpireDate: {
            type: String,
        },
        VehicleNumber: {
            type: String,
            required: true,
        },
        VehicleImage: [String],
    },
    aadharNumber: {
        type: String,
    },
    isFirstRechargeDone: {
        type: Boolean,
        default: false,
    },
    isProfileComplete: {
        type: Boolean,
        default: false,
    },
    isDocumentUpload: {
        type: Boolean,
        default: false,
    },
    points: {
        type: Number,
        default: 0,
    },
    TotalRides: {
        type: Number,
        default: 0,
    },
    rides: [
        {
            type: Schema.Types.ObjectId,
            ref: "RideRequest",
        },
    ],
    Ratings: {
        type: Number,
        default: 0,
    },
    documents: {
        license: {
            type: String,
        },
        rc: {
            type: String,
        },
        insurance: {
            type: String,
        },
        aadharBack: {
            type: String,
        },
        aadharFront: {
            type: String,
        },
        pancard: {
            type: String,
        },
        profile: {
            type: String,
        },
    },
    isPaid: {
        type: Boolean,
        default: false,
    },
    RechargeData: {
        rechargePlan: String,
        expireData: Date,
        onHowManyEarning: {
            type: String,
            default: "Ops",
        },
        whichDateRecharge: Date,
        approveRecharge: Boolean,
    },
    lastNotificationSent: {
        type: Date,
        default: null,
    },
    Bh: {
        type: String,
    },
    DocumentVerify: {
        type: Boolean,
        default: false,
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    isFreeMember: {
        type: Boolean,
        default: false,
    },
    freeTierEndData: {
        type: Date,
        default: null,
    },
    amountPaid: {
        type: Number,
        default: 0,
    },
    trn_no: {
        type: String,
    },
    payment_status: {
        type: String,
    },
    payment_date: {
        type: Date,
    },
    her_referenced: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "ParcelBikeRegister",
        },
    ],
    isOtpBlock: {
        type: Boolean,
        default: false,
    },
    howManyTimesHitResend: {
        type: Number,
        default: 0,
    },
    otpUnblockAfterThisTime: {
        type: Date,
    },
    isOtpVerify: {
        type: Boolean,
        default: false,
    },
    otp: {
        type: String,
    },
    phone: {
        type: String,
        // required: true,
    },
    address: {
        type: String,
        // required: true
    },
    isAvailable: {
        type: Boolean,
        default: false,
    },
    location: {
        type: {
            type: String,
            enum: ["Point"],
            // required: true
        },
        coordinates: {
            type: [Number],
            // required: true
        },
    },
    lastUpdated: {
        type: Date,
        default: Date.now,
    },
    createdAt: {
        type: Date,
        default: Date.now,
    },
    BH: {
        type: String,
    },
    AppVersion: {
        type: String,
        default: "1.0.1",
    },
    on_ride_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TempRideDetails",
    },
    on_intercity_ride_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "RideRequestNew",
    },
    YourQrCodeToMakeOnline: {
        type: String,
        default: null,
    },
    JsonData: {
        type: Object,
    },
    ridesRejected: {
        type: Number,
        default: 0,
    },
    recentRejections: [
        {
            rideId: { type: mongoose.Schema.Types.ObjectId, ref: "RideRequest" },
            timestamp: { type: Date, default: Date.now },
        },
    ],
    category: {
        type: String,
        enum: ["parcel", "cab"],
        default: "cab",
    },
    fcmToken: {
        type: String,
    },
    fcmUpdatedAt: {
        type: Date,
    },
    deviceId: {
        type: String,
    },
    isBlockByAdmin: {
        type: Boolean,
        default: false,
    },
    appDeleted: {
  type: Boolean,
  default: false,
},
    IntercityRideComplete: {
        type: Number,
    },
    // defaultVehicle: {
    //     vehicleName: {
    //         type: String,
    //         required: true
    //     },
    //     vehicleType: {
    //         type: String
    //     },
    //     PricePerKm: {
    //         type: Number
    //     },
    //     RcExpireDate: {
    //         type: String
    //     },
    //     VehicleNumber: {
    //         type: String,
    //         required: true,
    //     },
    //     VehicleImage: [String]
    // },

    WalletHistory: [
        {
            rideId: { type: mongoose.Schema.Types.ObjectId, ref: "RideBooking" },
            amount: { type: Number, required: true },
            date: { type: Date, default: Date.now },
            from: {
                type: mongoose.Schema.Types.ObjectId,
                ref: "User",
            },
        },
    ],

    reserve_intercity_rides: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: "RideRequestNew",
        },
    ],
    messageId: {
        type: String,
        default: null,
    },
    preferences: {
        OlyoxPriority: {
            type: PreferenceSchema,
            default: () => ({
                enabled: true,
                lastChanged: new Date(),
                history: [
                    {
                        enabled: true,
                        changedAt: new Date(),
                        changedBy: "system",
                        reason: "Initial setup",
                    },
                ],
                totalEnabledDuration: 0,
                enabledCount: 1,
                disabledCount: 0,
            }),
        },

        OlyoxIntercity: {
            type: PreferenceSchema,
            default: () => ({
                enabled: false,
                lastChanged: new Date(),
                history: [
                    {
                        enabled: false,
                        changedAt: new Date(),
                        changedBy: "system",
                        reason: "Initial setup",
                    },
                ],
                totalEnabledDuration: 0,
                enabledCount: 0,
                disabledCount: 1,
            }),
        },
        OlyoxAcceptMiniRides: {
            type: PreferenceSchema,
            default: () => ({
                enabled: false,
                lastChanged: new Date(),
                history: [
                    {
                        enabled: false,
                        changedAt: new Date(),
                        changedBy: "system",
                        reason: "Initial setup",
                    },
                ],
                totalEnabledDuration: 0,
                enabledCount: 0,
                disabledCount: 1,
            }),
        },
        OlyoxAcceptSedanRides: {
            type: PreferenceSchema,
            default: () => ({
                enabled: false,
                lastChanged: new Date(),
                history: [
                    {
                        enabled: false,
                        changedAt: new Date(),
                        changedBy: "system",
                        reason: "Initial setup",
                    },
                ],
                totalEnabledDuration: 0,
                enabledCount: 0,
                disabledCount: 1,
            }),
        },
        FoodDelivery: {
            type: PreferenceSchema,
            default: () => ({
                enabled: false,
                lastChanged: new Date(),
                history: [
                    {
                        enabled: false,
                        changedAt: new Date(),
                        changedBy: "system",
                        reason: "Initial setup",
                    },
                ],
                totalEnabledDuration: 0,
                enabledCount: 0,
                disabledCount: 1,
            }),
        },

        ParcelDelivery: {
            type: PreferenceSchema,
            default: () => ({
                enabled: false,
                lastChanged: new Date(),
                history: [
                    {
                        enabled: false,
                        changedAt: new Date(),
                        changedBy: "system",
                        reason: "Initial setup",
                    },
                ],
                totalEnabledDuration: 0,
                enabledCount: 0,
                disabledCount: 1,
            }),
        },

        // Additional preference tracking
        preferencesSummary: {
            totalPreferenceChanges: {
                type: Number,
                default: 5, // Initial setup counts
            },
            lastPreferenceUpdate: {
                type: Date,
                default: Date.now,
            },
            mostActivePreference: {
                type: String,
                default: null,
            },
        },
    },

    updateLogs: [UpdateLogSchema],
    position: {
        type: Number,
        required: true,
        unique: true, // Ensure position is unique
    },

    activityLog: [
        {
            action: { type: String, required: true },
            timestamp: { type: Date, default: Date.now },
            details: { type: Object },
        },
    ],
    isPanRejected: {
        type: Boolean,
        default:false
    },
    isInsuranceRejected: {
        type: Boolean,
        default:false
    }
});

RiderSchema.index({ location: "2dsphere" });
RiderSchema.index({ "rideVehicleInfo.VehicleNumber": 1 });
RiderSchema.index({ "preferences.OlyoxPriority.enabled": 1 });
RiderSchema.index({ category: 1, isAvailable: 1 });
RiderSchema.index({ category: 1, on_ride_id: 1 });
RiderSchema.index({ phone: 1 });
RiderSchema.index({ name: 1 });
RiderSchema.index({ "RechargeData.expireData": 1 });
RiderSchema.index({ "RechargeData.approveRecharge": 1 });
// Middleware to update lastUpdated on save
// RiderSchema.pre("save", function (next) {
//     this.lastUpdated = new Date();

//     // Track specific field updates
//     const fieldsToTrack = ["location", "fcmToken"];
//     fieldsToTrack.forEach((field) => {
//         if (this.isModified(field)) {
//             this.updateLogs.push({
//                 field,
//                 oldValue: this.get(field, null, {
//                     getters: false,
//                     virtuals: false,
//                     defaults: false,
//                     alias: false,
//                 }), // old value
//                 newValue: this[field], // new value
//                 changedBy: "system",
//             });
//         }
//     });

//     // Keep only last 100 logs
//     if (this.updateLogs.length > 100) {
//         this.updateLogs = this.updateLogs.slice(-100);
//     }

//     next();
// });

// Middleware to assign position for new riders
RiderSchema.pre("save", async function (next) {
    // Only assign position for new documents
    if (this.isNew) {
        try {
            // Find the rider with the highest valid position
            const lastRider = await mongoose.model("Rider").findOne({
                position: { $exists: true, $ne: null, $type: "number" },
            })
                .sort({ position: -1 })
                .exec();
            // Assign position: if no valid position exists, start with 1
            this.position = lastRider && Number.isFinite(lastRider.position) ? lastRider.position + 1 : 1;
        } catch (error) {
            return next(error);
        }
    }

    // Update lastUpdated and track field updates
    this.lastUpdated = new Date();

    const fieldsToTrack = ["location", "fcmToken"];
    fieldsToTrack.forEach((field) => {
        if (this.isModified(field)) {
            this.updateLogs.push({
                field,
                oldValue: this.get(field, null, {
                    getters: false,
                    virtuals: false,
                    defaults: false,
                    alias: false,
                }),
                newValue: this[field],
                changedBy: "system",
            });
        }
    });

    if (this.updateLogs.length > 100) {
        this.updateLogs = this.updateLogs.slice(-100);
    }

    next();
});

RiderSchema.methods.updatePreference = function (
    preferenceName,
    enabled,
    changedBy = "rider",
    reason = ""
) {
    if (!this.preferences[preferenceName]) {
        throw new Error(`Preference ${preferenceName} does not exist`);
    }

    const preference = this.preferences[preferenceName];
    const previousState = preference.enabled;
    const now = new Date();

    // Calculate duration if preference was enabled
    if (previousState && preference.lastChanged) {
        const duration = now.getTime() - preference.lastChanged.getTime();
        preference.totalEnabledDuration += duration;
    }

    // Update preference
    preference.enabled = enabled;
    preference.lastChanged = now;

    // Add to history
    preference.history.push({
        enabled: enabled,
        changedAt: now,
        changedBy: changedBy,
        reason: reason,
    });

    // Update counters
    if (enabled) {
        preference.enabledCount += 1;
    } else {
        preference.disabledCount += 1;
    }

    // Update summary
    this.preferences.preferencesSummary.totalPreferenceChanges += 1;
    this.preferences.preferencesSummary.lastPreferenceUpdate = now;

    // Keep only last 50 history entries to prevent document bloat
    if (preference.history.length > 50) {
        preference.history = preference.history.slice(-50);
    }

    return this.save();
};

// New method inside RiderSchema
RiderSchema.methods.getPreferenceAnalytics = function () {
    const vehicleType = this.rideVehicleInfo?.vehicleType?.toUpperCase() || "";
    const allPreferences = this.preferences;

    let preferenceKeys = [];

    switch (vehicleType) {
        case "MINI":
            preferenceKeys = ["OlyoxPriority", "OlyoxIntercity"];
            break;

        case "SEDAN":
            preferenceKeys = [
                "OlyoxPriority",
                "OlyoxIntercity",
                "OlyoxAcceptMiniRides",
            ];
            break;

        case "SUV":
        case "XL":
        case "SUV/XL":
            preferenceKeys = [
                "OlyoxPriority",
                "OlyoxIntercity",
                "OlyoxAcceptMiniRides",
                "OlyoxAcceptSedanRides",
            ];
            break;

        case "BIKE":
            preferenceKeys = ["OlyoxPriority"];
            break;

        default:
            preferenceKeys = ["OlyoxPriority"]; // fallback
            break;
    }

    // Build analytics object with preference details
    const analytics = preferenceKeys
        .map((key) => {
            const pref = allPreferences[key];
            if (!pref) return null;
            return {
                name: key,
                enabled: pref.enabled,
                lastChanged: pref.lastChanged,
                totalEnabledDuration: pref.totalEnabledDuration,
                enabledCount: pref.enabledCount,
                disabledCount: pref.disabledCount,
                last50History: pref.history.slice(-50),
            };
        })
        .filter(Boolean);

    return analytics;
};

RiderSchema.index({ position: 1 }, { unique: true });

module.exports = mongoose.model("Rider", RiderSchema);
