const RideBooking = require("./NewRideModel.model");
const axios = require("axios");
const User = require("../../models/normal_user/User.model");
const RiderModel = require("../../models/Rider.model");
const mongoose = require("mongoose");
const SendWhatsAppMessageNormal = require("../../utils/normalWhatsapp");
const sendNotification = require("../../utils/sendNotification");
const cron = require("node-cron");
const SettingsModel = require("../../models/Admin/Settings");
const jwt = require("jsonwebtoken");
const IntercityRide = require("../../models/v3 models/IntercityRides");
const {
  scheduleIntercityRideNotifications,
} = require("../../queues/DriverShutOffline");
const { startSearch } = require("../../queues/ParcelRidesFetchRiders");

// ============================================================================
// CONFIGURATION
// ============================================================================

const NOTIFICATION_CONFIG = {
  MAX_RETRIES: 5,
  RETRY_DELAY_MS: 10000,
  INITIAL_RADIUS: 1500,
  RADIUS_INCREMENT: 500,
  MAX_NOTIFICATIONS_PER_DRIVER: 3, // Changed from 3-4 to exactly 3
  MIN_NOTIFICATION_GAP_MS: 10000, // 10 seconds between notifications to same driver
  BACKGROUND_DURATION_MS: 60000, // 60 seconds total
  BACKGROUND_INTERVAL_MS: 15000, // Check every 15 seconds
  BATCH_SIZE: 25,
  BATCH_DELAY_MS: 200,
  FCM_DELAY_MS: 100,
};

const CANCELLABLE_STATUSES = ["pending", "searching"];
const ACTIVE_STATUSES = [
  "driver_assigned",
  "driver_arrived",
  "in_progress",
  "completed",
];

// ============================================================================
// GLOBAL TRACKING
// ============================================================================

const activeNotificationLoops = new Map();
const driverNotificationTracking = new Map();
const processingLocks = new Map();
const driverLastNotificationTime = new Map();

exports.NewcreateRequest = async (req, res) => {
  const logPrefix = "🚖 [NEW RIDE/PARCEL]";
  // Get io instance from your app
  const io = req.app.get("io");
  try {
    // ---------------------------
    // 1️⃣ Extract user and body
    // ---------------------------
    const user = Array.isArray(req.user?.user)
      ? req.user.user[0]
      : req.user?.user;

    const {
      vehicleType: rawVehicleType,
      pickupLocation,
      dropLocation,
      currentLocation,
      pick_desc,
      drop_desc,
      fare,
      fcmToken,
      paymentMethod = "cash",
      platform = "android",
      scheduledAt = null,
      pickupAddress = {},
      dropAddress = {},
      isFake = false,
      completeFare,
      fakeRiderName = null,
      fakeRiderPhone = null,
      isIntercity = false,
      isRental = false,
      rentalHours,
      estimatedKm,
      searchAreaLimit,

      // Parcel-specific
      isParcel = false,
      receiverDetails,
      baseFare,
      payableAmount,
      distance: clientDistance,
      vehicleInfo,
      isPooling = false,
    } = req.body;

    console.info(`${logPrefix} Booking request received`, {
      completeFare,
      fare,
    });

    // ---------------------------
    // 2️⃣ Normalize vehicleType (String only)
    // ---------------------------
    let vehicleType;

    if (isParcel) {
      if (!vehicleInfo?.title?.trim()) {
        return res.status(400).json({
          success: false,
          message: "vehicleInfo.title is required for parcel booking",
        });
      }
      vehicleType = vehicleInfo.title.trim(); // e.g., "Bike"
    } else {
      if (typeof rawVehicleType !== "string" || !rawVehicleType.trim()) {
        return res.status(400).json({
          success: false,
          message: "vehicleType string is required for ride booking",
        });
      }
      vehicleType = rawVehicleType.trim(); // e.g., "car", "bike"
    }

    // Normalize to lowercase for DB consistency
    const normalizedVehicleType = vehicleType.toLowerCase();

    // ---------------------------
    // 3️⃣ Validation (shared)
    // ---------------------------
    const requiredFields = {
      pickupLocation,
      dropLocation,
      currentLocation,
      pick_desc,
      drop_desc,
    };

    for (const [key, val] of Object.entries(requiredFields)) {
      if (!val) {
        console.warn(`${logPrefix} Missing required field: ${key}`);
        return res.status(400).json({
          success: false,
          message: "Required fields missing",
          required: Object.keys(requiredFields),
        });
      }
    }

    // Parcel-specific validation
    let receiverDetailsForDB = null;
    if (isParcel) {
      const { name, phone, apartment, savedAs, alternate_contact } =
        receiverDetails || {};

      if (!name?.trim()) {
        return res.status(400).json({
          success: false,
          message: "Receiver name is required for parcel",
        });
      }
      if (!phone?.trim() || !/^[0-9]{10,15}$/.test(phone)) {
        return res.status(400).json({
          success: false,
          message: "Receiver contact number must be 10-15 digits",
        });
      }
      if (alternate_contact && !/^[0-9]{10,15}$/.test(alternate_contact)) {
        return res.status(400).json({
          success: false,
          message: "Alternate contact number must be 10-15 digits",
        });
      }
      if (payableAmount === undefined || payableAmount < 0) {
        return res.status(400).json({
          success: false,
          message: "payableAmount is required for parcel",
        });
      }

      receiverDetailsForDB = {
        name: name.trim(),
        contact_number: phone.trim(),
        alternate_contact: alternate_contact?.trim() || undefined,
        appartment: apartment?.trim() || undefined,
        savedAs: savedAs?.trim() || undefined,
        pickup_photo: { url: null },
        delivery_photo: { url: null },
      };
    }

    // Fake ride validation
    if (isFake && (!fakeRiderName?.trim() || !fakeRiderPhone?.trim())) {
      return res.status(400).json({
        success: false,
        message: "Fake rider name and phone are required",
      });
    }

    if (!isFake && !user) {
      return res.status(401).json({
        success: false,
        message: "Please log in to book",
      });
    }

    // ---------------------------
    // 4️⃣ Validate coordinates
    // ---------------------------
    const validateCoords = (coords, field) => {
      if (!coords?.latitude || !coords?.longitude)
        throw new Error(`${field} coordinates missing`);
      if (
        coords.latitude < -90 ||
        coords.latitude > 90 ||
        coords.longitude < -180 ||
        coords.longitude > 180
      )
        throw new Error(`${field} coordinates invalid`);
    };
    validateCoords(pickupLocation, "pickup");
    validateCoords(dropLocation, "drop");
    validateCoords(currentLocation, "current");

    // ---------------------------
    // 5️⃣ Scheduled time
    // ---------------------------
    if (scheduledAt) {
      const schedule = new Date(scheduledAt);
      if (isNaN(schedule.getTime()) || schedule <= new Date()) {
        return res.status(400).json({
          success: false,
          message: "Invalid scheduled time",
        });
      }
    }

    // ---------------------------
    // 6️⃣ Handle real user
    // ---------------------------
    let findUser = null;
    let userFcmToken = fcmToken || null;
    if (!isFake) {
      findUser = await User.findById(user).populate("currentRide");
      if (!findUser) {
        return res.status(404).json({
          success: false,
          message: "User not found",
        });
      }
      if (fcmToken && findUser.fcmToken !== fcmToken) {
        findUser.fcmToken = fcmToken;
        findUser
          .save()
          .catch((err) =>
            console.error(`${logPrefix} FCM update failed`, err.message)
          );
      }
      userFcmToken = findUser.fcmToken;
    }

    // ---------------------------
    // 7️⃣ Geo Points
    // ---------------------------
    const pickupLocationGeo = {
      type: "Point",
      coordinates: [pickupLocation.longitude, pickupLocation.latitude],
    };
    const dropLocationGeo = {
      type: "Point",
      coordinates: [dropLocation.longitude, dropLocation.latitude],
    };

    // ---------------------------
    // 8️⃣ Route info
    // ---------------------------
    let routeInfo = {};
    try {
      console.info(`${logPrefix} Calling Google Directions API`);
      const routeData = await getRouteFromAPI(pickupLocation, dropLocation);
      if (routeData) {
        routeInfo = {
          distance: routeData.distance,
          duration: routeData.duration,
          polyline: routeData.polyline || null,
          waypoints: routeData.waypoints || [],
        };
      } else {
        throw new Error("No route");
      }
    } catch (err) {
      console.warn(`${logPrefix} Route API failed, using straight-line`);
      const straightLineDistance = calculateStraightLineDistance(
        pickupLocation.latitude,
        pickupLocation.longitude,
        dropLocation.latitude,
        dropLocation.longitude
      );
      routeInfo = {
        distance: straightLineDistance,
        duration: Math.round(straightLineDistance * 3),
        polyline: null,
        waypoints: [],
      };
    }

    // Override with client distance if provided (common in parcel)
    if (isParcel && clientDistance) {
      routeInfo.distance = parseFloat(clientDistance);
      routeInfo.duration = Math.round(routeInfo.distance * 3);
    }

    // ---------------------------
    // 9️⃣ Pricing Logic
    // ---------------------------
    let pricingData = {};

    if (isParcel) {
      pricingData = {
        base_fare: baseFare || 0,
        distance_fare: 0,
        time_fare: 0,
        platform_fee: 0,
        night_charge: 0,
        rain_charge: 0,
        toll_charge: 0,
        discount: 0,
        total_fare: payableAmount,
        original_fare: payableAmount,
        currency: "INR",
        payable_amount: payableAmount,
      };
    } else if (fare?.total_fare) {
      pricingData = {
        base_fare: completeFare?.baseFare || 0,
        distance_fare: completeFare?.distanceCost || 0,
        time_fare: completeFare?.timeCost,
        night_charge: completeFare?.nightSurcharge || 0,
        rain_charge: 0,
        toll_charge: completeFare?.tollCharges || 0,
        platform_fee: fare.platform_fee || 0,
        rain_charge: fare.rain_charge || 0,
        discount: fare.cashback_applied || 0,
        total_fare: isRental ? fare?.original_price : fare?.original_price,
        original_fare: fare.original_fare || fare?.original_price,
        currency: fare.currency || "INR",
      };
    } else {
      pricingData = calculateBasePricing(
        normalizedVehicleType,
        routeInfo.distance || 0
      );
    }

    // ---------------------------
    // 🔟 Addresses
    // ---------------------------
    const pickupAddressObj = { formatted_address: pick_desc, ...pickupAddress };
    const dropAddressObj = { formatted_address: drop_desc, ...dropAddress };

    // ---------------------------
    // 1️⃣1️⃣ Build Ride/Parcel Request Data
    // ---------------------------
    const rideRequestData = {
      pickup_location: pickupLocationGeo,
      pickup_address: pickupAddressObj,
      drop_location: dropLocationGeo,
      drop_address: dropAddressObj,
      route_info: routeInfo,
      user_fcm_token: userFcmToken,
      vehicle_type: normalizedVehicleType,
      ride_status: isParcel ? "searching" : "pending",
      requested_at: new Date(),
      scheduled_at: scheduledAt ? new Date(scheduledAt) : null,
      pricing: pricingData,
      payment_method: paymentMethod.toLowerCase(),
      payment_status:
        paymentMethod.toLowerCase() === "cod" ? "pending" : "pending",
      search_radius: 5,
      max_search_radius: 25,
      auto_increase_radius: true,
      retry_count: 0,
      rejected_by_drivers: [],
      isFake,
      isParcelOrder: !!isParcel,
      is_rental: isRental || false,
      isIntercity: isIntercity || false,
      rentalHours: isRental ? rentalHours || 1 : 0,
      rental_km_limit: isRental ? estimatedKm || 10 : 0,
      isPooling: isPooling || false,
    };

    // Conditional fields
    if (isParcel) {
      rideRequestData.details = { reciver_details: receiverDetailsForDB };
      rideRequestData.vehicle_info = vehicleInfo || null;
    }

    if (isFake) {
      rideRequestData.user = null;
      rideRequestData.fake_rider_details = {
        name: fakeRiderName.trim(),
        phone: fakeRiderPhone.trim(),
      };
    } else {
      rideRequestData.user = user;
      rideRequestData.fake_rider_details = null;
    }

    // ---------------------------
    // 1️⃣2️⃣ Save Booking
    // ---------------------------
    const newRideRequest = new RideBooking(rideRequestData);
    await newRideRequest.save();

    if (!isFake && findUser) {
      findUser.currentRide = newRideRequest._id;
      findUser
        .save()
        .catch((err) =>
          console.error(`${logPrefix} Failed to update user ride`, err.message)
        );
    }

    if (isParcel) {
      await startSearch(newRideRequest._id, io);
    } else {
      // Async: cancellation & driver search
      setImmediate(() =>
        scheduleRideCancellationCheck(getRedisClient(req), newRideRequest._id)
      );
      setImmediate(() =>
        initiateDriverSearch(
          newRideRequest._id,
          searchAreaLimit,
          req,
          res
        ).catch(console.error)
      );
    }

    // ---------------------------
    // 1️⃣3️⃣ Response
    // ---------------------------
    const responseData = {
      rideId: newRideRequest._id,
      ride_status: newRideRequest.ride_status,
      vehicle_type: newRideRequest.vehicle_type,
      pricing: newRideRequest.pricing,
      payment_method: newRideRequest.payment_method,
      payment_status: newRideRequest.payment_status,
      route_info: newRideRequest.route_info,
      requested_at: newRideRequest.requested_at,
      scheduled_at: newRideRequest.scheduled_at,
      search_radius: newRideRequest.search_radius,
      auto_increase_radius: newRideRequest.auto_increase_radius,
      retry_count: newRideRequest.retry_count,
      is_fake: newRideRequest.isFake,
      isParcelOrder: newRideRequest.isParcel,
      ...(isParcel && {
        receiver_details: newRideRequest.details?.reciver_details,
        vehicle_info: newRideRequest.vehicle_info,
      }),
      ...(isFake && { fake_rider_details: newRideRequest.fake_rider_details }),
    };

    console.info(
      `${logPrefix} ${isParcel ? "Parcel" : "Ride"} created`,
      newRideRequest._id
    );

    return res.status(201).json({
      success: true,
      message: isParcel
        ? "Parcel order created! Finding a delivery partner..."
        : isFake
        ? "Test ride created! Finding a driver..."
        : "Your ride request is created! Searching for drivers...",
      data: responseData,
    });
  } catch (error) {
    console.error("Booking creation error:", error);
    return res.status(201).json({
      success: true,
      message: "Your request is being processed! You will be updated shortly.",
      data: null,
    });
  }
};

const canCancelRide = async (rideId) => {
  try {
    const ride = await RideBooking.findById(rideId)
      .select("ride_status driver")
      .lean();

    if (!ride) {
      return { canCancel: false, reason: "Ride not found" };
    }

    if (ride.driver) {
      return { canCancel: false, reason: "Driver already assigned" };
    }

    if (!CANCELLABLE_STATUSES.includes(ride.ride_status)) {
      return {
        canCancel: false,
        reason: `Ride is ${ride.ride_status}, cannot cancel`,
      };
    }

    return { canCancel: true, reason: null };
  } catch (error) {
    console.error(
      `Error checking cancellation status for ride ${rideId}:`,
      error.message
    );
    return { canCancel: false, reason: "Error checking ride status" };
  }
};

