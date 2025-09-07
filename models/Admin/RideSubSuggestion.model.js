const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const RideSubSuggestionSchema = new Schema({
    categoryId: {
        type: Schema.ObjectId,
        ref: 'RidesSuggestion'
    },
    subCategory: [String]
});

module.exports = mongoose.model('RideSubSuggestion', RideSubSuggestionSchema);
