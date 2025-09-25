const mongoose = require("mongoose")

const CharDhamBannerSchema = new mongoose.Schema({
    type: {
        type: String,
        default: "video",
        enum: ["video", "image"],
        required: true
    },
    link: {
        type: String,
        required: true
    },
    public_id: {
        type: String
    }
}, { timestamps: true })

module.exports = mongoose.model("CharDhamBanner", CharDhamBannerSchema)