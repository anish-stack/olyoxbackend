const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    vehicleType: {
        type: String,
        enum: ['Big', 'Small', 'Medium'],
        required: true
    },
    image: {
        url: {
            type: String
        },
        public_id: {
            type: String
        }
    },
    isAvailable: {
        type: Boolean,
        default: true
    },
    categoryId: {
        type: mongoose.Types.ObjectId,
        ref: 'HeavyVehicleCategory'
    }
}, { timestamps: true });


module.exports = mongoose.model('Vehicle', vehicleSchema);
