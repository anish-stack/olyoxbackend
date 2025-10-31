const axios = require('axios');
const RidesSuggestionModel = require('../../models/Admin/RidesSuggestion.model');
const settings = require('../../models/Admin/Settings');

// In-memory caches
const directionsCache = new Map();
const weatherCache = new Map();
const surgeCache = new Map();

// Cache cleanup utility
const cleanupCache = (cache, maxAge = 900000) => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (now - value.timestamp > maxAge) {
      cache.delete(key);
    }
  }
};

// Time-based utilities
const isNightTimeNow = (timezone = 'Asia/Kolkata') => {
  try {
    const now = new Date();
    const currentHour = new Date(now.toLocaleString("en-US", { timeZone: timezone })).getHours();
    return currentHour >= 22 || currentHour < 6;
  } catch (error) {
    console.warn('⚠️ Error determining timezone, using system time:', error.message);
    const currentHour = new Date().getHours();
    return currentHour >= 22 || currentHour < 6;
  }
};

const isPeakHour = (timezone = 'Asia/Kolkata') => {
  try {
    const now = new Date();
    const currentHour = new Date(now.toLocaleString("en-US", { timeZone: timezone })).getHours();
    // Morning peak: 7-10 AM, Evening peak: 5-9 PM
    return (currentHour >= 7 && currentHour <= 10) || (currentHour >= 17 && currentHour <= 21);
  } catch (error) {
    return false;
  }
};

// Google Maps Directions API with caching
async function getDirectionsData(origin, destination, cacheKey) {
  try {
    cleanupCache(directionsCache);

    const cached = directionsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 900000)) {
      console.log(`✅ [CACHE HIT] Directions: ${cacheKey}`);
      return cached.data;
    }

    console.log(`🌐 [API CALL] Fetching directions from Google Maps...`);
    const originStr = `${origin.latitude},${origin.longitude}`;
    const destinationStr = `${destination.latitude},${destination.longitude}`;

    const response = await axios.get("https://maps.googleapis.com/maps/api/directions/json", {
      params: {
        origin: originStr,
        destination: destinationStr,
        key: process.env.GOOGLE_MAPS_API_KEY || "AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8",
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

    const standardizedData = {
      distance_km: leg.distance.value / 1000,
      duration_minutes: leg.duration.value / 60,
      traffic_duration_minutes: leg.duration_in_traffic?.value / 60 || leg.duration.value / 60,
      distance_text: leg.distance.text,
      duration_text: leg.duration.text,
      polyline: route.overview_polyline?.points || null
    };

    directionsCache.set(cacheKey, {
      data: standardizedData,
      timestamp: Date.now()
    });
    console.log(`💾 [CACHE SET] Directions cached: ${cacheKey}`);

    return standardizedData;

  } catch (error) {
    console.error('❌ [DIRECTIONS ERROR]:', error.message);
    throw new Error(`Failed to fetch directions: ${error.message}`);
  }
}

// Weather condition check with caching
async function getWeatherCondition(latitude, longitude) {
  const cacheKey = `weather:${latitude},${longitude}`;

  try {
    cleanupCache(weatherCache, 600000);

    const cached = weatherCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 600000)) {
      return cached.data;
    }

    const apiKey = process.env.OPEN_WEATHER_API_KEY;
    if (!apiKey) {
      console.warn('⚠️ No weather API key configured');
      return { isRaining: false, condition: 'unknown' };
    }

    const weatherResponse = await axios.get(`https://api.openweathermap.org/data/2.5/weather`, {
      params: {
        lat: latitude,
        lon: longitude,
        appid: apiKey,
        units: "metric"
      },
      timeout: 5000
    });

    const weatherMain = weatherResponse.data?.weather?.[0]?.main || 'Clear';
    const weatherData = {
      isRaining: weatherMain === 'Rain',
      condition: weatherMain,
      temperature: weatherResponse.data?.main?.temp || null
    };

    weatherCache.set(cacheKey, {
      data: weatherData,
      timestamp: Date.now()
    });

    return weatherData;
  } catch (error) {
    console.warn('⚠️ [WEATHER WARNING]:', error.message);
    return { isRaining: false, condition: 'unknown' };
  }
}

