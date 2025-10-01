
const RideRequest = require('../models/ride.request.model');
const Riders = require('../models/Rider.model')
const axios = require('axios');
const Crypto = require('crypto');
const { FindWeather, CheckTolls } = require('../utils/Api.utils');
const Settings = require('../models/Admin/Settings');
const RidesSuggestionModel = require('../models/Admin/RidesSuggestion.model');
const tempRideDetailsSchema = require('../models/tempRideDetailsSchema');
const RideRequestNotification = require('../models/RideRequestNotification');
const rideRequestModel = require('../models/ride.request.model');
const SendWhatsAppMessageNormal = require('../utils/normalWhatsapp');
const User = require('../models/normal_user/User.model');
const sendNotification = require('../utils/sendNotification');

// Enhanced logging utility
const logger = {
    debug: (message, data = null, context = null) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [DEBUG] ${context ? `[${context}]` : ''} ${message}`);
        if (data) console.log(JSON.stringify(data, null, 2));
    },
    info: (message, data = null, context = null) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [INFO] ${context ? `[${context}]` : ''} ${message}`);
        if (data) console.log(JSON.stringify(data, null, 2));
    },
    warn: (message, data = null, context = null) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [WARN] ${context ? `[${context}]` : ''} ${message}`);
        if (data) console.log(JSON.stringify(data, null, 2));
    },
    error: (message, data = null, context = null) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [ERROR] ${context ? `[${context}]` : ''} ${message}`);
        if (data) console.log(JSON.stringify(data, null, 2));
    },
    success: (message, data = null, context = null) => {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [SUCCESS] ${context ? `[${context}]` : ''} ${message}`);
        if (data) console.log(JSON.stringify(data, null, 2));
    }
};

exports.createRequest = async (req, res) => {
    try {
        const user = Array.isArray(req.user.user) ? req.user.user[0] : req.user.user;
        const { vehicleType, pickupLocation, dropLocation, currentLocation, pick_desc, drop_desc, fcmToken } = req.body;

        // Validate required fields
        if (!pickupLocation || !dropLocation || !pick_desc || !drop_desc || !currentLocation) {
            logger.warn("Missing required fields in ride request");
            return res.status(400).json({ error: 'All fields are required' });
        }

        // Construct geo points
        const pickupLocationGeo = {
            type: 'Point',
            coordinates: [pickupLocation.longitude, pickupLocation.latitude]
        };
        const dropLocationGeo = {
            type: 'Point',
            coordinates: [dropLocation.longitude, dropLocation.latitude]
        };
        const currentLocationGeo = {
            type: 'Point',
            coordinates: [currentLocation.longitude, currentLocation.latitude]
        };

        // Create a new ride request
        const newRideRequest = new RideRequest({
            vehicleType,
            user: user,
            pickupLocation: pickupLocationGeo,
            dropLocation: dropLocationGeo,
            currentLocation: currentLocationGeo,
            rideStatus: 'pending',
            pickup_desc: pick_desc,
            drop_desc: drop_desc,
            userFcm: fcmToken
        });

        // Find and update user FCM token
        const findUser = await User.findById(user);
        if (!findUser) {
            logger.error("User not found", { userId: user });
            return res.status(404).json({ error: "User not found" });
        }

        // Update FCM token with better logic
        if (fcmToken && findUser.fcmToken !== fcmToken) {
            logger.info(`Updating FCM token for user ${user}`, { oldToken: findUser.fcmToken, newToken: fcmToken });
            findUser.fcmToken = fcmToken;
            await findUser.save();
        }

        await newRideRequest.save();
        logger.success("Ride request created successfully", { rideRequestId: newRideRequest._id });

        res.status(201).json({
            message: 'Ride request created successfully',
            rideRequest: newRideRequest
        });

    } catch (error) {
        logger.error("Error creating ride request", { error: error.message });
        res.status(500).json({ error: 'Server error, please try again' });
    }
};

exports.findRider = async (id, io, app) => {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 10000;
    const INITIAL_RADIUS = 2500;
    const RADIUS_INCREMENT = 500;
    const API_TIMEOUT = 8000;
    const MIN_ACTIVE_DRIVERS_THRESHOLD = 1;

    let retryCount = 0;
    const rideRequestId = id;
    const context = `FIND_RIDER_${rideRequestId}`;

    logger.info(`Starting findRider process`, { rideRequestId }, context);

    // Utility functions
    const validateCoordinates = (location, locationType) => {
        if (!location?.coordinates ||
            !Array.isArray(location.coordinates) ||
            location.coordinates.length !== 2 ||
            typeof location.coordinates[0] !== 'number' ||
            typeof location.coordinates[1] !== 'number' ||
            location.coordinates[0] < -180 || location.coordinates[0] > 180 ||
            location.coordinates[1] < -90 || location.coordinates[1] > 90) {
            throw new Error(`Invalid ${locationType} location coordinates`);
        }
        return true;
    };

    const getDriverSocketMap = () => {
        const driverSocketMap = app.get('driverSocketMap');
        if (!driverSocketMap) {
            logger.warn("driverSocketMap not found in app context", null, context);
            return new Map();
        }
        return driverSocketMap;
    };

    const getPubClient = () => {
        const pubClient = app.get('pubClient');
        if (!pubClient) {
            logger.warn("Redis pubClient not found in app context", null, context);
            return null;
        }
        return pubClient;
    };

    // Enhanced Redis publishing with confirmation
    const publishRideRequestToRedis = async (rideInfo, driverIds) => {
        const pubClient = getPubClient();
        if (!pubClient) {
            logger.warn("Redis pubClient not available, skipping Redis notification", null, context);
            return { success: false, reason: 'No Redis client' };
        }

        try {
            const redisMessage = {
                type: 'ride_request',
                rideRequestId,
                rideInfo,
                targetDrivers: driverIds,
                timestamp: new Date().toISOString(),
                expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString()
            };

            const REDIS_KEY_PREFIX = 'driver_rides:';
            const NOTIFICATION_EXPIRY = 600;
            const notificationString = JSON.stringify(redisMessage);

            // Track results for each driver
            const results = {
                successful: [],
                failed: [],
                generalChannelPublished: false,
                totalProcessed: driverIds.length
            };

            // 1. Publish to general channel
            try {
                await pubClient.publish('driver_notifications', notificationString);
                results.generalChannelPublished = true;
                logger.success(`Published to general channel for ${driverIds.length} drivers`, null, context);
            } catch (generalError) {
                logger.error("Failed to publish to general channel", { error: generalError.message }, context);
            }

            // 2. Store for each driver individually
            for (const driverId of driverIds) {
                try {
                    const driverKey = `${REDIS_KEY_PREFIX}${driverId}`;
                    const driverChannel = `driver_notifications_${driverId}`;

                    // Store in driver's list
                    await pubClient.lPush(driverKey, notificationString);
                    await pubClient.expire(driverKey, NOTIFICATION_EXPIRY);
                    await pubClient.lTrim(driverKey, 0, 9); // Keep only last 10

                    // Publish to driver-specific channel
                    await pubClient.publish(driverChannel, notificationString);

                    // Verify the data was stored
                    const storedCount = await pubClient.lLen(driverKey);

                    results.successful.push({
                        driverId,
                        driverKey,
                        driverChannel,
                        storedCount,
                        status: 'success'
                    });

                    logger.success(`Data saved for driver ${driverId}`, {
                        driverKey,
                        storedCount,
                        channel: driverChannel
                    }, context);

                } catch (driverError) {
                    results.failed.push({
                        driverId,
                        error: driverError.message,
                        status: 'failed'
                    });
                    logger.error(`Failed to save data for driver ${driverId}`, {
                        error: driverError.message
                    }, context);
                }
            }

            // Summary logging
            logger.info("Redis notification storage summary", {
                totalDrivers: results.totalProcessed,
                successful: results.successful.length,
                failed: results.failed.length,
                generalChannelPublished: results.generalChannelPublished,
                successRate: `${((results.successful.length / results.totalProcessed) * 100).toFixed(1)}%`
            }, context);

            return {
                success: results.successful.length > 0,
                results,
                summary: {
                    totalDrivers: results.totalProcessed,
                    successfulSaves: results.successful.length,
                    failedSaves: results.failed.length,
                    generalChannelPublished: results.generalChannelPublished
                }
            };

        } catch (error) {
            logger.error("Error in Redis publishing process", { error: error.message }, context);
            return { success: false, error: error.message };
        }
    };

    const shouldRetryForActiveConnections = (totalDrivers, activeDrivers, currentRetryCount) => {
        return totalDrivers > 0 &&
            activeDrivers < MIN_ACTIVE_DRIVERS_THRESHOLD &&
            currentRetryCount < MAX_RETRIES;
    };

    const attemptFindRiders = async () => {
        logger.info(`Search attempt ${retryCount + 1}/${MAX_RETRIES}`, null, context);

        try {
            // Fetch ride request
            const rideRequest = await RideRequest.findById(rideRequestId)
                .populate("user")
                .lean();

            if (!rideRequest) {
                throw new Error("Ride request not found");
            }

            const {
                pickupLocation,
                pickup_desc,
                drop_desc,
                vehicleType,
                dropLocation,
                user,
                status
            } = rideRequest;

            if (!user?._id) {
                throw new Error("Invalid user data in ride request");
            }

            const userId = user._id.toString();
            logger.debug(`Processing ride request for user ${userId}`, null, context);

            // Check if ride request was cancelled/completed
            if (['cancelled', 'completed'].includes(status)) {
                logger.info(`Ride request is ${status}, stopping search`, null, context);
                return { message: `Ride request is ${status}` };
            }

            // Validate locations
            validateCoordinates(pickupLocation, "pickup");
            validateCoordinates(dropLocation, "drop");

            if (!vehicleType) {
                throw new Error("Vehicle type is required");
            }

            const [longitude, latitude] = pickupLocation.coordinates;
            const currentRadius = INITIAL_RADIUS + (retryCount * RADIUS_INCREMENT);

            logger.debug(`Searching with radius: ${currentRadius / 1000} km`, null, context);

            // Find nearby riders
            const riders = await Riders.aggregate([
                {
                    $geoNear: {
                        near: { type: "Point", coordinates: [longitude, latitude] },
                        distanceField: "distance",
                        maxDistance: currentRadius,
                        spherical: true,
                    },
                },
                {
                    $match: {
                        isAvailable: true,
                        "rideVehicleInfo.vehicleType": vehicleType,
                    },
                },
                {
                    $project: {
                        name: 1,
                        phoneNumber: 1,
                        profileImage: 1,
                        rating: 1,
                        "rideVehicleInfo.vehicleName": 1,
                        "rideVehicleInfo.vehicleImage": 1,
                        "rideVehicleInfo.VehicleNumber": 1,
                        "rideVehicleInfo.PricePerKm": 1,
                        "rideVehicleInfo.vehicleType": 1,
                        "RechargeData.expireData": 1,
                        on_ride_id: 1,
                        distance: 1,
                    },
                },
            ]);

            logger.debug(`Found ${riders.length} potential riders before filtering`, null, context);

            // Filter valid riders
            const currentDate = new Date();
            const validRiders = riders.filter((rider) => {
                const expire = rider?.RechargeData?.expireData;
                const hasValidRecharge = expire && new Date(expire) >= currentDate;
                const isFreeRider = !rider?.on_ride_id;

                if (!hasValidRecharge) {
                    logger.debug(`Rider ${rider._id} filtered: recharge expired`, null, context);
                }
                if (!isFreeRider) {
                    logger.debug(`Rider ${rider._id} filtered: already on ride`, null, context);
                }

                return hasValidRecharge && isFreeRider;
            });

            logger.info(`Found ${validRiders.length} eligible riders after filtering`, null, context);

            if (validRiders.length === 0) {
                logger.warn(`No available riders found within ${currentRadius / 1000} km`, null, context);

                // Notify user about search status
                io.to(userId).emit("finding_driver_update", {
                    message: `Searching for drivers within ${currentRadius / 1000} km...`,
                    searchRadius: currentRadius / 1000,
                    retryCount,
                    maxRetries: MAX_RETRIES
                });

                if (retryCount < MAX_RETRIES) {
                    logger.info(`Will retry in ${RETRY_DELAY_MS / 1000}s with expanded radius`, null, context);
                    retryCount++;

                    // Update ride request
                    await RideRequest.findByIdAndUpdate(rideRequestId, {
                        $set: {
                            retryCount,
                            lastRetryAt: new Date(),
                            currentSearchRadius: currentRadius + RADIUS_INCREMENT,
                            retryReason: 'no_drivers_found'
                        }
                    });

                    io.to(userId).emit("finding_driver", {
                        message: `Expanding search area... Attempt ${retryCount}/${MAX_RETRIES}`,
                        retryCount,
                        maxRetries: MAX_RETRIES,
                        currentRadius: (currentRadius / 1000).toFixed(1),
                        nextRadius: ((currentRadius + RADIUS_INCREMENT) / 1000).toFixed(1)
                    });

                    return new Promise(resolve => {
                        setTimeout(async () => {
                            resolve(await attemptFindRiders());
                        }, RETRY_DELAY_MS);
                    });
                } else {
                    const maxRadius = INITIAL_RADIUS + (MAX_RETRIES - 1) * RADIUS_INCREMENT;
                    logger.error(`No riders found after ${MAX_RETRIES} attempts`, { maxRadius: maxRadius / 1000 }, context);

                    await RideRequest.findByIdAndUpdate(rideRequestId, {
                        $set: {
                            rideStatus: 'no_driver_found',
                            maxSearchRadius: maxRadius
                        }
                    });

                    io.to(userId).emit("no_drivers_available", {
                        message: `No drivers available within ${maxRadius / 1000} km. Please try again later.`,
                        rideRequestId,
                        maxRadius: maxRadius / 1000
                    });

                    return {
                        error: "No drivers available after maximum retries",
                        rideRequestId,
                        maxSearchRadius: maxRadius / 1000
                    };
                }
            }

            // Get route information
            logger.debug("Calculating route and prices", null, context);
            const origin = `${pickupLocation.coordinates[1]},${pickupLocation.coordinates[0]}`;
            const destination = `${dropLocation.coordinates[1]},${dropLocation.coordinates[0]}`;

            const response = await axios.get("https://maps.googleapis.com/maps/api/directions/json", {
                params: {
                    origin,
                    destination,
                    key: "AIzaSyCr2aKtwOMiUdR0rBMpE0MCWBHvehwoOtM",
                    traffic_model: "best_guess",
                    departure_time: "now",
                    alternatives: true
                },
                timeout: API_TIMEOUT
            });

            if (!response?.data?.routes?.length) {
                throw new Error("No route found between pickup and drop locations");
            }

            const fastestRoute = response.data.routes.sort((a, b) =>
                (a.legs[0].duration_in_traffic?.value || a.legs[0].duration.value) -
                (b.legs[0].duration_in_traffic?.value || b.legs[0].duration.value)
            )[0];

            const distance = fastestRoute.legs[0].distance.value / 1000;
            const duration = fastestRoute.legs[0].duration.value / 60;
            const trafficDuration = (fastestRoute.legs[0].duration_in_traffic?.value || fastestRoute.legs[0].duration.value) / 60;

            logger.debug(`Route calculated: ${distance.toFixed(2)} km, ${Math.round(trafficDuration)} mins`, null, context);

            // Get vehicle pricing
            const vehiclePricing = await RidesSuggestionModel.findOne({ name: vehicleType }).lean();
            if (!vehiclePricing) {
                throw new Error(`Pricing not found for vehicle type: ${vehicleType}`);
            }

            const ratePerKm = vehiclePricing.priceRange;
            const priceData = await calculateRidePriceForConfirmRide({
                pickupLocation,
                dropLocation,
                waitingTimeInMinutes: 0,
                ratePerKm,
                polyline: fastestRoute.overview_polyline?.points,
                distance
            });

            const eta = Math.round(trafficDuration);

            // Format riders info
            const ridersInfo = validRiders.map((rider) => ({
                id: rider._id,
                name: rider.name,
                phoneNumber: rider.phoneNumber,
                profileImage: rider.profileImage,
                rating: rider.rating || 4.5,
                rideRequestId,
                vehicleName: rider.rideVehicleInfo.vehicleName,
                vehicleImage: rider.rideVehicleInfo.vehicleImage,
                vehicleNumber: rider.rideVehicleInfo.VehicleNumber,
                pricePerKm: rider.rideVehicleInfo.PricePerKm,
                vehicleType: rider.rideVehicleInfo.vehicleType,
                distance: (rider.distance / 1000).toFixed(2),
                price: priceData?.totalPrice.toFixed(2),
                eta,
                rain: priceData?.rain || false,
                tollPrice: priceData?.tollPrice || 0,
                tolls: priceData?.tolls?.length > 0,
                searchRadius: currentRadius / 1000
            }));

            const rideInfo = {
                message: "Nearby riders found successfully",
                requestId: rideRequestId,
                riders: ridersInfo,
                user,
                pickup_desc,
                drop_desc,
                pickupLocation,
                dropLocation,
                polyline: fastestRoute.overview_polyline?.points,
                distance: distance.toFixed(2),
                duration: Math.round(duration),
                trafficDuration: Math.round(trafficDuration),
                price: priceData?.totalPrice.toFixed(2),
                currency: "INR",
                retryCount,
                searchRadius: currentRadius / 1000,
                timestamp: new Date(),
            };

            // Notify drivers
            const driverSocketMap = getDriverSocketMap();
            const notifiedDrivers = [];
            const unavailableDrivers = [];

            logger.info("Starting driver notification process", {
                totalDrivers: validRiders.length
            }, context);

            for (const rider of validRiders) {
                const riderId = rider._id.toString();
                const driverSocketId = driverSocketMap.get(riderId);

                if (driverSocketId) {
                    const driverInfo = {
                        ...rideInfo,
                        driverDistance: (rider.distance / 1000).toFixed(2),
                        estimatedEarning: priceData?.totalPrice * 0.8,
                        message: "New ride request nearby!"
                    };

                    try {
                        io.to(driverSocketId).emit("ride_come", driverInfo);
                        notifiedDrivers.push(riderId);

                        await RideRequestNotification.create({
                            rideRequestId,
                            driverId: riderId,
                            notifiedAt: new Date(),
                            status: 'sent'
                        });

                        logger.success(`Notified driver ${riderId} via socket`, { socketId: driverSocketId }, context);
                    } catch (emitError) {
                        logger.error(`Error emitting to driver ${riderId}`, { error: emitError.message }, context);
                    }
                } else {
                    unavailableDrivers.push(riderId);
                    logger.debug(`Driver ${riderId} has no active socket connection`, null, context);
                }
            }

            logger.info("Driver notification summary", {
                totalDrivers: validRiders.length,
                notifiedViaSocket: notifiedDrivers.length,
                unavailableConnections: unavailableDrivers.length
            }, context);

            // Enhanced retry logic for inactive connections
            if (shouldRetryForActiveConnections(validRiders.length, notifiedDrivers.length, retryCount)) {
                logger.warn(`Found ${validRiders.length} drivers but only ${notifiedDrivers.length} active. Retrying...`, null, context);

                // Store for offline drivers with confirmation
                if (unavailableDrivers.length > 0) {
                    const redisResult = await publishRideRequestToRedis(rideInfo, unavailableDrivers);
                    logger.info("Redis storage result for offline drivers", redisResult, context);
                }

                await RideRequest.findByIdAndUpdate(rideRequestId, {
                    $set: {
                        retryCount: retryCount + 1,
                        lastRetryAt: new Date(),
                        currentSearchRadius: currentRadius + RADIUS_INCREMENT,
                        retryReason: 'insufficient_active_connections',
                        driversFoundButInactive: unavailableDrivers.length
                    }
                });

                io.to(userId).emit("finding_driver", {
                    message: `Found ${validRiders.length} drivers but most are offline. Expanding search... (${retryCount + 1}/${MAX_RETRIES})`,
                    retryCount: retryCount + 1,
                    maxRetries: MAX_RETRIES,
                    reason: 'inactive_connections',
                    driversFound: validRiders.length,
                    activeDrivers: notifiedDrivers.length,
                    currentRadius: (currentRadius / 1000).toFixed(1),
                    nextRadius: ((currentRadius + RADIUS_INCREMENT) / 1000).toFixed(1)
                });

                retryCount++;
                return new Promise(resolve => {
                    setTimeout(async () => {
                        resolve(await attemptFindRiders());
                    }, RETRY_DELAY_MS);
                });
            }

            // Process final results
            if (notifiedDrivers.length > 0) {
                await RideRequest.findByIdAndUpdate(rideRequestId, {
                    $set: {
                        retryCount: 0,
                        lastUpdatedAt: new Date(),
                        searchRadiusUsed: currentRadius / 1000,
                        rideStatus: 'drivers_found',
                        activeDriversNotified: notifiedDrivers.length,
                        totalDriversFound: validRiders.length
                    }
                });

                logger.success(`Successfully found and notified drivers`, {
                    totalFound: validRiders.length,
                    activeNotified: notifiedDrivers.length,
                    searchRadius: currentRadius / 1000
                }, context);

                io.to(userId).emit("drivers_found", {
                    message: `Found ${notifiedDrivers.length} active drivers within ${currentRadius / 1000} km`,
                    rideInfo: {
                        ...rideInfo,
                        driversNotified: notifiedDrivers.length,
                        totalDriversFound: validRiders.length
                    }
                });

                // Store for offline drivers as backup
                if (unavailableDrivers.length > 0) {
                    const redisResult = await publishRideRequestToRedis(rideInfo, unavailableDrivers);
                    logger.info("Backup Redis storage for offline drivers", redisResult, context);
                }

                return {
                    success: true,
                    data: rideInfo,
                    message: `Found and notified ${notifiedDrivers.length} active drivers`,
                    driversNotified: notifiedDrivers.length,
                    totalDriversFound: validRiders.length,
                    searchRadius: currentRadius / 1000,
                    rideRequestId
                };
            } else {
                if (unavailableDrivers.length > 0) {
                    const redisResult = await publishRideRequestToRedis(rideInfo, unavailableDrivers);
                    logger.info("Redis storage for all offline drivers", redisResult, context);
                }

                await RideRequest.findByIdAndUpdate(rideRequestId, {
                    $set: {
                        rideStatus: 'no_active_drivers',
                        totalDriversFound: validRiders.length,
                        activeDriversFound: 0,
                        maxSearchRadius: currentRadius / 1000
                    }
                });

                io.to(userId).emit("no_active_drivers", {
                    message: `Found ${validRiders.length} drivers but none are currently active. We've notified them.`,
                    rideRequestId,
                    driversFound: validRiders.length,
                    activeDrivers: 0,
                    searchRadius: currentRadius / 1000
                });

                return {
                    warning: "No active drivers available",
                    rideRequestId,
                    driversFound: validRiders.length,
                    activeDrivers: 0,
                    searchRadius: currentRadius / 1000,
                    redisNotified: unavailableDrivers.length > 0
                };
            }

        } catch (error) {
            logger.error(`Error in findRider attempt ${retryCount + 1}/${MAX_RETRIES}`, {
                error: error.message
            }, context);

            const retryableErrors = ["No riders available", "Failed to calculate route", "Network error", "timeout", "Maps API", "price"];
            const shouldRetry = retryableErrors.some(msg => error.message.toLowerCase().includes(msg.toLowerCase()));

            if (shouldRetry && retryCount < MAX_RETRIES) {
                logger.info(`Retrying due to retryable error`, { error: error.message }, context);
                retryCount++;

                try {
                    const rideRequest = await RideRequest.findById(rideRequestId).populate("user").lean();
                    if (rideRequest?.user?._id) {
                        io.to(rideRequest.user._id.toString()).emit("finding_driver_error", {
                            message: `Encountered an issue, retrying... (${retryCount}/${MAX_RETRIES})`,
                            error: error.message,
                            retryCount
                        });
                    }
                } catch (notifyError) {
                    logger.error("Failed to notify user about retry", { error: notifyError.message }, context);
                }

                return new Promise(resolve => {
                    setTimeout(async () => {
                        resolve(await attemptFindRiders());
                    }, RETRY_DELAY_MS);
                });
            } else {
                logger.error("Not retrying after error", { error: error.message }, context);

                try {
                    await RideRequest.findByIdAndUpdate(rideRequestId, {
                        $set: {
                            rideStatus: 'error',
                            lastError: error.message,
                            lastErrorAt: new Date()
                        }
                    });

                    const rideRequest = await RideRequest.findById(rideRequestId).populate("user").lean();
                    if (rideRequest?.user?._id) {
                        io.to(rideRequest.user._id.toString()).emit("ride_request_error", {
                            message: `Error processing your ride request: ${error.message}`,
                            rideRequestId,
                            error: error.message
                        });
                    }
                } catch (finalError) {
                    logger.error("Failed to handle final error", { error: finalError.message }, context);
                }

                return {
                    error: error.message,
                    rideRequestId,
                    retryCount
                };
            }
        }
    };

    return await attemptFindRiders();
}



