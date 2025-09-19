const rideRequestModel = require("../src/New-Rides-Controller/NewRideModel.model");
const User = require('../models/normal_user/User.model');
const RiderModel = require("../models/Rider.model");
const Parcel_Request = require("../models/Parcel_Models/Parcel_Request");



exports.webhookExotelApi = async (req, res) => {
    try {
        console.log('Webhook triggered: Incoming request', req.query);
        
        const { CallFrom } = req.query;
        
        if (!CallFrom) {
            console.log('❌ Error: Missing CallFrom parameter in request');
            console.log('Available query params:', Object.keys(req.query));
            return res.status(400).type('text/plain').send('Missing CallFrom parameter');
        }

        console.log('✅ CallFrom received:', CallFrom);
        
        // Remove leading zeros and clean the phone number
        const removeZero = CallFrom.toString().replace(/^0+/, '').trim();
        console.log('📞 Processed phone number:', removeZero);
        
        // Validate phone number format
        if (!/^\d{10}$/.test(removeZero)) {
            console.log('❌ Invalid phone number format:', removeZero);
            return res.status(400).type('text/plain').send('Invalid phone number format');
        }

        let typeOfCall = 'user-to-rider';
        let checkThisWithOurUser = null;
        
        console.log('🔍 Step 1: Checking if caller is a registered user...');
        
        // Check if the call is from a user
        try {
            checkThisWithOurUser = await User.findOne({ number: removeZero });
            console.log('👤 User lookup result:', checkThisWithOurUser ? 
                `Found user with ID ${checkThisWithOurUser._id}` : 'No user found');
        } catch (userError) {
            console.error('❌ Error during user lookup:', userError);
        }
        
        if (!checkThisWithOurUser) {
            console.log('🔍 Step 2: No user found, checking if caller is a registered rider...');
            
            try {
                checkThisWithOurUser = await RiderModel.findOne({ phone: removeZero });
                console.log('🏍️ Rider lookup result:', checkThisWithOurUser ? 
                    `Found rider with ID ${checkThisWithOurUser}` : 'No rider found');
                
                if (checkThisWithOurUser) {
                    typeOfCall = 'rider-to-user';
                    console.log('📞 Call type set to: rider-to-user');
                } else {
                    console.log(`❌ No user or rider found with number: ${removeZero}`);
                    return res.status(200).type('text/plain').send('Number not registered');
                }
            } catch (riderError) {
                console.error('❌ Error during rider lookup:', riderError);
                return res.status(500).type('text/plain').send('Database error during rider lookup');
            }
        } else {
            console.log('📞 Call type set to: user-to-rider');
        }
        
        // Handle user-to-rider calls
        if (typeOfCall === 'user-to-rider') {
            console.log(`🔍 Processing user-to-rider call from user ID: ${checkThisWithOurUser._id}`);
            
            try {
                // Look for active ride first
                console.log('🚗 Looking for active ride...');
                const rideRequest = await rideRequestModel
                    .findOne({ 
                        _id: checkThisWithOurUser.currentRide,
                        ride_status: { $in: ['pending', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress'] }
                    })
                    .populate('driver', 'phone')
                    .sort({ createdAt: -1 });
                
                console.log('🚗 Active ride lookup result:', rideRequest ? 
                    `Found ride with status: ${rideRequest.ride_status}` : 'No active ride found');
                
                if (rideRequest && rideRequest.driver && rideRequest.driver.phone) {
                    console.log(`✅ Found active ride. Driver phone: ${rideRequest.driver.phone}`);
                    const driverPhone = rideRequest.driver.phone.toString();
                    const formattedPhone = driverPhone.startsWith('+') ? driverPhone : `+91${driverPhone}`;
                    console.log(`📱 Returning formatted driver phone: ${formattedPhone}`);
                    return res.status(200).type('text/plain').send(formattedPhone);
                }
                
                // If no active ride, check for recent completed ride
                console.log('🚗 Looking for recent completed ride...');
                const recentRide = await rideRequestModel
                    .findOne({ 
                        user: checkThisWithOurUser._id,
                        ride_status: 'completed'
                    })
                    .populate('rider', 'phone')
                    .sort({ updatedAt: -1 });
                
                if (recentRide && recentRide.driver && recentRide.driver.phone) {
                    // Check if completed within last 30 minutes
                    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
                    if (recentRide.updated_at > thirtyMinutesAgo) {
                        console.log(`✅ Found recent completed ride. Driver phone: ${recentRide.driver.phone}`);
                        const driverPhone = recentRide.driver.phone.toString();
                        const formattedPhone = driverPhone.startsWith('+') ? driverPhone : `+91${driverPhone}`;
                        console.log(`📱 Returning formatted driver phone: ${formattedPhone}`);
                        return res.status(200).type('text/plain').send(formattedPhone);
                    }
                }
                
                // Check for active parcel
                console.log('📦 Looking for active parcel delivery...');
                const userParcelDetails = await Parcel_Request
                    .findOne({ 
                        customerId: checkThisWithOurUser._id,
                        status: { $in: ['accepted', 'picked', 'in_transit'] }
                    })
                    .populate('rider_id', 'phone')
                    .sort({ created_at: -1 });
                
                console.log('📦 Parcel lookup result:', userParcelDetails ? 
                    `Found parcel with status: ${userParcelDetails.status}` : 'No active parcel found');
                    
                if (userParcelDetails && userParcelDetails.rider_id && userParcelDetails.rider_id.phone) {
                    console.log(`✅ Found active parcel. Rider phone: ${userParcelDetails.rider_id.phone}`);
                    const riderPhone = userParcelDetails.rider_id.phone.toString();
                    const formattedPhone = riderPhone.startsWith('+') ? riderPhone : `+91${riderPhone}`;
                    console.log(`📱 Returning formatted rider phone for parcel: ${formattedPhone}`);
                    return res.status(200).type('text/plain').send(formattedPhone);
                }
                
            } catch (searchError) {
                console.error('❌ Error during ride/parcel search:', searchError);
                return res.status(500).type('text/plain').send('Database error during search');
            }
            
            console.log(`❌ No active services found for user ID ${checkThisWithOurUser._id}`);
            return res.status(200).type('text/plain').send('No active ride or delivery from user');
        }
        
        // Handle rider-to-user calls
        if (typeOfCall === 'rider-to-user') {
            console.log(`🔍 Processing rider-to-user call from rider ID: ${checkThisWithOurUser._id}`);
            
            try {
                // Look for active ride
                console.log('🚗 Looking for active ride assigned to this rider...');
                const rideDetails = await rideRequestModel
                    .findOne({ 
                        _id: checkThisWithOurUser.on_ride_id, 
                        ride_status: { $in: ['pending', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress'] } 
                    })
                    .populate('user', 'number')
                    .sort({ createdAt: -1 });
                
                console.log('🚗 Active ride lookup result:', rideDetails ? 
                    `Found ride with status: ${rideDetails.ride_status}` : 'No active ride found');
                
                if (rideDetails && rideDetails.user && rideDetails.user.number) {
                    console.log(`✅ Found active ride. User phone: ${rideDetails.user.number}`);
                    const userPhone = rideDetails.user.number.toString();
                    const formattedPhone = userPhone.startsWith('+') ? userPhone : `+91${userPhone}`;
                    console.log(`📱 Returning formatted user phone: ${formattedPhone}`);
                    return res.status(200).type('text/plain').send(formattedPhone);
                }
                
                // Check for recent completed ride
                console.log('🚗 Looking for recent completed ride...');
                const recentRide = await rideRequestModel
                    .findOne({ 
                        rider: checkThisWithOurUser._id,
                        ride_status: 'completed'
                    })
                    .populate('user', 'number')
                    .sort({ updatedAt: -1 });
                
                if (recentRide && recentRide.user && recentRide.user.number) {
                    // Check if completed within last 30 minutes
                    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
                    if (recentRide.updated_at > thirtyMinutesAgo) {
                        console.log(`✅ Found recent completed ride. User phone: ${recentRide.user.number}`);
                        const userPhone = recentRide.user.number.toString();
                        const formattedPhone = userPhone.startsWith('+') ? userPhone : `+91${userPhone}`;
                        console.log(`📱 Returning formatted user phone: ${formattedPhone}`);
                        return res.status(200).type('text/plain').send(formattedPhone);
                    }
                }
                
                // Check for active parcel
                console.log('📦 Looking for active parcel delivery assigned to this rider...');
                const parcelDetails = await Parcel_Request
                    .findOne({ 
                        rider_id: checkThisWithOurUser._id,
                        status: { $in: ['accepted', 'picked', 'in_transit'] }
                    })
                    .populate('customerId', 'number')
                    .sort({ created_at: -1 });
                
                console.log('📦 Parcel lookup result:', parcelDetails ? 
                    `Found parcel with status: ${parcelDetails.status}` : 'No active parcel found');
                
                if (parcelDetails && parcelDetails.customerId && parcelDetails.customerId.number) {
                    console.log(`✅ Found active parcel. User phone: ${parcelDetails.customerId.number}`);
                    const userPhone = parcelDetails.customerId.number.toString();
                    const formattedPhone = userPhone.startsWith('+') ? userPhone : `+91${userPhone}`;
                    console.log(`📱 Returning formatted user phone for parcel: ${formattedPhone}`);
                    return res.status(200).type('text/plain').send(formattedPhone);
                }
                
            } catch (searchError) {
                console.error('❌ Error during ride/parcel search:', searchError);
                return res.status(500).type('text/plain').send('Database error during search');
            }
            
            console.log(`❌ No active services found for rider ID ${checkThisWithOurUser._id}`);
            return res.status(200).type('text/plain').send('No active ride or delivery from rider');
        }
        
        console.log('⚠️ Warning: Reached end of function without processing call type');
        return res.status(200).type('text/plain').send('Unhandled call type');
        
    } catch (error) {
        console.error('💥 CRITICAL ERROR processing webhook request:');
        console.error('Error message:', error.message);
        console.error('Error stack:', error.stack);
        console.error('=== WEBHOOK REQUEST END WITH ERROR ===');
        return res.status(500).type('text/plain').send('Internal Server Error');
    }
};