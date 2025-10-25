const axios = require('axios');
const RidesSuggestionModel = require('../../models/Admin/RidesSuggestion.model');
const settings = require('../../models/Admin/Settings');

// In-memory cache for directions (simple cache for current session)
const directionsCache = new Map();
const weatherCache = new Map();

// Cache cleanup - remove entries older than 15 minutes
const cleanupCache = (cache, maxAge = 900000) => { // 15 minutes in milliseconds
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > maxAge) {
      cache.delete(key);
    }
  }
};

const isNightTimeNow = (timezone = 'Asia/Kolkata') => {
  try {
    const now = new Date();
    const currentHour = new Date(now.toLocaleString("en-US", { timeZone: timezone })).getHours();
    return currentHour >= 22 || currentHour < 6;
  } catch (error) {
    console.warn('Error determining time zone, using system time:', error.message);
    const currentHour = new Date().getHours();
    return currentHour >= 22 || currentHour < 6;
  }
};

const parseNumericValue = (value, defaultValue = 0) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const match = value.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : defaultValue;
  }
  return defaultValue;
};

// Optimized Google Maps API call with in-memory cache
async function getDirectionsData(origin, destination, cacheKey) {
  try {
    // Clean old cache entries
    cleanupCache(directionsCache);

    // Check in-memory cache first
    const cached = directionsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 900000)) { // 15 minutes
      console.log(`[CACHE HIT] Directions: ${cacheKey}`);
      return cached.data;
    }

    console.log(`[API CALL] Fetching directions from Google Maps...`);
    const originStr = `${origin.latitude},${origin.longitude}`;
    const destinationStr = `${destination.latitude},${destination.longitude}`;

    const response = await axios.get("https://maps.googleapis.com/maps/api/directions/json", {
      params: {
        origin: originStr,
        destination: destinationStr,
        key: "AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8",
        traffic_model: "best_guess",
        departure_time: "now",
        units: "metric"
      },
      timeout: 15000
    });

    if (!response.data?.routes?.length) {
      throw new Error("No routes found");
    }

    const route = response.data.routes[0];
    const leg = route.legs[0];

    if (!leg?.distance?.value || !leg?.duration?.value) {
      throw new Error("Invalid route data");
    }

    // Standardize the data format
    const standardizedData = {
      distance_km: leg.distance.value / 1000,
      duration_minutes: leg.duration.value / 60,
      traffic_duration_minutes: leg.duration_in_traffic?.value / 60 || leg.duration.value / 60,
      distance_text: leg.distance.text,
      duration_text: leg.duration.text,
      polyline: route.overview_polyline?.points || null
    };

    // Cache in memory for 15 minutes
    directionsCache.set(cacheKey, {
      data: standardizedData,
      timestamp: Date.now()
    });
    console.log(`[CACHE SET] Directions cached: ${cacheKey}`);

    return standardizedData;

  } catch (error) {
    console.error('[DIRECTIONS ERROR]:', error.message);
    throw new Error(`Failed to fetch directions: ${error.message}`);
  }
}

// Simple weather check (optional, non-blocking) with in-memory cache
async function getWeatherCondition(latitude, longitude) {
  const cacheKey = `weather:${latitude},${longitude}`;

  try {
    // Clean old cache entries
    cleanupCache(weatherCache, 600000); // 10 minutes for weather

    const cached = weatherCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 600000)) { // 10 minutes
      return cached.data.isRaining || false;
    }
    const apiKey = process.env.OPEN_WEATHER_API_KEY;

    // Quick weather check with timeout
    const weatherResponse = await axios.get(`https://api.openweathermap.org/data/2.5/weather`, {
      params: {
        lat: latitude,
        lon: longitude,
        appid: apiKey,
        units: "metric"
      },
      timeout: 5000
    });

    const isRaining = weatherResponse.data?.weather?.[0]?.main === 'Rain';

    // Cache in memory for 10 minutes
    weatherCache.set(cacheKey, {
      data: { isRaining },
      timestamp: Date.now()
    });

    return isRaining;
  } catch (error) {
    console.warn('[WEATHER WARNING]:', error.message);
    return false; // Default to no rain if weather check fails
  }
}

/**
 * Calculate rental prices for vehicles (only if distance < 69 km and isLater = false)
 */