// Dynamic Surge Pricing Calculator (Uber/Ola style)
function calculateSurgeMultiplier(options = {}) {
  const {
    isPeakHour = false,
    isNightTime = false,
    isRaining = false,
    distance_km = 0,
    demandLevel = 'normal' // low, normal, high, very_high
  } = options;

  let surgeMultiplier = 1.0;

  // Peak hour surge (7-10 AM, 5-9 PM)
  if (isPeakHour) {
    surgeMultiplier += 0.3; // 30% increase
  }

  // Night time surge (10 PM - 6 AM)
  if (isNightTime) {
    surgeMultiplier += 0.25; // 25% increase
  }

  // Weather-based surge
  if (isRaining) {
    surgeMultiplier += 0.2; // 20% increase for rain
  }

  // Demand-based surge (simulated - in production, fetch from real-time data)
  const demandMultipliers = {
    low: 0,
    normal: 0,
    high: 0.4,
    very_high: 0.8
  };
  surgeMultiplier += demandMultipliers[demandLevel] || 0;

  // Long-distance discount (encourage longer rides)
  if (distance_km > 50) {
    surgeMultiplier -= 0.1; // 10% discount
  }

  // Cap surge between 1.0x and 3.0x
  surgeMultiplier = Math.max(1.0, Math.min(3.0, surgeMultiplier));

  return parseFloat(surgeMultiplier.toFixed(2));
}

// Calculate fuel surcharge dynamically based on distance and mileage
function calculateFuelSurcharge(distance_km, vehicle) {
  const { avgMileage, fuelSurchargePerKM } = vehicle;
  
  // Fuel consumption = distance / mileage
  const fuelConsumed = distance_km / avgMileage;
  
  // Fuel surcharge = fuel consumed * surcharge per liter
  const fuelSurcharge = fuelConsumed * fuelSurchargePerKM;
  
  return Math.round(fuelSurcharge * 100) / 100;
}

// Calculate toll charges (if applicable)
function calculateTollCharges(distance_km, vehicle, hasTolls = false) {
  if (!vehicle.tollExtra || !hasTolls) {
    return 0;
  }

  // Estimate toll based on distance (customizable)
  // For intercity rides > 50km, estimate ₹50-200 toll
  if (distance_km > 50) {
    return Math.min(200, 50 + (distance_km - 50) * 2);
  }

  return 0;
}

// Main pricing calculation for regular vehicles
function calculateVehiclePrice(vehicle, routeData, conditions) {
  const {
    distance_km,
    traffic_duration_minutes,
    waitingTimeInMinutes = 0
  } = routeData;

  const {
    isNightTime,
    isRaining,
    isPeakHour,
    demandLevel,
    hasTolls = false
  } = conditions;

  // Extract vehicle pricing parameters
  const {
    baseFare = 0,
    baseKM = 0,
    perKM = 0,
    perMin = 0,
    waitingChargePerMin = 0,
    nightPercent = 0,
    minFare = 0
  } = vehicle;

  // 1. Distance cost (only beyond base KM)
  const chargeableDistance = Math.max(0, distance_km - baseKM);
  const distanceCost = chargeableDistance * perKM;

  // 2. Time cost
  const timeCost = traffic_duration_minutes * perMin;

  // 3. Waiting time cost
  const waitingTimeCost = waitingTimeInMinutes * waitingChargePerMin;

  // 4. Night surcharge (percentage on base + distance)
  const nightSurcharge = isNightTime
    ? ((baseFare + distanceCost) * nightPercent) / 100
    : 0;

  // 5. Fuel surcharge (dynamic based on mileage)
  const fuelSurcharge = calculateFuelSurcharge(distance_km, vehicle);

  // 6. Toll charges (if applicable)
  const tollCharges = calculateTollCharges(distance_km, vehicle, hasTolls);

  // 7. Calculate surge multiplier
  const surgeMultiplier = calculateSurgeMultiplier({
    isPeakHour,
    isNightTime,
    isRaining,
    distance_km,
    demandLevel
  });

  // 8. Base price before surge
  let basePrice = baseFare + distanceCost + timeCost + waitingTimeCost + nightSurcharge + fuelSurcharge;

  // 9. Apply surge multiplier
  let totalPrice = basePrice * surgeMultiplier;

  // 10. Add non-surgeable charges (tolls are fixed)
  totalPrice += tollCharges;

  // 11. Apply minimum fare
  totalPrice = Math.max(totalPrice, minFare);

  return {
    vehicleId: vehicle._id.toString(),
    vehicleName: vehicle.name || 'Unknown Vehicle',
    vehicleType: vehicle.vehicleType || vehicle.type,
    vehicleImage: vehicle.icons_image?.url || null,
    totalPrice: Math.round(totalPrice * 100) / 100,
    distanceInKm: Math.round(distance_km * 100) / 100,
    durationInMinutes: Math.round(traffic_duration_minutes * 100) / 100,
    surgeMultiplier,
    pricing: {
      baseFare: Math.round(baseFare * 100) / 100,
      distanceCost: Math.round(distanceCost * 100) / 100,
      timeCost: Math.round(timeCost * 100) / 100,
      waitingTimeCost: Math.round(waitingTimeCost * 100) / 100,
      nightSurcharge: Math.round(nightSurcharge * 100) / 100,
      fuelSurcharge: Math.round(fuelSurcharge * 100) / 100,
      tollCharges: Math.round(tollCharges * 100) / 100,
      surgeAmount: Math.round((totalPrice - tollCharges - basePrice) * 100) / 100,
      priceBeforeSurge: Math.round(basePrice * 100) / 100
    },
    conditions: {
      isNightTime,
      isRaining,
      isPeakHour,
      demandLevel,
      baseKmIncluded: baseKM,
      chargeableDistance: Math.round(chargeableDistance * 100) / 100,
      avgMileage: vehicle.avgMileage,
      hasTolls
    },
    isRental: false
  };
}

