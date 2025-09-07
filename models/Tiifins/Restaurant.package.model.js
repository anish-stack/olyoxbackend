const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const MealItemSchema = new mongoose.Schema({
    name: { type: String, required: true },
    price: { type: Number, required: true }
});

const MealSchema = new mongoose.Schema({
    enabled: { type: Boolean, default: false },
    items: [MealItemSchema]
});

const RestaurantPackageSchema = new Schema({
    packageName:{
        type: String,
   
    },
    duration: { type: Number, required: true, enum: [7, 15, 30] }, // 7, 15, or 30 days
    images: {
        url: {
            type: String
        },
        public_id: {
            type: String
        }
    },
    meals: {
        breakfast: { type: MealSchema, required: true },
        lunch: { type: MealSchema, required: true },
        dinner: { type: MealSchema, required: true }
    },
    preferences: {
        isVeg: { type: Boolean, default: true },
        spiceLevel: { type: String, enum: ["low", "medium", "high"], default: "medium" },
        includeWeekends: { type: Boolean, default: true }
    },
    totalPrice: { type: Number, required: true },
    restaurant_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Restaurant',
    },
    food_availability: {
        type: Boolean,
        default: true
    },
    isThisTopPackage:{
        type: Boolean,
        default: false
    }
}, { timestamps: true });

module.exports = mongoose.model('RestaurantPackage', RestaurantPackageSchema);