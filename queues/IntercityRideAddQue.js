// queues/ProcessRiderQueue.js
const Bull = require('bull');
const IntercityRides = require('../models/v3 models/IntercityRides');
const RideRequestNew = require('../src/New-Rides-Controller/NewRideModel.model');

// Redis configuration
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: process.env.REDIS_DB || 0,
};

const QUEUE_SETTINGS = {
    lockDuration: 60000, // 1 minute
    stalledInterval: 30000, // 30 seconds
    maxStalledCount: 3,
};

const JOB_OPTIONS = {
    removeOnComplete: 50,
    removeOnFail: 100,
    attempts: 3,
    backoff: {
        type: 'exponential',
        delay: 2000,
    },
};

// Queue for adding rides and processing intercity rides
const AddRideInModelOfDb = new Bull('ride-add-and-searching', {
    redis: REDIS_CONFIG,
    settings: QUEUE_SETTINGS,
    defaultJobOptions: JOB_OPTIONS,
});

// Job for starting driver search
const StartFetchingDriverQueue = new Bull('start-fetching-driver', {
    redis: REDIS_CONFIG,
    settings: QUEUE_SETTINGS,
    defaultJobOptions: JOB_OPTIONS,
});

// Processor for adding rides to RideRequestNew
AddRideInModelOfDb.process(async (job) => {
    try {
        const { id } = job.data;
        if (!id) throw new Error('No ride ID provided');

        const rideData = await IntercityRides.findById(id);
        if (!rideData) throw new Error('Intercity ride not found');

        // Map the intercity ride JSON to RideRequestNew schema
        const newRide = new RideRequestNew({
            user: rideData.passengerId,
            vehicle_type: rideData.vehicle?.type || 'unknown',
            pickup_location: {
                type: 'Point',
                coordinates: rideData.route.origin.location.coordinates,
            },
            pickup_address: {
                formatted_address: rideData.route.origin.address,
            },
            drop_location: {
                type: 'Point',
                coordinates: rideData.route.destination.location.coordinates,
            },
            drop_address: {
                formatted_address: rideData.route.destination.address,
            },
            route_info: {
                distance: rideData.route.distance,
                duration: rideData.route.estimatedDuration,
            },
            scheduled_at: rideData.schedule?.departureTime,
            rideType: rideData.rideType,
            IntercityPickupTime: rideData.schedule?.departureTime,
            pricing: {
                total_fare: rideData.pricing.totalPrice,
                currency: rideData.pricing.currency,
            },
            ride_status: "pending",
            ride_otp: rideData.otp?.code,
            payment_method: rideData.payment.method,
            isIntercityRides: true,
        });

        await newRide.save();
        console.log(`✅ Ride saved in RideRequestNew with ID: ${newRide._id}`);

        // Add a job to fetch driver
        await StartFetchingDriverQueue.add({ rideId: newRide._id });
        console.log('🚀 startFetchingDriver job added');

    } catch (error) {
        console.error('❌ Error processing ride:', error.message);
        throw error;
    }
});

// Example processor for startFetchingDriver job
StartFetchingDriverQueue.process(async (job) => {
    try {
        const { rideId } = job.data;
        console.log(`🔍 Start fetching drivers for ride: ${rideId}`);

        

    } catch (error) {
        console.error('❌ Error in startFetchingDriver job:', error.message);
        throw error;
    }
});

module.exports = {
    AddRideInModelOfDb,
    StartFetchingDriverQueue,
};
