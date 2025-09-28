const axios = require('axios');
const RidesSuggestionModel = require('../../models/Admin/RidesSuggestion.model');

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
        appid: apiKey, // Replace with your weather API key
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

// Main price calculation function
exports.calculateRidePriceForUser = async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      origin,
      destination,
      waitingTimeInMinutes = 0,
      vehicleIds = [],
      isNightTime,
      timezone = 'Asia/Kolkata'
    } = req.body;

    console.log("Request Body for price:", req.body);

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

    // Fetch vehicles
    const vehicleQuery = vehicleIds.length > 0
      ? { _id: { $in: vehicleIds }, status: true }
      : { status: true };

    const vehicles = await RidesSuggestionModel.find(vehicleQuery);

    if (!vehicles.length) {
      return res.status(404).json({
        success: false,
        message: vehicleIds.length > 0
          ? "No active vehicles found for the specified vehicle IDs"
          : "No active vehicles found",
        executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
      });
    }

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
      console.warn('Weather check failed, proceeding without weather data');
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
        }
      };
    });

    const executionTime = `${((performance.now() - startTime) / 1000).toFixed(3)}s`;

    console.log("Price Calculation Summary:", {
      distance: `${distance_km.toFixed(2)} km`,
      duration: `${traffic_duration_minutes.toFixed(2)} mins`,
      isNightTime: actualIsNightTime,
      isRaining,
      vehicleCount: vehicles.length,
      executionTime
    });

    // Sort by price (lowest first)
    vehiclePrices.sort((a, b) => a.totalPrice - b.totalPrice);

    return res.status(200).json({
      success: true,
      message: "Ride prices calculated successfully",
      routeInfo: {
        distanceInKm: Math.round(distance_km * 100) / 100,
        durationInMinutes: Math.round(traffic_duration_minutes * 100) / 100,
        distanceText: directionsData.distance_text,
        durationText: directionsData.duration_text,
        conditions: {
          isNightTime: actualIsNightTime,
          isRaining,
          timeDetection: isNightTime !== undefined ? 'manual' : 'auto-detected'
        }
      },
      vehiclePrices,
      executionTime
    });

  } catch (error) {
    const executionTime = `${((performance.now() - startTime) / 1000).toFixed(3)}s`;
    console.error("Error calculating ride price:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to calculate the ride price",
      error: process.env.NODE_ENV === 'development' ? error.message : "Internal server error",
      executionTime
    });
  }
};