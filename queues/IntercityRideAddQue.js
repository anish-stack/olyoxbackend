// queues/ProcessRiderQueue.js
const Bull = require('bull');
const IntercityRides = require('../models/v3 models/IntercityRides');
const RideRequestNew = require('../src/New-Rides-Controller/NewRideModel.model');
const driverModel = require('../models/Rider.model');
const sendNotification = require("../utils/sendNotification");
const SendWhatsAppMessageNormal = require('../utils/normalWhatsapp');
const User = require('../models/normal_user/User.model');

// ========================================
// LOGGER HELPER - Logs to both Console & Bull Dashboard
// ========================================
function createLogger(job) {
    return {
        info: async (message, data = {}) => {
            const logMsg = `ℹ️ ${message}`;
            console.log(logMsg, data);
            if (job) await job.log(logMsg);
        },
        success: async (message, data = {}) => {
            const logMsg = `✅ ${message}`;
            console.log(logMsg, data);
            if (job) await job.log(logMsg);
        },
        warn: async (message, data = {}) => {
            const logMsg = `⚠️ ${message}`;
            console.warn(logMsg, data);
            if (job) await job.log(logMsg);
        },
        error: async (message, error = null) => {
            const logMsg = `❌ ${message}`;
            console.error(logMsg, error?.message || error);
            if (job) await job.log(`${logMsg} - ${error?.message || error || ''}`);
        },
        search: async (message, data = {}) => {
            const logMsg = `🔍 ${message}`;
            console.log(logMsg, data);
            if (job) await job.log(logMsg);
        },
        time: async (message, data = {}) => {
            const logMsg = `⏰ ${message}`;
            console.log(logMsg, data);
            if (job) await job.log(logMsg);
        },
        notification: async (message, data = {}) => {
            const logMsg = `📱 ${message}`;
            console.log(logMsg, data);
            if (job) await job.log(logMsg);
        },
        stats: async (message, data = {}) => {
            const logMsg = `📊 ${message}`;
            console.log(logMsg, data);
            if (job) await job.log(logMsg);
        }
    };
}

function getLatLngSafe(obj) {
    const coords = obj?.coordinates;
    if (!coords || coords.length < 2) return null;
    return { lat: coords[1], lng: coords[0] };
}

// Haversine formula to calculate distance in KM
function calculateDistance(lat1, lon1, lat2, lon2) {
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 6371; // Earth radius in KM
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Format distance for display
function formatDistance(km) {
    if (km < 1) return `${(km * 1000).toFixed(0)}m`;
    return `${km.toFixed(1)}km`;
}

// Check if driver is eligible (not rejected, not recently notified)
function isDriverEligible(driver, ride, now) {
    // Check if driver rejected this ride
    const hasRejected = ride.rejected_by_drivers?.some(rej =>
        rej.driver.toString() === driver._id.toString()
    );
    if (hasRejected) return false;

    // Check recent notifications (within 5 minutes)
    const recentlyNotified = ride.notified_riders?.some(notification =>
        notification.rider_id.toString() === driver._id.toString() &&
        (now - new Date(notification.notification_time)) < 5 * 60 * 1000
    );
    if (recentlyNotified) return false;

    // Check active recharge
    const expireDate = driver?.RechargeData?.expireData;
    if (!expireDate || new Date(expireDate) < now) return false;

    return true;
}

// Update ride with driver notification tracking
async function trackDriverNotification(ride, driver, distanceKm, searchAttempt = 20, searchRadius) {
    const now = new Date();
    const distanceM = distanceKm * 1000;
    const formattedDistance = formatDistance(distanceKm);

    // Check if driver already notified in this search attempt
    const existingNotification = ride.notified_riders.find(n =>
        n.rider_id.toString() === driver._id.toString() &&
        n.search_attempt === searchAttempt
    );

    if (existingNotification) {
        existingNotification.notification_count += 1;
        existingNotification.notification_history.push({
            time: now,
            distance: distanceM,
            attempt: searchAttempt,
            success: true
        });
    } else {
        ride.notified_riders.push({
            rider_id: driver._id,
            distance_from_pickup: distanceM,
            distance_from_pickup_km: formattedDistance,
            notification_time: now,
            notification_count: 1,
            rider_location: driver.location || null,
            search_attempt: searchAttempt ? searchAttempt : 20,
            search_radius: searchRadius * 1000, // Convert to meters
            notification_history: [{
                time: now,
                distance: distanceM,
                attempt: searchAttempt,
                success: true
            }]
        });
        ride.total_notifications_sent += 1;
    }

    ride.last_notification_sent_at = now;
    ride.search_started_at = ride.search_started_at || now;

    // Update search status
    if (ride.ride_status !== 'searching') {
        ride.ride_status = 'searching';
    }

    await ride.save();
}

// Send WhatsApp message to user when no driver found
async function sendNoDriverWhatsApp(ride, logger) {
    try {
        const user = await User.findById(ride.user).select('number name');
        if (!user || !user.number) {
            await logger.warn(`No phone number for user ${ride.user}`);
            return;
        }

        const pickupTime = new Date(ride.IntercityPickupTime).toLocaleString('en-IN', {
            timeZone: 'Asia/Kolkata',
            dateStyle: 'medium',
            timeStyle: 'short'
        });

        const message = `Dear ${user.name || 'Customer'},\n\nWe're sorry, but we couldn't find an available driver for your intercity ride scheduled at ${pickupTime}.\n\nPickup: ${ride.pickup_address.formatted_address}\nDrop: ${ride.drop_address.formatted_address}\n\nPlease try booking again or contact support for assistance.\n\nThank you,\nOlyox Team`;

        await SendWhatsAppMessageNormal(message, user.number);

        await logger.notification(`WhatsApp sent to user ${user.number} for ride ${ride._id}`);

        // Update ride with WhatsApp notification status
        ride.no_driver_notification_sent = true;
        ride.no_driver_notification_time = new Date();
        await ride.save();

    } catch (error) {
        await logger.error('Error sending WhatsApp', error);
    }
}

// Redis configuration
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: process.env.REDIS_DB || 0,
};

