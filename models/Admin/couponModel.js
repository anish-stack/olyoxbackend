const mongoose = require('mongoose')

const CouponSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true
    },
    discount: {
        type: Number,
        required: true
    },
    active: {
        type: Boolean,
        default: true
    },
    expiryDate: {
        type: Date,
        required: true
    },
}, { timestamps: true });

module.exports = mongoose.model('Coupon', CouponSchema)