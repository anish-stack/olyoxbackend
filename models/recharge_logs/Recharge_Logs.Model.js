const mongoose = require('mongoose');

const rechargeLogSchema = new mongoose.Schema(
    {
        BHID: {
            type: String,
        },
        amount: {
            type: Number,
            required: true,
            min: 0,
        },
        transactionId: {
            type: String,
            required: true,
            unique: true,
        },
        status: {
            type: String,
            default: 'PENDING',
        },
        error_msg: {
            type: String,
        },
        paymentMethod: {
            type: String,
        },
        createdAt: {
            type: Date,
            default: Date.now,
        },
        updatedAt: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('RechargeLog', rechargeLogSchema);