// Bull queue settings
const QUEUE_SETTINGS = {
    lockDuration: 120000,   // 2 minutes for intercity
    stalledInterval: 60000, // 1 minute
    maxStalledCount: 3,
};

// Job options
const JOB_OPTIONS = {
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 5,
    backoff: { type: 'exponential', delay: 5000 },
};

// Queues
const AddRideInModelOfDb = new Bull('intercity-ride-add', {
    redis: REDIS_CONFIG,
    settings: QUEUE_SETTINGS,
    defaultJobOptions: JOB_OPTIONS,
});

const DriverSearchQueue = new Bull('intercity-driver-search', {
    redis: REDIS_CONFIG,
    settings: QUEUE_SETTINGS,
    defaultJobOptions: JOB_OPTIONS,
});

// ==========================
// Process: Add Intercity Ride to DB
// ==========================
AddRideInModelOfDb.process(1, async (job) => {
    const logger = createLogger(job);

    try {
        await logger.info(`Starting intercity ride add job ${job.id}`);

        const { id } = job.data;
        if (!id) throw new Error('No ride ID provided');

        await logger.info(`Fetching intercity ride ${id} from database`);
        const rideData = await IntercityRides.findById(id);

        if (!rideData) {
            await logger.error('Intercity ride not found in database');
            throw new Error('Intercity ride not found');
        }

        const now = new Date();
        const pickupTime = rideData.schedule?.departureTime;

        await logger.info(`Pickup time: ${pickupTime?.toISOString()}`);

        if (!pickupTime || pickupTime <= now) {
            await logger.error('Invalid pickup time - must be in future');
            throw new Error('Invalid pickup time');
        }

        // Map Intercity ride to RideRequestNew schema
        const newRide = new RideRequestNew({
            user: rideData.passengerId,
            intercityRideModel: id,
            vehicle_type: rideData.vehicle?.type || 'unknown',
            pickup_location: {
                type: 'Point',
                coordinates: rideData.route.origin.location.coordinates,
            },
            pickup_address: { formatted_address: rideData.route.origin.address },
            drop_location: {
                type: 'Point',
                coordinates: rideData.route.destination.location.coordinates,
            },
            drop_address: { formatted_address: rideData.route.destination.address },
            route_info: {
                distance: rideData.route.distance,
                duration: rideData.route.estimatedDuration,
                polyline: rideData.route.polyline,
            },
            scheduled_at: pickupTime,
            IntercityPickupTime: pickupTime,
            rideType: rideData.rideType,
            isIntercityRides: true,
            pricing: {
                total_fare: rideData.pricing.totalPrice,
                currency: rideData.pricing.currency || 'INR',
                original_fare: rideData.pricing.originalPrice || rideData.pricing.totalPrice,
            },
            ride_status: "pending",
            ride_otp: rideData.otp?.code
                ? rideData.otp.code.toString().padStart(4, '0').slice(0, 4)
                : "1290",

            payment_method: rideData.payment?.method || 'cash',
            search_radius: 5,
            max_search_radius: 25,
            auto_increase_radius: true,
            notified_riders: [],
            rejected_by_drivers: [],
            total_notifications_sent: 0,
        });

        await newRide.save();
        await logger.success(`Intercity ride saved: ${newRide._id}`);
        await logger.info(`Pickup: ${pickupTime.toISOString()}`);
        await logger.info(`Route: ${rideData.route.origin.address} → ${rideData.route.destination.address}`);

        // Start driver search after 20 seconds
        const searchDelay = 20 * 1000; // 20 seconds

        await DriverSearchQueue.add(
            { rideId: newRide._id.toString(), searchAttempt: 1 },
            { delay: searchDelay }
        );

        await logger.time(`Driver search scheduled to start in 20 seconds for ride ${newRide._id}`);
        await logger.success(`Job ${job.id} completed successfully`);

    } catch (error) {
        await logger.error('Error adding intercity ride', error);
        throw error;
    }
});

