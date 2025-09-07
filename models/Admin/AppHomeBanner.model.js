const mongoose = require('mongoose');

const AppHomeBannerSchema = new mongoose.Schema({
    image: {
        url: {
            type: String,
        },
        public_id: {
            type: String,
        }
    },
    is_active: {
        type: Boolean,
        default: true
    }
});

module.exports = mongoose.model('AppHomeBanner', AppHomeBannerSchema);