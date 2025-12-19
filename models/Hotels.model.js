const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const hotelRoomListing = new Schema({
    room_type: {
        type: String,
        required: true,
    },
    hotel_user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HotelUser',
    },
    has_tag: [
        {
            type: String,
        }
    ],
    rating_number: {
        type: Number,
        default: 0,
    },
    number_of_rating_done: {
        type: Number,
        default: 0,
    },
    amenities: {
        AC: { type: Boolean, default: false },
        freeWifi: { type: Boolean, default: false },
        kitchen: { type: Boolean, default: false },
        TV: { type: Boolean, default: false },
        powerBackup: { type: Boolean, default: false },
        geyser: { type: Boolean, default: false },
        parkingFacility: { type: Boolean, default: false },
        elevator: { type: Boolean, default: false },
        cctvCameras: { type: Boolean, default: false },
        diningArea: { type: Boolean, default: false },
        privateEntrance: { type: Boolean, default: false },
        reception: { type: Boolean, default: false },
        caretaker: { type: Boolean, default: false },
        security: { type: Boolean, default: false },
        checkIn24_7: { type: Boolean, default: false },
        dailyHousekeeping: { type: Boolean, default: false },
        fireExtinguisher: { type: Boolean, default: false },
        firstAidKit: { type: Boolean, default: false },
        buzzerDoorBell: { type: Boolean, default: false },
        attachedBathroom: { type: Boolean, default: false },
    },
    allowed_person: {
        type: Number,
        default: 0,
    },
    cut_price: {
        type: Number,
        default: 0,
    },
    book_price: {
        type: Number,
        default: 0,
    },
    discount_percentage: {
        type: Number,
        default: 0,
    },
    main_image: {
        url: { type: String },
        public_id: { type: String },
    },
    second_image: {
        url: { type: String },
        public_id: { type: String },
    },
    third_image: {
        url: { type: String },
        public_id: { type: String },
    },
    fourth_image: {
        url: { type: String },
        public_id: { type: String },
    },
    fifth_image: {
        url: { type: String },
        public_id: { type: String },
    },
    cancellation_policy: {
        type: [String],
        default: [],
    },
    is_tax_applied: {
        type: Boolean,
        default: false,
    },
    tax_fair: {
        type: Number,
        default: 0,
    },
    isPackage: {
        type: Boolean,
        default: false
    },
    package_add_ons: [
        String
    ],
    NumberOfRoomBooks:{
        type:Number,
        default:1
    },
    isRoomAvailable: {
        type: Boolean,
        default: false
    },
    reviews: [
        {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Review',
        }
    ],
    status: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true,
});

// Indexes
hotelRoomListing.index({ room_type: 1 });
hotelRoomListing.index({ hotel_user: 1 });
hotelRoomListing.index({ has_tag: 1 });
hotelRoomListing.index({ book_price: 1 });
hotelRoomListing.index({ 'amenities.freeWifi': 1 });

// Model
const HotelListing = mongoose.model('Hotel_Listing', hotelRoomListing);

module.exports = HotelListing;
