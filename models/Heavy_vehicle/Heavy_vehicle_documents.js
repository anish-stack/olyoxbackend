const mongoose = require('mongoose');

const HeavyVehicleDocumentsSchema = new mongoose.Schema({
    vehicle_partner_Id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HeavyVehicle',
        required: true
    },
    documentType: {
        type: String,
        required: true,
        enum: ['Registration', 'Insurance', 'Permit', 'Pollution Certificate', 'License', 'Aadhar']
    },

    documentFile: {
        type: String,
        required: true
    },
    documentFile_public_id: {  
        type: String,
        required: true
    },
    document_status: {
        type: String,
        enum: ['Pending', 'Approved', 'Rejected'],
        default: 'Pending'
    },
    reject_reason: {
        type: String,
        default: ''
    },
    uploadedAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true }); // Adding timestamps to track document creation and updates

module.exports = mongoose.model('HeavyVehicleDocuments', HeavyVehicleDocumentsSchema);
