
const express = require('express');
const { NewcreateRequest, BookingDetailsAdmin, ride_status_after_booking, riderFetchPoolingForNewRides, riderActionAcceptOrRejectRide, ride_status_after_booking_for_drivers, changeCurrentRiderRideStatus, verifyRideOtp, collectPayment, cancelRideByPoll, RateYourRider, cancelRideRequest, FetchAllBookedRides, AdminChangeCurrentRiderRideStatus, FindRiderNearByUser, riderActionAcceptOrRejectRideVia, findMyRideNewMode } = require('../../src/New-Rides-Controller/CreateNewRides');
const Protect = require('../../middleware/Auth');
const { calculateRidePriceForUser } = require('../../src/New-Rides-Controller/FindPrice');
const { updateRiderPreferences, getRiderPreferences } = require('../../src/New-Rides-Controller/V3/RIderPrefrencesUpdate');
const { bookIntercityRide, getBookingDetailsById, getAvailableRides, acceptRide, RejectRide, getBookingDetails, verifyRideOTPIntercity, startRide, completeRide, paymentCollect, cancelRide, rateYourInterCity, IntercityRideAll, getDriversForRide } = require('../../src/v3/IntercityRides');
const { getAllRides } = require('../../controllers/ride.request');
const NewRoutes = express.Router()

NewRoutes.post('/new-ride', Protect, NewcreateRequest)
NewRoutes.post('/new-ride-fake', NewcreateRequest)

NewRoutes.post('/new-price-calculations', calculateRidePriceForUser)
NewRoutes.get('/status/:rideId', ride_status_after_booking)
NewRoutes.post('/find-rider-near-user', FindRiderNearByUser)




NewRoutes.get('/pooling-rides-for-rider/:id', riderFetchPoolingForNewRides)
NewRoutes.get('/All-bookings-cab', FetchAllBookedRides)
NewRoutes.get('/booking-details/:id', BookingDetailsAdmin)
NewRoutes.post('/ride-action-reject-accepet', riderActionAcceptOrRejectRide)
NewRoutes.post('/ride-action-reject-accepet-via/:rideId/:token/:action', riderActionAcceptOrRejectRideVia)

NewRoutes.get('/status-driver/:rideId', ride_status_after_booking_for_drivers)


// Change Ride Status
NewRoutes.post('/change-ride-status', changeCurrentRiderRideStatus)
NewRoutes.post('/admin-change-ride-status', AdminChangeCurrentRiderRideStatus)
NewRoutes.post('/verify-ride-otp', verifyRideOtp)
NewRoutes.post('/collect-payment', collectPayment)
NewRoutes.post('/ride/cancel', cancelRideByPoll)
NewRoutes.post('/ride/rate-your-ride/:rideId', RateYourRider)
NewRoutes.post('/cancel-before/:rideId', cancelRideRequest)


// Preferences Update
NewRoutes.post('/update-rider-preferences', updateRiderPreferences);
NewRoutes.get('/get-prefrences/:riderId', getRiderPreferences)

//Book intercity Ride
NewRoutes.post('/book-intercity-ride', bookIntercityRide);
NewRoutes.get('/get-intercity-booking-details/:rideId', getBookingDetailsById)
NewRoutes.get('/get-available-ride-for-driver', getAvailableRides)
NewRoutes.get('/driver-found-for-ride', getDriversForRide)
NewRoutes.post('/accepet-intercity-ride/:rideId', acceptRide)
NewRoutes.post('/reject-intercity-ride/:rideId', RejectRide)
NewRoutes.get('/get-ride-details/:rideId', getBookingDetails)
NewRoutes.post('/verify-ride-otp-intercity', verifyRideOTPIntercity)
NewRoutes.post('/start-intercity-ride', startRide)
NewRoutes.post('/complete-ride-intercity', completeRide)
NewRoutes.post('/collect-payment-intercity', paymentCollect)
NewRoutes.post('/cancel-ride-intercity', cancelRide)
NewRoutes.post('/rate-your-ride-intercity', rateYourInterCity)


NewRoutes.get('/get-all-intercity-rides', IntercityRideAll)
NewRoutes.get('/get-all-rides-user/:id', findMyRideNewMode)



module.exports = NewRoutes;