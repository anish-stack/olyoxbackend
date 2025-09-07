const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const BookingRequestSchema = new Schema({
    guestInformation: [
        {
            guestName: {
                type: String,
                required: true
            },
            guestPhone: {
                type: String
            },
            guestAge: {
                type: Number,

            }
        }
    ],
    guest_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',

    },
    totalGuests: {
        type: Number,
        default: 0,
    },
    no_of_mens: {
        type: Number,
        default: 0
    },
    no_of_womens: {
        type: Number,
        default: 0

    },
    no_of_child: {
        type: Number,
        default: 0

    },
    checkInDate: {
        type: Date,
        required: true
    },
    checkOutDate: {
        type: Date,
        required: true
    },
    listing_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel_Listing',
        required: true
    },
    numberOfGuestsDetails: {
        type: Number,
        required: true
    },
    anyNotes: {
        type: String,
        default: "No Note"
    },
    status: {
        type: String,
        enum: ['Pending', 'Confirmed', 'Cancelled', 'CheckIn', 'Checkout'],
        default: 'Pending'
    },
    booking_payment_done: {
        type: Boolean,
        default: false
    },
    NumberOfRoomBooks:{
        type:Number,
        default:0
    },
    modeOfBooking: {
        type: String,
        enum: ['Online', 'Offline',],
        default: 'Online'
    },
    bookingAmount: {
        type: Number,
        default: 0
    },
    anyDiscountByHotel: {
        type: Number,
    },
    final_price_according_to_days: {
        type: Number,
        default: 0
    },
    booking_reject_reason: {
        type: String,
    },
    paymentMode: {
        type: String,
        enum: ['Cash', 'Online', 'Pay at Hotel'],
        default: 'Cash'
    },
    HotelUserId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'HotelUser',
    },
    BookingOtp: {
        type: Number,
    },
    BookingOtpExpiry: {
        type: Date,
    },
    isBookingDone: {
        type: Boolean,
        default: false
    },

    useCheckAt: {
        type: Date,
    },
    isUserCheckedIn: {
        type: Boolean,
        default: false
    },
    userCheckOut: {
        type: Date,
    },
    userCheckOutStatus: {
        type: Boolean,
        default: false
    },

    Booking_id: {
        type: String,
    }
}, { timestamps: true });

module.exports = mongoose.model('BookingRequest', BookingRequestSchema);