const canSendNotificationToDriver = (driverId, rideId) => {
  const driverIdStr = driverId.toString();
  const rideIdStr = rideId.toString();

  // Check notification count limit
  const notificationCount = getDriverNotificationCount(driverIdStr, rideIdStr);
  if (notificationCount >= 3) {
    console.log(
      `❌ Driver ${driverIdStr} reached max notifications (3) for ride ${rideIdStr}`
    );
    return false;
  }

  // Check time gap (10 seconds)
  if (!driverLastNotificationTime.has(driverIdStr)) {
    return true;
  }

  const rideTimestamps = driverLastNotificationTime.get(driverIdStr);
  const lastNotificationTime = rideTimestamps.get(rideIdStr);

  if (!lastNotificationTime) {
    return true;
  }

  const timeSinceLastNotification = Date.now() - lastNotificationTime;
  const minGapMs = 10000; // 10 seconds

  if (timeSinceLastNotification < minGapMs) {
    const remainingTime = Math.ceil(
      (minGapMs - timeSinceLastNotification) / 1000
    );
    console.log(
      `⏳ Driver ${driverIdStr} needs to wait ${remainingTime}s before next notification`
    );
    return false;
  }

  return true;
};
const recordNotificationSent = (driverId, rideId) => {
  const driverIdStr = driverId.toString();
  const rideIdStr = rideId.toString();

  if (!driverLastNotificationTime.has(driverIdStr)) {
    driverLastNotificationTime.set(driverIdStr, new Map());
  }

  const rideTimestamps = driverLastNotificationTime.get(driverIdStr);
  rideTimestamps.set(rideIdStr, Date.now());

  console.log(
    `✅ Notification recorded for driver ${driverIdStr} at ${new Date().toISOString()}`
  );
};

const getDriverNotificationCount = (driverId, rideId) => {
  const driverMap = driverNotificationTracking.get(driverId);
  if (!driverMap) return 0;
  return driverMap.get(rideId) || 0;
};
const clearRideNotificationTracking = (rideId) => {
  const rideIdStr = rideId.toString();

  // Clear notification counts
  clearDriverNotifications(rideIdStr);

  // Clear last notification times
  driverLastNotificationTime.forEach((rideTimestamps, driverId) => {
    rideTimestamps.delete(rideIdStr);
    if (rideTimestamps.size === 0) {
      driverLastNotificationTime.delete(driverId);
    }
  });

  console.log(`🧹 Cleared all notification tracking for ride ${rideIdStr}`);
};

const isRideActiveAndSearching = async (rideId) => {
  try {
    const ride = await RideBooking.findById(rideId)
      .select("ride_status driver")
      .lean();

    return ride && ride.ride_status === "searching" && !ride.driver;
  } catch (error) {
    console.error(`Error checking ride status ${rideId}:`, error.message);
    return false;
  }
};

const getRedisClient = (req) => {
  try {
    const redisClient = req.app.get("pubClient");
    if (!redisClient || typeof redisClient.set !== "function") {
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
      return false;
    }

    const rideKey = `ride:${rideId}`;
    await redisClient.set(rideKey, JSON.stringify(rideData), "EX", 3600);
    return true;
  } catch (error) {
    console.error(`Failed to save ride ${rideId} to Redis:`, error.message);
    return false;
  }
};

const clearRideFromRedis = async (redisClient, rideId) => {
  try {
    if (!redisClient) return false;

    await redisClient.del(`ride:${rideId}`);
    await redisClient.del(`riders:${rideId}`);
    return true;
  } catch (error) {
    console.error(`Failed to clear ride ${rideId} from Redis:`, error.message);
    return false;
  }
};
//add this

const cancelRide = async (
  redisClient,
  rideId,
  reason,
  cancelledBy = "system"
) => {
  try {
    // Fetch ride first to validate later pickup time
    const ride = await RideBooking.findById(rideId);

    if (!ride) {
      return { success: false, reason: "Ride not found" };
    }

    // ⛔ RULE: Do NOT cancel if ride isLater and pickup time is in the future
    if (ride.isLater && ride.IntercityPickupTime) {
      const pickupTime = new Date(ride.IntercityPickupTime);
      const now = new Date();

      if (now < pickupTime) {
        console.info(
          `Skipping cancellation for ride ${rideId}: Future pickup at ${pickupTime}`
        );

        return {
          success: false,
          reason: "Ride pickup time is in future, cannot cancel now",
        };
      }
    }

    // Continue normal cancellation process
    const { canCancel, reason: checkReason } = await canCancelRide(rideId);

    if (!canCancel) {
      console.info(`Skipping cancellation for ride ${rideId}: ${checkReason}`);
      return { success: false, reason: checkReason };
    }

    // Proceed with cancellation
    const updatedRide = await RideBooking.findByIdAndUpdate(
      rideId,
      {
        $set: {
          ride_status: "cancelled",
          cancellation_reason: reason,
          cancelled_at: new Date(),
          cancelledBy,
        },
      },
      { new: true }
    ).populate("user");

    if (!updatedRide) {
      return { success: false, reason: "Ride not found during update" };
    }

    // Clear user's current ride
    if (updatedRide.user) {
      await User.findByIdAndUpdate(updatedRide.user._id, {
        $set: { currentRide: null },
      });

      // Notify user
      if (updatedRide.user.fcmToken) {
        await sendNotification.sendNotification(
          updatedRide.user.fcmToken,
          "Ride Cancelled",
          reason,
          {
            event: "RIDE_CANCELLED",
            rideId: rideId,
            message: reason,
            screen: "RideHistory",
          }
        );
      }
    }

    // Clear from Redis
    await clearRideFromRedis(redisClient, rideId);

    // Stop background notifications
    stopBackgroundNotifications(rideId);

    console.info(`Ride ${rideId} cancelled successfully: ${reason}`);
    return { success: true, ride: updatedRide };
  } catch (error) {
    console.error(`Error cancelling ride ${rideId}:`, error.message);
    return { success: false, reason: error.message };
  }
};

const scheduleRideCancellationCheck = async (redisClient, rideId) => {
  const CANCELLATION_TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes

  setTimeout(async () => {
    try {
      const isActive = await isRideActiveAndSearching(rideId);

      if (!isActive) {
        console.info(`Ride ${rideId} no longer needs cancellation check`);
        return;
      }

      await cancelRide(
        redisClient,
        rideId,
        "No driver found within time limit",
        "system"
      );
    } catch (error) {
      console.error(
        `Error in cancellation check for ride ${rideId}:`,
        error.message
      );
    }
  }, CANCELLATION_TIMEOUT_MS);
};

const getRouteFromAPI = async (pickup, drop) => {
  try {
    const apiKey =
      process.env.GOOGLE_MAPS_API_KEY ||
      "AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8";

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
        distance: Math.round(leg.distance.value / 1000),
        duration: Math.round(leg.duration.value / 60),
        polyline: route.overview_polyline?.points || null,
        waypoints: [],
      };
    }

    console.warn(`Route API returned status: ${response.data.status}`);
    return null;
  } catch (error) {
    console.warn(`Route API error: ${error.message}`);
    return null;
  }
};

const calculateStraightLineDistance = (lat1, lng1, lat2, lng2) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 100) / 100;
};

const calculateBasePricing = (vehicleType, distance) => {
  const pricingConfig = {
    auto: { baseFare: 30, perKm: 12, perMin: 2 },
    bike: { baseFare: 20, perKm: 8, perMin: 1.5 },
    car: { baseFare: 50, perKm: 15, perMin: 3 },
    suv: { baseFare: 80, perKm: 20, perMin: 4 },
  };

  const config = pricingConfig[vehicleType] || pricingConfig.auto;
  const estimatedDuration = Math.round(distance * 3);

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

const normalizeVehicleType = (type) => {
  if (!type) return null;
  return type.toString().toUpperCase().trim();
};

const hasReachedNotificationLimit = (driverId, rideId) => {
  const driverMap = driverNotificationTracking.get(driverId);
  if (!driverMap) return false;

  const count = driverMap.get(rideId) || 0;
  return count >= NOTIFICATION_CONFIG.MAX_NOTIFICATIONS_PER_DRIVER;
};

const incrementNotificationCount = (driverId, rideId) => {
  if (!driverNotificationTracking.has(driverId)) {
    driverNotificationTracking.set(driverId, new Map());
  }

  const driverMap = driverNotificationTracking.get(driverId);
  const currentCount = driverMap.get(rideId) || 0;
  driverMap.set(rideId, currentCount + 1);

  return currentCount + 1;
};

const decrementNotificationCount = (driverId, rideId) => {
  const driverMap = driverNotificationTracking.get(driverId);
  if (driverMap) {
    const currentCount = driverMap.get(rideId) || 0;
    if (currentCount > 0) {
      driverMap.set(rideId, currentCount - 1);
    }
  }
};

const clearDriverNotifications = (rideId) => {
  driverNotificationTracking.forEach((driverMap) => {
    driverMap.delete(rideId);
  });
};

const generateNotificationId = (rideId) => {
  return `${rideId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

const fetchEligibleDrivers = async (rideId, rideData, searchAreaLimit) => {
  try {
    console.log("Starting fetchEligibleDrivers for ride:", rideId);
    const {
      pickup_location,
      vehicle_type,
      rejected_by_drivers = [],
      isLater = false,
      isIntercity = false,
    } = rideData;

    // ——————— VALIDATE PICKUP ———————
    if (
      !pickup_location?.coordinates ||
      pickup_location.coordinates.length !== 2
    ) {
      console.error("Invalid pickup coordinates:", pickup_location);
      throw new Error(`Invalid pickup coordinates for ride ${rideId}`);
    }

    const [longitude, latitude] = pickup_location.coordinates;
    const fiftyMinutesAgo = new Date(Date.now() - 50 * 60 * 1000);
    const currentDate = new Date();

    // ——————— REJECTED DRIVERS ———————
    const rejectedDriverIds = rejected_by_drivers
      .map((r) =>
        typeof r === "object" ? r.driver?.toString() : r?.toString()
      )
      .filter(Boolean);

    // ——————— JAIPUR-SIDE DETECTION & RADIUS LOGIC ———————
    // Jaipur approximate bounds (you can refine this)
    const JAIPUR_BOUNDS = {
      minLat: 26.75,  // South
      maxLat: 27.1,   // North
      minLng: 75.6,   // West
      maxLng: 76.0,   // East
    };

    const isJaipurSide =
      latitude >= JAIPUR_BOUNDS.minLat &&
      latitude <= JAIPUR_BOUNDS.maxLat &&
      longitude >= JAIPUR_BOUNDS.minLng &&
      longitude <= JAIPUR_BOUNDS.maxLng;

    let searchRadius;

    if (isJaipurSide) {
      searchRadius = 15000; // Fixed 15km for Jaipur side
      console.log("Pickup is on Jaipur side → Forcing search radius to 15km");
    } else {
      const searchLimit = searchAreaLimit * 1000;
      searchRadius = searchLimit || 10000; // Default 10km elsewhere
      console.log(`Non-Jaipur area → Using search radius: ${searchRadius / 1000}km`);
    }

    const MAX_RETRIES = 1; // Single search attempt
    let attempt = 0;
    let allDrivers = [];

    const isVehicleMatch = (driverVehicleRaw, rideVehicleRaw, prefsRaw) => {
      const driverVehicle = driverVehicleRaw?.trim().toUpperCase();
      const rideVehicle = rideVehicleRaw?.trim().toUpperCase();

      console.log("Comparing → Driver:", driverVehicle, "| Ride:", rideVehicle);

      if (["BIKE", "AUTO"].includes(rideVehicle)) {
        const match = driverVehicle === rideVehicle;
        console.log(`Ride is ${rideVehicle} → Exact match required → ${match}`);
        return match;
      }

      if (["BIKE", "AUTO"].includes(driverVehicle)) {
        const match = driverVehicle === rideVehicle;
        console.log(
          `Driver is ${driverVehicle} → Can only take ${driverVehicle} rides → ${match}`
        );
        return match;
      }

      const prefs = {
        OlyoxAcceptMiniRides: prefsRaw?.OlyoxAcceptMiniRides?.enabled === true,
        OlyoxAcceptSedanRides: prefsRaw?.OlyoxAcceptSedanRides?.enabled === true,
        OlyoxIntercity: prefsRaw?.OlyoxIntercity?.enabled === true,
      };

      const isLaterOrIntercity = isLater || isIntercity;

      if (driverVehicle === rideVehicle) {
        console.log("Exact match → ALLOWED");
        return true;
      }

      if (rideVehicle === "SEDAN") {
        const canTakeSedan = prefs.OlyoxAcceptSedanRides;
        const isUpgrade = ["SUV", "XL", "SUV/XL"].includes(driverVehicle);
        const allowed = isUpgrade && canTakeSedan;
        console.log(
          `SEDAN ride → Upgrade: ${isUpgrade}, AcceptSedan: ${canTakeSedan} → ${allowed}`
        );
        return allowed;
      }

      if (rideVehicle === "MINI") {
        const canTakeMini = prefs.OlyoxAcceptMiniRides;
        const isDowngrade = ["SEDAN", "SUV", "XL", "SUV/XL"].includes(driverVehicle);
        const allowed = isDowngrade && canTakeMini;
        console.log(
          `MINI ride → Downgrade: ${isDowngrade}, AcceptMini: ${canTakeMini} → ${allowed}`
        );
        return allowed;
      }

      if (rideVehicle === "SUV" || rideVehicle === "SUV/XL") {
        const canTakeMini = prefs.OlyoxIntercity;
        const isDowngrade = ["SEDAN", "SUV", "XL", "SUV/XL"].includes(driverVehicle);
        const allowed = isDowngrade && canTakeMini;
        console.log(
          `SUV ride → Downgrade: ${isDowngrade}, AcceptMini: ${canTakeMini} → ${allowed}`
        );
        return allowed;
      }

      if (isLaterOrIntercity && prefs.OlyoxIntercity) {
        console.log("Intercity/Later + OlyoxIntercity enabled → BYPASS");
        return true;
      }

      console.log("No match → REJECTED");
      return false;
    };

    // ——————— RADIUS SEARCH LOOP ———————
    while (attempt < MAX_RETRIES) {
      attempt++;
      console.log(
        `\nAttempt ${attempt} | Radius: ${(searchRadius / 1000).toFixed(1)} km`
      );

      const drivers = await RiderModel.aggregate([
        {
          $geoNear: {
            near: { type: "Point", coordinates: [longitude, latitude] },
            distanceField: "distance",
            maxDistance: searchRadius,
            spherical: true,
          },
        },
        {
          $match: {
            isAvailable: true,
            _id: { $nin: rejectedDriverIds },
            on_ride_id: null,
            "RechargeData.expireData": { $gte: currentDate },
            fcmToken: { $exists: true, $ne: null },
            lastUpdated: { $gte: fiftyMinutesAgo },
          },
        },
        {
          $project: {
            name: 1,
            phoneNumber: 1,
            fcmToken: 1,
            isAvailable: 1,
            lastUpdated: 1,
            location: 1,
            rating: 1,
            preferences: 1,
            distance: 1,
            on_ride_id: 1,
            "RechargeData.expireData": 1,
            "rideVehicleInfo.vehicleType": 1,
            "rideVehicleInfo.vehicleName": 1,
            "rideVehicleInfo.VehicleNumber": 1,
          },
        },
      ]);

      console.log(`Found ${drivers.length} drivers in range`);

      drivers.forEach((d, i) => {
        const minsAgo = (
          (Date.now() - new Date(d.lastUpdated).getTime()) /
          60000
        ).toFixed(1);
        console.log(
          `Driver ${i + 1}: ${d.name} | ${
            d.rideVehicleInfo?.vehicleType
          } | ${minsAgo} mins ago | Available: ${d.isAvailable} | on_ride: ${
            d.on_ride_id
          }`
        );
      });

      const eligibleDrivers = drivers.filter((driver) => {
        const match = isVehicleMatch(
          driver.rideVehicleInfo?.vehicleType,
          vehicle_type,
          driver.preferences
        );

        const isRecent = new Date(driver.lastUpdated) >= fiftyMinutesAgo;
        const isFree = !driver.on_ride_id && driver.isAvailable;

        let parcelAllowed = true;
        const driverCategory = driver.category?.toString().toLowerCase?.();

        if (driverCategory === "parcel") {
          const vehicleName =
            driver.rideVehicleInfo?.vehicleName?.toUpperCase?.() || "";
          const hasPriority =
            driver.preferences?.OlyoxPriority?.enabled === true;

          if (vehicleName === "BIKE") {
            parcelAllowed = hasPriority;
            console.log(
              parcelAllowed
                ? `✅ ${driver._id} (${driver.name}) [PARCEL-BIKE] → Priority enabled`
                : `❌ ${driver._id} (${driver.name}) [PARCEL-BIKE] → Priority disabled, excluded`
            );
          }
        }

        const isEligible = match && isRecent && isFree && parcelAllowed;

        if (!isEligible) {
          if (!match)
            console.log(
              `REJECTED ${driver._id} (${driver.name}) — Vehicle mismatch`
            );
          else if (!isRecent)
            console.log(
              `REJECTED ${driver._id} (${driver.name}) — Last updated >50 mins`
            );
          else if (!isFree)
            console.log(
              `REJECTED ${driver._id} (${driver.name}) — Busy or unavailable`
            );
          else if (!parcelAllowed)
            console.log(
              `REJECTED ${driver._id} (${driver.name}) — Parcel rule`
            );
        } else {
          console.log(`✅ ELIGIBLE ${driver._id} (${driver.name})`);
        }

        return isEligible;
      });

      console.log(`Eligible after filtering: ${eligibleDrivers.length}`);

      if (eligibleDrivers.length > 0) {
        allDrivers = eligibleDrivers;
        console.log(`Found ${allDrivers.length} eligible drivers — stopping`);
        break;
      }
    }

    if (allDrivers.length > 0) {
      console.log(
        "Driver IDs:",
        allDrivers.map((d) => d._id.toString())
      );
    } else {
      console.log("No eligible drivers found");
    }

    return allDrivers;
  } catch (error) {
    console.error(`Error in fetchEligibleDrivers for ride ${rideId}:`, error);
    return [];
  }
};

const sendDriverNotification = async (
  driver,
  ride,
  io,
  attempt,
  isInitial = false
) => {
  const driverId = driver._id.toString();
  const rideId = ride._id.toString();

  try {
    // Check if driver already rejected this ride
    if (
      ride.rejected_by_drivers?.some((r) => r.driver.toString() === driverId)
    ) {
      console.log(`🚫 Driver ${driverId} already rejected ride ${rideId}`);
      return { success: false, reason: "already_rejected" };
    }

    // Check if driver can receive notification (throttling + limit)
    if (!canSendNotificationToDriver(driverId, rideId)) {
      return { success: false, reason: "throttled_or_limit_reached" };
    }

    // Verify ride is still valid and searching
    const isActive = await isRideActiveAndSearching(rideId);
    if (!isActive) {
      console.log(`⚠️ Ride ${rideId} no longer active`);
      return { success: false, reason: "ride_no_longer_valid" };
    }

    // Increment count and record time BEFORE sending
    const notificationCount = incrementNotificationCount(driverId, rideId);
    recordNotificationSent(driverId, rideId);

    const notificationId = generateNotificationId(rideId);
    const distanceKm = ((driver.distance || 0) / 1000).toFixed(2);

    console.log(
      `📨 Sending notification ${notificationCount}/3 to driver ${driver.name} (${driverId})`
    );

    // Prepare FCM payload
    const fcmPayload = {
      event: "NEW_RIDE",
      notificationId,
      notificationCount,
      rideDetails: {
        rideId,
        distance: ride.route_info?.distance,
        distance_from_pickup_km: distanceKm,
        pickup: ride.pickup_address,
        drop: ride.drop_address,
        isRental: ride.is_rental || false,
        rentalHours: ride.rentalHours || 0,
        rental_km_limit: ride.rental_km_limit || 0,
        vehicleType: ride.vehicle_type,
        pricing: ride.pricing,
        searchAttempt: attempt,
        urgency: isInitial ? "high" : "normal",
        timestamp: Date.now(),
      },
      screen: "RideRequest",
      riderId: driverId,
    };

    // Send FCM notification
    await sendNotification.sendNotification(
      driver.fcmToken,
      `New Ride Request (#${notificationCount}/3)`,
      isInitial
        ? "🚀 New ride available nearby! Accept quickly!"
        : `📍 Ride still waiting for driver...`,
      fcmPayload,
      "ride_request_channel"
    );

    // Send Socket.IO notification
    if (io) {
      try {
        const socketsInRoom = await io.in(`driver:${driverId}`).allSockets();
        if (socketsInRoom.size > 0) {
          io.to(`driver:${driverId}`).emit("new_ride_request", {
            rideId,
            notificationId,
            notificationCount,
            distance_from_pickup_km: distanceKm,
            pickup: ride.pickup_address?.formatted_address,
            drop: ride.drop_address?.formatted_address,
            vehicleType: ride.vehicle_type,
            isRental: ride.is_rental || false,
            rentalHours: ride.rentalHours || 0,
            rental_km_limit: ride.rental_km_limit || 0,
            pricing: ride.is_rental
              ? ride.pricing.cashback < 0
                ? ride.pricing?.original_fare
                : ride.pricing?.total_fare
              : ride.pricing?.total_fare,
            isInitial,
            urgency: isInitial ? "high" : "normal",
          });
          console.log(`📡 Socket notification sent to driver ${driverId}`);
        }
      } catch (socketError) {
        console.warn(
          `⚠️ Socket error for driver ${driverId}:`,
          socketError.message
        );
      }
    }

    console.log(`✅ Notification sent successfully to driver ${driver.name}`);

    return {
      success: true,
      driverId,
      notificationId,
      notificationCount,
      distance: driver.distance,
      timestamp: new Date(),
    };
  } catch (error) {
    console.error(`❌ Failed to notify driver ${driverId}:`, error.message);
    // Rollback on failure
    decrementNotificationCount(driverId, rideId);
    return { success: false, reason: error.message };
  }
};

