const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const ParcelBikeRegisterSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    isDocumentUpload:{
        type:Boolean,
        default:false
    },

    otp:{
        type:String
    },
    phone: {
        type: String,
        required: true
    },
    address: {
        type: String,
        required: true
    },
    bikeDetails: {
        make: {
            type: String,
            required: true
        },
        model: {
            type: String,
            required: true
        },
        year: {
            type: Number,
            required: true
        },
        licensePlate: {
            type: String,
        }
    },
    documents: {
        license: {
            type: String,

        },
        rc: {
            type: String,
        },
        pan: {
            type: String,
        },
        aadhar:{
            type:String
        }
    },
    Bh: {
        type: String
    },
    DocumentVerify: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    isFreeMember: {
        type: Boolean,
    },
    amountPaid: {
        type: Number,
        default: 0
    },
    trn_no: {
        type: String
    },
    payment_status: {
        type: String
    },
    payment_date: {
        type: Date
    },
    her_referenced: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ParcelBikeRegister'
    }],
    isOtpBlock:{
        type:Boolean,
        default:false
    },
    howManyTimesHitResend:{
        type:Number,
        default:0
    },
    otpUnblockAfterThisTime:{
        type:Date,

    },
    isOtpVerify:{
        type:Boolean,
        default:false
    },
    type:{
        type:String
    },
    is_on_order:{
        type:Boolean,
        default:false
    }



}, { timestamps: true });

module.exports = mongoose.model('ParcelBikeRegister', ParcelBikeRegisterSchema);