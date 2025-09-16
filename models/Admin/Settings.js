const mongoose = require('mongoose');

const SettingsSchema = new mongoose.Schema({
    appName: {
        type: String,
        required: true
    },
    appUrl: {
        type: String,
        required: true
    },
    adminEmail: {
        type: String,
        required: true
    },
    ride_percentage_off: {
        type: Number
    },
    maintenanceMode: {
        type: Boolean,
        default: false
    },
    BasicFare: {
        type: Number,
        default: 0
    },
    BasicFarePerKm: {
        type: Number,
        default: 0
    },
    RainModeOn: {
        type: Boolean,
        default: false
    },
    RainModeFareOnEveryThreeKm: {
        type: Number,
        default: 0
    },
    ShowingRainOnApp: {
        type: Boolean,
        default: false
    },
    ShowingOfferScreenOnApp: {
        type: Boolean,
        default: false
    },
    foodDeliveryPrice: {
        type: Number,
        default: 0
    },
    openMapApiKey: {
        type: String,
        default: ''
    },
    googleApiKey: {
        type: String,
        default: ''
    },
    trafficDurationPricePerMinute: {
        type: Number,
        default: 0
    },
    waitingTimeInMinutes: {
        type: Number,
        default: 0
    },
    fbUrl: {
        type: String,
        default: ''
    },
    twitterUrl: {
        type: String,
        default: ''
    },
    instagramUrl: {
        type: String,
        default: ''
    },
    first_recharge_commisons: {
        type: Number,
        default: 0
    },
    second_recharge_commisons: {
        type: Number,
        default: 0
    },
    support_number: {
        type: String,
        default: "1234567890"
    },
    adminBh: {
        type: String
    },
    appVersionOnIos: {
        type: String
    },
    appVersionOnAndroid: {
        type: String
    },
    appVersionOnAndroidDriver: {
        type: String

    }
}, { timestamps: true });

module.exports = mongoose.model('Settings', SettingsSchema);
