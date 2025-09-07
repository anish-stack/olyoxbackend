const {
  getCachedOrFetchDirections,
  getCachedOrFetchTolls,
  getCachedOrFetchWeather,
} = require('../services/supporter');
const RidesSuggestionModel = require('../../models/Admin/RidesSuggestion.model');


// Helper function to determine if it's night time based on current hour
const isNightTimeNow = (timezone = 'Asia/Kolkata') => {
  try {
    const now = new Date();
    const currentHour = new Date(now.toLocaleString("en-US", { timeZone: timezone })).getHours();
    
    // Night time is considered between 10 PM (22:00) and 6 AM (06:00)
    return currentHour >= 22 || currentHour < 6;
  } catch (error) {
    console.warn('Error determining time zone, using system time:', error.message);
    const currentHour = new Date().getHours();
    return currentHour >= 22 || currentHour < 6;
  }
};

// Helper function to safely log values, replacing undefined with descriptive text
const safeLog = (obj) => {
  const safeObj = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      safeObj[key] = 'NOT_AVAILABLE';
    } else if (value === null) {
      safeObj[key] = 'NULL';
    } else if (typeof value === 'object' && Object.keys(value).length === 0) {
      safeObj[key] = 'EMPTY_OBJECT';
    } else {
      safeObj[key] = value;
    }
  }
  return safeObj;
};

// Helper function to extract numeric value from string or return default
const parseNumericValue = (value, defaultValue = 0) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const match = value.match(/[\d.]+/);
    return match ? parseFloat(match[0]) : defaultValue;
  }
  return defaultValue;
};

