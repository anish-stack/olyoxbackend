const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    Coupon_Code: {
        type: String,
        required: true,
        unique: true
    },
    min_order_amount: {
        type: Number,
        required: true
    },
    max_discount: {
        type: Number,
        required: true
    },
    discount_type: {
        type: String,
        enum: ['percentage', 'flat'],
        required: true
    },
    discount: {
        type: Number,
        required: true
    },
    active: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('CouponOfFood', couponSchema);