const sendBatchNotifications = async (
  drivers,
  ride,
  io,
  attempt,
  isInitial = false
) => {
  const results = {
    successful: [],
    failed: [],
    throttled: [],
    totalSent: 0,
  };

  if (!drivers || drivers.length === 0) {
    console.log("⚠️ No drivers provided for batch notification");
    return results;
  }

  console.log(`📦 Processing batch of ${drivers.length} drivers...`);

  // Process drivers one by one with throttling respect
  for (const driver of drivers) {
    try {
      const result = await sendDriverNotification(
        driver,
        ride,
        io,
        attempt,
        isInitial
      );

      if (result.success) {
        results.successful.push(result);
        results.totalSent++;
      } else if (result.reason === "throttled_or_limit_reached") {
        results.throttled.push({
          driverId: driver._id.toString(),
          reason: result.reason,
        });
      } else {
        results.failed.push({
          driverId: driver._id.toString(),
          reason: result.reason,
        });
      }

      // Small delay between notifications to avoid overwhelming FCM
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      console.error(`Error processing driver ${driver._id}:`, error.message);
      results.failed.push({
        driverId: driver._id.toString(),
        reason: error.message,
      });
    }
  }

  console.log(
    `📊 Batch complete: ${results.totalSent} sent, ${results.throttled.length} throttled, ${results.failed.length} failed`
  );

  return results;
};

const startBackgroundNotifications = (rideId, ride, io) => {
  // Stop any existing loop
  stopBackgroundNotifications(rideId);

  const startTime = Date.now();
  let attemptCount = 1;

  console.log(`🔄 Starting background notifications for ride ${rideId}`);

  const intervalId = setInterval(async () => {
    try {
      const elapsed = Date.now() - startTime;

      // Stop after duration limit (60 seconds)
      if (elapsed >= NOTIFICATION_CONFIG.BACKGROUND_DURATION_MS) {
        console.log(`⏱️ Background notification timeout for ride ${rideId}`);
        stopBackgroundNotifications(rideId);
        return;
      }

      // Check if ride still needs drivers
      const isActive = await isRideActiveAndSearching(rideId);
      if (!isActive) {
        console.log(`✅ Ride ${rideId} no longer needs notifications`);
        stopBackgroundNotifications(rideId);
        return;
      }

      attemptCount++;
      console.log(
        `🔁 Background notification attempt ${attemptCount} for ride ${rideId}`
      );

      // Fetch drivers and send notifications (with throttling)
      const drivers = await fetchEligibleDrivers(rideId, ride);

      if (drivers.length === 0) {
        console.log(`⚠️ No eligible drivers found in attempt ${attemptCount}`);
        return;
      }

      const results = await sendBatchNotifications(
        drivers,
        ride,
        io,
        attemptCount,
        false
      );

      console.log(
        `📈 Attempt ${attemptCount}: ${results.totalSent} notifications sent, ${results.throttled.length} throttled`
      );
    } catch (error) {
      console.error(
        `❌ Background notification error for ride ${rideId}:`,
        error.message
      );
    }
  }, NOTIFICATION_CONFIG.BACKGROUND_INTERVAL_MS); // 15 seconds

  activeNotificationLoops.set(rideId, intervalId);
  console.log(`✅ Background notifications scheduled for ride ${rideId}`);
};

const stopBackgroundNotifications = (rideId) => {
  console.log(`🛑 Stopping background notifications for ride ${rideId}`);

  if (activeNotificationLoops.has(rideId)) {
    clearInterval(activeNotificationLoops.get(rideId));
    activeNotificationLoops.delete(rideId);
    clearRideNotificationTracking(rideId);
    console.log(
      `✅ Background notifications stopped and tracking cleared for ride ${rideId}`
    );
  }
};

const initiateDriverSearch = async (rideId, searchAreaLimit, req, res) => {
  const io = req.app.get("io");
  const redisClient = getRedisClient(req);
  console.log(
    "🚀 [initiateDriverSearch] Starting driver search for ride:",
    rideId,
    searchAreaLimit
  );

  try {
    console.log("🔍 Fetching ride details...");
    const ride = await RideBooking.findById(rideId)
      .select(
        "ride_status driver isLater rental_km_limit pickup_location is_rental details isParcelOrder rentalHours vehicle_type rejected_by_drivers pickup_address drop_address pricing route_info"
      )
      .lean();

    console.log("📦 Ride data fetched:", ride ? "✅ Found" : "❌ Not found");

    if (!ride) {
      console.warn("⚠️ Ride not found for ID:", rideId);
      return { success: false, message: "Ride not found" };
    }

    if (ride.driver) {
      console.warn("🚫 Driver already assigned to ride:", rideId);
      return { success: false, message: "Driver already assigned" };
    }

    if (!["pending", "searching"].includes(ride.ride_status)) {
      console.warn(`🚫 Invalid ride status: ${ride.ride_status}`);
      return { success: false, message: `Ride is ${ride.ride_status}` };
    }

    if (!ride.pickup_location?.coordinates?.length) {
      console.error("❌ Invalid pickup location:", ride.pickup_location);
      await cancelRide(
        redisClient,
        rideId,
        "Invalid pickup location",
        "system"
      );
      return { success: false, message: "Invalid pickup location" };
    }

    console.log(
      "🕐 Updating ride status to 'searching'...",
      NOTIFICATION_CONFIG.INITIAL_RADIUS / 1000
    );
    await RideBooking.findByIdAndUpdate(rideId, {
      $set: {
        ride_status: "searching",
        search_started_at: new Date(),
        retry_count: 0,
        search_radius:
          searchAreaLimit || NOTIFICATION_CONFIG.INITIAL_RADIUS / 1000,
      },
    });

    console.log("✅ Ride status updated. Fetching eligible drivers...");
    const drivers = await fetchEligibleDrivers(rideId, ride, searchAreaLimit);

    console.log(`👥 Total eligible drivers found: ${drivers.length}`);

    if (drivers.length === 0) {
      console.warn("⚠️ No eligible drivers found after multiple attempts");
      await cancelRide(
        redisClient,
        rideId,
        "No drivers found after multiple attempts",
        "system"
      );
      return {
        success: false,
        message: "No drivers found after multiple attempts",
      };
    }

    console.log("📨 Sending initial notifications to drivers...");
    const notificationResults = await sendBatchNotifications(
      drivers,
      ride,
      io,
      1,
      true
    );

    console.log("📊 Notification results:", {
      totalSent: notificationResults.totalSent,
      successful: notificationResults.successful?.length,
      failed: notificationResults.failed?.length,
    });

    if (notificationResults.totalSent > 0) {
      console.log("📝 Updating ride with notification details...");
      await RideBooking.findByIdAndUpdate(rideId, {
        $push: {
          notified_riders: {
            $each: notificationResults.successful.map((n) => ({
              rider_id: n.driverId,
              notification_time: n.timestamp,
              notification_count: n.notificationCount,
              distance_from_pickup: n.distance,
            })),
          },
        },
        $set: {
          last_notification_sent_at: new Date(),
          riders_found: drivers.length,
        },
        $inc: {
          total_notifications_sent: notificationResults.totalSent,
        },
      });

      console.log("⚙️ Starting background notifications...");
      startBackgroundNotifications(rideId, ride, io);

      console.log("🕓 Scheduling cancellation check...");
      scheduleRideCancellationCheck(redisClient, rideId);
    } else {
      console.warn("⚠️ No notifications sent to any driver.");
    }

    console.log("✅ Driver search process completed successfully.");
    return {
      success: true,
      message: "Driver search initiated",
      drivers_notified: notificationResults.totalSent,
      total_drivers: drivers.length,
    };
  } catch (error) {
    console.error(`💥 Error in driver search for ride ${rideId}:`, error);
    await cancelRide(redisClient, rideId, `Error: ${error.message}`, "system");

    return { success: false, message: "Error during driver search" };
  }
};