exports.calculateRidePriceForUser = async (req, res) => {
  const startTime = performance.now();

  try {
    const {
      origin,
      destination,
      waitingTimeInMinutes = 0,
      vehicleIds = [],
      isNightTime, // Optional - will auto-detect if not provided
      timezone = 'Asia/Kolkata' // Default to Indian timezone
    } = req.body;

    console.log("Request Body:", req.body);

    // Auto-detect night time if not explicitly provided
    const actualIsNightTime = isNightTime !== undefined ? isNightTime : isNightTimeNow(timezone);
    
    console.log(`Time Detection: ${actualIsNightTime ? 'NIGHT' : 'DAY'} (${isNightTime !== undefined ? 'manual' : 'auto-detected'})`);

    // Input validation
    if (!origin?.latitude || !origin?.longitude || !destination?.latitude || !destination?.longitude) {
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
        message: "Invalid coordinate ranges. Latitude must be between -90 and 90, longitude between -180 and 180",
        executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
      });
    }

    const originKey = `${origin.latitude},${origin.longitude}`;
    const destinationKey = `${destination.latitude},${destination.longitude}`;

    // Generate cache keys
    const directionsCacheKey = `directions:${originKey}:${destinationKey}`;
    const weatherCacheKey = `weather:${originKey}`;
    const tollsCacheKey = `tolls:${originKey}:${destinationKey}`;

    // Fetch vehicles with better query handling
    const vehicleQuery = vehicleIds.length > 0 
      ? { _id: { $in: vehicleIds }, status: true }
      : { status: true };
    
    const vehicles = await RidesSuggestionModel.find(vehicleQuery);

    if (!vehicles.length) {
      const message = vehicleIds.length > 0 
        ? "No active vehicles found for the specified vehicle IDs"
        : "No active vehicles found";
      
      return res.status(404).json({
        success: false,
        message,
        executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
      });
    }

    // Parallel execution for better performance
    const [directionsResult, weatherResult, tollsResult] = await Promise.allSettled([
      getCachedOrFetchDirections(req.app, directionsCacheKey, originKey, destinationKey),
      getCachedOrFetchWeather(req.app, weatherCacheKey, origin.latitude, origin.longitude),
      getCachedOrFetchTolls(req.app, tollsCacheKey, origin, destination),
    ]);

    // Handle directions with comprehensive validation
    if (directionsResult.status === 'rejected' || !('value' in directionsResult)) {
      const errorMessage = directionsResult.status === 'rejected' ? directionsResult.reason : 'Unknown error';
      console.error('Directions fetch failed:', errorMessage);
      
      return res.status(400).json({
        success: false,
        message: "Unable to fetch directions",
        details: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
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

      distance = parseNumericValue(directions.distance);
      duration = parseNumericValue(directions.duration);
      trafficDuration = duration; // No traffic data in simplified format

    } else {
      console.error('Invalid directions structure:', directions);
      return res.status(400).json({
        success: false,
        message: "Invalid route data format",
        executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
      });
    }

    // Validate extracted distance and duration
    if (distance <= 0 || duration <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid route data: distance or duration is zero or negative",
        executionTime: `${((performance.now() - startTime) / 1000).toFixed(3)}s`
      });
    }

    // Handle weather with improved validation and logging
    let weather = null;
    let rain = false;
    
    if (weatherResult.status === 'fulfilled' && weatherResult.value) {
      weather = weatherResult.value;
      rain = Array.isArray(weather) && weather.length > 0 && weather[0]?.main === 'Rain';
    } else if (weatherResult.status === 'rejected') {
      console.warn('Weather fetch failed:', weatherResult.reason);
    }

    // Handle tolls with improved validation and logging
    let tollInfo = null;
    let tolls = false;
    let tollPrice = 0;

    if (tollsResult.status === 'fulfilled' && tollsResult.value) {
      tollInfo = tollsResult.value;
      tolls = tollInfo && 
              tollInfo.tollInfo && 
              typeof tollInfo.tollInfo === 'object' && 
              Object.keys(tollInfo.tollInfo).length > 0;
      
      if (tolls && tollInfo.tollInfo.estimatedPrice && Array.isArray(tollInfo.tollInfo.estimatedPrice)) {
        tollPrice = tollInfo.tollInfo.estimatedPrice[0]?.units || 0;
      }
    } else if (tollsResult.status === 'rejected') {
      console.warn('Tolls fetch failed:', tollsResult.reason);
    }

    // Calculate prices for all vehicles
    const vehiclePrices = vehicles.map(vehicle => {
      // Validate vehicle data
      if (!vehicle.baseFare || !vehicle.perKM || !vehicle.perMin) {
        console.warn(`Vehicle ${vehicle._id} has incomplete pricing data`);
      }

      // Calculate distance cost (only charge for distance beyond base KM)
      const baseKM = vehicle.baseKM || 0;
      const chargeableDistance = Math.max(0, distance - baseKM);
      const distanceCost = chargeableDistance * (vehicle.perKM || 0);

      // Calculate time cost
      const timeCost = trafficDuration * (vehicle.perMin || 0);

      // Calculate waiting time cost
      const waitingTimeCost = waitingTimeInMinutes * (vehicle.waitingChargePerMin || 0);

      // Calculate night surcharge (percentage of base fare + distance cost)
      const nightPercent = vehicle.nightPercent || 0;
      const nightSurcharge = actualIsNightTime
        ? ((vehicle.baseFare + distanceCost) * nightPercent) / 100
        : 0;

      // Calculate fuel surcharge
      const fuelSurcharge = distance * (vehicle.fuelSurchargePerKM || 0);

      // Calculate toll cost (only if vehicle supports toll extra)
      const tollCost = (tolls && vehicle.tollExtra) ? tollPrice : 0;

      // Calculate total price
      let totalPrice = (vehicle.baseFare || 0) +
        distanceCost +
        timeCost +
        waitingTimeCost +
        nightSurcharge +
        fuelSurcharge +
        tollCost;

      // Apply minimum fare
      const minFare = vehicle.minFare || 0;
      totalPrice = Math.max(totalPrice, minFare);

      return {
        vehicleId: vehicle._id?.toString(),
        vehicleName: vehicle.name || 'Unknown Vehicle',
        vehicleType: vehicle.vehicleType || null,
        vehicleImage: vehicle.icons_image.url || 'Unknown Type',
        totalPrice: Math.round(totalPrice * 100) / 100,
        distanceInKm: Math.round(distance * 100) / 100,
        durationInMinutes: Math.round(trafficDuration * 100) / 100,
        pricing: {
          baseFare: vehicle.baseFare || 0,
          distanceCost: Math.round(distanceCost * 100) / 100,
          timeCost: Math.round(timeCost * 100) / 100,
          waitingTimeCost: Math.round(waitingTimeCost * 100) / 100,
          nightSurcharge: Math.round(nightSurcharge * 100) / 100,
          fuelSurcharge: Math.round(fuelSurcharge * 100) / 100,
          tollCost: Math.round(tollCost * 100) / 100,
        },
        conditions: {
          rain,
          tolls,
          isNightTime: actualIsNightTime
        }
      };
    });

    const executionTime = `${((performance.now() - startTime) / 1000).toFixed(3)}s`;

    // Safe logging without undefined values
    console.log("Price Calculation Details:", safeLog({
      distance: `${distance} km`,
      duration: `${duration} mins`,
      trafficDuration: `${trafficDuration} mins`,
      rain: rain ? 'YES' : 'NO',
      tolls: tolls ? 'YES' : 'NO',
      tollPrice: tollPrice || 'NO_TOLLS',
      isNightTime: actualIsNightTime ? 'NIGHT' : 'DAY',
      vehicleCount: vehicles.length,
      executionTime
    }));

    return res.status(200).json({
      success: true,
      message: "Ride prices calculated successfully for all vehicles",
      routeInfo: {
        distanceInKm: Math.round(distance * 100) / 100,
        durationInMinutes: Math.round(trafficDuration * 100) / 100,
        conditions: {
          rain,
          tolls,
          isNightTime: actualIsNightTime,
          timeDetection: isNightTime !== undefined ? 'manual' : 'auto-detected'
        }
      },
      vehiclePrices: vehiclePrices.sort((a, b) => a.totalPrice - b.totalPrice),
      executionTime
    });

  } catch (error) {
    const executionTime = `${((performance.now() - startTime) / 1000).toFixed(3)}s`;
    console.error("Error calculating ride price:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to calculate the ride price",
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      executionTime
    });
  }
};