const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const RidesSuggestionSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    type: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    time: {
        type: String,
        required: true
    },
    priceRange: {
        type: String,
        required: true
    },
    status: {
        type: Boolean,
        default: false

    },
    icons_image: {
        url: {
            type: String,
        },
        public_id: {
            type: String,
        }
    },
    vehicleType: { type: String }, // e.g., "Bike", "Auto", etc.
    avgMileage: { type: Number, required: true }, // in km/l
    baseFare: { type: Number, required: true },
    baseKM: { type: Number, required: true },
    perKM: { type: Number, required: true },
    perMin: { type: Number, required: true },
    nightPercent: { type: Number, required: true }, // store as number, e.g., 15 for 15%
    minFare: { type: Number, required: true },
    tollExtra: { type: Boolean, required: true },
    waitingChargePerMin: { type: Number, required: true },
    fuelSurchargePerKM: { type: Number, required: true }
});

module.exports = mongoose.model('RidesSuggestion', RidesSuggestionSchema);