exports.cancelRideRequest = async (req, res) => {
  const io = req.app.get("io");

  try {
    const rideId = req.params.rideId;
    if (!rideId) {
      return res.status(400).json({ message: "Ride ID is required." });
    }

    const foundRide = await RideBooking.findById(rideId)
      .populate("user")
      .populate("driver");

    if (!foundRide) {
      return res.status(404).json({ message: "Ride not found." });
    }

    console.log("🛑 [CANCEL REQUEST] Ride found:", {
      id: foundRide._id,
      status: foundRide.ride_status,
      driver: foundRide.driver?._id,
      user: foundRide.user?._id,
    });

    // Allow cancellation only for specific statuses
    if (
      !["pending", "searching", "driver_assigned"].includes(
        foundRide.ride_status
      )
    ) {
      let message = "";
      switch (foundRide.ride_status) {
        case "driver_arrived":
          message = "Driver has already arrived at the pickup location.";
          break;
        case "in_progress":
          message = "Ride is already in progress.";
          break;
        case "completed":
          message = "Ride has already been completed.";
          break;
        case "cancelled":
          message = "Ride has already been cancelled.";
          break;
        default:
          message = "Ride cannot be cancelled at this stage.";
      }
      console.warn("⚠️ [CANCEL BLOCKED] Reason:", message);
      return res.status(400).json({ success: false, message });
    }

    const notifiedRiderIds = foundRide.notified_riders || [];
    const rejectedRiderIds = foundRide.rejected_by_drivers || [];
    console.log("rejectedRiderIds", rejectedRiderIds);
    // Stop background notification loop
    console.log("🧠 Stopping notification loop for ride:", rideId);
    stopBackgroundNotifications(rideId);

    // Emit socket event to clear ride request for active notified riders
    if (io && notifiedRiderIds.length > 0) {
      console.log("ℹ️ Notified riders exist, processing active riders...");

      // Map rider IDs
      const mappedRiderIds = notifiedRiderIds.map((nr) => nr.rider_id || nr);
      console.log("🔹 Mapped Rider IDs:", mappedRiderIds);

      // Filter out rejected riders
      const activeRiderIds = mappedRiderIds.filter(
        (id) => !rejectedRiderIds.includes(id.toString())
      );
      console.log("🔹 Active Rider IDs (excluding rejected):", activeRiderIds);

      if (activeRiderIds.length > 0) {
        console.log(
          `ℹ️ Found ${activeRiderIds.length} active riders. Fetching from DB...`
        );
        const notifiedRiders = await RiderModel.find({
          _id: { $in: activeRiderIds },
        }).select("_id name");
        console.log(`✅ DB returned ${notifiedRiders.length} active riders`);

        notifiedRiders.forEach((rider) => {
          console.log(
            `➡️ Sending clear_ride_request to rider:${rider._id} | Name: ${rider.name}`
          );

          // Emit with acknowledgement
          io.to(`driver:${rider._id}`).emit(
            "clear_ride_request",
            { rideId: foundRide._id, role: "rider" },
            (ack) => {
              if (ack && ack.status === "received") {
                console.log(
                  `✅ Rider ${rider._id} acknowledged clear_ride_request`
                );
              } else {
                console.log(
                  `⚠️ Rider ${rider._id} may not have received clear_ride_request`
                );
              }
            }
          );

          // Log after emit (synchronous)
          console.log(`➡️ Emit called for rider:${rider._id}`);
        });

        console.log("ℹ️ clear_ride_request emitted to all active riders.");
      } else {
        console.log("ℹ️ No active riders to emit clear_ride_request.");
      }
    } else {
      console.log("ℹ️ No notified riders or io instance not available.");
    }

    // Cancel the ride
    foundRide.ride_status = "cancelled";
    foundRide.cancellation_reason = "User cancelled the ride request";
    foundRide.cancelled_by = "user";
    foundRide.cancelled_at = new Date();
    await foundRide.save();
    console.log("✅ [RIDE CANCELLED] Ride marked as cancelled:", foundRide._id);

    // Send FCM notifications to active riders
    if (notifiedRiderIds.length > 0) {
      const activeRiderIds = notifiedRiderIds
        .map((nr) => nr.rider_id || nr)
        .filter((id) => !rejectedRiderIds.includes(id.toString()));

      if (activeRiderIds.length > 0) {
        const riders = await RiderModel.find({ _id: { $in: activeRiderIds } })
          .select("fcmToken name _id")
          .lean();

        const notificationPromises = riders.map(async (rider) => {
          if (!rider.fcmToken) return;
          try {
            await sendNotification.sendNotification(
              rider.fcmToken,
              "You Miss The Ride",
              "Hum apke pass or bhi ride laa rhe h jldi jldi ...",
              { event: "RIDE_CANCELLED", rideId },
              "ride_cancel_channel"
            );
            console.log(`✅ FCM sent to rider ${rider.name || rider._id}`);
          } catch (err) {
            console.error(
              `❌ Failed to send FCM to rider ${rider._id}:`,
              err.message
            );
          }
        });

        // Wait for notifications but timeout in 5s
        await Promise.race([
          Promise.allSettled(notificationPromises),
          new Promise((resolve) => setTimeout(resolve, 5000)),
        ]);
      } else {
        console.log("ℹ️ No active riders to send notifications.");
      }
    }

    // Clear current ride references
    if (foundRide.user) {
      foundRide.user.currentRide = null;
      await foundRide.user.save();
      console.log(`👤 Cleared currentRide for user ${foundRide.user._id}`);
    }
    if (foundRide.driver) {
      foundRide.driver.on_ride_id = null;
      await foundRide.driver.save();
      console.log(`🚗 Cleared on_ride_id for driver ${foundRide.driver._id}`);
    }

    return res.status(200).json({
      success: true,
      message: "Ride cancelled successfully.",
      notifications_sent: notifiedRiderIds.length - rejectedRiderIds.length,
    });
  } catch (error) {
    console.error("💥 Error cancelling ride request:", error);
    return res.status(500).json({
      message: "Server error while cancelling ride request.",
    });
  }
};

exports.ride_status_after_booking = async (req, res) => {
  try {
    const { rideId } = req.params;

    if (!rideId) {
      return res.status(400).json({ message: "Ride ID is required." });
    }

    const ride = await RideBooking.findOne({ _id: rideId })
      .populate("driver", "_id name phoneNumber profileImage rating")
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
        break;
      case "searching":
        responsePayload.message = "Searching for a driver near you...";
        responsePayload.rideDetails = ride;
        break;
      case "driver_assigned":
        responsePayload.message = "Driver assigned! Your ride is on the way.";
        responsePayload.rideDetails = ride;
        break;
      case "driver_arrived":
        responsePayload.message =
          "Your driver has arrived at the pickup location!";
        responsePayload.rideDetails = ride;
        break;
      case "in_progress":
        responsePayload.message = "Your ride is currently in progress.";
        responsePayload.rideDetails = {
          rideId: ride._id,
          driverId: ride.driver?._id,
        };
        break;
      case "completed":
        responsePayload.message = "Your ride has been completed. Thank you!";
        responsePayload.rideDetails = ride;
        break;
      case "cancelled":
        responsePayload.message = `This ride has been cancelled${
          ride.cancelled_by ? ` by ${ride.cancelled_by}` : ""
        }.`;
        responsePayload.rideDetails = ride;
        break;
      default:
        responsePayload.message = "Ride status is unknown or invalid.";
        break;
    }

    return res.status(200).json(responsePayload);
  } catch (error) {
    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid Ride ID format." });
    }
    return res.status(500).json({
      message: "Server error while fetching ride status.",
    });
  }
};