// Constants
const POLLING_TIMEOUT = 4000;
const REDIS_KEY_PREFIX = 'driver_rides:';
const GLOBAL_RIDES_KEY = 'global_pending_rides';
const MAX_RIDES_PER_POLL = 5;
const GEOSPATIAL_RADIUS = 10000;
const TIME_WINDOW = 30 * 60 * 1000;

// Helper function to get compatible vehicle types
const getCompatibleVehicleTypes = (primaryVehicleType) => {
    const compatibilityMap = {
        'SEDAN': ['SEDAN', 'HATCHBACK'],
        'SUV': ['SUV', 'SEDAN', 'HATCHBACK'],
        'HATCHBACK': ['HATCHBACK'],
        'AUTO': ['AUTO'],
        'BIKE': ['BIKE']
    };
    return compatibilityMap[primaryVehicleType] || [primaryVehicleType];
};

// Optimized Redis-first ride fetching
const getDriverSpecificRidesFromRedis = async (pubClient, driverId, context) => {
    try {
        logger.info("Fetching driver-specific rides from Redis", { driverId }, context);

        // Get rides specifically assigned to this driver
        const driverKey = `${REDIS_KEY_PREFIX}${driverId}`;
        const storedRides = await pubClient.lRange(driverKey, 0, -1);
        
        const validRides = [];
        const currentTime = new Date();

        for (const rideData of storedRides) {
            try {
                const parsedRide = JSON.parse(rideData);
                
                // Check if ride is not expired
                const expiresAt = new Date(parsedRide.expiresAt);
                if (expiresAt > currentTime) {
                    // Format data according to rideInfo structure
                    const rideInfo = parsedRide.rideInfo;
                    
                    validRides.push({
                        message: "Ride available from Redis",
                        requestId: parsedRide.rideRequestId,
                        riders: rideInfo?.riders || [], // Available riders info
                        user: rideInfo?.user || null,
                        pickup_desc: rideInfo?.pickup_desc,
                        drop_desc: rideInfo?.drop_desc,
                        pickupLocation: rideInfo?.pickupLocation,
                        dropLocation: rideInfo?.dropLocation,
                        polyline: rideInfo?.polyline,
                        distance: rideInfo?.distance || '0.00',
                        duration: rideInfo?.duration || 0,
                        trafficDuration: rideInfo?.trafficDuration || 0,
                        price: rideInfo?.price || '0.00',
                        currency: rideInfo?.currency || "INR",
                        retryCount: rideInfo?.retryCount || 0,
                        searchRadius: rideInfo?.searchRadius || 5,
                        timestamp: new Date(parsedRide.timestamp),
                        source: 'redis_assigned',
                        timeToExpiry: Math.max(0, expiresAt - currentTime),
                        rain: rideInfo?.rain || false,
                        tollPrice: rideInfo?.tollPrice || 0,
                        tolls: rideInfo?.tolls || false
                    });
                } else {
                    logger.debug("Expired ride found in Redis", {
                        rideRequestId: parsedRide.rideRequestId,
                        expiresAt: parsedRide.expiresAt
                    }, context);
                }
                
            } catch (parseError) {
                logger.error("Error parsing Redis ride data", {
                    driverId,
                    error: parseError.message
                }, context);
            }
        }

        logger.success("Driver-specific Redis rides fetched", {
            driverId,
            totalStored: storedRides.length,
            validRides: validRides.length
        }, context);

        return validRides;

    } catch (error) {
        logger.error("Error fetching driver-specific Redis rides", {
            driverId,
            error: error.message
        }, context);
        return [];
    }
};

