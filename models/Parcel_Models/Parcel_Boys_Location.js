const mongoose = require('mongoose');

const ParcelboyLocation = new mongoose.Schema({
    riderId: {
        type: mongoose.Schema.Types.ObjectId,
        ref:'ParcelBikeRegister',
        required: true,
        unique: true,
    },
    location: {
        type: { type: String, enum: ['Point'], required: true }, 
        coordinates: { type: [Number], required: true }, 
    },
    lastUpdated: {
        type: Date,
        default: Date.now,
    },
});

// Create a 2dsphere index on the 'location' field
ParcelboyLocation.index({ location: '2dsphere' });

const Parcel_boy_Location = mongoose.model('parcel_boy_locations', ParcelboyLocation);

module.exports = Parcel_boy_Location;