exports.riderFetchPoolingForNewRides = async (req, res) => {
  const io = req.app.get("io");
  const startTime = Date.now();

  try {
    const { id: riderId } = req.params;

    if (!riderId) {
      return res.status(400).json({ message: "Rider ID is required." });
    }

    const rider = await RiderModel.findById(riderId);
    if (!rider) {
      return res.status(404).json({ message: "Rider not found." });
    }

    if (!rider.isAvailable) {
      return res
        .status(400)
        .json({ message: "Rider is not available for new rides." });
    }

    if (
      !rider.location?.coordinates ||
      rider.location.coordinates.length !== 2
    ) {
      return res
        .status(400)
        .json({ message: "Rider location data is required." });
    }

    const [riderLng, riderLat] = rider.location.coordinates;

    const driverVehicle =
      rider.category === "parcel"
        ? rider?.rideVehicleInfo?.vehicleName?.trim().toUpperCase()
        : rider?.rideVehicleInfo?.vehicleType?.trim().toUpperCase();

    const rawPrefs = rider?.preferences || {};

    const prefs = {
      OlyoxAcceptMiniRides: rawPrefs.OlyoxAcceptMiniRides?.enabled === true,
      OlyoxAcceptSedanRides: rawPrefs.OlyoxAcceptSedanRides?.enabled === true,
      OlyoxIntercity: rawPrefs.OlyoxIntercity?.enabled === true,
      OlyoxPriority: rawPrefs.OlyoxPriority?.enabled === true,
    };

    const calculateDistance = (lat1, lng1, lat2, lng2) => {
      const R = 6371;
      const dLat = ((lat2 - lat1) * Math.PI) / 180;
      const dLng = ((lng2 - lng1) * Math.PI) / 180;
      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLng / 2) ** 2;
      return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const isRideNearby = (pickup, maxKm = 5) => {
      if (!pickup?.coordinates || pickup.coordinates.length !== 2) return false;
      const [pickupLng, pickupLat] = pickup.coordinates;
      const dist = calculateDistance(riderLat, riderLng, pickupLat, pickupLng);
      return dist <= maxKm;
    };

    const isRiderRejected = (rejectedDrivers = []) => {
      return (
        Array.isArray(rejectedDrivers) &&
        rejectedDrivers.some(
          (d) => d?.driver?.toString() === riderId.toString()
        )
      );
    };

    // 🔍 ENHANCED PREF LOGIC WITH PARCEL+BIKE+PRIORITY RULE
    const isRideAllowedByPreferences = (ride) => {
      const rideVehicleType = ride.vehicle_type?.trim().toUpperCase();
      const isLaterOrIntercity = ride.isLater || ride.isIntercity;

      // 🧩 Special case: PARCEL category + BIKE vehicleName
      if (rider.category === "parcel") {
        const vehicleName =
          rider.rideVehicleInfo?.vehicleName?.toUpperCase?.() || "";
        if (vehicleName === "BIKE") {
          if (prefs.OlyoxPriority) {
            console.log(
              `✅ Rider ${rider._id} [PARCEL-BIKE] has OlyoxPriority → allowed`
            );
          } else {
            console.log(
              `❌ Rider ${rider._id} [PARCEL-BIKE] missing OlyoxPriority → not allowed`
            );
            return false;
          }
        }
      }

      // 🧠 Existing cab ride preference logic
      if (
        rider.category === "cab" &&
        driverVehicle === "BIKE" &&
        ride.isParcelOrder === true
      ) {
        const canDeliver = !!rawPrefs?.ParcelDelivery?.enabled;
        return canDeliver;
      }

      if (driverVehicle === rideVehicleType) return true;

      if (rideVehicleType === "SEDAN") {
        const canTakeSedan = prefs.OlyoxAcceptSedanRides;
        const isUpgrade = ["SUV", "XL", "SUV/XL", "MINI"].includes(
          driverVehicle
        );
        return isUpgrade && canTakeSedan;
      }

      if (rideVehicleType === "MINI") {
        const canTakeMini = prefs.OlyoxAcceptMiniRides;
        const isDowngrade = ["SEDAN", "SUV", "XL", "SUV/XL"].includes(
          driverVehicle
        );
        return isDowngrade && canTakeMini;
      }

      if (["SUV", "SUV/XL", "SUV_RENTAL"].includes(rideVehicleType)) {
        const canTakeSUV = prefs.OlyoxIntercity;
        const isDowngrade = ["SEDAN", "MINI", "XL", "SUV/XL", "SUV"].includes(
          driverVehicle
        );
        return isDowngrade && canTakeSUV;
      }

      if (isLaterOrIntercity && prefs.OlyoxIntercity) return true;

      return false;
    };

    const formatDistanceInKm = (meters) => {
      if (meters == null) return "N/A";
      return (meters / 1000).toFixed(2) + " km";
    };

    const cutoffTime = new Date(Date.now() - 240 * 1000);

    const dbRides = await RideBooking.find({
      ride_status: { $in: ["searching", "pending"] },
      requested_at: { $gte: cutoffTime },
    }).sort({ requested_at: -1 });

    const activeRides = dbRides.filter(
      (r) => !activeNotificationLoops.has(r._id.toString())
    );

    const candidateRides = activeRides
      .filter((ride) => {
        const check = {
          rejected: isRiderRejected(ride.rejected_by_drivers),
          nearby: isRideNearby(ride.pickup_location),
          allowed: isRideAllowedByPreferences(ride),
        };
        return !check.rejected && check.nearby && check.allowed;
      })
      .slice(0, 2);

    const validatedRides = [];

    for (const ride of candidateRides) {
      if (activeNotificationLoops.has(ride._id.toString())) continue;

      const latestRide = await RideBooking.findById(ride._id);
      if (
        !latestRide ||
        !["searching", "pending"].includes(latestRide.ride_status)
      )
        continue;

      if (isRiderRejected(latestRide.rejected_by_drivers)) continue;
      if (!isRideNearby(latestRide.pickup_location)) continue;
      if (!isRideAllowedByPreferences(latestRide)) continue;

      const notifiedRider = latestRide.notified_riders?.find(
        (nr) => nr.rider_id.toString() === riderId.toString()
      );

      if (io) {
        const sockets = await io.in(`driver:${riderId}`).allSockets();
        if (sockets.size > 0) {
          const payload = {
            rideId: latestRide._id,
            notificationId: latestRide._id,
            notificationCount: 0,
            distance_from_pickup_km:
              notifiedRider?.distance_from_pickup_km ||
              formatDistanceInKm(notifiedRider?.distance_from_pickup),
            pickup: latestRide.pickup_address?.formatted_address,
            drop: latestRide.drop_address?.formatted_address,
            vehicleType: latestRide.vehicle_type,
            isRental: latestRide.is_rental || false,
            isParcelOrder: latestRide.isParcelOrder || false,
            isLater: latestRide.isLater || false,
            isIntercity: latestRide.isIntercity || false,
            rentalHours: latestRide.rentalHours || 0,
            rental_km_limit: latestRide.rental_km_limit || 0,
            pricing: latestRide.pricing?.total_fare,
            isInitial: true,
            urgency: "high",
          };

          io.to(`driver:${riderId}`).emit("new_ride_request", payload);
        }
      }

      validatedRides.push({
        _id: latestRide._id,
        pickup_address: latestRide.pickup_address?.formatted_address,
        drop_address: latestRide.drop_address?.formatted_address,
        pickup_coordinates: latestRide.pickup_location,
        vehicle_type: latestRide.vehicle_type,
        ride_status: latestRide.ride_status,
        total_fare: latestRide.pricing?.total_fare,
        isParcelOrder: latestRide.isParcelOrder || false,
        distance: latestRide.route_info?.distance,
        isLater: latestRide.isLater || false,
        isIntercity: latestRide.isIntercity || false,
        isRental: latestRide.is_rental || false,
        rentalHours: latestRide.rentalHours || 0,
        rental_km_limit: latestRide.rental_km_limit || 0,
        notified_rider: notifiedRider
          ? {
              distance_from_pickup: notifiedRider.distance_from_pickup,
              distance_from_pickup_km:
                notifiedRider.distance_from_pickup_km ||
                formatDistanceInKm(notifiedRider.distance_from_pickup),
            }
          : null,
      });
    }

    return res.status(200).json({
      success: true,
      message: `Found ${validatedRides.length} available rides`,
      data: validatedRides,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

exports.FetchAllBookedRides = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const { status, search, isFake, createdAtFilter } = req.query; // <-- added createdAtFilter

    // ---------- 1. Base match ----------
    const match = {};

    if (status) match.ride_status = status;

    // isFake filter
    if (typeof isFake !== "undefined" && isFake !== "") {
      const bool = isFake === "true"; // accept 'true' / 'false'
      match.isFake = bool;
    }

    // ✅ Created At Date Filter (using created_at field)
    if (createdAtFilter && createdAtFilter !== "all") {
      const now = new Date();
      const todayStart = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
      );
      let startDate = null;
      let endDate = null;

      if (createdAtFilter === "today") {
        startDate = todayStart;
        endDate = new Date(todayStart);
        endDate.setDate(endDate.getDate() + 1);
      } else if (createdAtFilter === "yesterday") {
        endDate = todayStart;
        startDate = new Date(todayStart);
        startDate.setDate(startDate.getDate() - 1);
      } else if (createdAtFilter === "thisWeek") {
        const day = todayStart.getDay() || 7; // Monday as first day (1–7)
        startDate = new Date(todayStart);
        startDate.setDate(startDate.getDate() - (day - 1));
        endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 7);
      } else if (createdAtFilter === "thisMonth") {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      } else if (createdAtFilter === "lastMonth") {
        const year = now.getFullYear();
        const month = now.getMonth(); // 0–11
        const lastMonth = month === 0 ? 11 : month - 1;
        const lastMonthYear = month === 0 ? year - 1 : year;
        startDate = new Date(lastMonthYear, lastMonth, 1);
        endDate = new Date(year, month, 1);
      }

      if (startDate && endDate) {
        match.created_at = { $gte: startDate, $lt: endDate };
      }
    }

    // ---------- 2. Search pipeline ----------
    const searchPipeline = [];
    if (search && search.trim()) {
      const safeSearch = search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = { $regex: safeSearch, $options: "i" };

      searchPipeline.push({
        $match: {
          $or: [
            { "user.name": regex },
            { "user.number": regex },
            { "driver.name": regex },
            { "driver.phone": regex },
            { "driver.rideVehicleInfo.VehicleNumber": regex },
            { "pickup_address.formatted_address": regex },
            { "drop_address.formatted_address": regex },
            { vehicle_type: regex },
            { payment_method: regex },
          ],
        },
      });
    }

    // ---------- 3. Main aggregation ----------
    const pipeline = [
      { $match: match },

      // Lookups (user + driver)
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },

      {
        $lookup: {
          from: "drivers",
          localField: "driver",
          foreignField: "_id",
          as: "driver",
        },
      },
      { $unwind: { path: "$driver", preserveNullAndEmptyArrays: true } },

      // Search after population
      ...searchPipeline,

      // Project only needed fields
      {
        $project: {
          pickup_location: 1,
          isFake: 1,
          pickup_address: 1,
          drop_location: 1,
          drop_address: 1,
          vehicle_type: 1,
          ride_status: 1,
          is_rental: 1,
          isLater: 1,
          details: 1,
          rentalHours: 1,
          rental_km_limit: 1,
          isParcelOrder: 1,
          isIntercity: 1,
          requested_at: 1,
          pricing: 1,
          payment_method: 1,
          payment_status: 1,
          cancellation_reason: 1,
          cancelled_by: 1,
          created_at: 1,
          updated_at: 1,
          route_info: 1,

          // Populated fields
          "user.name": 1,
          "user.number": 1,
          "driver.name": 1,
          "driver.phone": 1,
          "driver.rideVehicleInfo.VehicleNumber": 1,
          "driver.rideVehicleInfo.vehicleType": 1,
        },
      },

      { $sort: { requested_at: -1 } },
      { $skip: skip },
      { $limit: limit },
    ];

    // ---------- 4. Count aggregation (same match + search) ----------
    const countPipeline = [
      { $match: match },
      {
        $lookup: {
          from: "users",
          localField: "user",
          foreignField: "_id",
          as: "user",
        },
      },
      { $unwind: { path: "$user", preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: "drivers",
          localField: "driver",
          foreignField: "_id",
          as: "driver",
        },
      },
      { $unwind: { path: "$driver", preserveNullAndEmptyArrays: true } },
      ...searchPipeline,
      { $count: "total" },
    ];

    const [Bookings, totalResult] = await Promise.all([
      RideBooking.aggregate(pipeline),
      RideBooking.aggregate(countPipeline),
    ]);

    const total = totalResult[0]?.total || 0;

    res.status(200).json({
      success: true,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      Bookings,
    });
  } catch (error) {
    console.error("Error fetching booked rides:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

exports.BookingDetailsAdmin = async (req, res) => {
  try {
    const Bookings = await RideBooking.findById(req.params.id)
      .populate("user") // Populate user details
      .populate(
        "driver",
        "name rideVehicleInfo phone isAvailable BH fcmToken RechargeData"
      )
      .populate({
        path: "notified_riders.rider_id",
        model: "Rider",
        select:
          "name phone rideVehicleInfo isAvailable createdAt preferences.lastUpdated",
      })

      .populate({
        path: "rejected_by_drivers.driver",
        model: "Rider",
        select: "name phone rideVehicleInfo isAvailable",
      });

    res.status(200).json({ success: true, Bookings });
  } catch (error) {
    console.error("Error fetching booked rides:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// Helper function to clean up Redis cache (can be called periodically)
exports.cleanupRedisRideCache = async (req, res) => {
  try {
    const redisClient = getRedisClient(req);
    const cachedRidesKeys = await redisClient.keys("ride:*");
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
        const dbRide = await RideBooking.findById(ride._id).populate("user");

        if (!dbRide) {
          await redisClient.del(rideKey);
          cleanedCount++;
          console.log(`Deleted missing ride ${ride._id} from Redis`);
          continue;
        }

        // If cancelled, reset user current ride
        if (dbRide.ride_status === "cancelled" && dbRide.user) {
          dbRide.user.currentRide = null;
          await dbRide.user.save();
        }

        // Remove if cancelled or completed
        if (["cancelled", "completed"].includes(dbRide.ride_status)) {
          await redisClient.del(rideKey);
          cleanedCount++;
          console.log(`Cleaned ride ${ride._id} from Redis`);
        } else if (dbRide.ride_status !== ride.ride_status) {
          // Sync status
          await redisClient.set(rideKey, JSON.stringify(dbRide), "EX", 3600);
          console.log(
            `Updated Redis ride ${ride._id} status to ${dbRide.ride_status}`
          );
        }
      } catch (parseError) {
        console.warn(
          `Malformed ride data in Redis for key: ${rideKey}. Deleting...`
        );
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

exports.riderActionAcceptOrRejectRide = async (req, res) => {
  const log = (...args) =>
    console.log(`[${new Date().toISOString()}]`, ...args);

  try {
    const { riderId, rideId, action } = req.body;
    log("📥 Incoming rider action request:", req.body);

    // Step 1: Input validation
    if (!riderId || !rideId || !action) {
      log("⚠️ Missing fields:", { riderId, rideId, action });
      return res.status(400).json({
        success: false,
        message: "Please provide all required information",
      });
    }

    const normalizedAction = action.toLowerCase();
    if (!["accept", "reject"].includes(normalizedAction)) {
      log("❌ Invalid action received:", normalizedAction);
      return res.status(400).json({
        success: false,
        message: "Action must be either accept or reject",
      });
    }

    // Step 2: Validate Rider
    log("🔍 Validating driver:", riderId);
    const driver = await RiderModel.findById(riderId)
      .select("isAvailable on_ride_id name phone fcmToken")
      .lean();

    if (!driver) {
      log("❌ Driver not found:", riderId);
      return res.status(404).json({
        success: false,
        message: "We couldn't find your driver account",
      });
    }

    if (!driver.isAvailable || driver.on_ride_id) {
      log("⚠️ Driver unavailable or already on a ride:", {
        driverId: riderId,
        isAvailable: driver.isAvailable,
        on_ride_id: driver.on_ride_id,
      });
      return res.status(400).json({
        success: false,
        message: "You're currently unavailable or already on a ride",
      });
    }

    // Step 3: Validate Ride
    log("🔍 Fetching ride details for rideId:", rideId);
    const ride = await RideBooking.findById(rideId)
      .select(
        "ride_status driver rejected_by_drivers isFake user pickup_address drop_address vehicle_type pricing route_info ride_otp isIntercityRides IntercityPickupTime scheduled_at"
      )
      .populate("user", "name number fcmToken")
      .lean();

    if (!ride) {
      log("❌ Ride not found or expired:", rideId);
      return res.status(404).json({
        success: false,
        message: "This ride request is no longer available",
      });
    }

    log("📦 Ride fetched successfully:", {
      rideId: ride._id,
      ride_status: ride.ride_status,
      vehicle_type: ride.vehicle_type,
    });

    if (ride.ride_status !== "searching") {
      log(`⚠️ Ride is not in 'searching' state (current: ${ride.ride_status})`);
      return res.status(400).json({
        success: false,
        message: `This ride is ${ride.ride_status}, you can't perform this action`,
      });
    }

    const io = req.app.get("io");
    log("🔗 Socket instance acquired:", !!io);

    // Step 4: Route to action handler
    if (normalizedAction === "reject") {
      log("🚫 Driver chose to REJECT the ride:", { riderId, rideId });
      return await handleRideRejection(req, res, ride, driver, io);
    } else {
      log("✅ Driver chose to ACCEPT the ride:", { riderId, rideId });
      return await handleRideAcceptance(req, res, ride, driver, io);
    }
  } catch (error) {
    log("❌ Unexpected error in riderActionAcceptOrRejectRide:", {
      message: error.message,
      stack: error.stack,
      riderId: req.body?.riderId,
      rideId: req.body?.rideId,
    });
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again",
    });
  }
};

/**
 * Handle driver accepting or rejecting a ride via token (WhatsApp/Email link)
 */
exports.riderActionAcceptOrRejectRideVia = async (req, res) => {
  try {
    const { rideId, action, token } = req.params;

    // Verify JWT token
    let decoded;
    try {
      const jwt = require("jsonwebtoken");
      decoded = jwt.verify(
        token,
        process.env.JWT_SECRET ||
          "dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih"
      );
    } catch (err) {
      return res.status(401).json({
        success: false,
        message: "Your session has expired. Please log in again",
      });
    }

    const riderId = decoded?.userId;

    if (!riderId || !rideId || !action) {
      return res.status(400).json({
        success: false,
        message: "Please provide all required information",
      });
    }

    const normalizedAction = action.toLowerCase();
    if (!["accept", "reject"].includes(normalizedAction)) {
      return res.status(400).json({
        success: false,
        message: "Action must be either accept or reject",
      });
    }

    // Validate driver - minimal fields
    const driver = await RiderModel.findById(riderId)
      .select("isAvailable on_ride_id name phone fcmToken")
      .lean();

    if (!driver) {
      return res.status(404).json({
        success: false,
        message: "We couldn't find your driver account",
      });
    }

    if (!driver.isAvailable || driver.on_ride_id) {
      return res.status(400).json({
        success: false,
        message: "You're currently unavailable or already on a ride",
      });
    }

    // Validate ride - minimal fields
    const ride = await RideBooking.findById(rideId)
      .select(
        "ride_status driver rejected_by_drivers isFake user pickup_address drop_address vehicle_type pricing route_info ride_otp isIntercityRides IntercityPickupTime scheduled_at"
      )
      .populate("user", "name number fcmToken")
      .lean();

    if (!ride) {
      return res.status(404).json({
        success: false,
        message: "This ride request is no longer available",
      });
    }

    // if (ride.ride_status !== "searching") {
    //   return res.status(400).json({
    //     success: false,
    //     message: `This ride is ${ride.ride_status}, you can't perform this action`,
    //   });
    // }

    const io = req.app.get("io");

    // Route to appropriate handler
    if (normalizedAction === "reject") {
      return await handleRideRejection(req, res, ride, driver, io);
    } else {
      return await handleRideAcceptance(req, res, ride, driver, io);
    }
  } catch (error) {
    console.error("❌ Rider action via link error:", {
      message: error.message,
      rideId: req.params?.rideId,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again",
    });
  }
};

// ============================================================================
// REJECTION HANDLER
// ============================================================================

/**
 * Handle ride rejection with notification loop cleanup
 */
const handleRideRejection = async (req, res, ride, driver, io) => {
  const driverId = driver._id.toString();
  const rideId = ride._id.toString();

  console.log(
    "🚗 [handleRideRejection] Triggered for driver:",
    driverId,
    "ride:",
    rideId
  );

  try {
    // Step 1: Check if already rejected
    console.log("🔍 Checking if driver already rejected the ride...");
    const alreadyRejected = ride.rejected_by_drivers?.some(
      (rejection) => rejection.driver?.toString() === driverId
    );

    if (alreadyRejected) {
      console.warn("⚠️ Driver", driverId, "already rejected ride", rideId);
      return res.status(400).json({
        success: false,
        message: "You've already rejected this ride",
      });
    }

    // Step 2: Update ride with rejection (atomic operation)
    console.log("🛠️ Adding rejection entry to ride:", rideId);
    const updatedRide = await RideBooking.findByIdAndUpdate(
      rideId,
      {
        $addToSet: {
          rejected_by_drivers: {
            driver: new mongoose.Types.ObjectId(driverId),
            rejected_at: new Date(),
            byFake: false,
          },
        },
        $set: {
          updated_at: new Date(),
        },
      },
      { new: true, select: "_id rejected_by_drivers" }
    );

    if (!updatedRide) {
      console.error("❌ Ride not found or failed to update for ride:", rideId);
      return res.status(404).json({
        success: false,
        message: "Ride not found or failed to update",
      });
    }

    console.log(
      "✅ Successfully updated ride with rejection for driver:",
      driverId
    );
    console.log(
      "🧾 Current rejected_by_drivers list:",
      updatedRide.rejected_by_drivers
    );

    // Step 3: Notify driver UI
    if (io) {
      console.log("📡 Emitting 'clear_ride_request' to driver:", driverId);
      io.to(`driver:${driverId}`).emit("clear_ride_request", {
        rideId,
        reason: "rejected",
      });
    } else {
      console.warn(
        "⚠️ io instance not provided, skipping socket emit for driver:",
        driverId
      );
    }

    // Step 4: Return success response
    console.log(
      "✅ Ride rejection handled successfully for driver:",
      driverId,
      "ride:",
      rideId
    );
    return res.status(200).json({
      success: true,
      message: "You've declined this ride request",
    });
  } catch (error) {
    console.error(
      "❌ Ride rejection error for driver:",
      driverId,
      "ride:",
      rideId,
      error
    );
    return res.status(500).json({
      success: false,
      message: "Failed to reject ride. Please try again",
    });
  }
};

// ============================================================================
// ACCEPTANCE HANDLER
// ============================================================================

/**
 * Handle ride acceptance with race condition prevention
 */
const handleRideAcceptance = async (req, res, ride, driver, io) => {
  const driverId = driver._id.toString();
  const rideId = ride._id.toString();

  try {
    // Race condition check - use findOneAndUpdate with conditions
    const assignedRide = await RideBooking.findOneAndUpdate(
      {
        _id: rideId,
        ride_status: "searching",
        driver: null, // Ensure no driver assigned yet
      },
      {
        $set: {
          ride_status: "driver_assigned",
          driver: new mongoose.Types.ObjectId(driverId),
          driver_assigned_at: new Date(),
          eta: 5,
          updated_at: new Date(),
        },
      },
      {
        new: true,
        select:
          "_id ride_status driver isFake isIntercityRides IntercityPickupTime scheduled_at user pickup_address drop_address vehicle_type pricing route_info ride_otp",
      }
    ).populate("user", "name number fcmToken");

    // If null, another driver took it
    if (!assignedRide) {
      console.warn(`⚠️ Race condition: Driver ${driverId} lost ride ${rideId}`);

      if (io) {
        io.to(`driver:${driverId}`).emit("clear_ride_request", {
          rideId,
          reason: "already_assigned",
        });
      }

      return res.status(400).json({
        success: false,
        message: "Sorry, this ride was just taken by another driver",
      });
    }

    console.info(`✅ Driver ${driverId} accepted ride ${rideId}`);

    // Stop notification loop immediately
    stopBackgroundNotifications(rideId);

    // Handle fake rides
    if (assignedRide.isFake) {
      return await handleFakeRide(assignedRide, driver, io, res);
    }

    // Handle intercity rides
    if (assignedRide.isIntercityRides) {
      return await handleIntercityRide(assignedRide, driver, io, res);
    }

    // Handle regular local rides
    return await handleLocalRide(assignedRide, driver, io, res);
  } catch (error) {
    console.error(`❌ Ride acceptance error for driver ${driverId}:`, error);
    return res.status(500).json({
      success: false,
      message: "Failed to accept ride. Please try again",
    });
  }
};

// ============================================================================
// RIDE TYPE HANDLERS
// ============================================================================

/**
 * Handle fake ride rejection
 */
const handleFakeRide = async (ride, driver, io, res) => {
  const driverId = driver._id.toString();
  const rideId = ride._id.toString();

  try {
    console.info(
      `🎭 Fake ride attempt by driver ${driverId} for ride ${rideId}`
    );

    // Update ride to mark fake rejection
    await RideBooking.findByIdAndUpdate(rideId, {
      $addToSet: {
        rejected_by_drivers: {
          driver: new mongoose.Types.ObjectId(driverId),
          rejected_at: new Date(),
          byFake: true,
        },
      },
      $set: {
        ride_status: "searching", // Back to searching
        driver: null, // Remove driver
        updated_at: new Date(),
      },
    });

    // Notify driver
    if (driver.fcmToken) {
      try {
        await sendNotification.sendNotification(
          driver.fcmToken,
          "Missed Ride – More Coming Soon",
          "You missed this ride as another driver accepted it first. Don't worry, more ride requests are on the way with Olyox!",
          {
            event: "FAKE_RIDE_REJECTED",
            screen: "RiderDashboard",
          },
          "ride_cancel_channel"
        );
      } catch (notifError) {
        console.warn(
          "Failed to send fake ride notification:",
          notifError.message
        );
      }
    }

    if (io) {
      io.to(`driver:${driverId}`).emit("clear_ride_request", {
        rideId,
        reason: "fake_ride",
      });
    }

    return res.status(404).json({
      success: false,
      message:
        "This ride is not available for you, but other rides are coming.",
      is_fake: true,
    });
  } catch (error) {
    console.error("Fake ride handling error:", error);
    throw error;
  }
};

/**
 * Handle intercity ride assignment
 */
const handleIntercityRide = async (ride, driver, io, res) => {
  const driverId = driver._id.toString();
  const rideId = ride._id.toString();

  try {
    const pickupTime = new Date(ride.IntercityPickupTime || ride.scheduled_at);
    const oneHourFromNow = new Date(Date.now() + 60 * 60 * 1000);

    const formatDateTime = (date) =>
      new Intl.DateTimeFormat("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      }).format(date);

    const bookingId = rideId.slice(-8).toUpperCase();

    if (pickupTime > oneHourFromNow) {
      // Future intercity ride (> 1 hour)
      await RiderModel.findByIdAndUpdate(driverId, {
        $set: {
          on_intercity_ride_id: new mongoose.Types.ObjectId(rideId),
        },
      });

      const message = `🚗 *Driver Assigned!*\n\nHi ${
        ride.user.name
      },\n\nYour intercity ride is confirmed.\n\n📋 *Booking ID:* ${bookingId}\n👨‍💼 *Driver:* ${
        driver.name
      }\n📞 *Driver Contact:* ${driver.phone}\n🚗 *Vehicle:* ${
        ride.vehicle_type || "Not specified"
      }\n📅 *Departure:* ${formatDateTime(pickupTime)}\n\n🔐 *Your OTP:* ${
        ride.ride_otp || "N/A"
      }\n\n📞 Driver will contact you shortly.\n🙏 Thank you for choosing *Olyox*!`;

      try {
        await SendWhatsAppMessageNormal(message, ride.user.number);
        console.log("✅ Intercity WhatsApp sent");
      } catch (waError) {
        console.error("❌ WhatsApp failed:", waError.message);
      }

      await scheduleIntercityRideNotifications(rideId);

      return res.status(200).json({
        success: true,
        message: "Intercity ride scheduled. Driver assigned for your ride.",
        ride: {
          _id: rideId,
          pickup: ride.pickup_address,
          drop: ride.drop_address,
        },
        is_intercity: true,
      });
    } else {
      // Immediate intercity ride (<= 1 hour)
      await RiderModel.findByIdAndUpdate(driverId, {
        $set: {
          on_intercity_ride_id: new mongoose.Types.ObjectId(rideId),
          on_ride_id: new mongoose.Types.ObjectId(rideId),
          isAvailable: false,
        },
      });

      const message = `🚗 *Driver On The Way!*\n\nHi ${
        ride.user.name
      },\n\nYour intercity ride is starting soon.\n\n📋 *Booking ID:* ${bookingId}\n👨‍💼 *Driver:* ${
        driver.name
      }\n📞 *Driver Contact:* ${driver.phone}\n🚗 *Vehicle:* ${
        ride.vehicle_type || "Not specified"
      }\n📅 *Departure:* ${formatDateTime(pickupTime)}\n\n🔐 *Your OTP:* ${
        ride.ride_otp || "N/A"
      }\n\n📞 Driver will contact you shortly.\n🙏 Thank you for choosing *Olyox*!`;

      try {
        await SendWhatsAppMessageNormal(message, ride.user.number);
        console.log("✅ Immediate intercity WhatsApp sent");
      } catch (waError) {
        console.error("❌ WhatsApp failed:", waError.message);
      }

      return res.status(200).json({
        success: true,
        message: "Intercity ride starting soon. Driver assigned and notified.",
        ride: {
          _id: rideId,
          pickup: ride.pickup_address,
          drop: ride.drop_address,
        },
        is_intercity: true,
      });
    }
  } catch (error) {
    console.error("Intercity ride handling error:", error);
    throw error;
  }
};

/**
 * Handle local ride assignment
 */
const handleLocalRide = async (ride, driver, io, res) => {
  const driverId = driver._id.toString();
  const rideId = ride._id.toString();

  try {
    // Mark driver as unavailable
    await RiderModel.findByIdAndUpdate(driverId, {
      $set: {
        isAvailable: false,
        on_ride_id: new mongoose.Types.ObjectId(rideId),
      },
    });

    // Notify user
    if (ride.user?.fcmToken) {
      try {
        await sendNotification.sendNotification(
          ride.user.fcmToken,
          "Driver Found!",
          `${driver.name} is on the way to pick you up`,
          {
            event: "RIDE_ACCEPTED",
            rideId,
            driverName: driver.name,
            driverPhone: driver.phone,
            screen: "TrackRider",
          },
          "ride_accept_channel"
        );
      } catch (notifError) {
        console.warn("Failed to send user notification:", notifError.message);
      }
    }

    // Notify user via Socket.IO
    if (io && ride.user?._id) {
      io.to(`user:${ride.user._id}`).emit("driver_assigned", {
        rideId,
        driver: {
          name: driver.name,
          phone: driver.phone,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Ride accepted! Head to the pickup location",
      data: {
        rideId,
        pickup: ride.pickup_address,
        drop: ride.drop_address,
        vehicleType: ride.vehicle_type,
      },
    });
  } catch (error) {
    console.error("Local ride handling error:", error);
    throw error;
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
        responsePayload.rideDetails = ride.driver
          ? {
              rideId: ride._id,
              driverId: ride.driver._id,
              driverName: ride.driver.name,
              vehicleType: ride.vehicle_type,
              vehicleDetails: ride.driver.rideVehicleInfo,
              eta: ride.eta || 5,
              pickup: ride.pickup_address,
              drop: ride.drop_address,
              pricing: ride.pricing,
            }
          : null;
        break;
      case "driver_arrived":
        responsePayload.message =
          "Your driver has arrived at the pickup location!";
        responsePayload.rideDetails = ride.driver
          ? {
              rideId: ride._id,
              driverId: ride.driver._id,
              driverName: ride.driver.name,
              vehicleType: ride.vehicle_type,
              vehicleDetails: ride.driver.rideVehicleInfo,
              pickup: ride.pickup_address,
              drop: ride.drop_address,
              pricing: ride.pricing,
            }
          : null;
        break;
      case "in_progress":
        responsePayload.message = "Your ride is currently in progress.";
        responsePayload.rideDetails = ride.driver
          ? {
              rideId: ride._id,
              driverId: ride.driver._id,
              driverName: ride.driver.name,
              vehicleType: ride.vehicle_type,
              vehicleDetails: ride.driver.rideVehicleInfo,
              pickup: ride.pickup_address,
              drop: ride.drop_address,
              pricing: ride.pricing,
            }
          : null;
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
        responsePayload.message = `This ride has been cancelled${
          ride.cancelledBy ? ` by ${ride.cancelledBy}` : ""
        }.`;
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
        console.warn(
          `Ride ${ride._id} has an unhandled status: ${ride.ride_status}`
        );
        break;
    }
    return res.status(200).json({
      success: true,
      data: ride,
    });
  } catch (error) {
    console.error("Error fetching ride status:", error);
    if (error.name === "CastError") {
      return res.status(400).json({ message: "Invalid Ride ID format." });
    }
    return res
      .status(500)
      .json({ message: "Server error while fetching ride status." });
  }
};

exports.changeCurrentRiderRideStatus = async (req, res) => {
  const io = req.app.get("io");
  const logPrefix = "🚗 [RIDE STATUS]";

  try {
    const settings = await SettingsModel.findOne();
    const validStatus = ["driver_arrived", "completed", "cancelled"];
    const { riderId, rideId, status, byAdmin } = req.body;

    // ========================
    // 1️⃣ VALIDATION
    // ========================
    if (!riderId || !rideId || !status) {
      console.warn(`${logPrefix} Missing required fields`);
      return res.status(400).json({
        success: false,
        error: "Missing riderId, rideId, or status",
      });
    }

    if (!byAdmin && !validStatus.includes(status)) {
      console.warn(`${logPrefix} Invalid status: ${status}`);
      return res.status(400).json({
        success: false,
        error: "Invalid ride status",
      });
    }

    // ========================
    // 2️⃣ FETCH RIDE DATA
    // ========================
    const ride = await RideBooking.findById(rideId)
      .populate("driver")
      .populate("user");

    if (!ride) {
      console.warn(`${logPrefix} Ride not found: ${rideId}`);
      return res.status(404).json({
        success: false,
        error: "Ride not found",
      });
    }

    const { driver, user } = ride;
    const userFcmToken = user?.fcmToken || ride.user_fcm_token;

    console.info(
      `${logPrefix} Processing status change: ${ride.ride_status} → ${status}`
    );

    // ========================
    // 3️⃣ STATUS VALIDATION
    // ========================
    if (!byAdmin) {
      if (ride.ride_status === "cancelled") {
        return res.status(400).json({
          success: false,
          error: "Cannot update a cancelled ride",
        });
      }
      if (ride.ride_status === "completed") {
        return res.status(400).json({
          success: false,
          error: "Ride is already completed",
        });
      }
      if (
        ride.ride_status === "driver_arrived" &&
        status === "driver_arrived"
      ) {
        return res.status(400).json({
          success: false,
          error: "Ride is already marked as driver arrived",
        });
      }
    }

    // ========================
    // 4️⃣ HELPER FUNCTIONS
    // ========================
    const haversineDistance = (lat1, lon1, lat2, lon2) => {
      const toRad = (val) => (val * Math.PI) / 180;
      const R = 6371e3; // meters
      const φ1 = toRad(lat1);
      const φ2 = toRad(lat2);
      const Δφ = toRad(lat2 - lat1);
      const Δλ = toRad(lon2 - lon1);

      const a =
        Math.sin(Δφ / 2) ** 2 +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

      return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };

    const calculateRentalCharges = (ride, actualDistanceKm, settings) => {
      const rentalLimitKm = ride.rental_km_limit || 0;
      const rentalHours = ride.rentalHours || 0;
      const vehicleType = ride.vehicle_type?.toLowerCase();

      let extraKmFare = 0;
      let extraTimeFare = 0;
      let extraKm = 0;
      let extraHours = 0;

      // Get rental settings for vehicle type
      const rentalSettings = settings?.rental?.[vehicleType] || {};
      const pricePerKm = rentalSettings.pricePerKm || 0;
      const pricePerMin = rentalSettings.pricePerMin || 0;

      // Calculate extra km charges
      if (actualDistanceKm > rentalLimitKm) {
        extraKm = actualDistanceKm - rentalLimitKm;
        extraKmFare = pricePerKm * extraKm;
        console.info(
          `${logPrefix} Extra KM: ${extraKm.toFixed(
            2
          )} km @ ₹${pricePerKm}/km = ₹${extraKmFare.toFixed(2)}`
        );
      }

      // Calculate extra time charges
      if (ride.driver_assigned_at && rentalHours > 0) {
        const assignedAt = new Date(ride.driver_assigned_at);
        const now = new Date();
        const actualHours = (now - assignedAt) / (1000 * 60 * 60);

        if (actualHours > rentalHours) {
          extraHours = actualHours - rentalHours;
          const extraMinutes = extraHours * 60;
          extraTimeFare = pricePerMin * extraMinutes;
          console.info(
            `${logPrefix} Extra Time: ${extraHours.toFixed(
              2
            )} hrs @ ₹${pricePerMin}/min = ₹${extraTimeFare.toFixed(2)}`
          );
        }
      }

      return {
        extraKm: parseFloat(extraKm.toFixed(2)),
        extraKmFare: parseFloat(extraKmFare.toFixed(2)),
        extraHours: parseFloat(extraHours.toFixed(2)),
        extraTimeFare: parseFloat(extraTimeFare.toFixed(2)),
        totalExtraCharges: parseFloat((extraKmFare + extraTimeFare).toFixed(2)),
      };
    };

    const driverLat = driver?.location?.coordinates?.[1];
    const driverLng = driver?.location?.coordinates?.[0];

    // ========================
    // 5️⃣ DRIVER ARRIVED STATUS
    // ========================
    if (status === "driver_arrived") {
      const pickupLat = ride?.pickup_location?.coordinates?.[1];
      const pickupLng = ride?.pickup_location?.coordinates?.[0];

      if (
        driverLat == null ||
        driverLng == null ||
        pickupLat == null ||
        pickupLng == null
      ) {
        console.warn(
          `${logPrefix} Missing location coordinates for driver_arrived`
        );
        return res.status(400).json({
          success: false,
          error: "Location coordinates missing",
        });
      }

      const distance = haversineDistance(
        driverLat,
        driverLng,
        pickupLat,
        pickupLng
      );
      console.info(
        `${logPrefix} Distance from pickup: ${distance.toFixed(2)} meters`
      );

      const maxDistanceMeters = byAdmin ? 5000 : 500; // 5km for admin, 500m for driver

      if (distance <= maxDistanceMeters) {
        ride.ride_status = "driver_arrived";
        ride.driver_arrived_at = new Date();

        await ride.save();

        // Send notification to user
        if (userFcmToken) {
          await sendNotification
            .sendNotification(
              userFcmToken,
              "Your Driver Has Arrived! 🚗",
              `${
                driver?.name || "Your driver"
              } has arrived at your pickup location.`,
              {
                event: "DRIVER_ARRIVED",
                rideId: ride._id.toString(),
                driverName: driver?.name,
                driverPhone: driver?.phone_number,
              },
              "app_update_channel"
            )
            .catch((err) =>
              console.error(`${logPrefix} Notification failed:`, err.message)
            );
        }

        console.info(`${logPrefix} Ride marked as driver_arrived`);

        return res.status(200).json({
          success: true,
          message: "Driver has arrived at pickup location",
          data: {
            rideId: ride._id,
            ride_status: ride.ride_status,
            driver_arrived_at: ride.driver_arrived_at,
            distance_from_pickup: `${distance.toFixed(2)} meters`,
          },
        });
      } else {
        return res.status(400).json({
          success: false,
          error: `Driver is too far from pickup location (${(
            distance / 1000
          ).toFixed(2)} km away)`,
        });
      }
    }

    // ========================
    // 6️⃣ COMPLETED STATUS
    // ========================
    if (status === "completed") {
      const dropLat = ride?.drop_location?.coordinates?.[1];
      const dropLng = ride?.drop_location?.coordinates?.[0];

      if (
        driverLat == null ||
        driverLng == null ||
        dropLat == null ||
        dropLng == null
      ) {
        console.warn(`${logPrefix} Missing location coordinates for completed`);
        return res.status(400).json({
          success: false,
          error: "Location coordinates missing",
        });
      }

      const distanceMeters = haversineDistance(
        driverLat,
        driverLng,
        dropLat,
        dropLng
      );
      const distanceKm = distanceMeters / 1000;
      console.info(
        `${logPrefix} Distance from drop: ${distanceKm.toFixed(2)} km`
      );

      const maxDistanceKm = byAdmin ? 10 : 2; // 10km for admin, 1km for driver

      let rentalCharges = null;
      let updatedPricing = { ...ride.pricing };

      // Calculate rental charges if applicable
      if (ride.is_rental) {
        rentalCharges = calculateRentalCharges(ride, distanceKm, settings);

        // Update pricing with rental charges
        updatedPricing = {
          ...updatedPricing,
          extra_km: rentalCharges.extraKm,
          extra_km_fare: rentalCharges.extraKmFare,
          extra_hours: rentalCharges.extraHours,
          extra_time_fare: rentalCharges.extraTimeFare,
          total_extra_charges: rentalCharges.totalExtraCharges,
          original_total_fare: updatedPricing.total_fare,
          total_fare: parseFloat(
            (
              updatedPricing.total_fare + rentalCharges.totalExtraCharges
            ).toFixed(2)
          ),
        };

        console.info(`${logPrefix} Rental charges calculated:`, rentalCharges);
        console.info(
          `${logPrefix} Updated total fare: ₹${updatedPricing.original_total_fare} + ₹${rentalCharges.totalExtraCharges} = ₹${updatedPricing.total_fare}`
        );
      }

      if (distanceKm <= maxDistanceKm) {
        ride.ride_status = "completed";
        ride.ride_ended_at = new Date();
        ride.pricing = updatedPricing;

        await ride.save();

        // Clear current ride from user
        // if (user) {
        //     user.currentRide = null;
        //     await user.save().catch(err =>
        //         console.error(`${logPrefix} Failed to clear user currentRide:`, err.message)
        //     );
        // }

        // Send notification to user
        if (userFcmToken) {
          const fareMessage =
            ride.is_rental && rentalCharges?.totalExtraCharges > 0
              ? `Total Fare: ₹${updatedPricing.total_fare} (includes ₹${rentalCharges.totalExtraCharges} extra charges)`
              : `Total Fare: ₹${updatedPricing.total_fare}`;

          await sendNotification
            .sendNotification(
              userFcmToken,
              "Ride Completed! 🎉",
              `Thank you for riding with us. ${fareMessage}`,
              {
                event: "RIDE_COMPLETED",
                rideId: ride._id.toString(),
                totalFare: updatedPricing.total_fare,
                isRental: ride.is_rental,
                extraCharges: rentalCharges?.totalExtraCharges || 0,
              },
              "app_update_channel"
            )
            .catch((err) =>
              console.error(`${logPrefix} Notification failed:`, err.message)
            );
        }

        console.info(`${logPrefix} Ride completed successfully`);

        return res.status(200).json({
          success: true,
          message: "Ride completed successfully",
          data: {
            rideId: ride._id,
            ride_status: ride.ride_status,
            ride_ended_at: ride.ride_ended_at,
            distance_from_drop: `${distanceKm.toFixed(2)} km`,
            is_rental: ride.is_rental,
            pricing: updatedPricing,
            ...(ride.is_rental &&
              rentalCharges && {
                rental_details: {
                  planned_km: ride.rental_km_limit,
                  actual_km: distanceKm.toFixed(2),
                  extra_km: rentalCharges.extraKm,
                  extra_km_fare: rentalCharges.extraKmFare,
                  planned_hours: ride.rentalHours,
                  extra_hours: rentalCharges.extraHours,
                  extra_time_fare: rentalCharges.extraTimeFare,
                  total_extra_charges: rentalCharges.totalExtraCharges,
                  original_fare: updatedPricing.original_total_fare,
                  final_fare: updatedPricing.total_fare,
                },
              }),
          },
        });
      } else {
        return res.status(400).json({
          success: false,
          error: `Driver is too far from drop location (${distanceKm.toFixed(
            2
          )} km away)`,
        });
      }
    }

    // ========================
    // 7️⃣ CANCELLED STATUS
    // ========================
    if (status === "cancelled") {
      ride.ride_status = "cancelled";
      ride.cancellation_reason = byAdmin
        ? "Cancelled by admin"
        : "Cancelled by rider";
      ride.cancelled_by = byAdmin ? "admin" : "rider";
      ride.cancelled_at = new Date();

      await ride.save();

      // Clear current ride from user
      if (user) {
        user.currentRide = null;
        await user
          .save()
          .catch((err) =>
            console.error(
              `${logPrefix} Failed to clear user currentRide:`,
              err.message
            )
          );
      }

      // Notify user
      if (userFcmToken) {
        await sendNotification
          .sendNotification(
            userFcmToken,
            "Ride Cancelled",
            "Your ride has been cancelled. We hope to serve you again soon.",
            {
              event: "RIDE_CANCELLED",
              rideId: ride._id.toString(),
              cancelledBy: ride.cancelled_by,
            }
          )
          .catch((err) =>
            console.error(`${logPrefix} Notification failed:`, err.message)
          );
      }

      // Emit socket event to driver
      if (io && driver?._id) {
        io.to(`driver:${driver._id}`).emit("clear_ride_request", {
          rideId: ride._id.toString(),
          reason: "cancelled",
        });
      }

      // Notify driver
      if (driver?.fcmToken) {
        await sendNotification
          .sendNotification(
            driver.fcmToken,
            "Ride Cancelled",
            "The ride has been cancelled. We are sending more rides your way soon.",
            {
              event: "RIDE_CANCELLED_DRIVER",
              rideId: ride._id.toString(),
            },
            "ride_cancel_channel"
          )
          .catch((err) =>
            console.error(
              `${logPrefix} Driver notification failed:`,
              err.message
            )
          );
      }

      console.info(`${logPrefix} Ride cancelled by ${ride.cancelled_by}`);

      return res.status(200).json({
        success: true,
        message: "Ride cancelled successfully",
        data: {
          rideId: ride._id,
          ride_status: ride.ride_status,
          cancelled_by: ride.cancelled_by,
          cancelled_at: ride.cancelled_at,
          cancellation_reason: ride.cancellation_reason,
        },
      });
    }

    // ========================
    // 8️⃣ FALLBACK (shouldn't reach here)
    // ========================
    return res.status(400).json({
      success: false,
      error: "Invalid status or operation not handled",
    });
  } catch (error) {
    console.error(`${logPrefix} Internal error:`, error);
    return res.status(500).json({
      success: false,
      error: "Internal server error",
      details: error.message,
    });
  }
};

exports.AdminChangeCurrentRiderRideStatus = async (req, res) => {
  const io = req.app.get("io");

  try {
    const validStatus = [
      "pending",
      "searching",
      "driver_assigned",
      "driver_arrived",
      "in_progress",
      "completed",
      "cancelled",
    ];

    const { riderId, rideId, status, byAdmin } = req.body;

    if (!rideId || !status) {
      return res
        .status(400)
        .json({ error: "Missing riderId, rideId, or status" });
    }

    if (!byAdmin && !validStatus.includes(status)) {
      return res.status(400).json({ error: "Invalid ride status" });
    }

    const foundRide = await RideBooking.findById(rideId)
      .populate("driver")
      .populate("user");

    if (!foundRide) {
      return res.status(404).json({ error: "Ride not found" });
    }

    if (!byAdmin) {
      if (["cancelled", "completed"].includes(foundRide.ride_status)) {
        return res
          .status(400)
          .json({ error: `Cannot update a ${foundRide.ride_status} ride` });
      }
      if (foundRide.ride_status === status) {
        return res
          .status(400)
          .json({ error: `Ride is already marked as ${status}` });
      }
    }

    const { driver, user } = foundRide;
    const userFcmToken = user?.fcmToken || foundRide.user_fcm_token;

    // Validate required driver presence
    const driverRequiredStatuses = [
      "driver_assigned",
      "driver_arrived",
      "in_progress",
      "completed",
    ];
    if (driverRequiredStatuses.includes(status) && !driver) {
      return res.status(400).json({
        error: `Cannot set status '${status}' — no driver assigned to this ride.`,
      });
    }

    // Set common status
    foundRide.ride_status = status;

    // Apply status-specific logic
    switch (status) {
      case "driver_assigned":
        foundRide.driver_assigned_at = new Date();
        break;

      case "driver_arrived":
        foundRide.driver_arrived_at = new Date();
        if (userFcmToken) {
          await sendNotification.sendNotification(
            userFcmToken,
            "Driver Has Arrived",
            `Driver ${driver?.name || ""} has arrived at your pickup location.`,
            {
              event: "DRIVER_ARRIVED",
              rideId: foundRide._id,
            }
          );
        }
        break;

      case "in_progress":
        foundRide.ride_started_at = new Date();
        if (user?.fcmToken) {
          await sendNotification.sendNotification(
            user.fcmToken,
            "Your Ride Has Started",
            "Enjoy your ride!",
            {
              event: "RIDE_STARTED",
              rideId: foundRide._id,
            }
          );
        }
        break;

      case "completed":
        foundRide.ride_ended_at = new Date();

        if (userFcmToken) {
          await sendNotification.sendNotification(
            userFcmToken,
            "Ride Completed",
            "Thank you for riding with us. Please rate your experience!",
            {
              event: "RIDE_COMPLETED",
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
              event: "RIDE_COMPLETED_DRIVER",
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

      case "cancelled":
        foundRide.cancellation_reason = "Cancelled by admin";
        foundRide.cancelled_by = "admin";
        foundRide.cancelled_at = new Date();
        io.to(`driver:${driver?._id}`).emit("clear_ride_request", {
          rideId: foundRide._id,
        });

        if (userFcmToken) {
          await sendNotification.sendNotification(
            userFcmToken,
            "Ride Cancelled",
            "Your ride has been cancelled. We hope to serve you again.",
            {
              event: "RIDE_CANCELLED",
              rideId: foundRide._id,
            }
          );
        }

        if (driver?.fcmToken) {
          await sendNotification.sendNotification(
            driver.fcmToken,
            "You Miss The Ride",
            "Hum apke pass or bhi ride laa rhe h jldi jldi ...",
            {
              event: "RIDE_CANCELLED_DRIVER",
              rideId: foundRide._id,
            },
            "ride_cancel_channel"
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

      case "pending":
      case "searching":
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
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.verifyRideOtp = async (req, res) => {
  try {
    const { riderId, rideId, otp } = req.body;

    // Validate required fields
    if (!riderId || !rideId || !otp) {
      return res.status(400).json({ error: "Missing riderId, rideId, or otp" });
    }

    const foundRide = await RideBooking.findById(rideId)
      .populate("driver")
      .populate("user");

    if (!foundRide) {
      return res.status(404).json({ message: "Ride not found" });
    }

    const { user, driver } = foundRide;

    if (foundRide.ride_status === "cancelled") {
      if (user?.fcmToken) {
        await sendNotification.sendNotification(
          user.fcmToken,
          "Ride Verification Failed",
          "Ride has already been cancelled.",
          { event: "RIDE_CANCELLED", rideId }
        );
      }
      return res
        .status(400)
        .json({ message: "Cannot update a cancelled ride" });
    }

    if (foundRide.ride_status === "completed") {
      if (user?.fcmToken) {
        await sendNotification.sendNotification(
          user.fcmToken,
          "Ride Verification Failed",
          "Ride is already marked as completed.",
          { event: "RIDE_ALREADY_COMPLETED", rideId }
        );
      }
      return res.status(400).json({ message: "Ride is already completed" });
    }

    if (foundRide.ride_status !== "driver_arrived") {
      if (driver?.fcmToken) {
        await sendNotification.sendNotification(
          driver.fcmToken,
          "Cannot Start Ride",
          "You must mark 'Driver Arrived' before verifying OTP.",
          { event: "DRIVER_NOT_ARRIVED", rideId }
        );
      }
      return res
        .status(400)
        .json({ message: "Please mark as arrived at the customer location" });
    }

    // OTP check
    if (foundRide.ride_otp !== otp) {
      if (user?.fcmToken) {
        await sendNotification.sendNotification(
          user.fcmToken,
          "Invalid OTP",
          "The OTP you entered is incorrect. Please try again.",
          { event: "INVALID_OTP", rideId }
        );
      }
      return res.status(400).json({ message: "Invalid OTP" });
    }

    // OTP is valid – mark ride as in progress
    foundRide.ride_status = "in_progress";
    foundRide.ride_started_at = new Date();
    await foundRide.save();

    // Send success notification
    if (user?.fcmToken) {
      await sendNotification.sendNotification(
        user.fcmToken,
        "Ride Started",
        "Your ride has started. Enjoy the journey!",
        { event: "RIDE_STARTED", rideId }
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
    return res.status(500).json({ error: "Internal server error" });
  }
};

exports.collectPayment = async (req, res) => {
  const MAX_RETRIES = 3;
  const RETRY_DELAY = 100; // ms

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  class RetryableError extends Error {
    constructor(message) {
      super(message);
      this.name = "RetryableError";
    }
  }

  const executePaymentTransaction = async (attempt = 1) => {
    const session = await mongoose.startSession();

    let paidAmount = 0;
    let discountUsed = 0;
    let userGetCashback = false;
    let cashbackGet = 0;
    let bonusAmount = 0;

    console.log(
      `\n🚀 [Transaction Attempt ${attempt}] Starting payment collection...`
    );

    try {
      const { riderId, rideId, amount, mode } = req.body;
      console.log("📦 Request Body:", { riderId, rideId, amount, mode });

      if (!riderId || !rideId || !mode || !amount) {
        console.error("❌ Missing required fields");
        throw new Error(
          "Missing required fields: riderId, rideId, amount, mode"
        );
      }

      await session.startTransaction({
        readConcern: { level: "snapshot" },
        writeConcern: { w: "majority" },
        maxCommitTimeMS: 30000,
      });
      console.log("🔄 Transaction started...");

      const foundRide = await RideBooking.findById(rideId)
        .populate("driver")
        .populate("user")
        .session(session);

      if (!foundRide) throw new Error("Ride not found");
      console.log("🚗 Ride found:", foundRide._id);

      if (foundRide.ride_status === "cancelled") {
        console.warn("⚠️ Ride is cancelled, aborting payment.");
        if (foundRide.user) {
          await User.findByIdAndUpdate(
            foundRide.user._id,
            { currentRide: null },
            { session }
          );
          console.log("🧹 Cleared currentRide for user:", foundRide.user._id);
        }
        throw new Error("Cannot collect payment for a cancelled ride");
      }

      const { user, driver, pricing } = foundRide;
      const foundRider = await RiderModel.findById(driver?._id).session(
        session
      );
      console.log("👤 Rider found:", foundRider?._id);
      console.log("👥 User found:", user?._id);

      if (user) {
        user.currentRide = null;
        await user.save();
      }
      const totalFare = pricing?.total_fare || 0;
      paidAmount = parseFloat(amount);

      console.log(
        `💰 Fare Validation: totalFare=₹${totalFare}, paidAmount=₹${paidAmount}`
      );

      if (isNaN(paidAmount) || paidAmount <= 0 || paidAmount > totalFare) {
        throw new Error(`Invalid payment amount. Expected ≤ ₹${totalFare}`);
      }

      const updates = [];

      // ——————— CASHBACK DEDUCTION ———————
      if (foundRide?.pricing?.discount > 0 && user) {
        discountUsed = foundRide.pricing.discount;
        const newCashback = Math.max(0, (user.cashback || 0) - discountUsed);

        console.log(
          `💸 Cashback deduction: Used ₹${discountUsed}, New cashback balance: ₹${newCashback}`
        );

        updates.push({
          model: User,
          filter: { _id: user._id },
          update: {
            $set: { cashback: newCashback },
            $push: {
              cashbackHistory: {
                rideId: foundRide._id,
                amount: discountUsed,
                date: new Date(),
              },
            },
          },
        });
      }

      // ——————— WALLET UPDATE ———————
      if (foundRider && discountUsed > 0) {
        const walletAmount = Number(foundRider.Wallet) || 0;
        const newWalletAmount = walletAmount + discountUsed;

        console.log(
          `🏦 Wallet before: ₹${walletAmount}, after: ₹${newWalletAmount}`
        );

        let walletApiSuccess = false;
        try {
          console.log(
            `[🌐 Wallet API] Adding ₹${discountUsed} to BH: ${foundRider.BH}`
          );
          const response = await axios.post(
            "https://webapi.olyox.com/api/v1/add-amount-on-wallet",
            { BhId: foundRider.BH, amount: discountUsed }
          );
          console.log("[🌐 Wallet API Response]:", response.data);

          if (response.data.success) {
            walletApiSuccess = true;
            console.log(`✅ Wallet API success for BH: ${foundRider.BH}`);
          }
        } catch (apiError) {
          console.error(
            "❌ Wallet API Failed:",
            apiError.response?.data || apiError.message
          );
        }

        if (!walletApiSuccess) {
          console.error(
            "🚫 Wallet API not successful, aborting transaction..."
          );
          throw new Error(`Failed to update wallet for BH: ${foundRider.BH}`);
        }

        updates.push({
          model: RiderModel,
          filter: { _id: foundRider._id },
          update: {
            $set: {
              Wallet: newWalletAmount,
              TotalRides: (foundRider.TotalRides || 0) + 1,
              points:
                (foundRider.points || 0) + Math.floor(Math.random() * 5) + 1,
              isAvailable: true,
              on_ride_id: null,
              on_intercity_ride_id: null,
            },
            $push: {
              WalletHistory: {
                rideId: foundRide._id,
                amount: discountUsed,
                date: new Date(),
                from: user?._id,
              },
            },
          },
        });
      } else if (foundRider) {
        console.log("ℹ️ No cashback used — updating driver basic stats only.");
        updates.push({
          model: RiderModel,
          filter: { _id: foundRider._id },
          update: {
            $set: {
              TotalRides: (foundRider.TotalRides || 0) + 1,
              points:
                (foundRider.points || 0) + Math.floor(Math.random() * 5) + 1,
              isAvailable: true,
              on_ride_id: null,
              on_intercity_ride_id: null,
            },
          },
        });
      }

      // ——————— FIRST RIDE BONUS ———————
      console.log("🎁 Checking for first ride bonus eligibility...");
      if (user && !user.firstRideCompleted && !user.isFirstRideBonusRecived) {
        if (totalFare > 100) {
          bonusAmount = Math.floor(Math.random() * 21) + 10;
          userGetCashback = true;
          cashbackGet = bonusAmount;
          console.log(`🎉 User eligible for first ride bonus: ₹${bonusAmount}`);

          // Apply bonus + referral updates
          // (kept same logic, with added logs)
          const referrerCode = user.appliedReferralCode;
          if (referrerCode) {
            const referrer = await User.findOne({
              referralCode: referrerCode,
            }).session(session);
            if (referrer) {
              console.log(
                `🤝 Referral bonus: ₹${bonusAmount} credited to referrer ${referrer._id}`
              );
              updates.push({
                model: User,
                filter: { _id: referrer._id },
                update: {
                  $set: { cashback: (referrer.cashback || 0) + bonusAmount },
                  $push: {
                    cashbackHistory: {
                      rideId,
                      amount: bonusAmount,
                      date: new Date(),
                    },
                  },
                },
              });
            }
          }
        } else {
          console.log(
            "🚫 User not eligible for first ride bonus (fare ≤ ₹100)"
          );
        }
      } else {
        console.log(
          "✅ User already completed first ride — skipping bonus logic."
        );
      }

      // ——————— UPDATE RIDE STATUS ———————
      console.log("📝 Updating ride to completed...");
      updates.push({
        model: RideBooking,
        filter: { _id: foundRide._id },
        update: {
          $set: {
            payment_method: mode,
            payment_status: "completed",
            ride_status: "completed",
            ride_ended_at: new Date(),
            "pricing.collected_amount": paidAmount,
            cashback: userGetCashback ? cashbackGet : 0,
            isCashbackGet: userGetCashback,
          },
        },
      });

      // ——————— EXECUTE ALL UPDATES ———————
      console.log(`🧾 Executing ${updates.length} DB updates...`);
      for (const update of updates) {
        console.log(
          `➡️ Updating ${update.model.modelName} where`,
          update.filter
        );
        await update.model.updateOne(update.filter, update.update, { session });
      }

      await session.commitTransaction();
      console.log(`✅ Transaction committed successfully for ride ${rideId}`);

      return {
        success: true,
        message: "Payment collected successfully. Ride completed.",
        rideId,
        amount: paidAmount,
        method: mode,
        cashback: cashbackGet,
        isCashbackGet: userGetCashback,
      };
    } catch (error) {
      console.error("💥 Transaction error:", error.message);
      if (session.inTransaction()) {
        await session.abortTransaction();
        console.warn("⛔ Transaction aborted.");
      }

      const isRetriable =
        error.code === 112 ||
        error.code === 11000 ||
        (error.errorLabels &&
          error.errorLabels.includes("TransientTransactionError"));

      if (isRetriable && attempt < MAX_RETRIES) {
        console.log(
          `🔁 Retrying transaction (${attempt + 1}/${MAX_RETRIES}) in ${
            RETRY_DELAY * attempt
          }ms`
        );
        await delay(RETRY_DELAY * attempt);
        throw new RetryableError(error.message);
      }

      throw error;
    } finally {
      session.endSession();
      console.log("🔚 Session ended for attempt", attempt);
    }
  };

  // ——————— MAIN RETRY LOOP ———————
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await executePaymentTransaction(attempt);
      console.log("🎯 Final Payment Result:", result);
      return res.status(200).json(result);
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed:`, error.message);
      if (error instanceof RetryableError && attempt < MAX_RETRIES) continue;

      console.error("🚨 Payment Collection Failed:", error);
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
    this.name = "RetryableError";
  }
}

exports.cancelRideByPoll = async (req, res) => {
  const session = await mongoose.startSession();
  const io = req.app.get("io");

  try {
    const { ride, cancelBy, reason_id, reason, intercity } = req.body;
    console.log("📥 Cancel Ride Request Body:", req.body);

    if (!ride || !cancelBy) {
      return res.status(400).json({
        success: false,
        message: "Ride ID and cancelBy are required.",
      });
    }

    await session.withTransaction(async () => {
      let rideData = await RideBooking.findById(ride)
        .populate("driver user")
        .session(session);

      let isIntercityRide = !!intercity; // use the intercity flag from request

      if (!rideData && isIntercityRide) {
        console.log(
          "ℹ️ Ride not found by _id, trying RideBooking by intercityRideModel..."
        );
        rideData = await RideBooking.findOne({ intercityRideModel: ride })
          .populate("driver user")
          .session(session);
      }

      if (!rideData) {
        console.warn(
          "❌ Ride not found in RideBooking by _id or intercityRideModel:",
          ride
        );
        throw new Error("Ride not found");
      }

      // ✅ Only check statuses if cancelled by user
      if (cancelBy !== "driver") {
        const blockedStatuses = [
          "cancelled",
          "completed",
          "driver_arrived",
          "in_progress",
        ];
        if (blockedStatuses.includes(rideData.ride_status)) {
          let msg = "";
          switch (rideData.ride_status) {
            case "cancelled":
              msg = "Ride has already been cancelled.";
              break;
            case "completed":
              msg = "Ride has already been completed.";
              break;
            case "driver_arrived":
              msg = "Driver has already arrived. Ride cannot be cancelled now.";
              break;
            case "in_progress":
              msg = "Ride is already in progress. Cancellation not allowed.";
              break;
            default:
              msg = "Ride cannot be cancelled at this stage.";
          }
          throw new Error(msg);
        }
      }

      // ✅ Cancel the ride
      rideData.ride_status = "cancelled";
      rideData.payment_status = "cancelled";
      rideData.cancelled_by = cancelBy;
      rideData.cancelled_at = new Date();
      rideData.cancellation_reason = reason || null;

      stopBackgroundNotifications(rideData._id);

      // 🔹 Free driver if assigned
      if (rideData.driver) {
        const driver = await RiderModel.findById(rideData.driver._id).session(
          session
        );
        if (driver) {
          // Clear driver references only if they match the ride being cancelled
          if (driver.on_ride_id?.toString() === rideData._id.toString()) {
            driver.on_ride_id = null;
            console.log(`🚗 Cleared on_ride_id for driver ${driver._id}`);
          }

          if (
            driver.on_intercity_ride_id?.toString() === rideData._id.toString()
          ) {
            driver.on_intercity_ride_id = null;
            console.log(
              `🚗 Cleared on_intercity_ride_id for driver ${driver._id}`
            );
          }

          driver.isAvailable = true;
          await driver.save({ session });
        }

        // Notify driver if user cancelled
        if (cancelBy === "user" && driver?.fcmToken) {
          await sendNotification.sendNotification(
            driver.fcmToken,
            "Ride Cancelled by User",
            "The user has cancelled the ride request.",
            {
              event: "RIDE_CANCELLED",
              rideId: rideData._id,
              message: "The user has cancelled the ride request.",
              screen: "DriverHome",
            },
            "ride_cancel_channel"
          );
        }
      }

      // 🔹 Clear user's current ride
      if (rideData.user) {
        if (isIntercityRide) {
          rideData.user.IntercityRide = null;
        } else {
          rideData.user.currentRide = null;
        }
        await rideData.user.save({ session });
      }

      await rideData.save({ session });

      // Emit clear ride request event
      if (io) {
        io.to(`driver:${rideData?.driver?._id}`).emit("clear_ride_request", {
          rideId: rideData._id,
        });
      }

      // Notify user if driver cancelled
      if (cancelBy === "driver" && rideData.user?.fcmToken) {
        await sendNotification.sendNotification(
          rideData.user.fcmToken,
          "Ride Cancelled by Driver",
          "The driver has cancelled your ride.",
          {
            event: "RIDE_CANCELLED",
            rideId: rideData._id,
            message: "The driver has cancelled your ride.",
            screen: "RideHistory",
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
    return res.status(400).json({
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
      return res
        .status(400)
        .json({ message: "Ride ID and rating are required." });
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
      newAverage =
        (driver.Ratings * driver.TotalRatingsCount + rating) /
        (driver.TotalRatingsCount + 1);
    }

    driver.Ratings = Math.max(1, Math.min(5, newAverage)); // clamp between 1–5
    driver.TotalRatingsCount = driver.TotalRatingsCount + 1;

    await driver.save();
    if (rideData?.user) {
      if (rideData.user.currentRide !== null) {
        rideData.user.currentRide = null;
        await rideData.user.save();
        console.log("✅ Cleared currentRide for user:", rideData.user._id);
      } else {
        console.log("ℹ️ currentRide already null for user:", rideData.user._id);
      }
    }

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
      return res.status(400).json({
        success: false,
        message: "lat, lng, and vehicleType are required.",
      });
    }

    const fiftyMinutesAgo = new Date(Date.now() - 50 * 60 * 1000); // 50 minutes ago

    const riders = await RiderModel.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [lng, lat] },
          distanceField: "distance",
          maxDistance: 10000, // 10km in meters
          spherical: true,
        },
      },
      {
        $match: {
          isAvailable: true,
          lastUpdated: { $gte: fiftyMinutesAgo },
          $or: [{ on_ride_id: null }, { on_ride_id: "" }],
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
          lastActiveAt: 1,
          lastUpdated: 1,
          preferences: 1,
        },
      },
      { $sort: { distance: 1 } },
    ]);

    console.info(`Found ${riders.length} riders within 10km.`);

    const currentDate = new Date();

    const validRiders = riders.filter((rider) => {
      // ✅ Check recharge validity
      const expireDate = rider?.RechargeData?.expireData;
      if (!expireDate || new Date(expireDate) < currentDate) {
        console.debug(
          `Rider ${rider._id} skipped due to expired recharge (${expireDate})`
        );
        return false;
      }

      // ✅ Vehicle type and preference filtering
      const normalizeVehicleType = (type) =>
        type?.toString().toUpperCase().trim() || null;
      const driverType = normalizeVehicleType(
        rider?.rideVehicleInfo?.vehicleType
      );
      const requestedType = normalizeVehicleType(vehicleType);
      const prefs = rider.preferences || {};

      if (!driverType) {
        console.warn(`Rider ${rider._id} has no vehicle type, skipping`);
        return false;
      }

      let decision = false;

      if (requestedType === "BIKE") {
        decision = driverType === "BIKE";
      } else if (requestedType === "AUTO") {
        decision = driverType === "AUTO";
      } else if (requestedType === "MINI") {
        if (driverType === "MINI") decision = true;
        else if (driverType === "SEDAN" && prefs.OlyoxAcceptMiniRides?.enabled)
          decision = true;
        else if (
          ["SUV", "XL", "SUV/XL"].includes(driverType) &&
          prefs.OlyoxAcceptMiniRides?.enabled
        )
          decision = true;
      } else if (requestedType === "SEDAN") {
        if (driverType === "SEDAN") decision = true;
        else if (
          ["SUV", "XL", "SUV/XL"].includes(driverType) &&
          prefs.OlyoxAcceptSedanRides?.enabled
        )
          decision = true;
      } else if (["SUV", "SUV/XL", "XL"].includes(requestedType)) {
        decision = ["SUV", "XL", "SUV/XL"].includes(driverType);
      }

      if (decision) {
        console.info(
          `✅ Matched: ${rider.name} (${rider._id}) - Driver: ${driverType}, Requested: ${requestedType}`
        );
      } else {
        console.debug(
          `❌ Rejected: ${rider.name} (${rider._id}) - Driver: ${driverType}, Requested: ${requestedType}`
        );
      }

      return decision;
    });

    console.info(
      `Found ${validRiders.length} valid riders within 10km after filtering.`
    );

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
      error: error.message,
    });
  }
};

exports.findMyRideNewMode = async (req, res) => {
  try {
    const userId = req.params.id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Fetch Normal Rides
    const normalRides = await RideBooking.find({ user: userId })
      .select("-rejected_by_drivers -notified_riders -user -route_info")
      .sort({ created: -1 });

    // Prioritize active rides within each category
    const priorityStatuses = [
      "driver_assigned",
      "in_progress",
      "driver_reached",
      "otp_verify",
      "ride_in_progress",
    ];

    const sortByStatusAndDate = (rides) =>
      rides.sort((a, b) => {
        const aPriority = priorityStatuses.includes(a.rideStatus) ? 1 : 0;
        const bPriority = priorityStatuses.includes(b.rideStatus) ? 1 : 0;
        return (
          bPriority - aPriority ||
          new Date(b.createdAt || b.created) -
            new Date(a.createdAt || a.created)
        );
      });

    const intercityRides = normalRides.filter(
      (i) => i.isIntercityRides || i.isIntercity
    );
    const sortedNormalRides = sortByStatusAndDate(normalRides);
    const sortedIntercityRides = sortByStatusAndDate(intercityRides);

    return res.status(200).json({
      success: true,
      message: "Rides fetched successfully",
      normalRides: sortedNormalRides,
      intercityRides: sortedIntercityRides,
    });
  } catch (error) {
    console.error("Error fetching rides:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