async function calculateRentalPrices(distance_km, traffic_duration_minutes) {
  try {
    // Fetch rental settings
    const rentalSettings = await settings.findOne().select('rental');

    if (!rentalSettings || !rentalSettings.rental) {
      console.warn('⚠️ No rental settings found in database');
      return [];
    }

    const rentalVehicles = [];
    const vehicleTypes = ['mini', 'sedan', 'suv'];

    for (const vehicleType of vehicleTypes) {
      const rentalConfig = rentalSettings.rental[vehicleType];
      if (!rentalConfig || !rentalConfig.isAvailable) continue;

      const {
        baseKmPrice = 0,
        pricePerKm = 0,
        pricePerMin = 0,
        vehicleImage = '',
        baseFare = 0,
        fixedKmforBaseFare = 0,
        showingName = vehicleType.toUpperCase(),
        isAvailable
      } = rentalConfig;

      // ✅ Enforce minimum 1-hour (60 min) charge
      const effectiveMinutes = Math.max(traffic_duration_minutes, 60);

      // ✅ Distance breakdown logic
      const extraKm = Math.max(0, distance_km - fixedKmforBaseFare);

      // ✅ Cost calculations
      const extraKmCost = extraKm * pricePerKm;
      const timeCost = effectiveMinutes * pricePerMin;

      // ✅ Total price
      const totalPrice = baseFare + extraKmCost + timeCost;

      // ✅ Construct response
      rentalVehicles.push({
        vehicleType: showingName,
        vehicleName: vehicleType.toUpperCase(),
        vehicleImage,
        totalPrice: Math.round(totalPrice * 100) / 100,
        distanceInKm: Math.round(distance_km * 100) / 100,
        durationInMinutes: Math.round(effectiveMinutes * 100) / 100,
        pricing: {
          baseFare: Math.round(baseFare * 100) / 100,
          baseKmIncluded: fixedKmforBaseFare,
          extraKm: Math.round(extraKm * 100) / 100,
          extraKmCost: Math.round(extraKmCost * 100) / 100,
          timeCost: Math.round(timeCost * 100) / 100,
          pricePerKm: Math.round(pricePerKm * 100) / 100,
          pricePerMin: Math.round(pricePerMin * 100) / 100
        },
        isRental: true,
        isAvailable
      });
    }

    // Sort results by total price
    rentalVehicles.sort((a, b) => a.totalPrice - b.totalPrice);

    console.log(`✅ Calculated rental prices for ${rentalVehicles.length} vehicle types`);
    return rentalVehicles;

  } catch (error) {
    console.error('❌ Error calculating rental prices:', error.message);
    return [];
  }
}



