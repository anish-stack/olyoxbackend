const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const OnboardingSlidesSchema = new Schema({
    title: {
        type: String,
    },
    imageUrl: {
        image: {
            type: String,

        },
        public_id: {
            type: String,
        }
    },
    description: {
        type: String,
    },
    slug: {
        type: String,
    }
}, { timestamps: true });

module.exports = mongoose.model('OnboardingSlides', OnboardingSlidesSchema);