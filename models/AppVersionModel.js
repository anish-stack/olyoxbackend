const mongoose = require('mongoose');

const appVersionSchema = new mongoose.Schema({
    version: {
        type: String,
        required: true,
    },
    releaseDate: {
        type: Date,
        default: Date.now,
    },
    app_type: {
        type: String,

    },
    updateImage:{
        type:String
    },
    isMandatory: {
        type: Boolean,
        default: false,
    },
    description: {
        type: String,
        default: '',
    },
    downloadAppUrl: {
        type: String,
        default: '',
    }
});

const AppVersion = mongoose.model('AppVersion', appVersionSchema);

module.exports = AppVersion;