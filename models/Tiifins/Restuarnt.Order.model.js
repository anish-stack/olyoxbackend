const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const OrderSchema = new Schema({
    user: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        // required: true
    },
    restaurant: {
        type: Schema.Types.ObjectId,
        ref: 'Restaurant',
        required: true
    },
    user_delivery_address: {
        type: String,
    },
    address_details: {
        flatNo: { type: String },
        street: { type: String },
        landmark: { type: String },
        pincode: { type: String }
    },
    user_current_location: {
        type: { type: String, enum: ['Point'], default: 'Point' },
        coordinates: { type: [Number], index: '2dsphere' }
    },
    coupon_which_applied: {
        title: { type: String },
        coupon_code: { type: String },
        min_order_amount: { type: Number },
        max_discount: { type: Number },
        discount_type: { type: String },
        discount: { type: Number },
        active: { type: Boolean, default: false }
    },
    Order_Id: {
        type: String,
    },
    order_date: {
        type: Date,
        default: Date.now
    },
    rating_food: {
        type: Number
    },
    rating_restaurant: {
        type: Number
    },
    review: {
        type: String
    },
    
    items: [{
        foodItem_id: {
            type: Schema.Types.ObjectId,
            ref: 'FoodListing',
            required: true
        },
        quantity: {
            type: Number,
            required: true
        },
        price: {
            type: Number,
            required: true
        }
    }],
    totalPrice: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['Pending', 'Confirmed', 'Preparing', 'Out for Delivery', 'Delivered', 'Cancelled'],
        default: 'Pending'
    },
    paymentMethod: {
        type: String,
        // enum: ['Cash on Delivery', 'Credit Card', 'Debit Card', 'UPI'],
        required: true
    },
    isAdminMessageSendForCancel:{
        type:Boolean,
        default:false
    },
    adminWhyCancel:{
        type:String
    },
    deliveryBoyName:{
        type:String
    },
    deliveryBoyPhone:{
        type: Number
    },
    deliveryBoyBikeNumber:{
        type:String
    }

});


module.exports = mongoose.model('Order', OrderSchema);
