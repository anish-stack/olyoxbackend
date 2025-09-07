const RideBooking = require("./NewRideModel.model");
const axios = require("axios");
const User = require("../../models/normal_user/User.model");
const RiderModel = require("../../models/Rider.model");
// Fetch unassigned rides for a rider
const mongoose = require('mongoose');
const SendWhatsAppMessageNormal = require("../../utils/normalWhatsapp");
const sendNotification = require("../../utils/sendNotification");
const cron = require('node-cron')

const jwt = require('jsonwebtoken')

const scheduleRideCancellationCheck = async (redisClient, rideId) => {
    const CANCELLATION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
    setTimeout(async () => {
        try {
            const ride = await RideBooking.findById(rideId).populate('user');
            if (!ride) {
                console.error(`Ride ${rideId} not found for cancellation check`);
                return;
            }
            if (ride.ride_status === 'pending' || ride.ride_status === 'searching') {
                console.info(`No driver assigned for ride ${rideId} within 2 minutes, cancelling`);
                const updatedRide = await updateRideStatus(redisClient, rideId, 'cancelled', {
                    cancellation_reason: 'No driver found within time limit',
                    cancelled_at: new Date(),
                    cancelledBy: 'system'
                });
                // Notify user of cancellation
                if (updatedRide.user && updatedRide.user.fcmToken) {
                    await sendNotification.sendNotification(
                        updatedRide.user.fcmToken,
                        "Ride Cancelled",
                        "No drivers were available for your ride request.",
                        {
                            event: 'RIDE_CANCELLED',
                            rideId: rideId,
                            message: 'No drivers were available for your ride request.',
                            screen: 'RideHistory',
                        }
                    );
                }
                // Remove ride from Redis
                if (redisClient) {
                    await redisClient.del(`ride:${rideId}`);
                    await redisClient.del(`riders:${rideId}`);
                }
            }
        } catch (error) {
            console.error(`Error during cancellation check for ride ${rideId}:`, error.message);
        }
    }, CANCELLATION_TIMEOUT_MS);
};



exports.NewcreateRequest = async (req, res) => {
    try {
        const user = Array.isArray(req.user.user)
            ? req.user.user[0]
            : req.user.user;
        const {
            vehicleType,
            pickupLocation,
            dropLocation,
            currentLocation,
            pick_desc,
            fare,
            isCashbackApply,
            cashback,
            withoutcashback,
            drop_desc,
            fcmToken,
            paymentMethod = "cash",
            platform = "android",
            scheduledAt = null,
            pickupAddress = {},
            dropAddress = {},
        } = req.body;
        // Validate required fields
        if (
            !pickupLocation ||
            !dropLocation ||
            !pick_desc ||
            !drop_desc ||
            !currentLocation ||
            !vehicleType
        ) {
            console.warn("Missing required fields in ride request");
            return res.status(400).json({
                error: "All required fields must be provided",
                required: [
                    "vehicleType",
                    "pickupLocation",
                    "dropLocation",
                    "currentLocation",
                    "pick_desc",
                    "drop_desc",
                ],
            });
        }

        console.log(
            "Cashback Debug →", fare
        );

        const redisClient = getRedisClient(req)
        // Validate fare object if provided
        if (fare && typeof fare !== "object") {
            return res.status(400).json({
                error: "Fare must be an object with pricing details",
            });
        }

        // Validate coordinates
        const validateCoordinates = (coords, name) => {
            if (!coords.longitude || !coords.latitude) {
                throw new Error(`Invalid ${name} coordinates`);
            }
            if (
                coords.longitude < -180 ||
                coords.longitude > 180 ||
                coords.latitude < -90 ||
                coords.latitude > 90
            ) {
                throw new Error(`${name} coordinates out of valid range`);
            }
        };

        validateCoordinates(pickupLocation, "pickup");
        validateCoordinates(dropLocation, "drop");
        validateCoordinates(currentLocation, "current");

        // Validate scheduled time if provided
        if (scheduledAt) {
            const scheduledDate = new Date(scheduledAt);
            if (scheduledDate <= new Date()) {
                return res.status(400).json({
                    error: "Scheduled time must be in the future",
                });
            }
        }

        // Find and update user
        const findUser = await User.findById(user);
        if (!findUser) {
            console.error("User not found", { userId: user });
            return res.status(404).json({ error: "User not found" });
        }

        // Update FCM token if provided and different
        if (fcmToken && findUser.fcmToken !== fcmToken) {
            console.info(`Updating FCM token for user ${user}`);
            findUser.fcmToken = fcmToken;
            await findUser.save();
        }
        const ONE_MINUTE_AGO = new Date(Date.now() - 60 * 1000);
        // Check for existing active rides
        if (findUser.currentRide) {
            console.log("You already have an active ride")
            return res.status(409).json({
                error: "You already have an active ride request",
                activeRide: findUser.currentRide,
            });
        }

        // Construct geo points using the schema format
        const pickupLocationGeo = {
            type: "Point",
            coordinates: [pickupLocation.longitude, pickupLocation.latitude],
        };

        const dropLocationGeo = {
            type: "Point",
            coordinates: [dropLocation.longitude, dropLocation.latitude],
        };

        // Get route information (distance, duration, polyline)
        let routeInfo = {};
        try {
            const routeData = await getRouteFromAPI(pickupLocation, dropLocation);
            if (routeData) {
                routeInfo = {
                    distance: routeData.distance,
                    duration: routeData.duration,
                    polyline: routeData.polyline || null,
                    waypoints: routeData.waypoints || [],
                };
            } else {
                // Fallback to calculate straight-line distance
                const straightLineDistance = calculateStraightLineDistance(
                    pickupLocation.latitude,
                    pickupLocation.longitude,
                    dropLocation.latitude,
                    dropLocation.longitude
                );
                routeInfo = {
                    distance: straightLineDistance,
                    duration: Math.round(straightLineDistance * 3), // Rough estimate: 3 minutes per km
                };
            }
        } catch (error) {
            console.warn("Route calculation failed, using fallback:", error.message);
            const straightLineDistance = calculateStraightLineDistance(
                pickupLocation.latitude,
                pickupLocation.longitude,
                dropLocation.latitude,
                dropLocation.longitude
            );
            routeInfo = {
                distance: straightLineDistance,
                duration: Math.round(straightLineDistance * 3),
            };
        }

        // Calculate pricing based on fare object or use default calculation
        let pricingData;
        if (fare && fare.total_fare) {
            pricingData = {
                base_fare: fare.base_fare || 0,
                distance_fare: fare.distance_fare || 0,
                time_fare: fare.time_fare || 0,
                platform_fee: fare.platform_fee || 0,
                night_charge: fare.night_charge || 0,
                rain_charge: fare.rain_charge || 0,
                toll_charge: fare.toll_charge || 0,
                discount: fare?.cashback_applied || 0,
                total_fare: fare?.total_fare,
                original_fare: fare?.original_fare,
                currency: fare.currency || "INR",
            };
        } else {
            pricingData = calculateBasePricing(
                vehicleType.toLowerCase(),
                routeInfo.distance || 0
            );
        }
        console.log("pricingData", pricingData)
        // Create comprehensive address objects
        const pickupAddressObj = {
            formatted_address: pick_desc,
            street_number: pickupAddress.street_number || null,
            route: pickupAddress.route || null,
            locality: pickupAddress.locality || null,
            administrative_area: pickupAddress.administrative_area || null,
            country: pickupAddress.country || null,
            postal_code: pickupAddress.postal_code || null,
            place_id: pickupAddress.place_id || null,
        };

        const dropAddressObj = {
            formatted_address: drop_desc,
            street_number: dropAddress.street_number || null,
            route: dropAddress.route || null,
            locality: dropAddress.locality || null,
            administrative_area: dropAddress.administrative_area || null,
            country: dropAddress.country || null,
            postal_code: dropAddress.postal_code || null,
            place_id: dropAddress.place_id || null,
        };

        // Create new ride request with the updated schema
        const newRideRequest = new RideBooking({
            pickup_location: pickupLocationGeo,
            pickup_address: pickupAddressObj,
            drop_location: dropLocationGeo,
            drop_address: dropAddressObj,
            route_info: routeInfo,
            user: user,
            user_fcm_token: fcmToken || findUser.fcmToken,
            vehicle_type: vehicleType.toLowerCase(),
            ride_status: "pending",
            requested_at: new Date(),
            scheduled_at: scheduledAt ? new Date(scheduledAt) : null,
            pricing: pricingData,
            payment_method: paymentMethod.toLowerCase(),
            payment_status: "pending",
            search_radius: 5,
            max_search_radius: 25,
            auto_increase_radius: true,
            retry_count: 0,
            rejected_by_drivers: [],
        });

        // Save the ride request
        await newRideRequest.save();
        findUser.currentRide = newRideRequest._id;
        await findUser.save();
        // Log successful creation
        // console.info(`Ride request created successfully`, {
        //     rideId: newRideRequest._id,
        //     userId: user,
        //     vehicleType,
        //     status: newRideRequest.ride_status,
        //     totalFare: newRideRequest.pricing.total_fare,
        //     distance: routeInfo.distance,
        // });


        scheduleRideCancellationCheck(redisClient, newRideRequest._id);
        // Start driver search process asynchronously
        setImmediate(() => {
            initiateDriverSearch(newRideRequest._id, req, res).catch((error) => {
                console.error("Driver search failed:", error.message);
            });
        });

        // Prepare comprehensive response data
        const responseData = {
            rideId: newRideRequest._id,
            ride_status: newRideRequest.ride_status,
            ride_otp: newRideRequest.ride_otp,
            pickup_location: newRideRequest.pickup_location,
            drop_location: newRideRequest.drop_location,
            pickup_address: newRideRequest.pickup_address,
            drop_address: newRideRequest.drop_address,
            vehicle_type: newRideRequest.vehicle_type,
            pricing: newRideRequest.pricing,
            payment_method: newRideRequest.payment_method,
            payment_status: newRideRequest.payment_status,
            eta: newRideRequest.eta,
            search_radius: newRideRequest.search_radius,
            requested_at: newRideRequest.requested_at,
            scheduled_at: newRideRequest.scheduled_at,
            route_info: newRideRequest.route_info,
            wait_time: newRideRequest.wait_time,
            retry_count: newRideRequest.retry_count,
            auto_increase_radius: newRideRequest.auto_increase_radius,
        };

        res.status(201).json({
            success: true,
            message: "Ride request created successfully",
            data: responseData,
        });
    } catch (error) {
        console.error("Error creating ride request", {
            error: error.message,
            stack: error.stack,
            userId: req.user?.user,
        });

        // Handle specific validation errors
        if (error.name === "ValidationError") {
            const validationErrors = Object.values(error.errors).map(
                (err) => err.message
            );
            return res.status(400).json({
                success: false,
                error: "Validation failed",
                details: validationErrors,
            });
        }

        // Handle duplicate key errors
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                error: "Duplicate entry detected",
                details: error.message,
            });
        }

        res.status(500).json({
            success: false,
            error: "Server error, please try again",
            ...(process.env.NODE_ENV === "development" && { details: error.message }),
        });
    }
};

const getRouteFromAPI = async (pickup, drop) => {
    try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
            console.warn("Google Maps API key not configured");
            return null;
        }

        const response = await axios.get(
            "https://maps.googleapis.com/maps/api/directions/json",
            {
                params: {
                    origin: `${pickup.latitude},${pickup.longitude}`,
                    destination: `${drop.latitude},${drop.longitude}`,
                    mode: "driving",
                    units: "metric",
                    key: apiKey,
                },
                timeout: 5000,
            }
        );

        if (response.data.status === "OK" && response.data.routes.length > 0) {
            const route = response.data.routes[0];
            const leg = route.legs[0];

            return {
                distance: Math.round(leg.distance.value / 1000), // Convert to km
                duration: Math.round(leg.duration.value / 60), // Convert to minutes
                polyline: route.overview_polyline?.points || null,
                waypoints: [],
            };
        }
    } catch (error) {
        console.warn("Route API error:", error.message);
    }
    return null;
};

const calculateStraightLineDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371; // Earth's radius in kilometers
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 100) / 100; // Round to 2 decimal places
};

const calculateBasePricing = (vehicleType, distance) => {
    const pricingConfig = {
        auto: { baseFare: 30, perKm: 12, perMin: 2 },
        bike: { baseFare: 20, perKm: 8, perMin: 1.5 },
        car: { baseFare: 50, perKm: 15, perMin: 3 },
        suv: { baseFare: 80, perKm: 20, perMin: 4 },
    };

    const config = pricingConfig[vehicleType] || pricingConfig.auto;
    const estimatedDuration = Math.round(distance * 3); // 3 minutes per km estimate

    const baseFare = config.baseFare;
    const distanceFare = Math.round(distance * config.perKm);
    const timeFare = Math.round(estimatedDuration * config.perMin);

    const subtotal = baseFare + distanceFare + timeFare;
    const platformFee = Math.round(subtotal * 0.02);
    const currentHour = new Date().getHours();
    const nightCharge =
        currentHour >= 22 || currentHour <= 6 ? Math.round(subtotal * 0.1) : 0;

    const totalFare = subtotal + platformFee + nightCharge;

    return {
        base_fare: baseFare,
        distance_fare: distanceFare,
        time_fare: timeFare,
        platform_fee: platformFee,
        night_charge: nightCharge,
        rain_charge: 0,
        toll_charge: 0,
        discount: 0,
        total_fare: totalFare,
        currency: "INR",
    };
};

