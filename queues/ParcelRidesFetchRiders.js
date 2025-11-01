const Bull = require("bull");
const RideRequestNew = require("../src/New-Rides-Controller/NewRideModel.model");
const driverModel = require("../models/Rider.model");
const sendNotification = require("../utils/sendNotification");
const User = require("../models/normal_user/User.model");

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
            if (job) await job.log(`${logMsg} - ${error?.message || error || ""}`);
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
        },
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

// Helper to format distance from meters to km string
function formatDistanceInKm(meters) {
    if (!meters) return '0km';
    const km = meters / 1000;
    return formatDistance(km);
}

// Check if driver is eligible for parcel delivery
function isDriverEligibleForParcel(driver, ride, now) {
    // Check if driver rejected this ride
    const hasRejected = ride.rejected_by_drivers?.some(
        (rej) => rej.driver.toString() === driver._id.toString()
    );
    if (hasRejected) return { eligible: false, reason: 'rejected' };

    // Check recent notifications (within 5 minutes)
    const recentlyNotified = ride.notified_riders?.some(
        (notification) =>
            notification.rider_id.toString() === driver._id.toString() &&
            now - new Date(notification.notification_time) < 5 * 60 * 1000
    );
    if (recentlyNotified) return { eligible: false, reason: 'recently_notified' };

    // Parcel delivery eligibility logic
    const category = driver.category?.toLowerCase();
    const vehicleType = driver.rideVehicleInfo?.vehicleType?.toLowerCase();
    const parcelDelivery = driver.ParcelDelivery;

    // Category A: Parcel drivers - Always eligible (any vehicle type)
    if (category === 'parcel') {
        return { eligible: true, reason: 'parcel_driver' };
    }

    // Category B: Cab drivers with bike and ParcelDelivery = true
    if (category === 'cab' && vehicleType === 'bike' && parcelDelivery === true) {
        return { eligible: true, reason: 'cab_bike_parcel_enabled' };
    }

    // Category C: Cab drivers with bike but ParcelDelivery = false - Not eligible
    if (category === 'cab' && vehicleType === 'bike' && parcelDelivery === false) {
        return { eligible: false, reason: 'parcel_delivery_disabled' };
    }

    // Not eligible if none of the above conditions match
    return { eligible: false, reason: 'category_vehicle_mismatch' };
}

// Update ride with driver notification tracking
async function trackDriverNotification(
    ride,
    driver,
    distanceKm,
    searchAttempt = 1,
    searchRadius
) {
    const now = new Date();
    const distanceM = distanceKm * 1000;
    const formattedDistance = formatDistance(distanceKm);

    // Check if driver already notified in this search attempt
    const existingNotification = ride.notified_riders.find(
        (n) =>
            n.rider_id.toString() === driver._id.toString() &&
            n.search_attempt === searchAttempt
    );

    if (existingNotification) {
        existingNotification.notification_count += 1;
        existingNotification.notification_history.push({
            time: now,
            distance: distanceM,
            attempt: searchAttempt,
            success: true,
        });
    } else {
        ride.notified_riders.push({
            rider_id: driver._id,
            distance_from_pickup: distanceM,
            distance_from_pickup_km: formattedDistance,
            notification_time: now,
            notification_count: 1,
            rider_location: driver.location || null,
            search_attempt: searchAttempt,
            search_radius: searchRadius * 1000, // Convert to meters
            notification_history: [
                {
                    time: now,
                    distance: distanceM,
                    attempt: searchAttempt,
                    success: true,
                },
            ],
        });
        ride.total_notifications_sent += 1;
    }

    ride.last_notification_sent_at = now;
    ride.search_started_at = ride.search_started_at || now;

    // Update search status
    if (ride.ride_status !== "searching") {
        ride.ride_status = "searching";
    }

    await ride.save();
}

// Send WhatsApp notification when no driver found
async function sendNoDriverWhatsApp(ride, logger) {
    try {
        const user = await User.findById(ride.user);
        if (user && user.phone) {
            // Implement your WhatsApp notification logic here
            await logger.notification(`WhatsApp sent to user: ${user.phone}`);
        }
    } catch (error) {
        await logger.error("Failed to send WhatsApp", error);
    }
}

// Redis configuration
const REDIS_CONFIG = {
    host: process.env.REDIS_HOST || "127.0.0.1",
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: process.env.REDIS_DB || 0,
};