// Main price calculation function
exports.calculateRidePriceForUser = async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      origin,
      destination,
      distance,
      isLater = false,
      duration,
      waitingTimeInMinutes = 0,
      vehicleIds = [],
      isNightTime,
      timezone = 'Asia/Kolkata'
    } = req.body;

    console.log("📋 Request Body for price:", req.body);

    // Input validation
    if (!origin?.latitude || !origin?.longitude ||
      !destination?.latitude || !destination?.longitude) {
      return res.status(400).json({
        success: false,
        message: "Invalid origin or destination coordinates",
        executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
      });
    }

    // Validate coordinate ranges
    if (Math.abs(origin.latitude) > 90 || Math.abs(origin.longitude) > 180 ||
      Math.abs(destination.latitude) > 90 || Math.abs(destination.longitude) > 180) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinate ranges",
        executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
      });
    }

    // Auto-detect night time
    const actualIsNightTime = isNightTime !== undefined ? isNightTime : isNightTimeNow(timezone);

    // Create cache keys
    const directionsCacheKey = `directions:${origin.latitude},${origin.longitude}:${destination.latitude},${destination.longitude}`;

    // Get directions data (primary requirement)
    const directionsData = await getDirectionsData(origin, destination, directionsCacheKey);

    // Get weather condition (non-blocking, optional)
    let isRaining = false;
    try {
      isRaining = await Promise.race([
        getWeatherCondition(origin.latitude, origin.longitude),
        new Promise(resolve => setTimeout(() => resolve(false), 3000)) // 3 second timeout
      ]);
    } catch (error) {
      console.warn('⚠️ Weather check failed, proceeding without weather data');
    }

    const { distance_km, traffic_duration_minutes } = directionsData;

    // Validate route data
    if (distance_km <= 0 || traffic_duration_minutes <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid route data: distance or duration is zero or negative",
        executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
      });
    }

    // Determine ride type based on distance and isLater flag
    const isIntercityRide = distance_km > 69;
    const shouldCalculateRentals = distance_km < 69;

    console.log(`🚗 Ride Type: ${isIntercityRide ? 'INTERCITY' : 'LOCAL'} | Distance: ${distance_km.toFixed(2)} km | isLater: ${isLater}`);

    // ===== FETCH VEHICLES WITH FILTERING =====
    let vehicleQuery = { status: true };

    // If specific vehicle IDs are provided, use them
    if (vehicleIds.length > 0) {
      vehicleQuery._id = { $in: vehicleIds };
    }

    // CRITICAL FIX: For intercity rides or later rides, exclude Bike and Auto
    // The database field is 'name', not 'vehicleName'
    if (isIntercityRide) {
      console.log('🚫 Intercity/Later ride detected - Excluding Bike and Auto');

      // Use case-insensitive regex to match all variations of Bike and Auto
      vehicleQuery.name = {
        $not: { $regex: /^(bike|auto)$/i }
      };
    }

    console.log('🔍 Vehicle Query:', JSON.stringify(vehicleQuery, null, 2));

    const vehicles = await RidesSuggestionModel.find(vehicleQuery);

    if (!vehicles.length) {
      return res.status(404).json({
        success: false,
        message: vehicleIds.length > 0
          ? "No active vehicles found for the specified vehicle IDs"
          : isIntercityRide
            ? "No active vehicles found for intercity rides (Bike and Auto excluded)"
            : "No active vehicles found",
        executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
      });
    }

    console.log(`✅ Found ${vehicles.length} eligible vehicles (Bike/Auto excluded: ${isIntercityRide})`);

    // Calculate prices for all vehicles
    const vehiclePrices = vehicles.map(vehicle => {
      // Base calculations
      const baseFare = vehicle.baseFare || 0;
      const baseKM = vehicle.baseKM || 0;
      const perKM = vehicle.perKM || 0;
      const perMin = vehicle.perMin || 0;
      const waitingChargePerMin = vehicle.waitingChargePerMin || 0;
      const nightPercent = vehicle.nightPercent || 0;
      const minFare = vehicle.minFare || baseFare;

      // Distance cost (only charge for distance beyond base KM)
      const chargeableDistance = Math.max(0, distance_km - baseKM);
      const distanceCost = chargeableDistance * perKM;

      // Time cost
      const timeCost = traffic_duration_minutes * perMin;

      // Waiting time cost
      const waitingTimeCost = waitingTimeInMinutes * waitingChargePerMin;

      // Night surcharge (percentage of base components)
      const nightSurcharge = actualIsNightTime
        ? ((baseFare + distanceCost) * nightPercent) / 100
        : 0;

      // Rain surcharge (if applicable)
      const rainSurcharge = isRaining && vehicle.rainSurcharge
        ? vehicle.rainSurcharge
        : 0;

      // Calculate total price
      let totalPrice = baseFare + distanceCost + timeCost + waitingTimeCost + nightSurcharge + rainSurcharge;

      // Apply minimum fare
      totalPrice = Math.max(totalPrice, minFare);

      return {
        vehicleId: vehicle._id.toString(),
        vehicleName: vehicle.name || 'Unknown Vehicle',
        vehicleType: vehicle.vehicleType || null,
        vehicleImage: vehicle.icons_image?.url || null,
        totalPrice: Math.round(totalPrice * 100) / 100,
        distanceInKm: Math.round(distance_km * 100) / 100,
        durationInMinutes: Math.round(traffic_duration_minutes * 100) / 100,
        pricing: {
          baseFare: Math.round(baseFare * 100) / 100,
          distanceCost: Math.round(distanceCost * 100) / 100,
          timeCost: Math.round(timeCost * 100) / 100,
          waitingTimeCost: Math.round(waitingTimeCost * 100) / 100,
          nightSurcharge: Math.round(nightSurcharge * 100) / 100,
          rainSurcharge: Math.round(rainSurcharge * 100) / 100
        },
        conditions: {
          isNightTime: actualIsNightTime,
          isRaining,
          baseKmIncluded: baseKM,
          chargeableDistance: Math.round(chargeableDistance * 100) / 100
        },
        isRental: false
      };
    });

    // Calculate rental prices if conditions are met
    // Rentals are NOT included for intercity rides or later rides
    let rentalVehiclePrices = [];
    if (shouldCalculateRentals) {
      console.log('🚕 Calculating rental vehicle prices (distance < 69 km and isLater = false)...');
      rentalVehiclePrices = await calculateRentalPrices(distance_km, traffic_duration_minutes);
    } else {
      console.log('🚫 Skipping rental calculations (intercity ride or later ride)');
    }

    const executionTime = `${((performance.now() - startTime) / 1000).toFixed(3)}s`;

    console.log("💰 Price Calculation Summary:", {
      distance: `${distance_km.toFixed(2)} km`,
      duration: `${traffic_duration_minutes.toFixed(2)} mins`,
      isNightTime: actualIsNightTime,
      isRaining,
      isLater,
      isIntercityRide,
      regularVehicleCount: vehicles.length,
      rentalVehicleCount: rentalVehiclePrices.length,
      bikeAutoExcluded: isIntercityRide,
      executionTime
    });

    // Sort regular vehicles by price (lowest first)
    vehiclePrices.sort((a, b) => a.totalPrice - b.totalPrice);

    // Prepare response
    const response = {
      success: true,
      message: "Ride prices calculated successfully",
      rideType: isIntercityRide ? 'intercity' : 'local',
      routeInfo: {
        distanceInKm: Math.round(distance_km * 100) / 100,
        durationInMinutes: Math.round(traffic_duration_minutes * 100) / 100,
        distanceText: directionsData.distance_text,
        durationText: directionsData.duration_text,
        isIntercityRide,
        isLaterRide: isLater,
        conditions: {
          isNightTime: actualIsNightTime,
          isRaining,
          timeDetection: isNightTime !== undefined ? 'manual' : 'auto-detected'
        }
      },
      vehiclePrices,
      executionTime
    };

    // Add rental prices to response if available (only for local non-later rides)
    if (rentalVehiclePrices.length > 0) {
      response.rentalVehiclePrices = rentalVehiclePrices;
      response.message = "Ride prices calculated successfully (including rental options)";
    }

    // Add note about excluded vehicles for intercity/later rides
    if (isIntercityRide) {
      response.note = "Bike and Auto excluded for intercity/later rides. Rental vehicles not available.";
    }

    return res.status(200).json(response);

  } catch (error) {
    const executionTime = `${((performance.now() - startTime) / 1000).toFixed(3)}s`;
    console.error("❌ Error calculating ride price:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to calculate the ride price",
      error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error",
      executionTime
    });
  }
};