// Fallback: Only fetch from DB if no Redis data found
const getFallbackRidesFromDB = async (driver, context) => {
    const [longitude, latitude] = driver.location.coordinates;
    const compatibleVehicleTypes = getCompatibleVehicleTypes(driver.rideVehicleInfo?.vehicleType);

    logger.info("Performing fallback DB search", {
        driverLocation: [longitude, latitude],
        compatibleTypes: compatibleVehicleTypes
    }, context);

    try {
        // Simple pending rides query - no complex geo processing needed
        const pendingRides = await RideRequest.find({
            rideStatus: { $in: ['pending', 'no_active_drivers'] }, // Include 'no_active_drivers'
            vehicleType: { $in: compatibleVehicleTypes },
            createdAt: {
                $gte: new Date(Date.now() - TIME_WINDOW)
            }
        })
        .populate('user', 'name phoneNumber profileImage')
        .limit(MAX_RIDES_PER_POLL)
        .lean();

        return pendingRides.map(ride => ({
            rideRequestId: ride._id,
            user: ride.user || null,
            pickup_desc: ride.pickup_desc,
            drop_desc: ride.drop_desc,
            pickupLocation: ride.pickupLocation,
            dropLocation: ride.dropLocation,
            vehicleType: ride.vehicleType,
            distance: "0.00",
            duration: 0,
            trafficDuration: 0,
            price: "0.00",
            estimatedEarning: "0.00",
            distanceFromDriver: "0.00",
            createdAt: ride.createdAt,
            source: 'fallback_db',
            currency: "INR",
            rideStatus: ride.rideStatus,
            retryCount: ride.retryCount || 0
        }));

    } catch (error) {
        logger.error("Fallback DB search failed", { error: error.message }, context);
        return [];
    }
};