// ==========================
// Process: Periodic Driver Search
// ==========================
DriverSearchQueue.process(2, async (job) => {
    const logger = createLogger(job);

    try {
        const { rideId, searchAttempt } = job.data;

        await logger.search(`Starting search attempt #${searchAttempt} for ride ${rideId}`);

        if (!rideId) throw new Error('No rideId provided');

        const ride = await RideRequestNew.findById(rideId)
        if (!ride) {
            await logger.warn(`Ride ${rideId} not found in database`);
            return;
        }

        if (ride.driver || ride.driver._id) {
            ride.ride_status = 'driver_assigned'; 
            await ride.save();
            await logger.success(`Ride ${rideId} already has a driver assigned, stopping search`);
            return; // Stop processing this job
        }

        const now = new Date();
        const pickupTime = ride.IntercityPickupTime;

        await logger.info(`Current time: ${now.toISOString()}`);
        await logger.info(`Pickup time: ${pickupTime.toISOString()}`);

        // Stop searching 3 minutes before pickup time
        const searchCutoffTime = new Date(pickupTime.getTime() - 3 * 60 * 1000);
        await logger.info(`Search cutoff time: ${searchCutoffTime.toISOString()}`);

        if (now > searchCutoffTime) {
            await logger.time(`Search cutoff reached for ride ${rideId} (3 min before pickup)`);

            // Send WhatsApp if no driver assigned
            if (ride.ride_status === 'searching' || ride.ride_status === 'pending') {
                await logger.notification('No driver found, sending WhatsApp notification to user...');
                await sendNoDriverWhatsApp(ride, logger);

                ride.ride_status = 'no_driver_available';
                await ride.save();
                await logger.warn(`Ride ${rideId} marked as no_driver_available`);
            }
            return;
        }

        // Stop if driver is assigned
        const assignedStatuses = ['accepted', 'driver_assigned', 'arrived', 'started', 'completed'];
        if (assignedStatuses.includes(ride.ride_status)) {
            await logger.success(`Ride ${rideId} already assigned (status: ${ride.ride_status}), stopping search`);
            return;
        }

        // Stop if ride cancelled
        if (ride.ride_status === 'cancelled') {
            await logger.warn(`Ride ${rideId} cancelled, stopping search`);
            return;
        }

        const origin = getLatLngSafe(ride.pickup_location);
        if (!origin) {
            await logger.error('Invalid pickup location coordinates');
            return;
        }

        // Dynamic search radius
        let searchRadius = ride.search_radius || 5;
        if (ride.auto_increase_radius && searchAttempt > 1) {
            searchRadius = Math.min(searchRadius + (searchAttempt - 1) * 2, ride.max_search_radius || 25);
        }

        await logger.search(`Search radius: ${searchRadius}km for attempt #${searchAttempt}`);
        await logger.info(`Pickup location: [${origin.lat}, ${origin.lng}]`);

        // Find eligible drivers
        const driversQuery = {
            "preferences.OlyoxIntercity.enabled": true,
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [origin.lng, origin.lat]
                    },
                    $maxDistance: searchRadius * 1000
                }
            },
            $or: [
                { on_intercity_ride_id: { $exists: false } },
                { on_intercity_ride_id: null }
            ]
        };


        await logger.search('Querying database for nearby drivers...');
        const drivers = await driverModel
            .find(driversQuery)
            .select('name fcmToken location preferences rideVehicleInfo RechargeData')
            .lean();

        await logger.info(`Found ${drivers.length} drivers within ${searchRadius}km radius`);

        let notificationsSent = 0;
        let eligibleCount = 0;
        let ineligibleReasons = {
            rejected: 0,
            recentlyNotified: 0,
            noRecharge: 0,
            noLocation: 0,
            vehicleMismatch: 0
        };

        for (const driver of drivers) {
            // Check eligibility
            if (!isDriverEligible(driver, ride, now)) {
                const hasRejected = ride.rejected_by_drivers?.some(rej =>
                    rej.driver.toString() === driver._id.toString()
                );
                if (hasRejected) {
                    ineligibleReasons.rejected++;
                    continue;
                }

                const recentlyNotified = ride.notified_riders?.some(notification =>
                    notification.rider_id.toString() === driver._id.toString() &&
                    (now - new Date(notification.notification_time)) < 5 * 60 * 1000
                );
                if (recentlyNotified) {
                    ineligibleReasons.recentlyNotified++;
                    continue;
                }

                const expireDate = driver?.RechargeData?.expireData;
                if (!expireDate || new Date(expireDate) < now) {
                    ineligibleReasons.noRecharge++;
                    continue;
                }
            }

            const driverLoc = getLatLngSafe(driver.location);
            if (!driverLoc) {
                ineligibleReasons.noLocation++;
                continue;
            }

            const distanceKm = calculateDistance(origin.lat, origin.lng, driverLoc.lat, driverLoc.lng);

            if (distanceKm > searchRadius) continue;

            // Vehicle compatibility check
            const driverVehicle = driver.rideVehicleInfo?.vehicleType;
            const requiredVehicle = ride.vehicle_type.toUpperCase();
            let vehicleCompatible = false;

            if (driverVehicle === requiredVehicle) {
                vehicleCompatible = true;
            } else if (requiredVehicle === "SEDAN" && ["SUV", "XL", "SUV/XL", "MINI"].includes(driverVehicle)) {
                vehicleCompatible = driver.preferences?.OlyoxAcceptSedanRides || driver.preferences?.OlyoxIntercity;
            } else if (requiredVehicle === "MINI" && ["SEDAN", "SUV", "XL", "SUV/XL"].includes(driverVehicle)) {
                vehicleCompatible = driver.preferences?.OlyoxAcceptMiniRides || driver.preferences?.OlyoxIntercity;
            }

            if (!vehicleCompatible) {
                ineligibleReasons.vehicleMismatch++;
                continue;
            }

            eligibleCount++;

            try {
                // Track notification before sending
                await trackDriverNotification(ride, driver, distanceKm, searchAttempt, searchRadius);

                await logger.notification(`Sending notification to ${driver.name} (${distanceKm.toFixed(1)}km away)`);

                // Send notification
                await sendNotification.sendNotification(
                    driver.fcmToken,
                    "New Intercity Ride Available! 🚗✨",
                    `Intercity ride from ${ride.pickup_address.formatted_address} to ${ride.drop_address.formatted_address}`,
                    {
                        event: "NEW_INTERCITY_RIDE",
                        rideDetails: {
                            rideId: ride._id.toString(),
                            distance: ride.route_info?.distance,
                            distance_from_pickup_km: distanceKm.toFixed(1),
                            pickup: ride.pickup_address.formatted_address,
                            drop: ride.drop_address.formatted_address,
                            vehicleType: ride.vehicle_type,
                            pricing: ride.pricing,
                            scheduledTime: ride.IntercityPickupTime,
                            searchRadius: searchRadius
                        },
                        screen: "IntercityRideRequest",
                        rideType: "intercity"
                    },
                    "intercity_ride_channel"
                );

                notificationsSent++;
                await logger.success(`Notification sent to ${driver.name} (${distanceKm.toFixed(1)}km)`);

            } catch (notificationError) {
                await logger.error(`Failed to notify driver ${driver.name}`, notificationError);

                // Track failed notification
                const notificationEntry = ride.notified_riders.find(n =>
                    n.rider_id.toString() === driver._id.toString()
                );
                if (notificationEntry) {
                    notificationEntry.notification_failed = true;
                    notificationEntry.error_message = notificationError.message;
                    notificationEntry.error_code = notificationError.code || 'NOTIFICATION_FAILED';
                    notificationEntry.notification_history.push({
                        time: new Date(),
                        distance: distanceKm * 1000,
                        attempt: searchAttempt,
                        success: false,
                        error: notificationError.message
                    });
                }

                await ride.save();
            }
        }

        // Log detailed statistics
        await logger.stats(`Search attempt #${searchAttempt} completed`);
        await logger.info(`Total drivers found: ${drivers.length}`);
        await logger.info(`Eligible drivers: ${eligibleCount}`);
        await logger.info(`Notifications sent: ${notificationsSent}`);

        if (eligibleCount === 0) {
            await logger.warn('No eligible drivers found. Reasons:');
            await logger.info(`- Rejected: ${ineligibleReasons.rejected}`);
            await logger.info(`- Recently notified: ${ineligibleReasons.recentlyNotified}`);
            await logger.info(`- No active recharge: ${ineligibleReasons.noRecharge}`);
            await logger.info(`- No location: ${ineligibleReasons.noLocation}`);
            await logger.info(`- Vehicle mismatch: ${ineligibleReasons.vehicleMismatch}`);
        }

        // Schedule next search
        const timeUntilNextSearch = 30 * 1000; // 30 seconds
        const timeUntilCutoff = searchCutoffTime.getTime() - now.getTime();
        const minutesUntilCutoff = Math.floor(timeUntilCutoff / 1000 / 60);

        if (timeUntilCutoff > timeUntilNextSearch) {
            await DriverSearchQueue.add(
                { rideId: ride._id.toString(), searchAttempt: searchAttempt + 1 },
                { delay: timeUntilNextSearch }
            );
            await logger.time(`Next search scheduled in 30s (${minutesUntilCutoff} min until cutoff)`);
        } else if (timeUntilCutoff > 0) {
            await DriverSearchQueue.add(
                { rideId: ride._id.toString(), searchAttempt: searchAttempt + 1 },
                { delay: timeUntilCutoff - 5000 }
            );
            await logger.time('Final search scheduled before cutoff');
        } else {
            await logger.warn('Cutoff time reached, no more searches scheduled');
        }

        // Update retry count
        ride.retry_count = Math.max(ride.retry_count || 0, searchAttempt);
        ride.last_retry_at = now;
        await ride.save();

        await logger.success(`Job ${job.id} completed`);

    } catch (error) {
        await logger.error('Error in driver search', error);

        try {
            const ride = await RideRequestNew.findById(job.data.rideId);
            if (ride) {
                ride.last_error = {
                    message: error.message,
                    code: error.code || 'SEARCH_FAILED',
                    occurred_at: new Date()
                };
                ride.retry_count = (ride.retry_count || 0) + 1;
                await ride.save();
            }
        } catch (saveError) {
            await logger.error('Failed to save error to ride', saveError);
        }

        throw error;
    }
});

// Graceful shutdown
process.on('SIGTERM', async () => {
    console.log('🛑 Shutting down queues...');
    await AddRideInModelOfDb.close();
    await DriverSearchQueue.close();
    console.log('✅ Queues closed');
    process.exit(0);
});

// Monitor stalled jobs
AddRideInModelOfDb.on('stalled', (job) => {
    console.warn(`⚠️ AddRide job ${job.id} stalled`);
});

DriverSearchQueue.on('stalled', (job) => {
    console.warn(`⚠️ Driver search job ${job.id} stalled`);
});

// Monitor failed jobs
AddRideInModelOfDb.on('failed', (job, err) => {
    console.error(`❌ AddRide job ${job.id} failed:`, err.message);
});

DriverSearchQueue.on('failed', (job, err) => {
    console.error(`❌ Driver search job ${job.id} failed:`, err.message);
});

module.exports = {
    AddRideInModelOfDb,
    DriverSearchQueue,
    trackDriverNotification,
    isDriverEligible,
    sendNoDriverWhatsApp
};