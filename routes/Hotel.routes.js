const express = require('express');
const { register_hotel_user, add_hotel_listing,find_My_rooms, getHotelsNearByMe, getHotelsDetails, getHotelsListingDetails, verifyOtp, resendOtp, find_Hotel_Login, toggleHotelStatus, LoginHotel, toggleRoomStatus, deleteHotelRoom, uploadDocuments, getAllHotel, verifyDocuments, getSingleHotelDetails, updateHotelBlock, updateHotelUserDetail, updateHotelDetail, geHotelListingByHotelUser, HotelAnalyticData, deleteHotelVendor } = require('../hotel_controllers/hotel.user.controller');
const Protect = require('../middleware/Auth');
const upload = require('../middleware/multer');
const { makeBookingOffline, verifyOtpForBooking, resendOtpForBookingConfirm, UpdateBooking, getMyBookingAll, markCheckIn, markCheckOut, getAllUniqueGuestAndBookingAndHerAmount, UserMakesBooking, getAllHotelBooking, getSingleHotelBooking, cancelBooking, acceptBooking, deleleteHotelOrder, changeOrderStatusBookingByAdmin } = require('../hotel_controllers/BookingHotel');
const hotel_router = express.Router()
const uploadFields = upload.fields([
    { name: 'aadhar_front', maxCount: 1 },
    { name: 'aadhar_Back', maxCount: 1 },
    { name: 'panCard', maxCount: 1 },
    { name: 'gst', maxCount: 1 },
    { name: 'addressProof', maxCount: 1 },
    { name: 'ProfilePic', maxCount: 1 }
]);

hotel_router.post('/register-hotel', register_hotel_user)
hotel_router.post('/verify-otp', verifyOtp)
hotel_router.post('/resend-otp', resendOtp)
hotel_router.get('/find-Me-Hotel', Protect, find_Hotel_Login)
hotel_router.get('/find-My-Rooms', Protect, find_My_rooms)
hotel_router.post('/toggle-hotel', Protect, toggleHotelStatus)
hotel_router.post('/Login-Hotel', LoginHotel)
hotel_router.get('/get_all_hotel', getAllHotel)
hotel_router.put('/verify_hotel_documents/:id', verifyDocuments)
hotel_router.put('/update_hotel_block_status/:id', updateHotelBlock)
hotel_router.get('/get_hotelbyId/:id', getSingleHotelDetails)


hotel_router.post('/add-hotel-listing', upload.fields([
    { name: 'main_image', maxCount: 1 },
    { name: 'second_image', maxCount: 1 },
    { name: 'third_image', maxCount: 1 },
    { name: 'fourth_image', maxCount: 1 },
    { name: 'fifth_image', maxCount: 1 }
]),Protect, add_hotel_listing);
hotel_router.put('/update_hotel_user_details/:hotelId', uploadFields, updateHotelUserDetail);


hotel_router.post('/add-document', upload.fields([
    { name: 'aadhar_front', maxCount: 1 },
    { name: 'aadhar_Back', maxCount: 1 },
    { name: 'panCard', maxCount: 1 },
    { name: 'gst', maxCount: 1 },
    { name: 'addressProof', maxCount: 1 },
    { name: 'ProfilePic', maxCount: 1 }
]),Protect, uploadDocuments);

hotel_router.post('/delete-hotels', deleteHotelRoom)

hotel_router.get('/find-near-by-hotels', getHotelsNearByMe)
hotel_router.get('/find-hotel-details/:params', getHotelsDetails)
hotel_router.get('/hotel-details/:hotelId', getHotelsListingDetails)
hotel_router.post('/hotel-Room-toggle', toggleRoomStatus)

// Booking routes
hotel_router.post('/book-room', Protect, makeBookingOffline)
hotel_router.post('/book-room-user', Protect, UserMakesBooking)
hotel_router.post('/verify-booking', Protect, verifyOtpForBooking)
hotel_router.post('/resend-otp-booking', Protect, resendOtpForBookingConfirm)
hotel_router.post('/update-booking', Protect, UpdateBooking)
hotel_router.get('/get-bookings', Protect, getMyBookingAll)
hotel_router.post('/mark-check-in-booking', Protect, markCheckIn)
hotel_router.post('/mark-check-out-booking', Protect, markCheckOut)
hotel_router.get('/get-guests', Protect, getAllUniqueGuestAndBookingAndHerAmount)
hotel_router.get('/get_all_hotel_booking',getAllHotelBooking)
hotel_router.post('/cancel-booking',cancelBooking)
hotel_router.post('/accept-booking',acceptBooking)
hotel_router.get('/get_single_hotel_booking/:id',getSingleHotelBooking)


// 
hotel_router.get('/HotelAnalyticData/:id',HotelAnalyticData)

hotel_router.put('/update_hotel_detail/:id', upload.fields([
    { name: 'aadhar_front', maxCount: 1 },
    { name: 'aadhar_back', maxCount: 1 }, // Ensure correct case
    { name: 'panCard', maxCount: 1 },
    { name: 'gst', maxCount: 1 },
    { name: 'addressProof', maxCount: 1 },
    { name: 'ProfilePic', maxCount: 1 }
]), updateHotelDetail);

hotel_router.get('/get_hotel_listing_by_hotel_user/:id',geHotelListingByHotelUser)

hotel_router.delete('/delete_hotel_vendor/:id',deleteHotelVendor)
hotel_router.delete('/delete_hotel_order/:id',deleleteHotelOrder)
hotel_router.put('/update_status_hotel_order/:id',changeOrderStatusBookingByAdmin)

module.exports = hotel_router;
