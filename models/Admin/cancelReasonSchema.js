const mongoose = require("mongoose");

const cancelReasonSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: "",
        trim: true
    },
    status: {
        type: String,
        enum: ["active", "inactive"],
        default: "active"
    }
}, { timestamps: true });

const CancelReason = mongoose.model("CancelReason", cancelReasonSchema);

module.exports = CancelReason;
