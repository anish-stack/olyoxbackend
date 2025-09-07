const mongoose = require('mongoose');

const LoginBugsReportsSchema = new mongoose.Schema({
    name:{
        type:String
    },
    message: {
        type: String,
        required: true,
    },
    number: {
        type: String,
        required: true,
    },
    screenshot: {
        type: String,
        required: false,
    },
    adminHandle: {
        status: {
            type: String,
            enum: ['Pending', 'In Progress', 'Resolved'],
            default: 'Pending',
        },
        bugFix: {
            type: String
        },
       
        handledAt: {
            type: Date,
            default: null,
        },
    },
}, { timestamps: true });

module.exports = mongoose.model('LoginBugsReports', LoginBugsReportsSchema);