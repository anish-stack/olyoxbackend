const Bull = require('bull');
const RideBooking = require('../src/New-Rides-Controller/NewRideModel.model'); // RideBooking model
const driverModel = require('../models/Rider.model'); // Driver model
const SendWhatsAppMessageNormal = require('../utils/normalWhatsapp');

// Create Bull Queue
const intercityQueue = new Bull('intercity-ride-queue', {
    redis: { host: '127.0.0.1', port: 6379 }
});

// --- Schedule Notifications ---
const scheduleIntercityRideNotifications = async (rideId) => {
    const ride = await RideBooking.findById(rideId).populate('user driver');

    if (!ride || !ride.isIntercityRides) return;

    const pickupTime = new Date(ride.IntercityPickupTime);

    // 1 hour before pickup
    const delay1h = new Date(pickupTime.getTime() - 60 * 60 * 1000) - new Date();
    if (delay1h > 0) {
        await intercityQueue.add(
            { rideId, type: 'reminder' },
            { delay: delay1h, attempts: 3, backoff: 5000 }
        );
    }

    // 40 minutes before pickup
    const delay40m = new Date(pickupTime.getTime() - 40 * 60 * 1000) - new Date();
    if (delay40m > 0) {
        await intercityQueue.add(
            { rideId, type: 'lock_driver' },
            { delay: delay40m, attempts: 3, backoff: 5000 }
        );
    }
};

// --- Process Queue ---
intercityQueue.process(async (job) => {
    const { rideId, type } = job.data;

    try {
        const ride = await RideBooking.findById(rideId).populate('user driver');
        if (!ride || ride.ride_status==="cancelled") {
            await job.log(`Ride not found or cancelled: ${rideId}`);
            return;
        }

        const driver = await driverModel.findById(ride.driver?._id);
        if (!driver) {
            await job.log(`Driver not found for ride: ${rideId}`);
            return;
        }

        const pickupTime = new Date(ride.IntercityPickupTime || ride.scheduled_at);

        if (type === 'reminder') {
            // WhatsApp to driver
            if (driver.phone) {
                const driverMsg = `🚗 Hi ${driver.name}, your intercity ride is scheduled at ${pickupTime.toLocaleString()}. Please prepare for pickup.`;
                await SendWhatsAppMessageNormal(driverMsg, driver.phone);
            }

            // WhatsApp to user
            if (ride.user?.number) {
                const userMsg = `📢 Hi ${ride.user.name}, your intercity ride (Booking ID: ${ride._id.toString().slice(-8).toUpperCase()}) is confirmed. Pickup at ${pickupTime.toLocaleString()}.`;
                await SendWhatsAppMessageNormal(userMsg, ride.user.number);
            }

            await job.log(`✅ Reminder sent for ride ${rideId}`);
        }

        if (type === 'lock_driver') {
            // Lock driver if available
            if (!driver.on_ride_id) {
                driver.on_ride_id = ride._id;
                driver.isAvailable = false;
                await driver.save();
            }

            // Final WhatsApp to user
            if (ride.user?.number) {
                const userMsg = `🚗 Hi ${ride.user.name}, your driver ${driver.name} is now on the way. Pickup at ${pickupTime.toLocaleString()}.`;
                await SendWhatsAppMessageNormal(userMsg, ride.user.number);
            }

            await job.log(`🛑 Driver locked & final notification sent for ride ${rideId}`);
        }
    } catch (err) {
        console.error('Queue processing error:', err);
        await job.log(`❌ Error processing ride ${rideId}: ${err.message}`);
        throw err; // allows Bull retries
    }

    return Promise.resolve();
});

// --- Export ---
module.exports = {
    intercityQueue,
    scheduleIntercityRideNotifications
};
