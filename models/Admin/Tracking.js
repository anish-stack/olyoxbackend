const mongoose = require("mongoose");

const trackEventSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: false
    },
    event: String,
    screen: String,
    action: String,
    params: Object,
    device: String
}, { timestamps: true });

module.exports = mongoose.model("TrackEvent", trackEventSchema);