const getRedisClient = (req) => {
    try {
        const redisClient = req.app.get('pubClient');
        if (!redisClient || typeof redisClient.set !== 'function') {
            console.error("Redis client is not properly initialized");
            return null;
        }
        return redisClient;
    } catch (error) {
        console.error("Redis client not available:", error.message);
        return null;
    }
};

const saveRideToRedis = async (redisClient, rideId, rideData) => {
    try {
        if (!redisClient) {
            console.warn("Redis client not available, skipping save to Redis");
            return false;
        }

        const rideKey = `ride:${rideId}`;
        await redisClient.set(rideKey, JSON.stringify(rideData), 'EX', 3600);
        console.info(`Ride ${rideId} saved to Redis`);
        return true;
    } catch (error) {
        console.error("Failed to save ride to Redis:", error.message);
        return false;
    }
};

const saveRidersToRedis = async (redisClient, rideId, riders) => {
    try {
        if (!redisClient) {
            console.warn("Redis client not available, skipping save to Redis");
            return false;
        }

        const ridersKey = `riders:${rideId}`;
        await redisClient.set(ridersKey, JSON.stringify(riders), 'EX', 3600);
        console.info(`${riders.length} riders saved to Redis for ride ${rideId}`);
        return true;
    } catch (error) {
        console.error("Failed to save riders to Redis:", error.message);
        return false;
    }
};

const getRidersFromRedis = async (redisClient, rideId) => {
    try {
        if (!redisClient) {
            console.warn("Redis client not available, skipping fetch from Redis");
            return null;
        }

        const ridersKey = `riders:${rideId}`;
        const ridersData = await redisClient.get(ridersKey);
        if (ridersData) {
            console.info(`Retrieved riders from Redis for ride ${rideId}`);
            return JSON.parse(ridersData);
        }
        return null;
    } catch (error) {
        console.error("Failed to get riders from Redis:", error.message);
        return null;
    }
};

const updateRideStatus = async (redisClient, rideId, status, additionalData = {}, riderId) => {
    try {
        console.info(`Updating ride ${rideId} status to: ${status}`);

        const validStatuses = ['pending', 'searching', 'driver_assigned', 'driver_arrived', 'in_progress', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            throw new Error(`Invalid ride status: ${status}`);
        }

        const updateData = {
            ride_status: status,
            driver: riderId,
            updated_at: new Date(),
            ...additionalData
        };

        const updatedRide = await RideBooking.findByIdAndUpdate(
            rideId,
            { $set: updateData },
            { new: true }
        ).populate('user');

        if (status === 'cancelled' && updatedRide.user) {
            updatedRide.user.currentRide = null;
            await updatedRide.user.save();
        }

        if (!updatedRide) {
            throw new Error("Ride not found");
        }

        console.info(`Ride ${rideId} status updated successfully to ${status}`);

        // Update Redis cache
        await saveRideToRedis(redisClient, rideId, updatedRide);

        return updatedRide;
    } catch (error) {
        console.error(`Failed to update ride ${rideId} status:`, error.message);
        throw error;
    }
};

const initiateDriverSearch = async (rideId, req, res) => {
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 10000;
    const INITIAL_RADIUS = 2500;
    const RADIUS_INCREMENT = 500;

    let retryCount = 0;
    const redisClient = getRedisClient(req);

    try {
        console.info(`Initiating driver search for ride: ${rideId}`);

        const ride = await RideBooking.findById(rideId);
        if (!ride) {
            throw new Error("Ride not found");
        }

        if (!['pending', 'searching'].includes(ride.ride_status)) {
            console.info(`Ride ${rideId} is ${ride.ride_status}, stopping search`);
            return { message: `Ride request is ${ride.ride_status}` };
        }

        await updateRideStatus(redisClient, rideId, 'searching', {
            search_started_at: new Date(),
            retry_count: retryCount
        });

        await saveRideToRedis(redisClient, rideId, ride);

        let cachedRiders = await getRidersFromRedis(redisClient, rideId);
        if (cachedRiders && cachedRiders.length > 0) {
            console.info(`Using ${cachedRiders.length} cached riders for ride ${rideId}`);
            return await processRiders(redisClient, rideId, cachedRiders);
        }

        while (retryCount < MAX_RETRIES) {
            try {
                console.info(`Driver search attempt ${retryCount + 1}/${MAX_RETRIES} for ride ${rideId}`);

                const currentRide = await RideBooking.findById(rideId);
                if (!currentRide) {
                    throw new Error("Ride not found during search");
                }

                if (!['pending', 'searching'].includes(currentRide.ride_status)) {
                    console.info(`Ride ${rideId} status changed to ${currentRide.ride_status}, stopping search`);
                    return { message: `Ride status changed to ${currentRide.ride_status}` };
                }

                const pickupCoords = currentRide.pickup_location?.coordinates;
                if (!pickupCoords || pickupCoords.length !== 2) {
                    throw new Error("Invalid pickup coordinates");
                }
                const vehicleType = (ride.vehicle_type).toUpperCase();
                const [longitude, latitude] = pickupCoords;
                const currentRadius = INITIAL_RADIUS + (retryCount * RADIUS_INCREMENT);

                console.info(`Searching for drivers within ${currentRadius / 1000} km of coordinates [${longitude}, ${latitude}]`);

                let riders = await RiderModel.aggregate([
                    {
                        $geoNear: {
                            near: {
                                type: "Point",
                                coordinates: [longitude, latitude]
                            },
                            distanceField: "distance",
                            maxDistance: currentRadius,
                            spherical: true,
                        },
                    },
                    {
                        $match: {
                            isAvailable: true,
                            _id: { $nin: currentRide.rejected_by_drivers || [] }
                        },
                    },
                    {
                        $project: {
                            name: 1,
                            phoneNumber: 1,
                            profileImage: 1,
                            rating: 1,
                            fcmToken: 1,
                            location: 1,
                            "rideVehicleInfo.vehicleName": 1,
                            "rideVehicleInfo.vehicleImage": 1,
                            "rideVehicleInfo.VehicleNumber": 1,
                            "rideVehicleInfo.PricePerKm": 1,
                            "rideVehicleInfo.vehicleType": 1,
                            "RechargeData.expireData": 1,
                            preferences: 1,
                            on_ride_id: 1,
                            distance: 1,
                            isAvailable: 1,
                            lastActiveAt: 1
                        },
                    },
                    {
                        $sort: { distance: 1 }
                    }
                ]);

                console.info(`Found ${riders.length} riders in radius for ride ${rideId}`);

                const currentDate = new Date();


                // if booking  vehicleType is  MINI  and rider vhecke " rideVehicleInfo.vehicleType": vehicleType,

                const preferenceFilteredRiders = riders.filter((rider) => {
                    const driverType = rider?.rideVehicleInfo?.vehicleType?.trim();
                    const prefs = rider.preferences || {};

                    console.info("--------------------------------------------------");
                    console.info(`👤 Rider: ${rider.name || 'Unnamed'} (${rider._id})`);
                    console.info(`📌 Driver Vehicle Type: ${driverType}`);
                    console.info(`📌 Ride Requires Vehicle Type: ${vehicleType}`);
                    console.info(`⚙️ Preferences:`, {
                        OlyoxAcceptMiniRides: prefs?.OlyoxAcceptMiniRides?.enabled,
                        OlyoxAcceptSedanRides: prefs?.OlyoxAcceptSedanRides?.enabled
                    });

                    let decision = false;

                    switch (vehicleType) {
                        case "MINI":
                            decision = (
                                driverType === "MINI" ||
                                (driverType === "SEDAN" && prefs.OlyoxAcceptMiniRides?.enabled) ||
                                ((driverType === "SUV" || driverType === "XL" || driverType === "SUV/XL") &&
                                    prefs.OlyoxAcceptMiniRides?.enabled)
                            );
                            break;

                        case "SEDAN":
                            decision = (
                                driverType === "SEDAN" ||
                                ((driverType === "SUV" || driverType === "XL" || driverType === "SUV/XL") &&
                                    prefs.OlyoxAcceptSedanRides?.enabled)
                            );
                            break;

                        case "SUV":
                        case "SUV/XL":
                        case "SUV/XL ":
                        case "XL":
                            decision = driverType === "SUV/XL" || driverType === "XL" || driverType === "SUV";
                            break;

                        default:
                            decision = false;
                    }

                    console.info(`✅ Decision: ${decision ? "ACCEPTED ✅" : "REJECTED ❌"}`);
                    console.info("--------------------------------------------------");

                    return decision;
                });

                console.info(`Matched ${preferenceFilteredRiders.length} riders after preference filter ✅`);

                console.log("preferenceFilteredRiders", preferenceFilteredRiders.length)

                preferenceFilteredRiders.forEach(rider => {
                    console.info(`✅ Rider Matched: ${rider.name || 'Unnamed'} (${rider._id}) - Vehicle: ${rider?.rideVehicleInfo?.vehicleType}`);
                });
                const validRiders = preferenceFilteredRiders.filter((rider) => {
                    try {
                        const expireDate = rider?.RechargeData?.expireData;
                        const hasValidRecharge = expireDate && new Date(expireDate) >= currentDate;
                        const isFreeRider = !rider?.on_ride_id;
                        const isAvailable = rider?.isAvailable === true;

                        if (!hasValidRecharge) {
                            console.debug(`Rider ${rider._id} filtered: recharge expired (${expireDate})`);
                        }
                        if (!isFreeRider) {
                            console.debug(`Rider ${rider._id} filtered: already on ride (${rider.on_ride_id})`);
                        }
                        if (!isAvailable) {
                            console.debug(`Rider ${rider._id} filtered: not available`);
                        }

                        return hasValidRecharge && isFreeRider && isAvailable;
                    } catch (filterError) {
                        console.warn(`Error filtering rider ${rider._id}:`, filterError.message);
                        return false;
                    }
                });



                console.info(`${validRiders.length} valid riders found out of ${riders.length} total riders for ride ${rideId}`);

                await saveRidersToRedis(redisClient, rideId, validRiders);
                const processResult = await processRiders(redisClient, rideId, validRiders);

                // If no valid riders were found, proceed with retry logic
                if (validRiders.length === 0) {
                    console.warn(`No valid riders found for ride ${rideId}`);
                    retryCount++;

                    await updateRideStatus(redisClient, rideId, 'searching', {
                        retry_count: retryCount,
                        search_radius: currentRadius / 1000,
                        available_drivers: validRiders.length,
                        last_search_at: new Date()
                    });

                    if (retryCount < MAX_RETRIES) {
                        console.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
                        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                        continue;
                    } else {
                        await updateRideStatus(redisClient, rideId, 'cancelled', {
                            cancellation_reason: 'No drivers available',
                            cancelled_at: new Date()
                        });
                        return {
                            success: false,
                            message: "No drivers available in the area"
                        };
                    }
                }
                const sendRideNotifications = async (riders, ride) => {
                    console.log("i am starting to send notifications");
                    for (const rider of riders) {
                        try {
                            await sendNotification.sendNotification(
                                rider.fcmToken,
                                "New Ride Available",
                                "A new ride request is waiting! Please open the app to accept.",
                                {
                                    event: "NEW_RIDE",
                                    rideDetails: {
                                        rideId: ride._id.toString(),
                                        pickup: ride.pickup_address,
                                        drop: ride.drop_address,
                                        vehicleType: ride.vehicle_type,
                                        pricing: ride.pricing
                                    },
                                    screen: "RideRequest",
                                    riderId: rider._id
                                },
                                "ride_request_channel"
                            );
                            console.info(`Notification sent to rider ${rider._id} for ride ${ride._id}`);
                        } catch (err) {
                            console.error(`Failed to send notification to rider ${rider._id}:`, err);
                        }
                    }
                };

                // Fire-and-forget, fully detached from other incoming requests
                const notifyRiders = (riders, ride) => {
                    sendRideNotifications(riders, ride).catch(err => {
                        console.error("Unexpected error in notification flow:", err);
                    });
                };




                console.info(`Driver search process completed for ride ${rideId}`);


                // Return the result of processRiders if riders were found
                return processResult;

            } catch (searchError) {
                console.error(`Driver search attempt ${retryCount + 1} failed:`, searchError.message);
                retryCount++;

                if (retryCount < MAX_RETRIES) {
                    console.info(`Waiting ${RETRY_DELAY_MS / 1000} seconds before retry...`);
                    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
                } else {
                    await updateRideStatus(redisClient, rideId, 'cancelled', {
                        cancellation_reason: 'Driver search failed after maximum retries',
                        cancelled_at: new Date(),
                        final_retry_count: retryCount
                    });
                    return {
                        success: false,
                        message: "Driver search failed after maximum retries"
                    };
                }
            }
        }

        // If retries are exhausted
        await updateRideStatus(redisClient, rideId, 'cancelled', {
            cancellation_reason: 'Driver search failed after maximum retries',
            cancelled_at: new Date(),
            final_retry_count: retryCount
        });

        return {
            success: false,
            message: "Driver search failed after maximum retries"
        };

    } catch (error) {
        console.error("Driver search initiation failed:", error.message);

        try {
            await updateRideStatus(redisClient, rideId, 'cancelled', {
                cancellation_reason: 'Driver search error: ' + error.message,
                cancelled_at: new Date(),
                last_error: {
                    message: error.message,
                    code: "DRIVER_SEARCH_FAILED",
                    occurred_at: new Date(),
                }
            });
        } catch (updateError) {
            console.error("Failed to update ride with error:", updateError.message);
        }

        throw error;
    }
};

