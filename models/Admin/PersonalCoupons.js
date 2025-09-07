const mongoose = require('mongoose');

const personalCouponSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    discount: {
        type: Number,
        required: true,
        min: 0
    },
    expirationDate: {
        type: Date,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        refPath: 'onModel', 
        required: true
    },
    onModel: {
        type: String,
        required: true,
        enum: ['User', 'Heavy_vehicle_partners', 'Rider', 'HotelUser', 'Restaurant'] // Reference models
    },
    isUsed:{
        type: Boolean,
        default: false,
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('PersonalCoupon', personalCouponSchema);