// Bull queue settings
const QUEUE_SETTINGS = {
    lockDuration: 60000, // 1 minute for parcel delivery
    stalledInterval: 30000, // 30 seconds
    maxStalledCount: 3,
};

// Job options
const JOB_OPTIONS = {
    removeOnComplete: 100,
    removeOnFail: 200,
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
};

const DriverSearchForParcelQueue = new Bull("parcel-driver-search", {
    redis: REDIS_CONFIG,
    settings: QUEUE_SETTINGS,
    defaultJobOptions: JOB_OPTIONS,
});

DriverSearchForParcelQueue.process(2, async (job) => {
    const logger = createLogger(job);
    let io;

    try {
        const { rideId, searchAttempt = 1 } = job.data;

        // Get io from global if available
        if (global.socketIO) {
            io = global.socketIO;
        }

        await logger.search(
            `Starting parcel search attempt #${searchAttempt} for ride ${rideId}`
        );

        if (!rideId) throw new Error("No rideId provided");

        const ride = await RideRequestNew.findById(rideId);
        if (!ride) {
            await logger.warn(`Ride ${rideId} not found in database`);
            return;
        }
        console.log("ride details", ride)
        // Check if driver already assigned
        if (ride.driver) {
            ride.ride_status = "driver_assigned";
            await ride.save();
            await logger.success(
                `Ride ${rideId} already has a driver assigned, stopping search`
            );
            return;
        }

        const now = new Date();

        // For immediate parcel orders, stop searching after 5 minutes
        const searchDuration = 5 * 60 * 1000; // 5 minutes
        const searchStartTime = ride.search_started_at || ride.requested_at || now;
        const searchCutoffTime = new Date(searchStartTime.getTime() + searchDuration);

        await logger.info(`Current time: ${now.toISOString()}`);
        await logger.info(`Search started at: ${searchStartTime.toISOString()}`);
        await logger.info(`Search cutoff time: ${searchCutoffTime.toISOString()}`);

        // Check if search time has expired
        if (now > searchCutoffTime) {
            await logger.time(
                `Search cutoff reached for ride ${rideId} (5 min search limit)`
            );

            if (ride.ride_status === "searching" || ride.ride_status === "pending") {
                await logger.notification(
                    "No driver found, sending WhatsApp notification to user..."
                );
                // await sendNoDriverWhatsApp(ride, logger);

                ride.ride_status = "cancelled";
                ride.cancellation_reason = "No drivers found after multiple attempts";
                ride.cancelled_at = now;
                await ride.save();
                await logger.warn(`Ride ${rideId} marked as no_driver_available`);
            }
            return;
        }

        // Stop if driver is assigned
        const assignedStatuses = [
            "accepted",
            "driver_assigned",
            "arrived",
            "started",
            "completed",
        ];
        if (assignedStatuses.includes(ride.ride_status)) {
            await logger.success(
                `Ride ${rideId} already assigned (status: ${ride.ride_status}), stopping search`
            );
            return;
        }

        // Stop if ride cancelled
        if (ride.ride_status === "cancelled") {
            await logger.warn(`Ride ${rideId} cancelled, stopping search`);
            return;
        }

        const origin = getLatLngSafe(ride.pickup_location);
        if (!origin) {
            await logger.error("Invalid pickup location coordinates");
            return;
        }

        // Dynamic search radius for parcel delivery
        let searchRadius = ride.search_radius || 1.5;
        if (ride.auto_increase_radius && searchAttempt > 1) {
            searchRadius = Math.min(
                searchRadius + (searchAttempt - 1) * 0.5,
                ride.max_search_radius || 25
            );
        }

        await logger.search(
            `Search radius: ${searchRadius}km for attempt #${searchAttempt}`
        );
        await logger.info(`Pickup location: [${origin.lat}, ${origin.lng}]`);
        console.log("origin", origin)
        // Find eligible drivers for parcel delivery
        const driversQuery = {
            location: {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [origin.lng, origin.lat],
                    },
                    $maxDistance: searchRadius * 1000,
                },
            },


            isAvailable: true,
            $or: [
                { on_ride_id: { $exists: false } },
                { on_ride_id: null },
            ],
        };

        await logger.search("Querying database for nearby parcel drivers...");
        const drivers = await driverModel
            .find(driversQuery)
            .select("name fcmToken location category ParcelDelivery rideVehicleInfo preferences")
            .lean();
        console.log("")
        await logger.info(
            `Found ${drivers.length} drivers within ${searchRadius}km radius`
        );

        let notificationsSent = 0;
        let eligibleCount = 0;
        let ineligibleReasons = {
            rejected: 0,
            recentlyNotified: 0,
            noLocation: 0,
            categoryVehicleMismatch: 0,
            parcelDeliveryDisabled: 0,
        };

        for (const driver of drivers) {
            // Check parcel delivery eligibility
            const eligibilityCheck = isDriverEligibleForParcel(driver, ride, now);
            console.log("eligibilityCheck", eligibilityCheck)
            if (!eligibilityCheck.eligible) {
                switch (eligibilityCheck.reason) {
                    case 'rejected':
                        ineligibleReasons.rejected++;
                        break;
                    case 'recently_notified':
                        ineligibleReasons.recentlyNotified++;
                        break;
                    case 'parcel_delivery_disabled':
                        ineligibleReasons.parcelDeliveryDisabled++;
                        break;
                    case 'category_vehicle_mismatch':
                        ineligibleReasons.categoryVehicleMismatch++;
                        break;
                }
                continue;
            }

            const driverLoc = getLatLngSafe(driver.location);
            if (!driverLoc) {
                ineligibleReasons.noLocation++;
                continue;
            }

            const distanceKm = calculateDistance(
                origin.lat,
                origin.lng,
                driverLoc.lat,
                driverLoc.lng
            );

            if (distanceKm > searchRadius) continue;

            eligibleCount++;

            try {
                // Track notification before sending
                await trackDriverNotification(
                    ride,
                    driver,
                    distanceKm,
                    searchAttempt,
                    searchRadius
                );

                await logger.notification(
                    `Sending notification to ${driver.name} (${distanceKm.toFixed(1)}km away) - ${eligibilityCheck.reason}`
                );

                // Send notification
                await sendNotification.sendNotification(
                    driver.fcmToken,
                    "New Parcel Delivery Available! 📦",
                    `Parcel delivery from ${ride.pickup_address.formatted_address} to ${ride.drop_address.formatted_address}`,
                    {
                        event: "NEW_PARCEL_DELIVERY",
                        rideDetails: {
                            rideId: ride._id.toString(),
                            distance: ride.route_info?.distance,
                            distance_from_pickup_km: distanceKm.toFixed(1),
                            pickup: ride.pickup_address.formatted_address,
                            drop: ride.drop_address.formatted_address,
                            vehicleType: ride.vehicle_type,
                            pricing: ride.pricing,
                            isParcelOrder: true,
                            searchRadius: searchRadius,
                        },
                        screen: "ParcelDeliveryRequest",
                        rideType: "parcel",
                    },
                    "ride_request_channel"
                );

                // Send socket notification if available
                if (io) {
                    const socketsInRoom = await io.in(`driver:${driver._id}`).allSockets();
                    if (socketsInRoom.size > 0) {
                        const notifiedRider = ride.notified_riders?.find(
                            nr => nr.rider_id.toString() === driver._id.toString()
                        );

                        io.to(`driver:${driver._id}`).emit("new_parcel_request", {
                            rideId: ride._id,
                            notificationId: ride._id,
                            notificationCount: notifiedRider?.notification_count || 0,
                            distance_from_pickup_km: notifiedRider?.distance_from_pickup_km || formatDistanceInKm(notifiedRider?.distance_from_pickup),
                            pickup: ride.pickup_address?.formatted_address,
                            drop: ride.drop_address?.formatted_address,
                            vehicleType: ride.vehicle_type,
                            pricing: ride.pricing?.total_fare,
                            isParcelOrder: true,
                            isInitial: true,
                            urgency: 'high',
                        });
                    }
                }

                notificationsSent++;
                await logger.success(
                    `Notification sent to ${driver.name} (${distanceKm.toFixed(1)}km)`
                );
            } catch (notificationError) {
                await logger.error(
                    `Failed to notify driver ${driver.name}`,
                    notificationError
                );

                // Track failed notification
                const notificationEntry = ride.notified_riders.find(
                    (n) => n.rider_id.toString() === driver._id.toString()
                );
                if (notificationEntry) {
                    notificationEntry.notification_failed = true;
                    notificationEntry.error_message = notificationError.message;
                    notificationEntry.error_code =
                        notificationError.code || "NOTIFICATION_FAILED";
                    notificationEntry.notification_history.push({
                        time: new Date(),
                        distance: distanceKm * 1000,
                        attempt: searchAttempt,
                        success: false,
                        error: notificationError.message,
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
            await logger.warn("No eligible drivers found. Reasons:");
            await logger.info(`- Rejected: ${ineligibleReasons.rejected}`);
            await logger.info(`- Recently notified: ${ineligibleReasons.recentlyNotified}`);
            await logger.info(`- No location: ${ineligibleReasons.noLocation}`);
            await logger.info(`- Category/Vehicle mismatch: ${ineligibleReasons.categoryVehicleMismatch}`);
            await logger.info(`- Parcel delivery disabled: ${ineligibleReasons.parcelDeliveryDisabled}`);
        }

        // Schedule next search
        const timeUntilNextSearch = 30 * 1000; // 30 seconds
        const timeUntilCutoff = searchCutoffTime.getTime() - now.getTime();
        const minutesUntilCutoff = Math.floor(timeUntilCutoff / 1000 / 60);

        if (timeUntilCutoff > timeUntilNextSearch) {
            await DriverSearchForParcelQueue.add(
                { rideId: ride._id.toString(), searchAttempt: searchAttempt + 1 },
                { delay: timeUntilNextSearch }
            );
            await logger.time(
                `Next search scheduled in 30s (${minutesUntilCutoff} min until cutoff)`
            );
        } else if (timeUntilCutoff > 0) {
            await DriverSearchForParcelQueue.add(
                { rideId: ride._id.toString(), searchAttempt: searchAttempt + 1 },
                { delay: Math.max(timeUntilCutoff - 5000, 0) }
            );
            await logger.time("Final search scheduled before cutoff");
        } else {
            await logger.warn("Cutoff time reached, no more searches scheduled");
        }

        // Update retry count
        ride.retry_count = Math.max(ride.retry_count || 0, searchAttempt);
        ride.last_retry_at = now;
        await ride.save();

        await logger.success(`Job ${job.id} completed`);
    } catch (error) {
        await logger.error("Error in parcel driver search", error);

        try {
            const ride = await RideRequestNew.findById(job.data.rideId);
            if (ride) {
                ride.last_error = {
                    message: error.message,
                    code: error.code || "SEARCH_FAILED",
                    occurred_at: new Date(),
                };
                ride.retry_count = (ride.retry_count || 0) + 1;
                await ride.save();
            }
        } catch (saveError) {
            await logger.error("Failed to save error to ride", saveError);
        }

        throw error;
    }
});

// Event listeners for monitoring
DriverSearchForParcelQueue.on('completed', (job, result) => {
    console.log(`✅ Parcel search job ${job.id} completed`);
});

DriverSearchForParcelQueue.on('failed', (job, err) => {
    console.error(`❌ Parcel search job ${job.id} failed:`, err.message);
});

DriverSearchForParcelQueue.on('stalled', (job) => {
    console.warn(`⚠️ Parcel search job ${job.id} stalled`);
});

// Function to start immediate parcel driver search
async function startParcelDriverSearch(rideId, io = null) {
    try {
        console.log(`🚀 Starting immediate parcel driver search for ride: ${rideId}`);

        // Store io instance in a global variable if provided
        if (io) {
            global.socketIO = io;
        }

        // Add job with no delay for immediate processing
        // Don't pass req/io in job data to avoid circular reference
        const job = await DriverSearchForParcelQueue.add(
            {
                rideId: rideId.toString(),
                searchAttempt: 1
            },
            {
                delay: 0, // Start immediately
                priority: 1, // High priority
                attempts: 5,
                backoff: {
                    type: 'exponential',
                    delay: 5000
                }
            }
        );

        console.log(`✅ Parcel driver search job created: ${job.id}`);
        return job;
    } catch (error) {
        console.error(`❌ Failed to start parcel driver search for ride ${rideId}:`, error);
        throw error;
    }
}

module.exports = {
    queue: DriverSearchForParcelQueue,
    startSearch: startParcelDriverSearch
};