const processRiders = async (redisClient, rideId, riders, rideDetails = {}) => {
    const notificationStateKey = `ride:${rideId}:notification_state`;
    let notificationsSentCount = 0;

    const sendRideNotifications = async (eligibleRiders, ride) => {
        console.log(`🚀 Sending notifications to ${eligibleRiders.length} riders for ride ${ride._id}`);
        for (const rider of eligibleRiders) {
            try {
                await sendNotification.sendNotification(
                    rider.fcmToken,
                    "New Ride Available",
                    "A new ride request is waiting! Please open the app to accept.",
                    {
                        event: "NEW_RIDE",
                        rideDetails: {
                            rideId: ride._id.toString(),
                            pickup: ride.pickup_address,
                            drop: ride.drop_address,
                            vehicleType: ride.vehicle_type,
                            pricing: ride.pricing
                        },
                        screen: "RideRequest",
                        riderId: rider._id
                    },
                    "ride_request_channel"
                );
                console.info(`✅ Notification sent to rider ${rider._id}`);
            } catch (err) {
                console.error(`❌ Failed to send notification to rider ${rider._id}:`, err.message);
            }
        }
        console.log(`🚀 Completed sending notifications for this batch`);
    };

    try {
        console.info(`🚀 Processing ${riders.length} riders for ride ${rideId}`);

        if (!riders || riders.length === 0) {
            console.warn(`⚠️ No riders to notify for ride ${rideId}`);
            await redisClient.set(notificationStateKey, JSON.stringify({
                batchCount: 0,
                totalNotificationsSent: 0,
                completed: true,
                lastBatchSentAt: new Date(),
                reason: 'No riders available'
            }));
            return { success: true, message: 'No riders available', riders_count: 0, total_notifications: 0 };
        }

        // Initialize Redis state
        await redisClient.set(notificationStateKey, JSON.stringify({
            batchCount: 0,
            totalNotificationsSent: 0,
            completed: false,
            lastBatchSentAt: null
        }), 'EX', 3600);

        const maxDuration = 120000; // 2 minutes
        const interval = 5000;
        const startTime = Date.now();

        while (Date.now() - startTime < maxDuration) {
            let retries = 3;
            let transactionSuccessful = false;

            while (!transactionSuccessful && retries > 0) {
                try {
                    await redisClient.watch(`ride:${rideId}`);
                    const ride = await RideBooking.findById(rideId)
                        .select('ride_status rejected_by_drivers pickup_address drop_address vehicle_type pricing');

                    if (!ride) {
                        await redisClient.unwatch();
                        throw new Error('Ride not found');
                    }

                    if (ride.ride_status === 'cancelled') {
                        await redisClient.unwatch();
                        console.warn(`⚠️ Ride ${rideId} cancelled`);
                        await redisClient.set(notificationStateKey, JSON.stringify({
                            batchCount: notificationsSentCount,
                            totalNotificationsSent: 0,
                            completed: true,
                            lastBatchSentAt: new Date(),
                            reason: 'Ride cancelled'
                        }));
                        return { success: true, message: 'Ride cancelled', riders_count: riders.length, total_notifications: 0 };
                    }

                    if (!['pending', 'searching'].includes(ride.ride_status)) {
                        await redisClient.unwatch();
                        console.info(`ℹ️ Ride status is ${ride.ride_status}, skipping notifications`);
                        await redisClient.set(notificationStateKey, JSON.stringify({
                            batchCount: notificationsSentCount,
                            totalNotificationsSent: 0,
                            completed: true,
                            lastBatchSentAt: new Date(),
                            reason: `Ride status is ${ride.ride_status}`
                        }));
                        return { success: true, message: 'Ride not eligible for notifications', riders_count: riders.length, total_notifications: 0 };
                    }

                    const rejectedDriverIds = (ride.rejected_by_drivers || []).map(r => r.driver.toString());
                    const eligibleRiders = riders.filter(r => !rejectedDriverIds.includes(r._id.toString()));

                    if (eligibleRiders.length === 0) {
                        await redisClient.unwatch();
                        console.info(`ℹ️ All riders have rejected ride ${rideId}`);
                        await redisClient.set(notificationStateKey, JSON.stringify({
                            batchCount: notificationsSentCount,
                            totalNotificationsSent: 0,
                            completed: true,
                            lastBatchSentAt: new Date(),
                            reason: 'All riders rejected'
                        }));
                        return { success: true, message: 'All riders rejected, notifications skipped', riders_count: riders.length, total_notifications: 0 };
                    }

                    notificationsSentCount++;

                    const multi = redisClient.multi();
                    multi.set(notificationStateKey, JSON.stringify({
                        batchCount: notificationsSentCount,
                        totalNotificationsSent: notificationsSentCount * eligibleRiders.length,
                        completed: false,
                        lastBatchSentAt: new Date()
                    }));

                    await RideBooking.findByIdAndUpdate(rideId, {
                        $set: { last_notification_sent_at: new Date(), notified_riders: eligibleRiders.map(r => r._id) },
                        $inc: { total_notifications_sent: eligibleRiders.length }
                    });

                    await multi.exec();
                    transactionSuccessful = true;

                    // Send notifications in background
                    sendRideNotifications(eligibleRiders, ride);

                } catch (err) {
                    retries--;
                    await redisClient.unwatch();
                    console.error(`⚠️ Transaction failed, retries left: ${retries}`, err.message);
                    if (retries === 0) throw err;
                    await new Promise(res => setTimeout(res, 100));
                }
            }

            await new Promise(res => setTimeout(res, interval));
        }

        console.info(`✅ Completed ${notificationsSentCount} notification batches for ride ${rideId}`);
        await redisClient.set(notificationStateKey, JSON.stringify({
            batchCount: notificationsSentCount,
            totalNotificationsSent: notificationsSentCount * riders.length,
            completed: true,
            lastBatchSentAt: new Date()
        }));

        return { success: true, message: `Completed ${notificationsSentCount} batches`, riders_count: riders.length, total_notifications: notificationsSentCount * riders.length };

    } catch (error) {
        console.error(`❌ Failed to process riders for ride ${rideId}:`, error.message);
        await redisClient.set(notificationStateKey, JSON.stringify({
            batchCount: notificationsSentCount,
            totalNotificationsSent: notificationsSentCount * riders.length,
            completed: false,
            lastBatchSentAt: new Date(),
            error: error.message
        }));
        return { success: false, message: 'Failed to process riders', error: error.message };
    }
};



exports.cancelRideRequest = async (req, res) => {
    try {
        const rideId = req.params.rideId;

        if (!rideId) {
            return res.status(400).json({ message: "Ride ID is required." });
        }

        const foundRide = await RideBooking.findById(rideId).populate('user');
        if (!foundRide) {
            return res.status(404).json({ message: "Ride not found." });
        }

        if (["completed", "cancelled"].includes(foundRide.ride_status)) {
            return res.status(400).json({ message: "Ride is already completed or cancelled." });
        }

        // Cancel the ride
        foundRide.ride_status = "cancelled";
        foundRide.cancellation_reason = "User cancelled the ride request";
        foundRide.cancelled_by = "user";
        foundRide.cancelled_at = new Date();
        await foundRide.save();

        // Clear user's current ride if populated
        if (foundRide.user) {
            foundRide.user.currentRide = null;
            await foundRide.user.save();
        }

        // Update Redis cache
        const redisClient = getRedisClient(req);
        if (redisClient) {
            try {
                await redisClient.del(`ride:${rideId}`); // avoid flushAll() which removes all keys!
            } catch (redisErr) {
                console.error("Redis cache error:", redisErr.message);
            }
        }

        return res.status(200).json({ success: true, message: "Ride cancelled successfully." });
    } catch (error) {
        console.error("Error cancelling ride request:", error);
        return res.status(500).json({ message: "Server error while cancelling ride request." });
    }
};

exports.ride_status_after_booking = async (req, res) => {
    try {
        const { rideId } = req.params;

        console.log("🔎 Received request for ride status.");
        console.log("📦 rideId from params new hai bilkul:", rideId);

        if (!rideId) {
            console.warn("⚠️ Ride ID not provided in request.");
            return res.status(400).json({ message: "Ride ID is required." });
        }

        console.log("⏳ Simulating delay before fetching ride status (5 seconds)...");
        await new Promise(resolve => setTimeout(resolve, 5000));

        console.log("📡 Fetching ride details from database...");
        const ride = await RideBooking.findOne({ _id: rideId }).populate("driver");

        if (!ride) {
            console.warn("❌ Ride not found for ID:", rideId);
            return res.status(404).json({ message: "Ride not found." });
        }

        console.log("✅ Ride found:", {
            rideId: ride._id,
            status: ride.ride_status,
            driver: ride.driver ? ride.driver._id : null,
        });

        let responsePayload = {
            status: ride.ride_status,
            message: "",
            rideDetails: null,
        };

        switch (ride.ride_status) {
            case "pending":
                responsePayload.message = "Your ride request is pending confirmation.";
                console.log("🕒 Status: pending");
                break;
            case "searching":
                responsePayload.message = "Searching for a driver near you...";
                responsePayload.rideDetails = ride;
                console.log("🔍 Status: searching, ride details included");
                break;
            case "driver_assigned":
                responsePayload.message = "Driver assigned! Your ride is on the way.";
                responsePayload.rideDetails = ride;
                console.log("🚗 Status: driver_assigned");
                break;
            case "driver_arrived":
                responsePayload.message = "Your driver has arrived at the pickup location!";
                responsePayload.rideDetails = ride;
                console.log("📍 Status: driver_arrived");
                break;
            case "in_progress":
                responsePayload.message = "Your ride is currently in progress.";
                responsePayload.rideDetails = ride ? {
                    rideId: ride._id,
                    driverId: ride.driver._id,
                } : null;
                console.log("🚕 Status: in_progress");
                break;
            case "completed":
                responsePayload.message = "Your ride has been completed. Thank you!";
                responsePayload.rideDetails = ride;
                console.log("✅ Status: completed");
                break;
            case "cancelled":
                responsePayload.message = `This ride has been cancelled${ride.cancelledBy ? ` by ${ride.cancelledBy}` : ""}.`;
                responsePayload.rideDetails = ride;
                console.log("❌ Status: cancelled");
                break;
            default:
                responsePayload.message = "Ride status is unknown or invalid.";
                console.warn(`⚠️ Unhandled ride status: ${ride.ride_status} for rideId: ${ride._id}`);
                break;
        }

        console.log("📤 Sending response:", responsePayload.status);
        return res.status(200).json(responsePayload);
    } catch (error) {
        console.error("💥 Error fetching ride status:", error);
        if (error.name === "CastError") {
            console.warn("❗ Invalid Ride ID format received.");
            return res.status(400).json({ message: "Invalid Ride ID format." });
        }
        return res.status(500).json({ message: "Server error while fetching ride status." });
    }
};

const isRideAllowedByPreferences = (rideVehicleType, rider) => {
    const driverType = rider?.rideVehicleInfo?.vehicleType?.trim();
    const prefs = rider?.preferences || {};
    let decision = false;

    console.info("--------------------------------------------------");
    console.info(`👤 Rider: ${rider.name || 'Unnamed'} (${rider._id})`);
    console.info(`📌 Driver Vehicle Type: ${driverType}`);
    console.info(`📌 Ride Requires Vehicle Type: ${rideVehicleType}`);
    console.info(`⚙️ Preferences:`, {
        OlyoxAcceptMiniRides: prefs?.OlyoxAcceptMiniRides?.enabled,
        OlyoxAcceptSedanRides: prefs?.OlyoxAcceptSedanRides?.enabled
    });

    switch (rideVehicleType?.toUpperCase()) {
        case "MINI":
            decision = (
                driverType === "MINI" ||
                (driverType === "SEDAN" && prefs.OlyoxAcceptMiniRides?.enabled) ||
                ((driverType === "SUV" || driverType === "XL" || driverType === "SUV/XL") &&
                    prefs.OlyoxAcceptMiniRides?.enabled)
            );
            break;

        case "SEDAN":
            decision = (
                driverType === "SEDAN" ||
                ((driverType === "SUV" || driverType === "XL" || driverType === "SUV/XL") &&
                    prefs.OlyoxAcceptSedanRides?.enabled)
            );
            break;

        case "SUV":
        case "SUV/XL":
        case "SUV/XL ":
        case "XL":
            decision = driverType === "SUV/XL" || driverType === "XL" || driverType === "SUV";
            break;

        default:
            decision = false;
    }

    console.info(`✅ Preference Decision: ${decision ? "ACCEPTED ✅" : "REJECTED ❌"}`);
    console.info("--------------------------------------------------");

    return decision;
};