// Calculate rental prices
async function calculateRentalPrices(distance_km, traffic_duration_minutes, conditions) {
  try {
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

      // Minimum 1-hour charge
      const effectiveMinutes = Math.max(traffic_duration_minutes, 60);

      // Distance breakdown
      const extraKm = Math.max(0, distance_km - fixedKmforBaseFare);

      // Cost calculations
      const extraKmCost = extraKm * pricePerKm;
      const timeCost = effectiveMinutes * pricePerMin;

      // Total price
      let totalPrice = baseFare + extraKmCost + timeCost;

      // Apply minimal surge for rentals (less aggressive than regular rides)
      const rentalSurge = conditions.isPeakHour ? 1.15 : 1.0;
      totalPrice *= rentalSurge;

      rentalVehicles.push({
        vehicleType: showingName,
        vehicleName: vehicleType.toUpperCase(),
        vehicleImage,
        totalPrice: Math.round(totalPrice * 100) / 100,
        distanceInKm: Math.round(distance_km * 100) / 100,
        durationInMinutes: Math.round(effectiveMinutes * 100) / 100,
        surgeMultiplier: rentalSurge,
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

    rentalVehicles.sort((a, b) => a.totalPrice - b.totalPrice);

    console.log(`✅ Calculated rental prices for ${rentalVehicles.length} vehicle types`);
    return rentalVehicles;

  } catch (error) {
    console.error('❌ Error calculating rental prices:', error.message);
    return [];
  }
}

// Main API endpoint
exports.calculateRidePriceForUser = async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      origin,
      destination,
      isLater = false,
      waitingTimeInMinutes = 0,
      vehicleIds = [],
      isNightTime,
      timezone = 'Asia/Kolkata',
      demandLevel = 'normal', // low, normal, high, very_high
      hasTolls = false
    } = req.body;

    console.log("📋 Request Body:", req.body);

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

    // Auto-detect conditions
    const actualIsNightTime = isNightTime !== undefined ? isNightTime : isNightTimeNow(timezone);
    const actualIsPeakHour = isPeakHour(timezone);

    // Create cache keys
    const directionsCacheKey = `directions:${origin.latitude},${origin.longitude}:${destination.latitude},${destination.longitude}`;

    // Get directions data
    const directionsData = await getDirectionsData(origin, destination, directionsCacheKey);

    // Get weather condition (non-blocking)
    let weatherData = { isRaining: false, condition: 'unknown' };
    try {
      weatherData = await Promise.race([
        getWeatherCondition(origin.latitude, origin.longitude),
        new Promise(resolve => setTimeout(() => resolve({ isRaining: false, condition: 'timeout' }), 3000))
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

    // Determine ride type
    const isIntercityRide = distance_km > 69;
    const shouldCalculateRentals = distance_km < 69 && !isLater;

    console.log(`🚗 Ride Type: ${isIntercityRide ? 'INTERCITY' : 'LOCAL'} | Distance: ${distance_km.toFixed(2)} km | isLater: ${isLater}`);

    // Fetch vehicles with filtering
    let vehicleQuery = { status: true };

    if (vehicleIds.length > 0) {
      vehicleQuery._id = { $in: vehicleIds };
    }

    // Exclude Bike and Auto for intercity/later rides
    if (isIntercityRide || isLater) {
      console.log('🚫 Intercity/Later ride - Excluding Bike and Auto');
      vehicleQuery.name = { $not: { $regex: /^(bike|auto)$/i } };
    }

    console.log('🔍 Vehicle Query:', JSON.stringify(vehicleQuery, null, 2));

    const vehicles = await RidesSuggestionModel.find(vehicleQuery);

    if (!vehicles.length) {
      return res.status(404).json({
        success: false,
        message: vehicleIds.length > 0
          ? "No active vehicles found for the specified vehicle IDs"
          : isIntercityRide || isLater
            ? "No active vehicles found for intercity/later rides (Bike and Auto excluded)"
            : "No active vehicles found",
        executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
      });
    }

    console.log(`✅ Found ${vehicles.length} eligible vehicles`);

    // Prepare conditions object
    const conditions = {
      isNightTime: actualIsNightTime,
      isRaining: weatherData.isRaining,
      isPeakHour: actualIsPeakHour,
      demandLevel,
      hasTolls
    };

    // Prepare route data object
    const routeData = {
      distance_km,
      traffic_duration_minutes,
      waitingTimeInMinutes
    };

    // Calculate prices for all vehicles
    const vehiclePrices = vehicles.map(vehicle => 
      calculateVehiclePrice(vehicle, routeData, conditions)
    );

    // Calculate rental prices if applicable
    let rentalVehiclePrices = [];
    if (shouldCalculateRentals) {
      console.log('🚕 Calculating rental vehicle prices...');
      rentalVehiclePrices = await calculateRentalPrices(distance_km, traffic_duration_minutes, conditions);
    } else {
      console.log('🚫 Skipping rental calculations (intercity ride or later ride)');
    }

    const executionTime = `${((performance.now() - startTime) / 1000).toFixed(3)}s`;

    console.log("💰 Price Calculation Summary:", {
      distance: `${distance_km.toFixed(2)} km`,
      duration: `${traffic_duration_minutes.toFixed(2)} mins`,
      conditions,
      isLater,
      isIntercityRide,
      regularVehicleCount: vehicles.length,
      rentalVehicleCount: rentalVehiclePrices.length,
      executionTime
    });

    // Sort by price
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
          ...conditions,
          weatherCondition: weatherData.condition,
          timeDetection: isNightTime !== undefined ? 'manual' : 'auto-detected'
        }
      },
      vehiclePrices,
      executionTime
    };

    // Add rental prices if available
    if (rentalVehiclePrices.length > 0) {
      response.rentalVehiclePrices = rentalVehiclePrices;
      response.message = "Ride prices calculated successfully (including rental options)";
    }

    // Add note for excluded vehicles
    if (isIntercityRide || isLater) {
      response.note = "Bike and Auto excluded for intercity/later rides" + 
                      (isIntercityRide ? ". Rental vehicles not available." : "");
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

// Recalculate rental prices with additional hours
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

    const { pricePerMin, pricePerKm } = config;

    let totalHours = origHrs + addHrs;
    let estimatedDistanceKm = origDist;
    let additionalTimeCost = 0;
    let additionalDistanceCost = 0;
    let totalFare = currFare;

    // Special case: originalHours = 1 AND additionalHours = 1
    if (origHrs === 1 && addHrs === 1) {
      estimatedDistanceKm += 15;
      totalHours = origHrs;
      totalFare = currFare;
    } else if (addHrs > 0) {
      // Normal calculation
      const additionalMinutes = addHrs * 60;
      additionalTimeCost = additionalMinutes * pricePerMin;

      // Extra distance after first hour
      const extraHoursAfterFirst = Math.max(totalHours - 1, 0);
      const additionalDistance = extraHoursAfterFirst * 15;
      estimatedDistanceKm = origDist + additionalDistance;
      additionalDistanceCost = additionalDistance * pricePerKm;

      // Update total fare
      totalFare = currFare + additionalTimeCost + additionalDistanceCost;
    }

    const response = {
      success: true,
      additional: {
        originalHours: parseFloat(origHrs.toFixed(2)),
        additionalHours: parseFloat(addHrs.toFixed(2)),
        currentDistanceKm: parseFloat(origDist.toFixed(2)),
        totalHours: parseFloat(totalHours.toFixed(2)),
        estimatedDistanceKm: parseFloat(estimatedDistanceKm.toFixed(2)),
        currentFare: parseFloat(currFare.toFixed(2)),
        additionalTimeCost: parseFloat(additionalTimeCost.toFixed(2)),
        additionalDistanceCost: parseFloat(additionalDistanceCost.toFixed(2)),
        totalFare: parseFloat(totalFare.toFixed(2))
      },
      executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
    };

    console.log("📋 Recalculation:", response.additional);

    return res.status(200).json(response);

  } catch (error) {
    console.error("❌ Error in reCalculatePriceForOnlyRentals:", error);
    return res.status(500).json({ 
      success: false, 
      message: error.message || error,
      executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
    });
  }
};