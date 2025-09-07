const mongoose = require('mongoose');

const VehicleSchema = new mongoose.Schema({
    image: {
        url: {
            type: String
        },
        public_id: {
            type: String

        }
    },
    BaseFare:{
        type:Number
    },
    title: {
        type: String,
        required: true
    },
    info: {
        type: String,
        required: true
    },
    max_weight: {
        type: Number,
        required: true
    },
    price_per_km: {
        type: Number,
        required: true
    },
    status: {
        type: Boolean,
        default: false
    },
    anyTag: {
        type: Boolean,
        default: false
    },
    tag: {
        type: String,
        default: ''
    },
    time_can_reach: {
        type: Number,
        required: true
    },
    position: {
        type: Number,
        unique: true,
        required: true
    }
}, { timestamps: true });

module.exports = mongoose.model('VehicleForParcel', VehicleSchema);