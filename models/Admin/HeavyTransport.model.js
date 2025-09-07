const mongoose = require('mongoose');

const HeavyTransportSchema = new mongoose.Schema({
    title: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    image: {
        url: {
            type: String,
        },
        public_id: {
            type: String
        }
    },
    backgroundColour: {
        type: String,
        required: true
    },
    active: {
        type: Boolean,
        default: true
    }
});

module.exports = mongoose.model('HeavyTransport', HeavyTransportSchema);