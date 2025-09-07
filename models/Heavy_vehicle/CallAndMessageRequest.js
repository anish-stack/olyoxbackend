const mongoose = require('mongoose');

const CallAndMessageRequestSchema = new mongoose.Schema({
    senderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    receiverId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Heavy_vehicle_partners',
        required: true,
    },
    requestType: {
        type: String,
        enum: ['call', 'message'],
        required: true,
    },
    message: {
        type: String,

    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'Checked','Bookmark','Not Interested','User By Mistake'],
        default: 'pending',
    },
    noteByReciver: [{
        note: String,
        date: Date
    }],
    createdAt: {
        type: Date,
        default: Date.now,
    },
});

module.exports = mongoose.model('CallAndMessageRequest', CallAndMessageRequestSchema);