exports.riderFetchPoolingForNewRides = async (req, res) => {
    try {
        const { id: riderId } = req.params;
        console.log("=== STARTING RIDE FETCH FOR RIDER ===");
        console.log("Rider ID:", riderId);

        if (!riderId) {
            console.log("ERROR: No rider ID provided");
            return res.status(400).json({ message: "Rider ID is required." });
        }

        const foundRiderDetails = await RiderModel.findOne({ _id: riderId });
        console.log("Found rider details:", foundRiderDetails ? "YES" : "NO");
        if (!foundRiderDetails) {
            console.log("ERROR: Rider not found in database");
            return res.status(404).json({ message: "Rider not found." });
        }

        console.log("Rider availability:", foundRiderDetails.isAvailable);
        if (!foundRiderDetails.isAvailable) {
            console.log("ERROR: Rider is not available");
            return res.status(400).json({ message: "Rider is not available for new rides." });
        }

        console.log("Rider vehicle type:", foundRiderDetails.rideVehicleInfo.vehicleType);
        console.log("Rider location:", JSON.stringify(foundRiderDetails.location, null, 2));

        // Check if rider has location data
        if (!foundRiderDetails.location || !foundRiderDetails.location.coordinates || foundRiderDetails.location.coordinates.length !== 2) {
            console.log("ERROR: Rider location data is missing or invalid");
            return res.status(400).json({ message: "Rider location data is required." });
        }

        const riderLat = foundRiderDetails.location.coordinates[1]; // Latitude
        const riderLng = foundRiderDetails.location.coordinates[0]; // Longitude
        console.log("Rider coordinates - Lat:", riderLat, "Lng:", riderLng);

        const redisClient = getRedisClient(req);
        let availableRides = [];

        // Time cutoff: 4 minutes ago (240 seconds)
        const now = new Date();
        const cutoffTime = new Date(now.getTime() - 240 * 1000);
        console.log("Current time:", now);
        console.log("Cutoff time:", cutoffTime);

        // Helper function to calculate distance between two points (Haversine formula)
        const calculateDistance = (lat1, lng1, lat2, lng2) => {
            console.log(`--- CALCULATING DISTANCE ---`);
            console.log(`Point 1 (Rider): Lat ${lat1}, Lng ${lng1}`);
            console.log(`Point 2 (Pickup): Lat ${lat2}, Lng ${lng2}`);

            const R = 6371; // Radius of the Earth in kilometers
            const dLat = (lat2 - lat1) * Math.PI / 180;
            const dLng = (lng2 - lng1) * Math.PI / 180;
            const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                Math.sin(dLng / 2) * Math.sin(dLng / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            const distance = R * c; // Distance in kilometers

            console.log(`Calculated distance: ${distance.toFixed(2)} km`);
            return distance;
        };

        // Helper function to check if ride is within acceptable distance (e.g., 5km)
        const isRideNearby = (ridePickupLocation, riderLat, riderLng, maxDistanceKm = 5) => {
            console.log(`--- CHECKING RIDE PROXIMITY ---`);
            console.log("Ride pickup location:", JSON.stringify(ridePickupLocation, null, 2));

            if (!ridePickupLocation || !ridePickupLocation.coordinates || ridePickupLocation.coordinates.length !== 2) {
                console.log("Ride pickup location is invalid - SKIPPING RIDE");
                return false;
            }

            const pickupLat = ridePickupLocation.coordinates[1]; // Latitude
            const pickupLng = ridePickupLocation.coordinates[0]; // Longitude
            console.log("Pickup coordinates - Lat:", pickupLat, "Lng:", pickupLng);

            const distance = calculateDistance(riderLat, riderLng, pickupLat, pickupLng);
            const isNearby = distance <= maxDistanceKm;

            console.log(`Distance: ${distance.toFixed(2)}km, Max allowed: ${maxDistanceKm}km, Is nearby: ${isNearby}`);
            return isNearby;
        };

        // Helper function to check if rider is rejected
        const isRiderRejected = (rejectedDrivers, riderId) => {
            console.log("--- CHECKING REJECTION ---");
            console.log("Rejected drivers array:", JSON.stringify(rejectedDrivers, null, 2));
            console.log("Checking rider ID:", riderId);

            if (!rejectedDrivers || !Array.isArray(rejectedDrivers)) {
                console.log("No rejected drivers array or not array - RIDER NOT REJECTED");
                return false;
            }

            if (rejectedDrivers.length === 0) {
                console.log("Empty rejected drivers array - RIDER NOT REJECTED");
                return false;
            }

            for (let i = 0; i < rejectedDrivers.length; i++) {
                const rejection = rejectedDrivers[i];
                console.log(`Checking rejection ${i}:`, JSON.stringify(rejection, null, 2));

                if (!rejection) {
                    console.log(`Rejection ${i} is null/undefined - SKIP`);
                    continue;
                }

                // Based on schema, the field is 'driver' not '_id'
                const rejectedDriverId = rejection.driver;
                console.log(`Rejected driver ID from schema: ${rejectedDriverId}`);
                console.log(`Rejected at: ${rejection.rejected_at}`);
                console.log(`Comparing: ${rejectedDriverId} === ${riderId}`);
                console.log(`String comparison: ${rejectedDriverId?.toString()} === ${riderId.toString()}`);

                if (rejectedDriverId && rejectedDriverId.toString() === riderId.toString()) {
                    console.log("MATCH FOUND - RIDER IS REJECTED");
                    return true;
                }
            }

            console.log("NO MATCH FOUND - RIDER NOT REJECTED");
            return false;
        };

        // 🆕 Integrated preference checking function
        const isRideAllowedByPreferences = (rideVehicleType, rider) => {
            const driverType = rider?.rideVehicleInfo?.vehicleType?.trim();
            const prefs = rider?.preferences || {};
            let decision = false;
            console.info("--------------------------------------------------");
            console.info(`👤 Rider: ${rider.name || 'Unnamed'} (${rider._id})`);
            console.info(`📌 Driver Vehicle Type: ${driverType}`);
            console.info(`📌 Ride Requires Vehicle Type: ${rideVehicleType}`);
            console.info(`⚙️ Preferences:`, {
                OlyoxAcceptMiniRides: prefs?.OlyoxAcceptMiniRides?.enabled,
                OlyoxAcceptSedanRides: prefs?.OlyoxAcceptSedanRides?.enabled
            });

            switch (rideVehicleType?.toUpperCase()) {
                case "MINI":
                    decision = (
                        driverType === "MINI" ||
                        (driverType === "SEDAN" && prefs.OlyoxAcceptMiniRides?.enabled) ||
                        ((driverType === "SUV" || driverType === "XL" || driverType === "SUV/XL") &&
                            prefs.OlyoxAcceptMiniRides?.enabled)
                    );
                    break;
                case "SEDAN":
                    decision = (
                        driverType === "SEDAN" ||
                        ((driverType === "SUV" || driverType === "XL" || driverType === "SUV/XL") &&
                            prefs.OlyoxAcceptSedanRides?.enabled)
                    );
                    break;
                case "SUV":
                case "SUV/XL":
                case "SUV/XL ":
                case "XL":
                    decision = driverType === "SUV/XL" || driverType === "XL" || driverType === "SUV";
                    break;
                default:
                    decision = false;
            }
            console.info(`✅ Preference Decision: ${decision ? "ACCEPTED ✅" : "REJECTED ❌"}`);
            console.info("--------------------------------------------------");
            return decision;
        };

        // 🔄 Modified database query - get ALL searching rides (remove vehicle_type filter)
        console.log("\n=== QUERYING DATABASE FOR RIDES ===");
        console.log("Query criteria:");
        console.log("- ride_status: 'searching'");
        console.log("- requested_at >= ", cutoffTime);
        console.log("- 🆕 Removed vehicle_type filter - will check preferences instead");

        const dbRides = await RideBooking.find({
            ride_status: 'searching',
            requested_at: { $gte: cutoffTime }
        }).sort({ requested_at: -1 });

        console.log(`Found ${dbRides.length} rides in database with basic criteria`);

        // Filter out rejected rides, check proximity, and check preferences
        const filteredRides = [];
        for (let i = 0; i < dbRides.length; i++) {
            const ride = dbRides[i];
            console.log(`\n--- PROCESSING RIDE ${i + 1}/${dbRides.length} ---`);
            console.log("Ride ID:", ride._id);
            console.log("Ride status:", ride.ride_status);
            console.log("Ride vehicle type:", ride.vehicle_type);
            console.log("Requested at:", ride.requested_at);
            console.log("Pickup location:", JSON.stringify(ride.pickup_location, null, 2));

            // Check if rider is rejected for this ride
            const isRejected = isRiderRejected(ride.rejected_by_drivers, riderId);
            console.log("Is rider rejected for this ride:", isRejected);

            if (isRejected) {
                console.log("SKIPPING RIDE - RIDER IS REJECTED");
                continue;
            }

            // Check if ride is nearby (within 5km)
            const isNearby = isRideNearby(ride.pickup_location, riderLat, riderLng, 5);
            console.log("Is ride nearby:", isNearby);

            if (!isNearby) {
                console.log("SKIPPING RIDE - TOO FAR FROM RIDER");
                continue;
            }

            // 🆕 Check if ride is allowed by preferences
            const isAllowedByPreferences = isRideAllowedByPreferences(ride.vehicle_type, foundRiderDetails);
            console.log("Is ride allowed by preferences:", isAllowedByPreferences);

            if (!isAllowedByPreferences) {
                console.log("SKIPPING RIDE - NOT ALLOWED BY PREFERENCES");
                continue;
            }

            console.log("ADDING RIDE TO FILTERED LIST - PASSED ALL CHECKS ✅");
            filteredRides.push(ride);
        }

        console.log(`\n=== FILTERING RESULTS ===`);
        console.log(`After rejection, proximity, and preference filtering: ${filteredRides.length} rides`);

        // Take only first 2 rides
        const finalRides = filteredRides.slice(0, 2);
        console.log(`Taking first 2 rides: ${finalRides.length} rides`);

        // Final validation - check each ride one more time
        const validatedRides = [];
        for (let i = 0; i < finalRides.length; i++) {
            const ride = finalRides[i];
            console.log(`\n--- FINAL VALIDATION FOR RIDE ${i + 1} ---`);
            console.log("Ride ID:", ride._id);

            // Get latest ride data from database
            const latestRideData = await RideBooking.findById(ride._id);
            console.log("Latest ride data found:", latestRideData ? "YES" : "NO");

            if (!latestRideData) {
                console.log("RIDE NOT FOUND IN DB - SKIPPING");
                continue;
            }

            console.log("Latest ride status:", latestRideData.ride_status);

            if (latestRideData.ride_status !== 'searching') {
                console.log("RIDE STATUS NOT SEARCHING - SKIPPING");
                continue;
            }

            // Final rejection check
            const finalRejectionCheck = isRiderRejected(latestRideData.rejected_by_drivers, riderId);
            console.log("Final rejection check result:", finalRejectionCheck);

            if (finalRejectionCheck) {
                console.log("RIDER IS REJECTED IN FINAL CHECK - SKIPPING");
                continue;
            }

            // Final proximity check
            const finalProximityCheck = isRideNearby(latestRideData.pickup_location, riderLat, riderLng, 5);
            console.log("Final proximity check result:", finalProximityCheck);

            if (!finalProximityCheck) {
                console.log("RIDE TOO FAR IN FINAL CHECK - SKIPPING");
                continue;
            }

            // 🆕 Final preference check
            const finalPreferenceCheck = isRideAllowedByPreferences(latestRideData.vehicle_type, foundRiderDetails);
            console.log("Final preference check result:", finalPreferenceCheck);

            if (!finalPreferenceCheck) {
                console.log("RIDE NOT ALLOWED BY PREFERENCES IN FINAL CHECK - SKIPPING");
                continue;
            }

            console.log("RIDE PASSED ALL VALIDATIONS - ADDING TO FINAL LIST ✅");
            validatedRides.push(latestRideData);
        }

        console.log(`\n=== FINAL RESULTS ===`);
        console.log(`Total validated rides: ${validatedRides.length}`);

        if (validatedRides.length > 0) {
            console.log("Final ride IDs:", validatedRides.map(r => r._id.toString()));
            console.log("Final ride vehicle types:", validatedRides.map(r => r.vehicle_type));

            validatedRides.forEach((ride, index) => {
                console.log(`Ride ${index + 1} rejected_by_drivers:`, JSON.stringify(ride.rejected_by_drivers, null, 2));
            });
        }

        return res.status(200).json({
            success: true,
            message: `Found ${validatedRides.length} available rides`,
            data: validatedRides
        });

    } catch (error) {
        console.error("ERROR in riderFetchPoolingForNewRides:", error.message);
        console.error("Full error:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while fetching rides.",
            error: error.message
        });
    }
};

