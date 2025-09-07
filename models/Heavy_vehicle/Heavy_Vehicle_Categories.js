const mongoose = require('mongoose');

const HeavyVehicleCategorySchema = new mongoose.Schema({
    title: {
        type: String,
        required: true,
        trim: true
    },
    active: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('HeavyVehicleCategory', HeavyVehicleCategorySchema);