// Main optimized polling function
exports.getRidesForMeOffSocketRider = async (req, res) => {
    const startTime = Date.now();
    const riderId = req.body?.driver_id;
    const context = `OPTIMIZED_POLL_${riderId}`;

    logger.info("Starting optimized Redis-first ride polling", { riderId }, context);

    try {
        // Input validation
        if (!riderId) {
            return res.status(400).json({
                success: false,
                error: "Driver ID is required",
                timestamp: new Date().toISOString()
            });
        }

        // Get driver details
        const driver = await Riders.findById(riderId).lean();
        if (!driver) {
            return res.status(404).json({
                success: false,
                error: "Driver not found",
                riderId,
                timestamp: new Date().toISOString()
            });
        }

        // Basic driver status checks
        if (!driver.isAvailable) {
            return res.status(200).json({
                success: true,
                message: "Driver is not available",
                rides: [],
                driverStatus: "unavailable",
                riderId,
                timestamp: new Date().toISOString()
            });
        }

        if (driver.on_ride_id) {
            return res.status(200).json({
                success: true,
                message: "Driver is currently on a ride",
                rides: [],
                driverStatus: "on_ride",
                currentRideId: driver.on_ride_id,
                riderId,
                timestamp: new Date().toISOString()
            });
        }

        // Check recharge validity
        const currentDate = new Date();
        const rechargeExpiry = driver.RechargeData?.expireData;
        const hasValidRecharge = rechargeExpiry && new Date(rechargeExpiry) >= currentDate;

        if (!hasValidRecharge) {
            return res.status(200).json({
                success: true,
                message: "Recharge expired, please recharge to receive rides",
                rides: [],
                driverStatus: "recharge_expired",
                expiryDate: rechargeExpiry,
                riderId,
                timestamp: new Date().toISOString()
            });
        }

        let finalRides = [];
        const pubClient = req.app.get('pubClient');

        // PRIORITY 1: Get Redis data first (already processed with all calculations)
        if (pubClient) {
            finalRides = await getDriverSpecificRidesFromRedis(pubClient, riderId, context);
            logger.info("Redis rides retrieved", { count: finalRides.length }, context);
        }

        // PRIORITY 2: Only if no Redis data, fallback to DB
        if (finalRides.length === 0) {
            logger.info("No Redis data found, falling back to DB search", null, context);
            
            // Check if driver location is available for DB search
            if (!driver.location?.coordinates || !Array.isArray(driver.location.coordinates)) {
                logger.warn("Driver location not available for DB fallback", { riderId }, context);
                return res.status(200).json({
                    success: true,
                    message: "No rides available and location not set",
                    rides: [],
                    driverStatus: "location_required",
                    riderId,
                    timestamp: new Date().toISOString()
                });
            }

            finalRides = await getFallbackRidesFromDB(driver, context);
        }

        // Sort by priority: Redis rides first, then by distance/time
        finalRides.sort((a, b) => {
            // Redis rides get priority
            if (a.source === 'redis_assigned' && b.source !== 'redis_assigned') return -1;
            if (b.source === 'redis_assigned' && a.source !== 'redis_assigned') return 1;
            
            // Then sort by distance
            const distanceA = parseFloat(a.distanceFromDriver || 999);
            const distanceB = parseFloat(b.distanceFromDriver || 999);
            return distanceA - distanceB;
        });

        // Limit results
        finalRides = finalRides.slice(0, MAX_RIDES_PER_POLL);

        // Update driver's polling timestamp
        await Riders.findByIdAndUpdate(riderId, {
            $set: {
                lastPolledAt: new Date(),
                lastActiveAt: new Date()
            }
        });

        const pollingDuration = Date.now() - startTime;

        logger.success("Optimized polling completed", {
            riderId,
            ridesFound: finalRides.length,
            pollingDuration: `${pollingDuration}ms`,
            primarySource: finalRides[0]?.source || 'none'
        }, context);

        return res.status(200).json({
            success: true,
            message: finalRides.length > 0 ?
                `Found ${finalRides.length} available ride requests` :
                "No ride requests available at the moment",
            rides: finalRides,
            metadata: {
                driverStatus: "available",
                riderId,
                pollingDuration: `${pollingDuration}ms`,
                maxRidesPerPoll: MAX_RIDES_PER_POLL,
                compatibleVehicleTypes: getCompatibleVehicleTypes(driver.rideVehicleInfo?.vehicleType),
                primarySource: finalRides[0]?.source || 'none',
                redisRides: finalRides.filter(r => r.source === 'redis_assigned').length,
                dbRides: finalRides.filter(r => r.source === 'fallback_db').length,
                withinTimeout: pollingDuration < POLLING_TIMEOUT,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        const pollingDuration = Date.now() - startTime;

        logger.error("Error in optimized ride polling", {
            riderId,
            error: error.message,
            pollingDuration: `${pollingDuration}ms`
        }, context);

        return res.status(500).json({
            success: false,
            error: "Internal server error during ride polling",
            message: error.message,
            riderId,
            pollingDuration: `${pollingDuration}ms`,
            timestamp: new Date().toISOString()
        });
    }
};

// Additional endpoint to get all Redis rides without driver filtering
exports.getAllRedisRides = async (req, res) => {
    const context = 'GET_ALL_REDIS_RIDES';
    const startTime = Date.now();

    try {
        const pubClient = req.app.get('pubClient');

        if (!pubClient) {
            return res.status(503).json({
                success: false,
                error: "Redis client not available",
                timestamp: new Date().toISOString()
            });
        }

        const { allRedisRides, rideStats } = await getAllRidesFromRedis(pubClient, context);

        const processingDuration = Date.now() - startTime;

        logger.success("All Redis rides retrieved successfully", {
            totalRides: allRedisRides.length,
            processingDuration: `${processingDuration}ms`
        }, context);

        return res.status(200).json({
            success: true,
            message: `Found ${allRedisRides.length} rides across all drivers in Redis`,
            rides: allRedisRides,
            statistics: rideStats,
            metadata: {
                processingDuration: `${processingDuration}ms`,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        const processingDuration = Date.now() - startTime;

        logger.error("Error retrieving all Redis rides", {
            error: error.message,
            stack: error.stack,
            processingDuration: `${processingDuration}ms`
        }, context);

        return res.status(500).json({
            success: false,
            error: "Internal server error while retrieving Redis rides",
            message: error.message,
            processingDuration: `${processingDuration}ms`,
            timestamp: new Date().toISOString()
        });
    }
};

// Debug endpoint for comprehensive ride analysis
exports.debugRideSystem = async (req, res) => {
    const context = 'DEBUG_RIDE_SYSTEM';
    const startTime = Date.now();

    try {
        const pubClient = req.app.get('pubClient');

        // Database statistics
        const dbStats = {
            totalPendingRides: await RideRequest.countDocuments({ status: 'pending' }),
            totalCompletedRides: await RideRequest.countDocuments({ status: 'completed' }),
            totalCancelledRides: await RideRequest.countDocuments({ status: 'cancelled' }),
            ridesLast1Hour: await RideRequest.countDocuments({
                status: 'pending',
                createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) }
            }),
            ridesLast24Hours: await RideRequest.countDocuments({
                createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
            }),
            totalAvailableDrivers: await Riders.countDocuments({ isAvailable: true }),
            totalDriversOnRide: await Riders.countDocuments({ on_ride_id: { $exists: true, $ne: null } })
        };

        // Vehicle type breakdown
        const vehicleTypeStats = await RideRequest.aggregate([
            { $match: { status: 'pending' } },
            { $group: { _id: '$vehicleType', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        // Redis statistics
        let redisStats = null;
        if (pubClient) {
            const { rideStats } = await getAllRidesFromRedis(pubClient, context);
            redisStats = rideStats;
        }

        const processingDuration = Date.now() - startTime;

        return res.status(200).json({
            success: true,
            message: "Complete ride system analysis",
            databaseStats: dbStats,
            vehicleTypeBreakdown: vehicleTypeStats,
            redisStats,
            systemHealth: {
                redisConnected: !!pubClient,
                processingDuration: `${processingDuration}ms`,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        logger.error("Error in ride system debug", {
            error: error.message,
            stack: error.stack
        }, context);

    }
}


exports.ChangeRideRequestByRider = async (io, data) => {
    try {

        if (!data || !data.ride_request_id || !data.rider_id) {
            throw new Error('Invalid data: rideRequestId and driverId are required');
        }

        const { ride_request_id, rider_id, user_id } = data;

        const findDriver = await Riders.findById(rider_id);
        if (!findDriver) {
            throw new Error('Driver not found');
        }

        const ride = await RideRequest.findById(ride_request_id);

        if (!ride) {
            throw new Error('Ride request not found');
        }

        const { pickupLocation, dropLocation } = ride;

        const originD = `${[pickupLocation.coordinates[1], pickupLocation.coordinates[0]]}`;
        const destinationD = `${[dropLocation.coordinates[1], dropLocation.coordinates[0]]}`;

        // Check ride status
        if (ride.rideStatus === 'accepted') {
            throw new Error('Ride has already been accepted by another rider');
        }

        // Update ride status and driver
        ride.rideStatus = 'accepted';
        ride.rider = findDriver._id;

        // Update driver status to not available
        findDriver.isAvailable = false;
        findDriver.on_ride_id = ride?._id;

        // Save both documents
        await Promise.all([
            ride.save(),
            findDriver.save()
        ]);

        const populatedRide = await RideRequest.findById(ride_request_id).populate('rider');

        let eta = null;
        let origin = `${populatedRide?.rider?.location?.coordinates?.[1]},${populatedRide?.rider?.location?.coordinates?.[0]}`;
        let destination = `${populatedRide?.currentLocation?.coordinates?.[1] || ''},${populatedRide?.currentLocation?.coordinates?.[0] || ''}`;

        try {
            const response = await axios.get(`https://maps.googleapis.com/maps/api/directions/json`, {
                params: {
                    origin: origin,
                    destination: destination,
                    key: 'AIzaSyCr2aKtwOMiUdR0rBMpE0MCWBHvehwoOtM',
                    traffic_model: 'best_guess',
                    departure_time: 'now',
                },
            });

            if (response.data.routes && response.data.routes.length > 0) {
                const route = response.data.routes[0];
                const duration = route.legs[0].duration.text; // Duration in minutes
                eta = duration;
            }

            if (!io) {
                throw new Error('Socket.io instance is not available');
            }

            populatedRide.RideOtp = Crypto.randomInt(1000, 9999);
            populatedRide.kmOfRide = data?.price;
            populatedRide.EtaOfRide = eta;
            populatedRide.acceptedAt = new Date();  // Add timestamp when ride was accepted

            await populatedRide.save();

            // Track that this ride was accepted for notification records
            try {
                // Update or create notification record
                await RideRequestNotification.findOneAndUpdate(
                    { rideRequestId: ride_request_id, driverId: rider_id },
                    {
                        $set: {
                            status: 'accepted',
                            acceptedAt: new Date()
                        }
                    },
                    { upsert: true }
                );
            } catch (notifError) {
                console.log(`[${new Date().toISOString()}] Failed to update notification status: ${notifError.message}`);

            }

            const returnData = {
                ...populatedRide.toObject(),
                eta: eta,
                driver: populatedRide?.rider,
                temp_ride_id: populatedRide?.rider?.on_ride_id
            };

            return returnData;
        } catch (error) {
            console.log(error);
            throw error;
        }
    } catch (error) {
        // Log and handle the error
        console.error('Error in ChangeRideRequestByRider:', error.message);
        throw error;
    }
};

exports.cancelRideForOtherDrivers = async (io, rideRequestId, acceptingDriverId, driverSocketMap) => {
    try {
        console.log(`[${new Date().toISOString()}] Cancelling ride ${rideRequestId} for drivers other than ${acceptingDriverId}`);

        // Get the driver socket map

        if (!driverSocketMap) {
            console.log(`[${new Date().toISOString()}] Warning: driverSocketMap not found, can't notify other drivers`);
            return;
        }

        // Find all drivers who were notified about this ride
        let notifiedDrivers = [];
        try {
            // If you have a notification tracking system
            const notifications = await RideRequestNotification.find({
                rideRequestId: rideRequestId,
                status: 'sent'
            }).lean();

            notifiedDrivers = notifications.map(notification => notification.driverId);

            console.log(`[${new Date().toISOString()}] Found ${notifiedDrivers.length} drivers to notify about cancellation`);
        } catch (error) {
            console.log(`[${new Date().toISOString()}] Error fetching notified drivers: ${error.message}`);

            // If no notification tracking system or it failed, use alternative:
            // Query nearby drivers who might have been notified (less efficient)
            try {
                const rideRequest = await RideRequest.findById(rideRequestId).lean();
                if (rideRequest && rideRequest.pickupLocation && rideRequest.pickupLocation.coordinates) {
                    const [longitude, latitude] = rideRequest.pickupLocation.coordinates;

                    // Search in a radius that matches your original search radius
                    const searchRadius = rideRequest.searchRadiusUsed || 5; // km

                    const nearbyDrivers = await Riders.find({
                        location: {
                            $nearSphere: {
                                $geometry: {
                                    type: "Point",
                                    coordinates: [longitude, latitude]
                                },
                                $maxDistance: searchRadius * 1000 // convert km to meters
                            }
                        }
                    }).select('_id').lean();

                    notifiedDrivers = nearbyDrivers.map(driver => driver._id.toString());
                    console.log(`[${new Date().toISOString()}] Found ${notifiedDrivers.length} nearby drivers as fallback`);
                }
            } catch (fallbackError) {
                console.log(`[${new Date().toISOString()}] Fallback search also failed: ${fallbackError.message}`);
                // If both methods fail, we can't notify other drivers
                return;
            }
        }

        // Send cancellation to all drivers except the accepting one
        let cancelledCount = 0;
        let skippedCount = 0;
        let notFoundCount = 0;

        // Process each driver
        for (const driverId of notifiedDrivers) {
            // Skip the accepting driver
            if (driverId === acceptingDriverId) {
                skippedCount++;
                continue;
            }

            // Get the driver's socket ID
            const driverSocketId = driverSocketMap.get(String(driverId));

            if (driverSocketId) {
                // Emit cancellation to this driver
                io.to(driverSocketId).emit('ride_cancelled', {
                    message: 'This ride has been accepted by another driver',
                    ride_request_id: rideRequestId,
                    reason: 'accepted_by_another_driver',
                    timestamp: new Date()
                });

                cancelledCount++;

                // Update notification status if tracking system exists
                try {
                    await RideRequestNotification.findOneAndUpdate(
                        { rideRequestId, driverId },
                        {
                            $set: {
                                status: 'cancelled',
                                cancelledAt: new Date(),
                                cancellationReason: 'accepted_by_another_driver'
                            }
                        }
                    );
                } catch (updateError) {
                    // Non-critical error, continue without blocking
                    console.log(`[${new Date().toISOString()}] Failed to update notification for driver ${driverId}: ${updateError.message}`);
                }
            } else {
                notFoundCount++;
                console.log(`[${new Date().toISOString()}] Driver ${driverId} doesn't have an active socket connection`);
            }
        }

        console.log(`[${new Date().toISOString()}] Ride cancellation summary: ${cancelledCount} cancelled, ${skippedCount} skipped (acceptor), ${notFoundCount} not found (offline)`);

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error cancelling ride for other drivers:`, error);
        // This is a non-critical operation, so we don't throw the error
        // The primary ride acceptance flow should continue even if this fails
    }
}


exports.updateRideRejectionStatus = async (rideId, driverId) => {
    try {
        console.log(`[${new Date().toISOString()}] Updating rejection status for ride: ${rideId}, driver: ${driverId}`);

        // 1. Update notification record
        const notification = await RideRequestNotification.findOneAndUpdate(
            { rideRequestId: rideId, driverId: driverId },
            {
                $set: {
                    status: 'rejected',
                    rejectedAt: new Date()
                }
            },
            {
                upsert: true, // Create if it doesn't exist
                new: true // Return the updated document
            }
        );

        console.log(`[${new Date().toISOString()}] Updated notification status to rejected:`, notification._id);

        // 2. Update driver's rejection statistics (optional)
        await Riders.findByIdAndUpdate(
            driverId,
            {
                $inc: { 'stats.ridesRejected': 1 },
                $push: {
                    'recentRejections': {
                        rideId: rideId,
                        timestamp: new Date()
                    }
                }
            }
        );

        // 3. Update ride request document - Add to the rejectedBy array
        await RideRequest.findByIdAndUpdate(
            rideId,
            {
                $addToSet: { rejectedByDrivers: driverId }
            }
        );

        console.log(`[${new Date().toISOString()}] Ride rejection fully recorded in database`);
        return true;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error updating ride rejection status:`, error);
        throw error;
    }
}


exports.findNextAvailableDriver = async (io, rideId) => {
    try {
        console.log(`[${new Date().toISOString()}] Finding next available driver for ride: ${rideId}`);

        // 1. Get the ride request details
        const rideRequest = await RideRequest.findById(rideId);

        if (!rideRequest) {
            console.error(`[${new Date().toISOString()}] Ride not found: ${rideId}`);
            return false;
        }

        // Don't look for new drivers if ride is already accepted or cancelled
        if (rideRequest.rideStatus !== 'pending') {
            // console.log(`[${new Date().toISOString()}] Ride ${rideId} is not pending (status: ${rideRequest.rideStatus}). Skipping driver search.`);
            return false;
        }

        // 2. Extract pickup location
        const pickupLocation = rideRequest.pickupLocation;
        if (!pickupLocation || !pickupLocation.coordinates) {
            console.error(`[${new Date().toISOString()}] Ride ${rideId} has invalid pickup location`);
            return false;
        }

        // 3. Find nearby drivers who haven't rejected or been notified
        const [longitude, latitude] = pickupLocation.coordinates;

        // Get list of drivers who already rejected this ride
        const rejectedDriverIds = rideRequest.rejectedByDrivers || [];

        // Get list of drivers who were already notified
        const notifiedDrivers = await RideRequestNotification.find({
            rideRequestId: rideId
        }).distinct('driverId');

        // Combine both lists to exclude from search
        const excludeDriverIds = [...rejectedDriverIds, ...notifiedDrivers];
        const excludeDriverObjectIds = excludeDriverIds.map(id =>
            typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id
        );

        // Search radius (in kilometers)
        const searchRadius = rideRequest.searchRadius || 5; // km

        const nearbyDrivers = await Riders.find({
            _id: { $nin: excludeDriverObjectIds },
            isAvailable: true,
            isOnline: true,
            location: {
                $nearSphere: {
                    $geometry: {
                        type: "Point",
                        coordinates: [longitude, latitude]
                    },
                    $maxDistance: searchRadius * 1000 // convert km to meters
                }
            }
        }).limit(5); // Limit to 5 new drivers

        console.log(`[${new Date().toISOString()}] Found ${nearbyDrivers.length} new potential drivers for ride ${rideId}`);

        if (nearbyDrivers.length === 0) {
            // If no new drivers found, maybe increase search radius or notify user

            // Option 1: Auto-increase search radius if configured
            if (rideRequest.autoIncreaseRadius &&
                rideRequest.currentSearchRadius < rideRequest.maxSearchRadius) {

                const newRadius = Math.min(
                    rideRequest.currentSearchRadius * 1.5, // Increase by 50%
                    rideRequest.maxSearchRadius // But don't exceed max
                );

                // Update ride request with new radius
                await RideRequest.findByIdAndUpdate(rideId, {
                    $set: { currentSearchRadius: newRadius }
                });

                console.log(`[${new Date().toISOString()}] Increased search radius for ride ${rideId} to ${newRadius}km`);

                // Recursive call with new radius
                return findNextAvailableDriver(io, rideId);
            }

            // Option 2: Notify user that no drivers are available
            const userId = rideRequest.user.toString();
            const userSocketId = userSocketMap.get(userId);

            if (userSocketId) {
                io.to(userSocketId).emit('no_drivers_available', {
                    ride_id: rideId,
                    message: 'No drivers are currently available in your area. Please try again later.'
                });
                console.log(`[${new Date().toISOString()}] Notified user ${userId} about no available drivers`);
            }

            return false;
        }

        // 4. For each driver, send ride request notification
        for (const driver of nearbyDrivers) {
            const driverId = driver._id.toString();
            const driverSocketId = driverSocketMap.get(driverId);

            if (driverSocketId) {
                // Prepare ride request data for the driver
                const rideData = {
                    ride_id: rideId,
                    pickup: {
                        address: rideRequest.pickupAddress,
                        coordinates: rideRequest.pickupLocation.coordinates
                    },
                    dropoff: {
                        address: rideRequest.dropAddress,
                        coordinates: rideRequest.dropLocation.coordinates
                    },
                    user: {
                        name: rideRequest.userName,
                        rating: rideRequest.userRating || 0,
                        photo: rideRequest.userPhoto || null
                    },
                    distance: rideRequest.distance,
                    estimatedPrice: rideRequest.estimatedPrice,
                    estimatedDuration: rideRequest.estimatedDuration,
                    paymentMethod: rideRequest.paymentMethod,
                    createdAt: rideRequest.createdAt
                };

                // Emit ride request to driver
                io.to(driverSocketId).emit('new_ride_request', rideData);

                // Record notification in database
                await RideRequestNotification.create({
                    rideRequestId: rideId,
                    driverId: driverId,
                    status: 'sent',
                    notifiedAt: new Date()
                });

                console.log(`[${new Date().toISOString()}] Sent ride request to new driver: ${driverId}`);
            } else {
                console.log(`[${new Date().toISOString()}] Driver ${driverId} doesn't have active socket`);
            }
        }

        return true;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error finding next available driver:`, error);
        return false;
    }
}


exports.rideStart = async (data) => {
    try {

        const ride_id = await RideRequest.findById(data?.rideDetails?._id);

        const ride_id_temp = await tempRideDetailsSchema.findById(data?._id);
        console.log("ride_id_temp", ride_id_temp)

        if (!ride_id) {
            return {
                success: false,
                message: 'Ride not found'
            };
        }

        ride_id.ride_is_started = true;
        ride_id.ride_start_time = new Date();

        if (ride_id_temp) {
            ride_id_temp.ride_is_started = true;
            ride_id_temp.ride_start_time = new Date();
            if (ride_id_temp?.rideDetails) {
                ride_id_temp.rideDetails.isOtpVerify = true;
                ride_id_temp.rideDetails.otp_verify_time = new Date();
            }
            await ride_id_temp.save();
        }

        await ride_id.save();

        return {
            success: true,
            message: 'Ride started successfully'
        };

    } catch (error) {
        console.error('Error in rideStart:', error.message);
        return {
            success: false,
            message: 'An error occurred while starting the ride',
            error: error.message
        };
    }
};


exports.rideEnd = async (data) => {
    try {
        const ride = await RideRequest.findById(data?._id);
        if (!ride) {
            return {
                success: false,
                message: 'Ride not found',
            };
        }

        // Mark the ride as completed
        ride.ride_end_time = new Date();
        ride.rideStatus = "completed";
        await ride.save();

        const rider = await Riders.findById(ride.rider);
        if (!rider) {
            return {
                success: false,
                message: 'Rider not found',
            };
        }

        // Update rider stats
        rider.TotalRides += 1;
        if (!rider.rides.includes(ride._id)) {
            rider.rides.push(ride._id);
        }

        // Remove on_ride_id from rider
        if (rider.on_ride_id) {
            rider.on_ride_id = undefined;
        }

        await rider.save();

        return {
            success: true,
            driverId: rider._id,
            message: 'Ride ended successfully',
        };

    } catch (error) {
        console.error('Error in rideEnd:', error.message);
        return {
            success: false,
            message: 'Something went wrong during ride end',
            error: error.message,
        };
    }
};



exports.rideEndByFallBack = async (req, res) => {
    try {
        const rideId = req.params?._id;

        if (!rideId) {
            return res.status(400).json({
                success: false,
                message: 'Ride ID is required',
            });
        }

        const ride = await RideRequest.findById(rideId).populate('user', 'number');
        if (!ride) {
            return res.status(404).json({
                success: false,
                message: 'Ride not found',
            });
        }

        // Mark the ride as completed
        ride.ride_end_time = new Date();
        ride.rideStatus = 'completed';
        await ride.save();

        const rider = await Riders.findById(ride.rider);
        if (!rider) {
            return res.status(404).json({
                success: false,
                message: 'Rider not found',
            });
        }

        // Update rider stats
        rider.TotalRides += 1;
        if (!rider.rides.includes(ride._id)) {
            rider.rides.push(ride._id);
        }

        // Remove on_ride_id from rider
        rider.on_ride_id = undefined;

        // 🔔 Send FCM Notification
        if (ride.userFcm) {
            try {
                const title = 'Ride Completed! Please Make Payment';
                const body = 'Your ride has ended successfully. Kindly proceed to make the payment. Thank you for riding with us!';

                await sendNotification(ride.userFcm, title, body);
            } catch (fcmError) {
                console.error(`[${new Date().toISOString()}] Error sending FCM notification:`, fcmError.message);
            }
        }

        // 💬 Send WhatsApp Message
        const userNumber = ride?.user?.number;
        if (userNumber) {
            try {
                const message = `Your ride has been marked as completed. Please make the payment to finalize the ride. Thank you!`;
                await SendWhatsAppMessageNormal(userNumber, message);
            } catch (waError) {
                console.error(`[${new Date().toISOString()}] Error sending WhatsApp message:`, waError.message);
            }
        }

        await rider.save();

        return res.status(200).json({
            success: true,
            driverId: rider._id,
            message: 'Ride ended successfully',
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error in rideEndByFallBack:`, error);
        return res.status(500).json({
            success: false,
            message: 'Something went wrong during ride end',
            error: error.message,
        });
    }
};


exports.collectCash = async ({ data, paymentMethod }) => {
    try {
        console.log('Incoming data:', data);
        console.log('Payment method:', paymentMethod);

        const ride = await RideRequest.findById(data?._id);
        if (!ride) {
            return { success: false, message: 'Ride not found' };
        }

        // Mark the ride as paid
        ride.is_ride_paid = true;
        ride.paymentMethod = paymentMethod;
        await ride.save();
        console.log('Ride marked as paid and saved.');

        const findRider = await Riders.findById(ride?.rider);
        if (!findRider) {
            return { success: false, message: 'Rider not found' };
        }

        // Recharge Date Check
        const rechargeDateRaw = findRider?.RechargeData?.whichDateRecharge;
        const rechargeDate = rechargeDateRaw ? new Date(rechargeDateRaw) : null;
        console.log('Recharge date:', rechargeDate);

        let currentEarning = 0;
        let totalEarnings = 0;

        if (rechargeDate && !isNaN(rechargeDate.getTime())) {
            // Calculate earnings only if recharge date is valid
            const pastRides = await rideRequestModel.find({
                rider: findRider._id,
                rideStatus: "completed",
                createdAt: { $gte: rechargeDate }
            });

            const pastEarnings = pastRides.reduce((acc, cur) => acc + Number(cur.kmOfRide || 0), 0);
            currentEarning = Number(ride.kmOfRide || 0);
            totalEarnings = pastEarnings + currentEarning;

            const earningLimit = Number(findRider?.RechargeData?.onHowManyEarning || 0);
            const remaining = earningLimit - totalEarnings;
            const number = findRider?.phone;

            console.log('Earning limit:', earningLimit);
            console.log('Total earnings:', totalEarnings);

            // Earning limit logic
            if (totalEarnings >= earningLimit) {
                const message = `🎉 You’ve crossed your earning limit according to your current plan. Thank you for using Olyox! Please recharge now to continue earning more.`;
                await SendWhatsAppMessageNormal(message, number);

                findRider.isAvailable = false;
                findRider.RechargeData = {
                    expireData: new Date(Date.now() - 5 * 60 * 1000),
                    rechargePlan: '',
                    onHowManyEarning: '',
                    approveRecharge: false,
                    whichDateRecharge: null
                };
                findRider.isPaid = false;
            } else if (remaining < 300) {
                const reminderMessage = `🛎️ Reminder: You have ₹${remaining} earning potential left on your plan. Recharge soon to avoid interruptions in your earnings. – Team Olyox`;
                await SendWhatsAppMessageNormal(reminderMessage, number);
            }
        } else {
            console.log('Skipping earnings calculation due to invalid recharge date');
        }

        // Finalize rider status update
        findRider.isAvailable = true;
        findRider.on_ride_id = null;
        await findRider.save();

        return {
            success: true,
            message: rechargeDate && !isNaN(rechargeDate.getTime())
                ? 'Ride ended and payment recorded with earnings tracked.'
                : 'Ride ended and payment recorded. Earnings not tracked due to invalid recharge date.',
            currentEarning,
            totalEarnings
        };

    } catch (error) {
        console.error('Error in collectCash:', error.message);
        return { success: false, message: error.message || 'Internal server error' };
    }
};




exports.AddRating = async (data, rate) => {
    try {
        const ride_id = await RideRequest.findById(data?._id)

        if (!ride_id) {
            return {
                success: false,
                message: 'Ride not found'
            }
        }

        ride_id.RatingOfRide = rate
        await ride_id.save()

        return {
            success: true,
            driverId: ride_id.rider,
            message: 'Ride End and Payment Success successfully'
        }

    } catch (error) {
        // Log and handle the error
        console.error('Error in rideStart:', error.message);
        return error.message
    }
}


exports.cancelRideByAnyOne = async (cancelBy, rideData, reason) => {
    try {
        console.log("🛑 Cancel Ride Triggered");
        console.log("cancelBy:", cancelBy);
        console.log("rideData:", JSON.stringify(rideData));
        console.log("reason:", reason);

        let rideId = rideData?._id || rideData?.ride?.rideDetails?._id;
        console.log("Extracted rideId:", rideId);

        if (!rideId) {
            console.warn("⚠️ Invalid rideData - missing _id");
            return {
                success: false,
                message: "Invalid ride data",
            };
        }

        const ride = await RideRequest.findById(rideId);
        if (!ride) {
            console.warn(`⚠️ Ride not found with ID: ${rideId}`);
            return {
                success: false,
                message: "Ride not found",
            };
        }

        console.log("✅ Ride found:", ride._id, "Status:", ride.rideStatus);

        if (ride.rideStatus === "cancelled") {
            console.warn("⚠️ Ride already cancelled");
            return {
                success: false,
                message: "Ride is already cancelled",
            };
        }

        if (ride.rideStatus === "completed") {
            console.warn("⚠️ Ride already completed");
            return {
                success: false,
                message: "Cannot cancel a completed ride",
            };
        }

        // Cancel the ride
        ride.rideCancelBy = cancelBy;
        ride.rideCancelReason = reason;
        ride.rideStatus = "cancelled";
        ride.rideCancelTime = new Date();

        console.log("🔁 Updating rider availability...");

        const foundRiderId = ride?.rider?._id || ride?.rider;
        if (!foundRiderId) {
            console.warn("⚠️ Rider ID missing from ride object");
            return {
                success: false,
                message: "Rider not found in ride data",
            };
        }

        const foundRider = await Riders.findById(foundRiderId);
        if (!foundRider) {
            console.warn(`⚠️ Rider not found with ID: ${foundRiderId}`);
            return {
                success: false,
                message: "Rider not found",
            };
        }

        foundRider.isAvailable = true;
        foundRider.on_ride_id = null;

        await ride.save();
        await foundRider.save();

        console.log("✅ Ride cancelled and rider updated successfully");

        return {
            success: true,
            message: "Ride cancelled successfully",
            ride,
        };
    } catch (error) {
        console.error("❌ Error in cancelRideByAnyOne:", error);
        return {
            success: false,
            message: "Something went wrong while canceling the ride",
            error: error.message,
        };
    }
};





exports.complete_Details_ofRide = async (req, res) => {
    try {
        const { id } = req.query;

        // Find the ride by ID and populate related rider details
        const ride = await RideRequest.findById(id).populate('rider');

        // If the ride is not found, return an error response
        if (!ride) {
            return res.status(404).json({
                success: false,
                message: 'Ride not found',
            });
        }



        return res.status(200).json({
            success: true,
            message: 'Ride ended successfully',
            data: ride
        });

    } catch (error) {
        // Log the error and return a server error response
        console.error('Error in complete_Details_ofRide:', error.message);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while completing'
        })
    }
}


const calculateRidePrice = async (origin, destination, waitingTimeInMinutes, ratePerKm) => {
    console.log("ratePerKm", ratePerKm);
    try {
        // Validate ratePerKm
        if (isNaN(ratePerKm) || ratePerKm <= 0) {
            throw new Error('Invalid rate per km');
        }

        // Fetching directions from Google Maps API to get distance and duration with traffic consideration
        const response = await axios.get('https://maps.googleapis.com/maps/api/directions/json', {
            params: {
                origin: origin,
                destination: destination,
                key: 'AIzaSyCr2aKtwOMiUdR0rBMpE0MCWBHvehwoOtM',
                traffic_model: 'best_guess',
                departure_time: 'now',
            },
        });

        if (response.data.routes.length === 0) {
            throw new Error('No routes found between the locations');
        }

        const route = response.data.routes[0];
        const distanceInKm = route.legs[0].distance.value / 1000;
        const durationInMinutes = route.legs[0].duration_in_traffic.value / 60;

        console.log("distanceInKm", distanceInKm);
        console.log("durationInMinutes", durationInMinutes);

        const priceBasedOnDistance = distanceInKm * ratePerKm;
        console.log("priceBasedOnDistance", priceBasedOnDistance);

        const waitingTimeCost = waitingTimeInMinutes * 5; // Assuming 5 Rupees per minute of waiting
        console.log("waitingTimeCost", waitingTimeCost);

        const totalPrice = priceBasedOnDistance + waitingTimeCost;
        console.log("totalPrice", totalPrice);

        return {
            totalPrice: totalPrice,
            distanceInKm: distanceInKm,
            durationInMinutes: durationInMinutes,
            waitingTimeCost: waitingTimeCost,
        };
    } catch (error) {
        console.error('Error calculating ride price:', error);
        throw new Error('Failed to calculate the ride price');
    }
};

exports.calculateRidePriceForUser = async (req, res) => {
    const startTime = performance.now();

    try {
        const { origin, destination, waitingTimeInMinutes = 0, ratePerKm } = req.body;
        console.log("Request Body:", req.body);

        // Input validation
        if (!origin?.latitude || !origin?.longitude || !destination?.latitude || !destination?.longitude) {
            return res.status(400).json({
                success: false,
                message: "Invalid origin or destination coordinates",
                executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
            });
        }

        const redisClient = req.app.get('pubClient');
        const perKmRate = Number(ratePerKm?.match(/\d+/)?.[0]) || 15;

        const originKey = `${origin.latitude},${origin.longitude}`;
        const destinationKey = `${destination.latitude},${destination.longitude}`;

        // Generate cache keys
        const directionsCacheKey = `directions:${originKey}:${destinationKey}`;
        const weatherCacheKey = `weather:${originKey}`;
        const tollsCacheKey = `tolls:${originKey}:${destinationKey}`;
        const settingsCacheKey = 'fare_settings';

        // Parallel execution for better performance
        const [directionsResult, weatherResult, tollsResult, settingsResult] = await Promise.allSettled([
            getCachedOrFetchDirections(redisClient, directionsCacheKey, originKey, destinationKey),
            getCachedOrFetchWeather(redisClient, weatherCacheKey, origin.latitude, origin.longitude),
            getCachedOrFetchTolls(redisClient, tollsCacheKey, origin, destination),
            getCachedOrFetchSettings(redisClient, settingsCacheKey)
        ]);

        // Handle directions with comprehensive validation
        if (directionsResult.status === 'rejected' || !directionsResult.value) {
            console.error('Directions fetch failed:', directionsResult.reason);
            return res.status(400).json({
                success: false,
                message: "Unable to fetch directions",
                executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
            });
        }

        const directions = directionsResult.value;
        let distance, duration, trafficDuration;

        // Handle different data formats (cached vs Google Maps API)
        if (directions.legs && Array.isArray(directions.legs) && directions.legs.length > 0) {
            // Standard Google Maps API format
            const leg = directions.legs[0];
            if (!leg || !leg.distance || !leg.duration) {
                console.error('Invalid leg structure:', leg);
                return res.status(400).json({
                    success: false,
                    message: "Invalid route leg data",
                    executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
                });
            }

            distance = leg.distance.value / 1000; // km
            duration = leg.duration.value / 60; // minutes
            trafficDuration = leg.duration_in_traffic?.value / 60 || duration;

        } else if (directions.distance && directions.duration) {
            // Custom/simplified format (from cache)
            console.log('Using simplified cached directions format');

            // Parse distance - extract number from string like "3.3 km"
            const distanceMatch = directions.distance.toString().match(/[\d.]+/);
            distance = distanceMatch ? parseFloat(distanceMatch[0]) : 0;

            // Parse duration - extract number from string like "8 mins"
            const durationMatch = directions.duration.toString().match(/[\d.]+/);
            duration = durationMatch ? parseFloat(durationMatch[0]) : 0;
            trafficDuration = duration; // No traffic data in simplified format

        } else {
            console.error('Invalid directions structure:', directions);
            return res.status(400).json({
                success: false,
                message: "Invalid route data format",
                executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
            });
        }

        // Handle weather (with comprehensive validation)
        const weather = weatherResult.status === 'fulfilled' && weatherResult.value ? weatherResult.value : [];
        const rain = Array.isArray(weather) && weather.length > 0 && weather[0]?.main === 'Rain';

        // Handle tolls (with comprehensive validation)
        const tollInfo = tollsResult.status === 'fulfilled' && tollsResult.value ? tollsResult.value : {};
        const tolls = tollInfo && tollInfo.tollInfo && typeof tollInfo.tollInfo === 'object' && Object.keys(tollInfo.tollInfo).length > 0;
        const tollPrice = tolls && tollInfo.tollInfo.estimatedPrice && Array.isArray(tollInfo.tollInfo.estimatedPrice) && tollInfo.tollInfo.estimatedPrice[0]?.units ? tollInfo.tollInfo.estimatedPrice[0].units : 0;

        // Handle settings (with comprehensive validation)  
        const settingData = settingsResult.status === 'fulfilled' && settingsResult.value ? settingsResult.value : {};

        const baseFare = Number(settingData?.BasicFare) || 94;
        const trafficDurationPricePerMinute = Number(settingData?.trafficDurationPricePerMinute) || 0;
        const rainModeFare = Number(settingData?.RainModeFareOnEveryThreeKm) || 0;
        const waitingTimeCost = waitingTimeInMinutes * (Number(settingData?.waitingTimeInMinutes) || 0);

        // Calculate price
        let totalPrice = baseFare +
            (trafficDuration * trafficDurationPricePerMinute) +
            waitingTimeCost +
            (distance * perKmRate);

        if (rain) totalPrice += rainModeFare;
        if (tolls) totalPrice += Number(tollPrice) / 2;

        const executionTime = `${((performance.now() - startTime) / 1000).toFixed(3)}s`;

        console.log("Price Calculation Details:", {
            distance: `${distance} km`,
            duration: `${duration} mins`,
            trafficDuration: `${trafficDuration} mins`,
            perKmRate,
            baseFare,
            rain,
            rainModeFare: rain ? rainModeFare : 0,
            tolls,
            tollPrice,
            waitingTimeCost,
            totalPrice,
            executionTime
        });

        return res.status(200).json({
            success: true,
            message: "Ride price calculated successfully",
            totalPrice: Math.round(totalPrice * 100) / 100, // Round to 2 decimal places
            distanceInKm: Math.round(distance * 100) / 100,
            durationInMinutes: Math.round(trafficDuration * 100) / 100,
            pricing: {
                baseFare,
                distanceCost: Math.round(distance * perKmRate * 100) / 100,
                trafficCost: Math.round(trafficDuration * trafficDurationPricePerMinute * 100) / 100,
                waitingTimeCost,
                rainFare: rain ? rainModeFare : 0,
                tollPrice: tolls ? Math.round(tollPrice / 2 * 100) / 100 : 0
            },
            conditions: {
                rain,
                tolls
            },
            executionTime
        });

    } catch (error) {
        const executionTime = `${((performance.now() - startTime) / 1000).toFixed(3)}s`;
        console.error("Error calculating ride price:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to calculate the ride price",
            executionTime
        });
    }
};

// Helper functions for caching and fetching
async function getCachedOrFetchDirections(redisClient, cacheKey, originKey, destinationKey) {
    try {
        let directions = await redisClient.get(cacheKey);
        if (directions) {
            directions = JSON.parse(directions);
            console.log('Using cached directions');
            return directions;
        }

        const response = await axios.get("https://maps.googleapis.com/maps/api/directions/json", {
            params: {
                origin: originKey,
                destination: destinationKey,
                key: 'AIzaSyCr2aKtwOMiUdR0rBMpE0MCWBHvehwoOtM',
                traffic_model: "best_guess",
                departure_time: Math.floor(Date.now() / 1000),
            },
            timeout: 5000 // 5 second timeout
        });

        if (!response.data || !response.data.routes || !response.data.routes.length) {
            console.error('Google Maps API response:', response.data);
            throw new Error("No routes found from Google Maps API");
        }

        const route = response.data.routes[0];
        if (!route || !route.legs || !Array.isArray(route.legs) || route.legs.length === 0) {
            console.error('Invalid route structure:', route);
            throw new Error("Invalid route structure from Google Maps API");
        }

        directions = route;
        // Don't await the cache operation to speed up response
        redisClient.setEx(cacheKey, 900, JSON.stringify(directions)).catch(console.error);
        console.log('Fetched and cached new directions');
        return directions;
    } catch (error) {
        console.error('Error fetching directions:', error);
        throw error;
    }
}

async function getCachedOrFetchWeather(redisClient, cacheKey, latitude, longitude) {
    try {
        let weather = await redisClient.get(cacheKey);
        if (weather) {
            weather = JSON.parse(weather);
            console.log('Using cached weather');
            return weather;
        }

        weather = await FindWeather(latitude, longitude);
        if (weather) {
            // Don't await the cache operation
            redisClient.setEx(cacheKey, 600, JSON.stringify(weather)).catch(console.error);
            console.log('Fetched and cached new weather data');
        }
        return weather || [];
    } catch (error) {
        console.error('Error fetching weather:', error);
        return []; // Return empty array as fallback
    }
}

async function getCachedOrFetchTolls(redisClient, cacheKey, origin, destination) {
    try {
        let tollInfo = await redisClient.get(cacheKey);
        if (tollInfo) {
            tollInfo = JSON.parse(tollInfo);
            console.log('Using cached toll info');
            return tollInfo;
        }

        const tollCheck = await CheckTolls(origin, destination);
        tollInfo = tollCheck?.travelAdvisory || {};
        // Don't await the cache operation
        redisClient.setEx(cacheKey, 900, JSON.stringify(tollInfo)).catch(console.error);
        console.log('Fetched and cached new toll info');
        return tollInfo;
    } catch (error) {
        console.error('Error fetching tolls:', error);
        return {}; // Return empty object as fallback
    }
}

async function getCachedOrFetchSettings(redisClient, cacheKey) {
    try {
        let settings = await redisClient.get(cacheKey);
        if (settings) {
            settings = JSON.parse(settings);
            console.log('Using cached settings');
            return settings;
        }

        const settingData = await Settings.findOne();
        if (settingData) {
            // Cache settings for 1 hour since they don't change often
            redisClient.setEx(cacheKey, 3600, JSON.stringify(settingData)).catch(console.error);
            console.log('Fetched and cached new settings');
        }
        return settingData || {};
    } catch (error) {
        console.error('Error fetching settings:', error);
        return {}; // Return empty object as fallback
    }
}

const calculateRidePriceForConfirmRide = async (data) => {
    try {
        console.log("Request data:", data);

        // Extract pickup and drop coordinates correctly
        if (!data?.pickupLocation?.coordinates || !data?.dropLocation?.coordinates) {
            throw new Error("Invalid pickup or drop location data");
        }

        const [pickupLng, pickupLat] = data.pickupLocation.coordinates;
        const [dropLng, dropLat] = data.dropLocation.coordinates;

        const pickupLocation = { latitude: pickupLat, longitude: pickupLng };
        const dropLocation = { latitude: dropLat, longitude: dropLng };

        // Destructure and provide default values
        const { waitingTimeInMinutes = 0, ratePerKm = "15" } = data;

        // Convert ratePerKm to a valid number
        const perKmRate = Number(ratePerKm?.match(/\d+/)?.[0]) || 15;

        // Format coordinates for API request
        const formattedOrigin = `${pickupLocation.latitude},${pickupLocation.longitude}`;
        const formattedDestination = `${dropLocation.latitude},${dropLocation.longitude}`;

        // Fetch route details from Google Maps Directions API
        const response = await axios.get("https://maps.googleapis.com/maps/api/directions/json", {
            params: {
                origin: formattedOrigin,
                destination: formattedDestination,
                key: 'AIzaSyCr2aKtwOMiUdR0rBMpE0MCWBHvehwoOtM',
                traffic_model: "best_guess",
                departure_time: Math.floor(Date.now() / 1000),
            },
        });

        if (!response.data.routes?.length) {
            return { success: false, message: "Unable to fetch directions from Google Maps API" };
        }

        const route = response.data.routes[0];
        const distance = route.legs[0].distance.value / 1000; // Convert meters to km
        const duration = route.legs[0].duration.value / 60; // Convert seconds to minutes
        const trafficDuration = route.legs[0].duration_in_traffic?.value / 60 || duration;

        // Check weather conditions
        const checkWeather = await FindWeather(pickupLocation.latitude, pickupLocation.longitude);
        const rain = checkWeather?.[0]?.main === 'Rain';

        // Check for tolls on the route
        const checkTolls = await CheckTolls(pickupLocation, dropLocation);
        console.log("Travel Advisory Data:", checkTolls?.travelAdvisory);

        const tolls = checkTolls?.travelAdvisory?.tollInfo && Object.keys(checkTolls.travelAdvisory.tollInfo).length > 0;
        let tollPrice = tolls ? checkTolls.travelAdvisory.tollInfo?.estimatedPrice?.[0]?.units || 0 : 0;

        // Retrieve fare settings from the database
        const settingData = await Settings.findOne();
        const baseFare = settingData?.BasicFare || 94;
        const trafficDurationPricePerMinute = settingData?.trafficDurationPricePerMinute || 0;
        const rainModeFare = settingData?.RainModeFareOnEveryThreeKm || 0;
        const waitingTimeCost = waitingTimeInMinutes * (settingData?.waitingTimeInMinutes || 0);

        // Calculate total fare
        let totalPrice = baseFare + (trafficDuration * trafficDurationPricePerMinute) + waitingTimeCost;
        if (rain) totalPrice += rainModeFare;
        if (tolls) totalPrice += Number(tollPrice) / 2;
        totalPrice += distance * perKmRate;

        console.log("Total Price Calculation:", {
            totalPrice, distance, rain, tolls, tollPrice, trafficDuration, waitingTimeCost, baseFare
        });

        return {
            success: true,
            message: "Ride price calculated successfully",
            totalPrice, distanceInKm: distance, rain, RainFare: rainModeFare,
            tolls, tollPrice, durationInMinutes: trafficDuration, waitingTimeCost, totalBaseFare: baseFare
        };
    } catch (error) {
        console.error("Error calculating ride price:", error);
        return { success: false, message: "Failed to calculate the ride price" };
    }
};



exports.getAllRides = async (req, res) => {
    try {
        const allRides = await RideRequest.find().populate('rider').populate('user')
        if (!allRides) {
            return res.status(404).json({ success: false, message: "No rides found" })
        }
        res.status(200).json({
            success: true,
            message: "All rides founded",
            data: allRides
        })
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        })
    }
}

exports.getSingleRides = async (req, res) => {
    try {
        const { id } = req.params;
        const allRides = await RideRequest.findById(id).populate('rider').populate('user')
        if (!allRides) {
            return res.status(404).json({ success: false, message: "No rides found" })
        }
        res.status(200).json({
            success: true,
            message: "All rides founded",
            data: allRides
        })
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        })
    }
}

exports.deleleteRidersRideOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await RideRequest.findByIdAndDelete(id);
        if (!order) {
            return res.status(400).json({
                success: false,
                message: "Order not found"
            })
        }
        return res.status(200).json({ success: true, message: "Order deleted successfully" });
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: "Internal servere error",
            error: error.message
        })
    }
}