exports.FetchAllBookedRides = async (req, res) => {
    try {
        const Bookings = await RideBooking.find()
            .populate('user') // Populate user details
            .populate('driver', 'name rideVehicleInfo phone isAvailable BH fcmToken RechargeData') // Populate specific driver fields
            .populate({
                path: 'rejected_by_drivers.driver', // Populate driver inside rejected_by_drivers array
                model: 'Rider',
                select: 'name phone rideVehicleInfo isAvailable' // Select fields you want from the Rider model
            }).sort({ requested_at: -1 }); // Sort by requested_at in descending order

        res.status(200).json({ success: true, Bookings });
    } catch (error) {
        console.error("Error fetching booked rides:", error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
};


exports.BookingDetailsAdmin = async (req, res) => {
    try {
        const Bookings = await RideBooking.findById(req.params.id)
            .populate('user') // Populate user details
            .populate('driver', 'name rideVehicleInfo phone isAvailable BH fcmToken RechargeData') // Populate specific driver fields
            .populate({
                path: 'rejected_by_drivers.driver', // Populate driver inside rejected_by_drivers array
                model: 'Rider',
                select: 'name phone rideVehicleInfo isAvailable' // Select fields you want from the Rider model
            });

        res.status(200).json({ success: true, Bookings });
    } catch (error) {
        console.error("Error fetching booked rides:", error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
}

// Helper function to clean up Redis cache (can be called periodically)
exports.cleanupRedisRideCache = async (req, res) => {
    try {
        const redisClient = getRedisClient(req);
        const cachedRidesKeys = await redisClient.keys('ride:*');
        let cleanedCount = 0;

        for (const rideKey of cachedRidesKeys) {
            const rideData = await redisClient.get(rideKey);

            if (!rideData) {
                await redisClient.del(rideKey); // In case it's a stale key with no value
                cleanedCount++;
                continue;
            }

            try {
                const ride = JSON.parse(rideData);

                // Check if ride still exists in DB
                const dbRide = await RideBooking.findById(ride._id).populate('user');

                if (!dbRide) {
                    await redisClient.del(rideKey);
                    cleanedCount++;
                    console.log(`Deleted missing ride ${ride._id} from Redis`);
                    continue;
                }

                // If cancelled, reset user current ride
                if (dbRide.ride_status === 'cancelled' && dbRide.user) {
                    dbRide.user.currentRide = null;
                    await dbRide.user.save();
                }

                // Remove if cancelled or completed
                if (['cancelled', 'completed'].includes(dbRide.ride_status)) {
                    await redisClient.del(rideKey);
                    cleanedCount++;
                    console.log(`Cleaned ride ${ride._id} from Redis`);
                } else if (dbRide.ride_status !== ride.ride_status) {
                    // Sync status
                    await redisClient.set(rideKey, JSON.stringify(dbRide), 'EX', 3600);
                    console.log(`Updated Redis ride ${ride._id} status to ${dbRide.ride_status}`);
                }

            } catch (parseError) {
                console.warn(`Malformed ride data in Redis for key: ${rideKey}. Deleting...`);
                await redisClient.del(rideKey);
                cleanedCount++;
            }
        }

        return res.status(200).json({
            success: true,
            message: `Cleaned up ${cleanedCount} rides from Redis cache.`,
        });

    } catch (error) {
        console.error("Error cleaning up Redis cache:", error.message);
        return res.status(500).json({
            success: false,
            message: "Server error while cleaning up cache.",
            error: error.message,
        });
    }
};

// Handle rider accepting or rejecting a ride
exports.riderActionAcceptOrRejectRide = async (req, res) => {
    try {
        const { riderId, rideId, action } = req.body;
        console.log("=== RIDER ACTION REQUEST ===");
        console.log("Rider ID:", riderId);
        console.log("Ride ID:", rideId);
        console.log("Action:", action);

        // Input validation
        if (!riderId || !rideId || !action) {
            console.log("ERROR: Missing required fields");
            return res.status(400).json({
                success: false,
                message: "Rider ID, Ride ID, and action are required."
            });
        }

        if (!["accept", "reject"].includes(action.toLowerCase())) {
            console.log("ERROR: Invalid action provided");
            return res.status(400).json({
                success: false,
                message: "Invalid action. Must be 'accept' or 'reject'."
            });
        }

        // Convert to ObjectIds
        const riderObjectId = new mongoose.Types.ObjectId(riderId);
        const rideObjectId = new mongoose.Types.ObjectId(rideId);
        console.log("Converted to ObjectIds - Rider:", riderObjectId, "Ride:", rideObjectId);

        // Validate rider
        console.log("\n=== VALIDATING RIDER ===");
        const rider = await RiderModel.findById(riderObjectId);
        if (!rider) {
            console.log("ERROR: Rider not found");
            return res.status(404).json({
                success: false,
                message: "Rider not found."
            });
        }

        console.log("Rider found:", rider.name);
        console.log("Rider available:", rider.isAvailable);
        console.log("Rider on ride:", rider.on_ride_id);

        if (!rider.isAvailable || rider.on_ride_id) {
            console.log("ERROR: Rider not available or already on ride");
            return res.status(400).json({
                success: false,
                message: "Rider is not available or is already on a ride."
            });
        }

        // Validate ride
        console.log("\n=== VALIDATING RIDE ===");
        const ride = await RideBooking.findById(rideObjectId).populate("user driver");
        if (!ride) {
            console.log("ERROR: Ride not found");
            return res.status(404).json({
                success: false,
                message: "Ride not found."
            });
        }

        console.log("Ride found - ID:", ride._id);
        console.log("Ride status:", ride.ride_status);
        console.log("Ride user:", ride.user?.name || ride.user?.phone);

        if (ride.ride_status !== "searching") {
            console.log("ERROR: Ride not in searching status");
            return res.status(400).json({
                success: false,
                message: `Ride is in ${ride.ride_status} status, cannot perform action.`
            });
        }

        const redisClient = getRedisClient(req);

        // Handle REJECT action
        if (action.toLowerCase() === "reject") {
            console.log("\n=== PROCESSING REJECT ACTION ===");
            return await handleRideRejection(req, res, ride, rider, rideObjectId, riderId, redisClient);
        }

        // Handle ACCEPT action
        if (action.toLowerCase() === "accept") {
            console.log("\n=== PROCESSING ACCEPT ACTION ===");
            return await handleRideAcceptance(req, res, ride, rider, riderObjectId, rideObjectId, riderId, rideId, redisClient);
        }

    } catch (error) {
        console.error("=== UNEXPECTED ERROR ===");
        console.error("Error message:", error.message);
        console.error("Error stack:", error.stack);
        return res.status(500).json({
            success: false,
            message: "Server error while processing rider action.",
            error: error.message
        });
    }
};

exports.riderActionAcceptOrRejectRideVia = async (req, res) => {
    try {
        const { rideId, action, token } = req.params;
        console.log("📩 Incoming params:", req.params);

        // Verify token
        let decoded;
        try {
            decoded = jwt.verify(
                token,
                "dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih"
            );
        } catch (err) {
            console.error("❌ Token verification failed:", err.message);
            return res.status(401).json({
                success: false,
                message: "Invalid or expired token.",
                error: err.message
            });
        }

        const riderId = decoded?.userId;
        console.log(`👉 Rider action request → Rider: ${riderId}, Ride: ${rideId}, Action: ${action}`);

        // Input validation
        if (!riderId || !rideId || !action) {
            console.error("❌ Missing required fields:", { riderId, rideId, action });
            return res.status(400).json({
                success: false,
                message: "Rider ID, Ride ID, and action are required."
            });
        }

        if (!["accept", "reject"].includes(action.toLowerCase())) {
            console.error("❌ Invalid action:", action);
            return res.status(400).json({
                success: false,
                message: "Invalid action. Must be 'accept' or 'reject'."
            });
        }

        // Validate Rider
        let rider;
        try {
            rider = await RiderModel.findById(riderId);
        } catch (err) {
            console.error("❌ Error fetching rider:", err.message);
            return res.status(500).json({ success: false, message: "DB error fetching rider", error: err.message });
        }

        if (!rider) {
            console.error("❌ Rider not found:", riderId);
            return res.status(404).json({
                success: false,
                message: "Rider not found."
            });
        }
        if (!rider.isAvailable || rider.on_ride_id) {
            console.error("❌ Rider not available or already on ride:", { riderId, isAvailable: rider.isAvailable, onRide: rider.on_ride_id });
            return res.status(400).json({
                success: false,
                message: "Rider is not available or already on a ride."
            });
        }

        // Validate Ride
        let ride;
        try {
            ride = await RideBooking.findById(rideId).populate("user driver");
        } catch (err) {
            console.error("❌ Error fetching ride:", err.message);
            return res.status(500).json({ success: false, message: "DB error fetching ride", error: err.message });
        }

        if (!ride) {
            console.error("❌ Ride not found:", rideId);
            return res.status(404).json({
                success: false,
                message: "Ride not found."
            });
        }
        if (ride.ride_status !== "searching") {
            console.error(`❌ Ride status invalid: ${ride.ride_status}`);
            return res.status(400).json({
                success: false,
                message: `Ride is in ${ride.ride_status} status, cannot perform action.`
            });
        }

        const redisClient = getRedisClient(req);

        // Handle Rejection
        if (action.toLowerCase() === "reject") {
            console.log(`🚫 Rider ${riderId} rejecting ride ${rideId}`);
            try {
                return await handleRideRejection(req, res, ride, rider, rideId, riderId, redisClient);
            } catch (err) {
                console.error("❌ Error in handleRideRejection:", err.message, err);
                return res.status(500).json({
                    success: false,
                    message: "Server error in ride rejection.",
                    error: err.message
                });
            }
        }

        // Handle Acceptance
        if (action.toLowerCase() === "accept") {
            console.log(`✅ Rider ${riderId} accepting ride ${rideId}`);
            try {
                return await handleRideAcceptance(req, res, ride, rider, riderId, rideId, riderId, rideId, redisClient);
            } catch (err) {
                console.error("❌ Error in handleRideAcceptance:", err.message, err);
                return res.status(500).json({
                    success: false,
                    message: "Server error in ride acceptance.",
                    error: err.message
                });
            }
        }

    } catch (error) {
        console.error("🔥 Fatal error in riderActionAcceptOrRejectRideVia:", error.message, error);
        return res.status(500).json({
            success: false,
            message: "Server error while processing rider action.",
            error: error.message
        });
    }
};


// Handle ride rejection
const handleRideRejection = async (req, res, ride, rider, rideObjectId, riderId, redisClient) => {
    try {
        console.log("Adding rider to rejected_by_drivers list");

        // Check if rider already rejected this ride
        const alreadyRejected = ride.rejected_by_drivers?.some(rejection =>
            rejection.driver && rejection.driver.toString() === riderId.toString()
        );

        if (alreadyRejected) {
            console.log("WARNING: Rider already rejected this ride");
            return res.status(400).json({
                success: false,
                message: "You have already rejected this ride."
            });
        }

        // Update ride with rejection
        const updatedRide = await RideBooking.findByIdAndUpdate(
            rideObjectId,
            {
                $addToSet: {
                    rejected_by_drivers: {
                        driver: rider._id,
                        rejected_at: new Date()
                    }
                }
            },
            { new: true }
        );

        if (!updatedRide) {
            console.log("ERROR: Failed to update ride with rejection");
            return res.status(404).json({
                success: false,
                message: "Ride not found or failed to update."
            });
        }

        console.log("Successfully added rejection to database");
        console.log("Updated rejected_by_drivers:", JSON.stringify(updatedRide.rejected_by_drivers, null, 2));

        // Clean up Redis
        try {
            console.log("Cleaning up Redis data");
            let cachedRiders = await getRidersFromRedis(redisClient, ride._id.toString());

            if (cachedRiders && cachedRiders.length > 0) {
                console.log("Found cached riders:", cachedRiders.length);
                cachedRiders = cachedRiders.filter((r) => {
                    const rId = typeof r === "string" ? r : r._id?.toString();
                    return rId !== riderId;
                });

                await saveRidersToRedis(redisClient, ride._id.toString(), cachedRiders);
                console.log("Rider removed from Redis cache");
            } else {
                console.log("No cached riders found in Redis");
            }

            // Update ride data in Redis
            const rideKey = `ride:${ride._id}`;
            await redisClient.set(rideKey, JSON.stringify(updatedRide), 'EX', 3600);
            console.log("Updated ride data in Redis");

        } catch (redisError) {
            console.error("Redis cleanup error:", redisError.message);
            // Don't fail the request if Redis fails
        }

        console.log("=== REJECTION COMPLETED SUCCESSFULLY ===");
        return res.status(200).json({
            success: true,
            message: "Ride rejected successfully."
        });

    } catch (error) {
        console.error("Error in handleRideRejection:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to reject ride.",
            error: error.message
        });
    }
};

// Handle ride acceptance
const handleRideAcceptance = async (req, res, ride, rider, riderObjectId, rideObjectId, riderId, rideId, redisClient) => {
    try {
        console.log("Attempting to accept ride");

        // Double-check ride is still available (race condition protection)
        const currentRide = await RideBooking.findById(rideObjectId);
        if (!currentRide || currentRide.ride_status !== "searching") {
            console.log("ERROR: Ride no longer available");
            return res.status(400).json({
                success: false,
                message: "Ride is no longer available."
            });
        }

        // Update ride status to accepted
        console.log("Updating ride status to driver_assigned");
        await RideBooking.findByIdAndUpdate(rideObjectId, {
            $set: {
                ride_status: "driver_assigned",
                driver: riderObjectId,
                driver_assigned_at: new Date(),
                eta: 5,
                updated_at: new Date()
            }
        }, { new: true, runValidators: true });

        const updatedRide = await RideBooking.findById(rideObjectId).populate("user driver");

        if (!updatedRide) {
            console.log("ERROR: Failed to update ride status");
            return res.status(500).json({
                success: false,
                message: "Failed to update ride status."
            });
        }

        console.log("Ride status updated successfully", updatedRide.ride_status);


        console.log("Updating rider status");
        await RiderModel.findByIdAndUpdate(riderObjectId, {
            $set: {
                isAvailable: false,
                on_ride_id: rideObjectId
            }
        });

        console.log("Rider status updated successfully");

        // Send notification to user
        console.log("Sending notification to user");
        if (updatedRide.user?.fcmToken) {
            try {
                await sendNotification.sendNotification(
                    updatedRide.user.fcmToken,
                    "Ride Accepted",
                    "Your ride request has been accepted!",
                    {
                        event: "RIDE_ACCEPTED",
                        eta: 5,
                        message: "Your ride request has been accepted!",
                        rideDetails: {
                            rideId: updatedRide._id.toString(),
                            pickup: updatedRide.pickup_address,
                            drop: updatedRide.drop_address,
                            vehicleType: updatedRide.vehicle_type,
                            pricing: updatedRide.pricing,
                            driverName: rider.name,
                            vehicleDetails: rider.rideVehicleInfo
                        },
                        screen: "TrackRider",
                        riderId: rider.name
                    }
                );
                console.log("User notification sent successfully");
            } catch (notificationError) {
                console.error("Failed to send user notification:", notificationError.message);
            }
        } else {
            console.log("No FCM token found for user");
        }

        // Notify other riders and clean up Redis
        console.log("Notifying other riders and cleaning up Redis");
        try {
            let cachedRiders = await getRidersFromRedis(redisClient, rideId);

            if (cachedRiders && cachedRiders.length > 0) {
                console.log("Found cached riders:", cachedRiders.length);
                const otherRiders = cachedRiders.filter((r) => {
                    const rId = typeof r === "string" ? r : r._id?.toString();
                    return rId !== riderId;
                });

                console.log("Other riders to notify:", otherRiders.length);

                // Notify other riders
                for (const otherRider of otherRiders) {
                    const token = typeof otherRider === "string" ? null : otherRider.fcmToken;

                    if (token) {
                        try {
                            await sendNotification.sendNotification(
                                token,
                                "Ride Unavailable",
                                "The ride you were considering is no longer available.",
                                {
                                    event: "RIDE_UNAVAILABLE",
                                    rideId: rideId,
                                    message: "The ride you were considering is no longer available.",
                                    screen: "RiderDashboard"
                                }
                            );
                            console.log("Notification sent to other rider");
                        } catch (notificationError) {
                            console.error("Failed to notify other rider:", notificationError.message);
                        }
                    }
                }

                // Clear riders cache
                await redisClient.del(`riders:${rideId}`);
                console.log("Cleared riders cache from Redis");
            }

            // Update ride data in Redis
            const rideKey = `ride:${rideId}`;
            await redisClient.set(rideKey, JSON.stringify(updatedRide), 'EX', 3600);
            console.log("Updated ride data in Redis");

        } catch (redisError) {
            console.error("Redis cleanup error:", redisError.message);
            // Don't fail the request if Redis fails
        }

        console.log("=== ACCEPTANCE COMPLETED SUCCESSFULLY ===");
        return res.status(200).json({
            success: true,
            message: "Ride accepted successfully.",
            data: {
                rideId: updatedRide._id.toString(),
                pickup: updatedRide.pickup_address,
                drop: updatedRide.drop_address,
                vehicleType: updatedRide.vehicle_type,
                pricing: updatedRide.pricing,
                driverName: rider.name,
                vehicleDetails: rider.rideVehicleInfo,
                eta: 5
            }
        });

    } catch (error) {
        console.error("Error in handleRideAcceptance:", error.message);
        return res.status(500).json({
            success: false,
            message: "Failed to accept ride.",
            error: error.message
        });
    }
};

exports.ride_status_after_booking_for_drivers = async (req, res) => {
    try {

        const { rideId } = req.params;
        if (!rideId) {
            return res.status(400).json({ message: "Ride ID is required." });
        }
        const ride = await RideBooking.findOne({ _id: rideId })
            .populate("driver user")
            .lean();
        if (!ride) {
            return res.status(404).json({ message: "Ride not found." });
        }

        let responsePayload = {
            status: ride.ride_status,
            message: "",
            rideDetails: null,
        };
        switch (ride.ride_status) {
            case "pending":
                responsePayload.message = "Your ride request is pending confirmation.";
                responsePayload.rideDetails = {
                    rideId: ride._id,
                    pickup: ride.pickup_address,
                    drop: ride.drop_address,
                    vehicleType: ride.vehicle_type,
                    pricing: ride.pricing,
                    requestedAt: ride.requested_at,
                };
                break;
            case "searching":
                responsePayload.message = "Searching for a driver near you...";
                responsePayload.rideDetails = {
                    rideId: ride._id,
                    pickup: ride.pickup_address,
                    drop: ride.drop_address,
                    vehicleType: ride.vehicle_type,
                    pricing: ride.pricing,
                    searchRadius: ride.search_radius,
                    retryCount: ride.retry_count,
                };
                break;
            case "driver_assigned":
                responsePayload.message = "Driver assigned! Your ride is on the way.";
                responsePayload.rideDetails = ride.driver ? {
                    rideId: ride._id,
                    driverId: ride.driver._id,
                    driverName: ride.driver.name,
                    vehicleType: ride.vehicle_type,
                    vehicleDetails: ride.driver.rideVehicleInfo,
                    eta: ride.eta || 5,
                    pickup: ride.pickup_address,
                    drop: ride.drop_address,
                    pricing: ride.pricing,
                } : null;
                break;
            case "driver_arrived":
                responsePayload.message = "Your driver has arrived at the pickup location!";
                responsePayload.rideDetails = ride.driver ? {
                    rideId: ride._id,
                    driverId: ride.driver._id,
                    driverName: ride.driver.name,
                    vehicleType: ride.vehicle_type,
                    vehicleDetails: ride.driver.rideVehicleInfo,
                    pickup: ride.pickup_address,
                    drop: ride.drop_address,
                    pricing: ride.pricing,
                } : null;
                break;
            case "in_progress":
                responsePayload.message = "Your ride is currently in progress.";
                responsePayload.rideDetails = ride.driver ? {
                    rideId: ride._id,
                    driverId: ride.driver._id,
                    driverName: ride.driver.name,
                    vehicleType: ride.vehicle_type,
                    vehicleDetails: ride.driver.rideVehicleInfo,
                    pickup: ride.pickup_address,
                    drop: ride.drop_address,
                    pricing: ride.pricing,
                } : null;
                break;
            case "completed":
                responsePayload.message = "Your ride has been completed. Thank you!";
                responsePayload.rideDetails = {
                    rideId: ride._id,
                    pickup: ride.pickup_address,
                    drop: ride.drop_address,
                    vehicleType: ride.vehicle_type,
                    pricing: ride.pricing,
                    completedAt: ride.completed_at || new Date(),
                };
                break;
            case "cancelled":
                responsePayload.message = `This ride has been cancelled${ride.cancelledBy ? ` by ${ride.cancelledBy}` : ""}.`;
                responsePayload.rideDetails = {
                    rideId: ride._id,
                    pickup: ride.pickup_address,
                    drop: ride.drop_address,
                    vehicleType: ride.vehicle_type,
                    pricing: ride.pricing,
                    cancellationReason: ride.cancellation_reason || "Unknown",
                    cancelledAt: ride.cancelled_at || new Date(),
                };
                break;
            default:
                responsePayload.message = "Ride status is unknown or invalid.";
                console.warn(`Ride ${ride._id} has an unhandled status: ${ride.ride_status}`);
                break;
        }
        return res.status(200).json({
            success: true,
            data: ride
        });
    } catch (error) {
        console.error("Error fetching ride status:", error);
        if (error.name === "CastError") {
            return res.status(400).json({ message: "Invalid Ride ID format." });
        }
        return res.status(500).json({ message: "Server error while fetching ride status." });
    }
};

exports.changeCurrentRiderRideStatus = async (req, res) => {
    try {
        const validStatus = ['driver_arrived', 'completed', 'cancelled'];
        const { riderId, rideId, status, byAdmin } = req.body;

        if (!riderId || !rideId || !status) {
            return res.status(400).json({ error: 'Missing riderId, rideId, or status' });
        }

        if (!byAdmin && !validStatus.includes(status)) {
            return res.status(400).json({ error: 'Invalid ride status' });
        }

        const foundRide = await RideBooking.findById(rideId)
            .populate('driver')
            .populate('user');

        if (!foundRide) return res.status(404).json({ error: 'Ride not found' });

        if (!byAdmin) {
            if (foundRide.ride_status === 'cancelled')
                return res.status(400).json({ error: 'Cannot update a cancelled ride' });

            if (foundRide.ride_status === 'completed')
                return res.status(400).json({ error: 'Ride is already completed' });

            if (foundRide.ride_status === 'driver_arrived' && status === 'driver_arrived')
                return res.status(400).json({ error: 'Ride is already marked as driver arrived' });
        }

        const { driver, user } = foundRide;
        const userFcmToken = user?.fcmToken || foundRide.user_fcm_token;

        if ((status === 'driver_arrived' || status === 'completed') && !driver) {
            return res.status(400).json({ error: `Cannot update to '${status}' because no driver is assigned.` });
        }

        // ----------------------------
        // Status Update Logic
        // ----------------------------

        if (status === 'driver_arrived') {
            foundRide.ride_status = 'driver_arrived';
            foundRide.driver_arrived_at = new Date();

            if (userFcmToken) {
                await sendNotification.sendNotification(
                    userFcmToken,
                    "Your Driver Has Arrived",
                    `Driver ${driver?.name || ''} has arrived at your pickup location.`,
                    {
                        event: 'DRIVER_ARRIVED',
                        rideId: foundRide._id,
                    }
                );
            }
        }

        const haversineDistance = (lat1, lon1, lat2, lon2) => {
            const toRad = (val) => (val * Math.PI) / 180;

            const R = 6371e3; // Radius of Earth in meters
            const φ1 = toRad(lat1);
            const φ2 = toRad(lat2);
            const Δφ = toRad(lat2 - lat1);
            const Δλ = toRad(lon2 - lon1);

            const a =
                Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
                Math.cos(φ1) * Math.cos(φ2) *
                Math.sin(Δλ / 2) * Math.sin(Δλ / 2);

            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

            return R * c; // in meters
        };

        if (status === 'completed') {
            const driverLocationLat = driver?.location?.coordinates[1];
            const driverLocationLng = driver?.location?.coordinates[0];

            const dropLocationLat = foundRide?.drop_location?.coordinates[1];
            const dropLocationLng = foundRide?.drop_location?.coordinates[0];

            if (
                driverLocationLat != null &&
                driverLocationLng != null &&
                dropLocationLat != null &&
                dropLocationLng != null
            ) {
                const distance = haversineDistance(
                    driverLocationLat,
                    driverLocationLng,
                    dropLocationLat,
                    dropLocationLng
                );

                console.log("📍 Distance from drop:", distance, "meters");

                if (distance <= 200) {
                    foundRide.ride_status = 'completed';
                    foundRide.ride_ended_at = new Date();

                    if (userFcmToken) {
                        await sendNotification.sendNotification(
                            userFcmToken,
                            "Ride Completed",
                            "Thank you for riding with us. Please rate your experience!",
                            {
                                event: 'RIDE_COMPLETED',
                                rideId: foundRide._id,
                            }
                        );
                    }
                } else {
                    console.log("❌ Driver too far from drop location to mark ride as completed.");
                    return res.status(400).json({ error: `You are too far from drop location to mark ride as completed.` });

                }
            }
        }
        if (status === 'cancelled') {
            foundRide.ride_status = 'cancelled';
            foundRide.cancellation_reason = "Cancelled by rider";
            foundRide.cancelled_by = "rider";
            foundRide.cancelled_at = new Date();

            if (userFcmToken) {
                await sendNotification.sendNotification(
                    userFcmToken,
                    "Ride Cancelled",
                    "Your ride has been cancelled. We hope to serve you again.",
                    {
                        event: 'RIDE_CANCELLED',
                        rideId: foundRide._id,
                    }
                );
            }

            if (driver?.fcmToken) {
                await sendNotification.sendNotification(
                    driver.fcmToken,
                    "Ride Cancelled",
                    "The ride has been cancelled. Awaiting next request.",
                    {
                        event: 'RIDE_CANCELLED_DRIVER',
                        rideId: foundRide._id,
                    }
                );
            }
        }

        // Clear current ride from user on cancel/completed
        if ((status === 'completed' || status === 'cancelled') && foundRide.user) {
            foundRide.user.currentRide = null;
            await foundRide.user.save();
        }

        await foundRide.save();

        return res.status(200).json({
            success: true,
            message: `Ride status updated to ${status}`,
            ride: foundRide,
        });

    } catch (error) {
        console.error("Error changing ride status:", error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};


exports.AdminChangeCurrentRiderRideStatus = async (req, res) => {
    try {
        const validStatus = [
            'pending',
            'searching',
            'driver_assigned',
            'driver_arrived',
            'in_progress',
            'completed',
            'cancelled',
        ];

        const { riderId, rideId, status, byAdmin } = req.body;

        if (!rideId || !status) {
            return res.status(400).json({ error: 'Missing riderId, rideId, or status' });
        }

        if (!byAdmin && !validStatus.includes(status)) {
            return res.status(400).json({ error: 'Invalid ride status' });
        }

        const foundRide = await RideBooking.findById(rideId)
            .populate('driver')
            .populate('user');

        if (!foundRide) {
            return res.status(404).json({ error: 'Ride not found' });
        }

        if (!byAdmin) {
            if (['cancelled', 'completed'].includes(foundRide.ride_status)) {
                return res.status(400).json({ error: `Cannot update a ${foundRide.ride_status} ride` });
            }
            if (foundRide.ride_status === status) {
                return res.status(400).json({ error: `Ride is already marked as ${status}` });
            }
        }

        const { driver, user } = foundRide;
        const userFcmToken = user?.fcmToken || foundRide.user_fcm_token;

        // Validate required driver presence
        const driverRequiredStatuses = ['driver_assigned', 'driver_arrived', 'in_progress', 'completed'];
        if (driverRequiredStatuses.includes(status) && !driver) {
            return res.status(400).json({
                error: `Cannot set status '${status}' — no driver assigned to this ride.`,
            });
        }

        // Set common status
        foundRide.ride_status = status;

        // Apply status-specific logic
        switch (status) {
            case 'driver_assigned':
                foundRide.driver_assigned_at = new Date();
                break;

            case 'driver_arrived':
                foundRide.driver_arrived_at = new Date();
                if (userFcmToken) {
                    await sendNotification.sendNotification(
                        userFcmToken,
                        "Driver Has Arrived",
                        `Driver ${driver?.name || ''} has arrived at your pickup location.`,
                        {
                            event: 'DRIVER_ARRIVED',
                            rideId: foundRide._id,
                        }
                    );
                }
                break;

            case 'in_progress':
                foundRide.ride_started_at = new Date();
                if (user?.fcmToken) {
                    await sendNotification.sendNotification(
                        user.fcmToken,
                        "Your Ride Has Started",
                        "Enjoy your ride!",
                        {
                            event: 'RIDE_STARTED',
                            rideId: foundRide._id,
                        }
                    );
                }
                break;

            case 'completed':
                foundRide.ride_ended_at = new Date();

                if (userFcmToken) {
                    await sendNotification.sendNotification(
                        userFcmToken,
                        "Ride Completed",
                        "Thank you for riding with us. Please rate your experience!",
                        {
                            event: 'RIDE_COMPLETED',
                            rideId: foundRide._id,
                        }
                    );
                }

                if (driver?.fcmToken) {
                    await sendNotification.sendNotification(
                        driver.fcmToken,
                        "Ride Completed",
                        "You've successfully completed the ride. Great job!",
                        {
                            event: 'RIDE_COMPLETED_DRIVER',
                            rideId: foundRide._id,
                        }
                    );
                }

                // Reset current ride
                if (user) {
                    user.currentRide = null;
                    await user.save();
                }
                break;

            case 'cancelled':
                foundRide.cancellation_reason = "Cancelled by admin";
                foundRide.cancelled_by = "admin";
                foundRide.cancelled_at = new Date();

                if (userFcmToken) {
                    await sendNotification.sendNotification(
                        userFcmToken,
                        "Ride Cancelled",
                        "Your ride has been cancelled. We hope to serve you again.",
                        {
                            event: 'RIDE_CANCELLED',
                            rideId: foundRide._id,
                        }
                    );
                }

                if (driver?.fcmToken) {
                    await sendNotification.sendNotification(
                        driver.fcmToken,
                        "Ride Cancelled",
                        "The ride has been cancelled. Awaiting next request.",
                        {
                            event: 'RIDE_CANCELLED_DRIVER',
                            rideId: foundRide._id,
                        }
                    );
                }

                // Reset current ride
                if (user) {
                    user.currentRide = null;
                    await user.save();
                }
                if (driver) {
                    driver.on_ride_id = null;
                    driver.isAvailable = true;

                    await driver.save();
                }
                break;

            case 'pending':
            case 'searching':
            default:
                break;
        }

        await foundRide.save();

        return res.status(200).json({
            success: true,
            message: `Ride status updated to '${status}'`,
            ride: foundRide,
        });
    } catch (error) {
        console.error("Error changing ride status:", error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};


exports.verifyRideOtp = async (req, res) => {
    try {
        const { riderId, rideId, otp } = req.body;

        // Validate required fields
        if (!riderId || !rideId || !otp) {
            return res.status(400).json({ error: 'Missing riderId, rideId, or otp' });
        }

        const foundRide = await RideBooking.findById(rideId)
            .populate('driver')
            .populate('user');

        if (!foundRide) {
            return res.status(404).json({ message: 'Ride not found' });
        }

        const { user, driver } = foundRide;

        if (foundRide.ride_status === 'cancelled') {
            if (user?.fcmToken) {
                await sendNotification.sendNotification(
                    user.fcmToken,
                    "Ride Verification Failed",
                    "Ride has already been cancelled.",
                    { event: 'RIDE_CANCELLED', rideId }
                );
            }
            return res.status(400).json({ message: 'Cannot update a cancelled ride' });
        }

        if (foundRide.ride_status === 'completed') {
            if (user?.fcmToken) {
                await sendNotification.sendNotification(
                    user.fcmToken,
                    "Ride Verification Failed",
                    "Ride is already marked as completed.",
                    { event: 'RIDE_ALREADY_COMPLETED', rideId }
                );
            }
            return res.status(400).json({ message: 'Ride is already completed' });
        }

        if (foundRide.ride_status !== 'driver_arrived') {
            if (driver?.fcmToken) {
                await sendNotification.sendNotification(
                    driver.fcmToken,
                    "Cannot Start Ride",
                    "You must mark 'Driver Arrived' before verifying OTP.",
                    { event: 'DRIVER_NOT_ARRIVED', rideId }
                );
            }
            return res.status(400).json({ message: 'Please mark as arrived at the customer location' });
        }

        // OTP check
        if (foundRide.ride_otp !== otp) {
            if (user?.fcmToken) {
                await sendNotification.sendNotification(
                    user.fcmToken,
                    "Invalid OTP",
                    "The OTP you entered is incorrect. Please try again.",
                    { event: 'INVALID_OTP', rideId }
                );
            }
            return res.status(400).json({ message: 'Invalid OTP' });
        }

        // OTP is valid – mark ride as in progress
        foundRide.ride_status = 'in_progress';
        foundRide.ride_started_at = new Date();
        await foundRide.save();

        // Send success notification
        if (user?.fcmToken) {
            await sendNotification.sendNotification(
                user.fcmToken,
                "Ride Started",
                "Your ride has started. Enjoy the journey!",
                { event: 'RIDE_STARTED', rideId }
            );
        }

        // if (driver?.fcmToken) {
        //     await sendNotification.sendNotification(
        //         driver.fcmToken,
        //         "Ride Started",
        //         "OTP verified. You can now begin the ride.",
        //         { event: 'RIDE_STARTED_DRIVER', rideId }
        //     );
        // }

        return res.status(200).json({
            success: true,
            message: "OTP verified successfully. Ride is now in progress.",
            ride: foundRide,
        });

    } catch (error) {
        console.error("❌ OTP verification error:", error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};

exports.collectPayment = async (req, res) => {
    // Maximum retry attempts for transaction conflicts
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 100; // milliseconds

    // Helper function to introduce delay
    const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Main transaction logic wrapped in a function for retry
    const executePaymentTransaction = async (attempt = 1) => {
        const session = await mongoose.startSession();
        
        // State variables
        let paidAmount = 0;
        let discountUsed = 0;
        let userGetCashback = false;
        let cashbackGet = 0;
        let bonusAmount = 0;

        try {
            const { riderId, rideId, amount, mode } = req.body;

            // Input validation
            if (!riderId || !rideId || !mode || !amount) {
                throw new Error('Missing required fields: riderId, rideId, amount, mode');
            }

            // Start transaction with proper options
            await session.startTransaction({
                readConcern: { level: 'snapshot' },
                writeConcern: { w: 'majority' },
                maxCommitTimeMS: 30000 // 30 second timeout
            });

            // Use findOneAndUpdate with session for atomic operations where possible
            const foundRide = await RideBooking.findById(rideId)
                .populate('driver')
                .populate('user')
                .session(session);

            if (!foundRide) {
                throw new Error("Ride not found");
            }

            // Handle cancelled ride
            if (foundRide.ride_status === 'cancelled') {
                if (foundRide.user) {
                    await User.findByIdAndUpdate(
                        foundRide.user._id,
                        { currentRide: null },
                        { session }
                    );
                }
                throw new Error("Cannot collect payment for a cancelled ride");
            }

            const { user, driver, pricing } = foundRide;
            
            // Get rider with session
            const foundRider = await RiderModel.findById(driver?._id).session(session);

            // Validate amount
            const totalFare = pricing?.total_fare || 0;
            paidAmount = parseFloat(amount);

            if (isNaN(paidAmount) || paidAmount <= 0 || paidAmount > totalFare) {
                throw new Error(`Invalid payment amount. Expected ≤ ₹${totalFare}`);
            }

            // Prepare all updates as atomic operations
            const updates = [];

            // ---------------- CASHBACK DEDUCTION ----------------
            if (foundRide?.pricing?.discount > 0 && user) {
                discountUsed = foundRide.pricing.discount;
                const newCashback = Math.max(0, (user.cashback || 0) - discountUsed);
                
                const cashbackHistoryEntry = {
                    rideId: foundRide._id,
                    amount: discountUsed,
                    date: new Date(),
                };

                updates.push({
                    model: User,
                    filter: { _id: user._id },
                    update: {
                        $set: { cashback: newCashback },
                        $push: { cashbackHistory: cashbackHistoryEntry }
                    }
                });

                console.log(`[Cashback Deduction] User ${user._id} used ₹${discountUsed}. Remaining: ₹${newCashback}`);
            }

            // ---------------- WALLET UPDATE ----------------
            if (foundRider && discountUsed > 0) {
                const walletAmount = Number(foundRider.Wallet) || 0;
                const discountAmount = Number(discountUsed) || 0;
                const newWalletAmount = walletAmount + discountAmount;

                const walletHistoryEntry = {
                    rideId: foundRide._id,
                    amount: discountAmount,
                    date: new Date(),
                    from: user?._id
                };

                // Call external wallet API before updating database
             let walletApiSuccess = false;

try {
    console.log(`[Wallet API] Initiating request to add amount on wallet`);
    console.log(`[Wallet API] Request Payload:`, {
        BhId: foundRider?.BH,
        amount: discountAmount
    });

    const response = await axios.post('https://newweb.olyox.com/api/v1/add-amount-on-wallet', {
        BhId: foundRider?.BH,
        amount: discountAmount
    });

    console.log(`[Wallet API] Response Status: ${response.status}`);
    console.log(`[Wallet API] Response Data:`, response.data);

    if (response.data.success) {
        walletApiSuccess = true;
        console.log(`[Wallet API Success] BH: ${foundRider?.BH}, Amount: ₹${discountAmount}`);
    } else {
        console.warn(`[Wallet API Warning] API responded with success = false`);
    }

} catch (apiError) {
    console.error(`[Wallet API Error] Request failed`);
    if (apiError.response) {
        // Server responded with a non-2xx status
        console.error(`[Wallet API Error] Status: ${apiError.response.status}`);
        console.error(`[Wallet API Error] Data:`, apiError.response.data);
    } else if (apiError.request) {
        // Request was made but no response received
        console.error(`[Wallet API Error] No response received from server.`);
        console.error(`[Wallet API Error] Request:`, apiError.request);
    } else {
        // Something happened in setting up the request
        console.error(`[Wallet API Error] Message:`, apiError.message);
    }
}


                if (!walletApiSuccess) {
                    throw new Error(`Critical Error: Failed to update wallet for BH: ${foundRider?.BH}`);
                }

                updates.push({
                    model: RiderModel,
                    filter: { _id: foundRider._id },
                    update: {
                        $set: { 
                            Wallet: newWalletAmount,
                            TotalRides: (foundRider.TotalRides || 0) + 1,
                            points: (foundRider.points || 0) + Math.floor(Math.random() * 5) + 1,
                            isAvailable: true,
                            on_ride_id: null
                        },
                        $push: { WalletHistory: walletHistoryEntry }
                    }
                });
            } else if (foundRider) {
                // Update rider without wallet changes
                updates.push({
                    model: RiderModel,
                    filter: { _id: foundRider._id },
                    update: {
                        $set: {
                            TotalRides: (foundRider.TotalRides || 0) + 1,
                            points: (foundRider.points || 0) + Math.floor(Math.random() * 5) + 1,
                            isAvailable: true,
                            on_ride_id: null
                        }
                    }
                });
            }

            // ---------------- FIRST RIDE BONUS ----------------
            if (user && user.firstRideCompleted === false && user.isFirstRideBonusRecived === false) {
                try {
                    if (totalFare > 100) {
                        bonusAmount = Math.floor(Math.random() * (30 - 10 + 1)) + 10;
                        userGetCashback = true;
                        cashbackGet = bonusAmount;
                        
                        console.log(`[First Ride Bonus] Giving ₹${bonusAmount} to user ${user._id}`);

                        const currentUserUpdate = updates.find(u => 
                            u.model === User && u.filter._id.toString() === user._id.toString()
                        );

                        if (currentUserUpdate) {
                            // Merge with existing user update
                            currentUserUpdate.update.$set.cashback = 
                                (currentUserUpdate.update.$set.cashback || user.cashback || 0) + bonusAmount;
                            currentUserUpdate.update.$set.firstRideCompleted = true;
                            currentUserUpdate.update.$set.isFirstRideBonusRecived = true;
                            currentUserUpdate.update.$set.currentRide = null;
                        } else {
                            updates.push({
                                model: User,
                                filter: { _id: user._id },
                                update: {
                                    $set: {
                                        cashback: (user.cashback || 0) + bonusAmount,
                                        firstRideCompleted: true,
                                        isFirstRideBonusRecived: true,
                                        currentRide: null
                                    }
                                }
                            });
                        }

                        // ---------------- REFERRAL BONUS ----------------
                        if (user.appliedReferralCode && bonusAmount > 0) {
                            const referrer = await User.findOne({ 
                                referralCode: user.appliedReferralCode 
                            }).session(session);

                            if (referrer) {
                                const referralHistoryEntry = {
                                    rideId,
                                    amount: bonusAmount,
                                    date: new Date(),
                                };

                                updates.push({
                                    model: User,
                                    filter: { _id: referrer._id },
                                    update: {
                                        $set: { cashback: (referrer.cashback || 0) + bonusAmount },
                                        $push: { cashbackHistory: referralHistoryEntry }
                                    }
                                });

                                console.log(`[Referral Bonus] Referrer ${referrer._id} also got ₹${bonusAmount}`);
                            } else {
                                console.log(`[Referral Bonus] Invalid code: ${user.appliedReferralCode}`);
                            }
                        }
                    } else {
                        console.log(`[First Ride Bonus] Skipped. Fare ₹${totalFare} ≤ 100.`);
                        
                        // Still need to update user status
                        const currentUserUpdate = updates.find(u => 
                            u.model === User && u.filter._id.toString() === user._id.toString()
                        );

                        if (currentUserUpdate) {
                            currentUserUpdate.update.$set.firstRideCompleted = true;
                            currentUserUpdate.update.$set.isFirstRideBonusRecived = true;
                            currentUserUpdate.update.$set.currentRide = null;
                        } else {
                            updates.push({
                                model: User,
                                filter: { _id: user._id },
                                update: {
                                    $set: {
                                        firstRideCompleted: true,
                                        isFirstRideBonusRecived: true,
                                        currentRide: null
                                    }
                                }
                            });
                        }
                    }
                } catch (bonusErr) {
                    console.error("⚠️ First Ride Bonus Error:", bonusErr.message);
                }
            } else if (user) {
                // Clear current ride for existing users
                const currentUserUpdate = updates.find(u => 
                    u.model === User && u.filter._id.toString() === user._id.toString()
                );

                if (currentUserUpdate) {
                    currentUserUpdate.update.$set.currentRide = null;
                } else {
                    updates.push({
                        model: User,
                        filter: { _id: user._id },
                        update: { $set: { currentRide: null } }
                    });
                }
            }

            // ---------------- UPDATE RIDE ----------------
            updates.push({
                model: RideBooking,
                filter: { _id: foundRide._id },
                update: {
                    $set: {
                        payment_method: mode,
                        payment_status: 'completed',
                        ride_status: 'completed',
                        ride_ended_at: new Date(),
                        'pricing.collected_amount': paidAmount,
                        cashback: userGetCashback ? cashbackGet : 0,
                        isCashbackGet: userGetCashback
                    }
                }
            });

            // Execute all updates atomically
            for (const update of updates) {
                await update.model.updateOne(
                    update.filter,
                    update.update,
                    { session, upsert: false }
                );
            }

            await session.commitTransaction();
            console.log(`[Transaction Success] Payment collected for ride: ${rideId}, Amount: ₹${paidAmount}`);

            return {
                success: true,
                message: "✅ Payment collected successfully. Ride completed.",
                rideId,
                amount: paidAmount,
                method: mode,
                cashback: cashbackGet,
                isCashbackGet: userGetCashback,
                rideStatus: 'completed',
                paymentStatus: 'completed'
            };

        } catch (error) {
            if (session.inTransaction()) {
                await session.abortTransaction();
                console.log("[Transaction Rollback] Transaction aborted");
            }

            // Check if it's a transient transaction error that can be retried
            const isRetriableError = 
                error.code === 112 || // WriteConflict
                error.code === 11000 || // DuplicateKey
                (error.errorLabels && error.errorLabels.includes('TransientTransactionError'));

            if (isRetriableError && attempt < MAX_RETRIES) {
                console.log(`[Retry ${attempt}/${MAX_RETRIES}] Retrying transaction due to: ${error.message}`);
                await delay(RETRY_DELAY * attempt); // Exponential backoff
                throw new RetryableError(error.message);
            }

            throw error;

        } finally {
            session.endSession();
        }
    };

    // Main function execution with retry logic
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            const result = await executePaymentTransaction(attempt);
            return res.status(200).json(result);
        } catch (error) {
            if (error instanceof RetryableError && attempt < MAX_RETRIES) {
                continue; // Retry the transaction
            }

            console.error("❌ Payment Collection Error:", error);
            return res.status(500).json({
                success: false,
                message: "Payment collection failed",
                error: error.message,
            });
        }
    }
};

// Custom error class for retriable errors
class RetryableError extends Error {
    constructor(message) {
        super(message);
        this.name = 'RetryableError';
    }
}


exports.cancelRideByPoll = async (req, res) => {
    const session = await mongoose.startSession();

    try {
        const { ride, cancelBy, reason_id, reason } = req.body;
        console.log("📥 Cancel Ride Request Body:", req.body);

        if (!ride || !cancelBy) {
            return res.status(400).json({
                success: false,
                message: "Ride ID and cancelBy are required.",
            });
        }

        await session.withTransaction(async () => {
            const rideData = await RideBooking.findById(ride)
                .populate('driver user')
                .session(session);

            if (!rideData) {
                throw new Error("Ride not found");
            }

            if (rideData.ride_status === "cancelled" || rideData.ride_status === "completed") {
                throw new Error(`Ride is already ${rideData.ride_status}`);
            }

            console.log("🚨 Cancelling ride...");
            rideData.ride_status = "cancelled";
            rideData.payment_status = "cancelled";
            rideData.cancelled_by = cancelBy;
            rideData.cancelled_at = new Date();
            rideData.cancellation_reason = reason || null;

            if (rideData?.driver) {
                const driver = await RiderModel.findById(rideData.driver._id).session(session);
                driver.on_ride_id = null;
                driver.isAvailable = true;
                await driver.save({ session });

                if (cancelBy === 'user' && driver?.fcmToken) {
                    await sendNotification.sendNotification(
                        driver.fcmToken,
                        "Ride Cancelled by User",
                        "The user has cancelled the ride request.",
                        {
                            event: 'RIDE_CANCELLED',
                            rideId: rideData._id,
                            message: 'The user has cancelled the ride request.',
                            screen: 'DriverHome',
                        },
                        "ride_cancel_channel"
                    );
                }
            }

            if (rideData?.user) {
                rideData.user.currentRide = null;
                await rideData.user.save({ session });
            }

            await rideData.save({ session });

            if (cancelBy === 'driver' && rideData?.user?.fcmToken) {
                await sendNotification.sendNotification(
                    rideData.user.fcmToken,
                    "Ride Cancelled by Driver",
                    "The driver has cancelled your ride.",
                    {
                        event: 'RIDE_CANCELLED',
                        rideId: rideData._id,
                        message: 'The driver has cancelled your ride.',
                        screen: 'RideHistory',
                    }
                );
            }
        });

        return res.status(200).json({
            success: true,
            message: "Ride has been cancelled successfully.",
        });

    } catch (error) {
        console.error("❌ Error cancelling ride:", error.message || error);
        return res.status(500).json({
            success: false,
            message: error.message || "Internal server error.",
        });
    } finally {
        await session.endSession();
    }
};


exports.RateYourRider = async (req, res) => {
  try {
    const { rideId } = req.params;
    const { rating, feedback } = req.body;

    if (!rideId || !rating) {
      return res.status(400).json({ message: "Ride ID and rating are required." });
    }

    const rideData = await RideBooking.findById(rideId)
      .populate("user")
      .populate("driver");

    if (!rideData) {
      return res.status(404).json({ message: "Ride not found." });
    }

    if (rideData.ride_status !== "completed") {
      return res.status(400).json({ message: "Ride has not been completed." });
    }

    // Save rating in ride document
    rideData.driver_rating = {
      rating,
      feedback: feedback || "",
      created_at: new Date(),
    };
    await rideData.save();

    // --- Update Driver Average Rating ---
    const driver = rideData.driver;
    if (!driver) {
      return res.status(404).json({ message: "Driver not found." });
    }

    // ensure fields exist
    if (!driver.TotalRatingsCount) driver.TotalRatingsCount = 0;
    if (!driver.Ratings) driver.Ratings = 0;

    let newAverage;
    if (driver.TotalRatingsCount === 0 || driver.Ratings === 0) {
      // first rating — just set directly
      newAverage = rating;
    } else {
      // weighted average formula
      newAverage = ((driver.Ratings * driver.TotalRatingsCount) + rating) / (driver.TotalRatingsCount + 1);
    }

    driver.Ratings = Math.max(1, Math.min(5, newAverage)); // clamp between 1–5
    driver.TotalRatingsCount = driver.TotalRatingsCount + 1;

    await driver.save();

    return res.status(200).json({
      success: true,
      message: "Rating submitted successfully.",
      rideRating: rideData.driver_rating,
      driverAverageRating: driver.Ratings.toFixed(2),
      totalRatings: driver.TotalRatingsCount,
    });
  } catch (error) {
    console.error("❌ Error rating rider:", error);
    return res.status(500).json({ message: "Internal Server Error." });
  }
};



exports.FindRiderNearByUser = async (req, res) => {
    try {
        const { lat, lng, vehicleType } = req.body;

        if (!lat || !lng || !vehicleType) {
            return res.status(400).json({ success: false, message: 'lat, lng, and vehicleType are required.' });
        }

        const riders = await RiderModel.aggregate([
            {
                $geoNear: {
                    near: {
                        type: "Point",
                        coordinates: [lng, lat], // ⚠️ Correct order: [longitude, latitude]
                    },
                    distanceField: "distance",
                    maxDistance: 5000,
                    spherical: true,
                },
            },
            {
                $match: {
                    isAvailable: true,
                    "rideVehicleInfo.vehicleType": vehicleType,
                    $or: [
                        { on_ride_id: null },
                        { on_ride_id: "" }
                    ],
                },
            },
            {
                $project: {
                    name: 1,
                    phoneNumber: 1,
                    profileImage: 1,
                    rating: 1,
                    fcmToken: 1,
                    location: 1,
                    "rideVehicleInfo.vehicleName": 1,
                    "rideVehicleInfo.vehicleImage": 1,
                    "rideVehicleInfo.VehicleNumber": 1,
                    "rideVehicleInfo.PricePerKm": 1,
                    "rideVehicleInfo.vehicleType": 1,
                    "RechargeData.expireData": 1,
                    on_ride_id: 1,
                    location: 1,
                    distance: 1,
                    isAvailable: 1,
                    lastActiveAt: 1
                },
            },
            {
                $sort: { distance: 1 }
            }
        ]);

        console.info(`Found ${riders.length} riders within 5km.`);

        const currentDate = new Date();

        const validRiders = riders.filter((rider) => {
            const expireDate = rider?.RechargeData?.expireData;
            const hasValidRecharge = expireDate && new Date(expireDate) >= currentDate;

            if (!hasValidRecharge) {
                console.debug(`Rider ${rider._id} skipped due to expired recharge (${expireDate})`);
            }

            return hasValidRecharge;
        });

        console.info(`Found ${validRiders.length} validRiders riders within 5km.`);


        return res.status(200).json({
            success: true,
            count: validRiders.length,
            data: validRiders,
        });

    } catch (error) {
        console.error("Error finding nearby riders:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while finding nearby riders.",
            error: error.message
        });
    }
};



cron.schedule('*/10 * * * * *', async () => {
    try {
        console.log('🕒 Running scheduled ride cleanup job...');

        const currentTime = new Date();
        const oneMinuteAgo = new Date(currentTime.getTime() - 1 * 60 * 1000);

        // Find rides still pending or searching and older than 1 minute
        const allRides = await RideBooking.find({
            ride_status: { $in: ['pending', 'searching'] },
            requested_at: { $lte: oneMinuteAgo },  // ✅ Fixed field name
        }).populate('user').populate('driver');

        if (allRides.length === 0) {
            console.log('✅ No rides to cancel. All clean.');
            return;
        }

        console.log(`🔍 Found ${allRides.length} outdated rides. Cleaning up...`);

        for (const ride of allRides) {
            console.log(`⛔ Cancelling ride ${ride._id} requested at ${ride.requested_at}`);

            ride.ride_status = 'cancelled';
            ride.cancelled_at = new Date();
            ride.cancellation_reason = 'Auto-cancelled due to inactivity';
            ride.cancelled_by = 'system';

            if (ride.user) {
                ride.user.currentRide = null;
                await ride.user.save();
                console.log(`👤 Cleared currentRide for user ${ride.user._id}`);
            }

            await ride.save();
            console.log(`✅ Ride ${ride._id} cancelled successfully`);
        }

        console.log('🎯 Ride cleanup job completed.');
    } catch (error) {
        console.error('❌ Error in ride cleanup cron job:', error.message);
    }
});
