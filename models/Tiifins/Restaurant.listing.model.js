const mongoose = require('mongoose');

const foodListingSchema = new mongoose.Schema({
    food_name: {
        type: String,
        required: true,
    },
    description: {
        type: String,
    },
    food_price: {
        type: Number,
        required: true,
    },

    food_category: {
        type: String,
        default: 'Veg'
    },
    food_availability: {
        type: Boolean,
        default: true,
    },
    images: {
        url: {
            type: String
        },
        public_id: {
            type: String
        }
    },
    reviews: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Food_Review',
      
    },
    
    what_includes: [String],
    restaurant_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Restaurant',
    }
}, {
    timestamps: true
});

const FoodListing = mongoose.model('FoodListing', foodListingSchema);

module.exports = FoodListing;