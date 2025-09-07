const express = require('express');
const { createRequest, findRider, complete_Details_ofRide, getAllRides, getSingleRides, deleleteRidersRideOrder, changeRidersRideStatusByAdmin, getRidesForMeOffSocketRider } = require('../controllers/ride.request');
const Protect = require('../middleware/Auth');
const { getOnlineTimeByRiderId, getMyEligibleBonus, parcelDashboardData, inProgressOrder } = require('../controllers/rider.controller');
const { registerToken } = require('../Admin Controllers/notification/notificationController');

const rides = express.Router();

rides.post('/create-ride',Protect, createRequest);

rides.get('/find-ride', findRider);
rides.get('/find-ride_details', complete_Details_ofRide);
// rides.post('/change-status', ChangeRideRequestByRider);


rides.get('/all_rides',getAllRides)
rides.get('/single_rides/:id',getSingleRides)

rides.get('/get_riders_times_by_rider_id/:id',getOnlineTimeByRiderId)
rides.delete('/delete_rider_ride/:id', deleleteRidersRideOrder);
rides.put('/update_rider_ride_status/:id', changeRidersRideStatusByAdmin);

rides.post('/driver/poll-rides',getRidesForMeOffSocketRider)
rides.get('/driver/poll-rides-data',getAllRides)


// get My eligible 
rides.get('/getMyEligibleBonus/:userId',getMyEligibleBonus)
rides.get('/parcelDashboardData/:userId',parcelDashboardData)
rides.get('/inProgressOrder/:userId',inProgressOrder)


//expo token push
rides.post('/register-token',registerToken)

module.exports = rides;