exports.changeRidersRideStatusByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;

        const order = await RideRequest.findById(id)
            .populate('rider', 'name phone')
            .populate('user', 'name number');

        if (!order) {
            return res.status(400).json({ success: false, message: "Ride request not found" });
        }

        order.rideStatus = status;
        await order.save();

        // Safe fallback values
        const riderName = order?.rider?.name || "Rider";
        const riderPhone = order?.rider?.phone || null;
        const userName = order?.user?.name || "User";
        const userPhone = order?.user?.number || null;
        const userFcmToken = order?.userFcm; // Get FCM token from the order

        let riderMessage = "";
        let userMessage = "";
        let notificationTitle = "";
        let notificationBody = "";

        switch (status) {
            case 'pending':
                riderMessage = `🚕 Hello ${riderName},\n\nA new ride request (ID: ${order._id}) is now *PENDING*. Please review and take action. Refresh the app to see the latest status.`;
                userMessage = `🕒 Hi ${userName},\n\nYour ride request (ID: ${order._id}) is currently *PENDING*. We will notify you once a rider accepts it. Please refresh the app for updates.`;
                notificationTitle = '🕒 Ride Status Update';
                notificationBody = `Your ride request is currently PENDING. We'll notify you once a rider accepts it. Refresh your app for the latest status.`;
                break;
            case 'accepted':
                riderMessage = `✅ Hello ${riderName},\n\nYou have *ACCEPTED* the ride (ID: ${order._id}). Please proceed to pick up the user. Refresh the app to see the latest status.`;
                userMessage = `👏 Hi ${userName},\n\nYour ride (ID: ${order._id}) has been *ACCEPTED* by ${riderName}. They will be on their way soon. Please refresh the app for updates.`;
                notificationTitle = '✅ Ride Accepted!';
                notificationBody = `Your ride has been ACCEPTED by ${riderName}. They'll be on their way soon. Refresh your app for the latest status.`;
                break;
            case 'in_progress':
                riderMessage = `🚗 Ride (ID: ${order._id}) is now *IN PROGRESS*. Stay safe on the road, ${riderName}. Refresh the app to see the latest status.`;
                userMessage = `🚕 Your ride (ID: ${order._id}) is now *IN PROGRESS*. Enjoy your journey! Please refresh the app for updates.`;
                notificationTitle = '🚗 Ride In Progress';
                notificationBody = `Your ride is now IN PROGRESS. Enjoy your journey! Refresh your app for the latest status.`;
                order.rideCancelBy = 'admin';
                order.rideCancelReason = "Cancel By Admin ";
                order.rideStatus = "cancelled";
                order.rideCancelTime = new Date();
                const foundRiderId = order?.rider?._id || order?.rider;
                const foundRider = await Riders.findById(foundRiderId);
                if (!foundRider) {
                    console.warn(`⚠️ Rider not found with ID: ${foundRiderId}`);
                    return {
                        success: false,
                        message: "Rider not found",
                    };
                }

                foundRider.isAvailable = true;
                foundRider.on_ride_id = null;

                await ride.save();
                await foundRider.save();
                break;
            case 'completed':
                riderMessage = `✅ Great job, ${riderName}!\n\nYou have *COMPLETED* the ride (ID: ${order._id}). Refresh the app to see the latest status.`;
                userMessage = `🎉 Hi ${userName},\n\nYour ride (ID: ${order._id}) has been *COMPLETED*. Thank you for riding with us! Please refresh the app for updates.`;
                notificationTitle = '🎉 Ride Completed';
                notificationBody = `Your ride has been COMPLETED. Thank you for riding with us! Refresh your app for the latest status.`;
                break;
            case 'cancelled':
                riderMessage = `❌ The ride (ID: ${order._id}) has been *CANCELLED*. No further action is required. Refresh the app to see the latest status.`;
                userMessage = `⚠️ Hi ${userName},\n\nYour ride (ID: ${order._id}) has been *CANCELLED*. We apologize for the inconvenience. Please refresh the app for updates.`;
                notificationTitle = '⚠️ Ride Cancelled';
                notificationBody = `Your ride has been CANCELLED. We apologize for the inconvenience. Refresh your app for the latest status.`;
                break;
            default:
                riderMessage = `ℹ️ Ride (ID: ${order._id}) status has been changed to *${status}*. Refresh the app to see the latest status.`;
                userMessage = `ℹ️ Ride (ID: ${order._id}) status is now *${status}*. Please refresh the app for updates.`;
                notificationTitle = 'ℹ️ Ride Status Updated';
                notificationBody = `Your ride status is now "${status}". Refresh your app for the latest status.`;
        }

        // Send WhatsApp messages if phone numbers are available
        if (riderPhone) {
            SendWhatsAppMessageNormal(riderMessage, riderPhone);
        }

        if (userPhone) {
            SendWhatsAppMessageNormal(userMessage, userPhone);
        }

        // Send FCM notification if token is available
        if (userFcmToken) {
            try {
                // Include ride ID in the notification data for deep linking in the app
                const notificationData = {
                    event: "RIDE_STATUS_UPDATE",
                    ride_id: order._id.toString(),
                    status: status,
                    timestamp: new Date().toISOString()
                };

                await sendNotification(userFcmToken, notificationTitle, notificationBody, notificationData);
                console.log(`FCM notification sent to user for ride ${order._id}`);
            } catch (notificationError) {
                console.error("Failed to send FCM notification:", notificationError);
                // Continue execution even if notification fails
            }
        } else {
            console.log(`No FCM token available for user of ride ${order._id}`);
        }

        return res.status(200).json({
            success: true,
            message: `Ride status updated to "${status}" and notifications sent`
        });

    } catch (error) {
        console.error("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};