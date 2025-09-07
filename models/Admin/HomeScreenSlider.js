const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const HomeScreenSlides = new Schema({

    imageUrl: {
        image: {
            type: String,

        },
        public_id: {
            type: String,
        }
    },
    active: {
        type: Boolean,
        default: false,
    }
}, { timestamps: true });

module.exports = mongoose.model('HomeScreenSlide', HomeScreenSlides);