exports.reCalculatePriceForOnlyRentals = async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      rentalType,
      originalHours,
      additionalHours,
      originalDistanceKm,
      currentFare = 0
    } = req.body;

    const origHrs = parseFloat(originalHours);
    const addHrs = parseFloat(additionalHours);
    const origDist = parseFloat(originalDistanceKm);
    const currFare = parseFloat(currentFare);

    // Validate input
    if (isNaN(origHrs) || isNaN(addHrs) || isNaN(origDist) || origHrs < 0 || origDist < 0) {
      return res.status(400).json({ success: false, message: "Invalid numeric values" });
    }

    // Fetch rental settings
    const rentalSettings = await settings.findOne().select("rental");
    const config = rentalSettings?.rental?.[rentalType];
    if (!config || !config.isAvailable) {
      return res.status(400).json({ success: false, message: "Rental type unavailable" });
    }

    const { pricePerMin } = config;

    let totalHours = origHrs + addHrs;
    let estimatedDistanceKm = origDist;
    let additionalTimeCost = 0;
    let totalFare = currFare;

    // Special case: originalHours = 1 AND additionalHours = 1
    if (origHrs === 1 && addHrs === 1) {
      estimatedDistanceKm += 15; // add 15 km
      totalHours = origHrs;       // keep hours same
      totalFare = currFare;       // keep fare same
    } else if (addHrs > 0) {
      // Normal calculation for other cases
      const additionalMinutes = addHrs * 60;
      additionalTimeCost = additionalMinutes * pricePerMin;

      // Extra distance only after first hour
      const extraHoursAfterFirst = Math.max(totalHours - 1, 0);
      estimatedDistanceKm = origDist + (extraHoursAfterFirst * 15);

      // Update total fare
      totalFare = currFare + additionalTimeCost;
    }

    const response = {
      success: true,
     additional: {
        originalHours: parseFloat(origHrs.toFixed(2)),
        additionalHours: parseFloat(addHrs.toFixed(2)),
        current:originalDistanceKm,
        totalHours: parseFloat(totalHours.toFixed(2)),
        estimatedDistanceKm: parseFloat(estimatedDistanceKm.toFixed(2)),
        currentFare: parseFloat(currFare.toFixed(2)),
        additionalTimeCost: parseFloat(additionalTimeCost.toFixed(2)),
        totalFare: parseFloat(totalFare.toFixed(2))
      },
      executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
    };

    console.log("📋 Recalculation:", response.additional);

    return res.status(200).json(response);

  } catch (error) {
    console.error("❌ Error in reCalculatePriceForOnlyRentals:", error);
    return res.status(500).json({ success: false, message: error.message || error });
  }
};
