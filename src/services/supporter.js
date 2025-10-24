const axios = require('axios');
const { CheckTolls } = require('./CheckTolls');
const { checkWeather } = require('./WheatherCheck');

// ===== SUPPORTER SERVICES =====

// Utility: Get Redis client from req
function getRedisClient(req) {
  const redis = req.get('pubClient') || req.get('subClient');
  if (!redis) {
    throw new Error("Redis client not found in request");
  }
  return redis;
}

// Directions
async function getCachedOrFetchDirections(req, cacheKey, originKey, destinationKey) {
  let redis;
  try {
    redis = getRedisClient(req);

    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] Directions for key: ${cacheKey}`);
      return JSON.parse(cached);
    }

    console.log(`[CACHE MISS] Fetching directions from Google Maps API...`);
    const response = await axios.get("https://maps.googleapis.com/maps/api/directions/json", {
      params: {
        origin: originKey,
        destination: destinationKey,
        key: "AIzaSyBfRHuTByG6CiXtLbyzK_aKNpJfDiB4jUo",
        traffic_model: "best_guess",
        departure_time: "now",
        alternatives: true
      },
      timeout: 30000
    });

    const routes = response.data?.routes;
    if (!routes?.length) {
      console.error(`[ERROR] No routes found from Google Maps API for ${originKey} to ${destinationKey}`);
      throw new Error("No routes found");
    }

    const route = routes[0];
    if (!route?.legs?.length) {
      console.error(`[ERROR] Invalid route structure returned from API`);
      throw new Error("Invalid route structure");
    }

    await redis.set(cacheKey, JSON.stringify(route), 'EX', 900);
    console.log(`[CACHE SET] Cached directions for key: ${cacheKey}`);
    return route;
  } catch (error) {
    console.error(`[DIRECTIONS ERROR]`, error.message || error);
    throw new Error("Failed to fetch directions");
  }
}

// Weather
async function getCachedOrFetchWeather(req, cacheKey, lat, lng) {
  let redis;
  try {
    redis = getRedisClient(req);

    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] Weather for key: ${cacheKey}`);
      return JSON.parse(cached);
    }

    console.log(`[CACHE MISS] Fetching weather data for (${lat}, ${lng})...`);
    const data = await checkWeather(lat, lng);
    if (!data) {
      console.warn(`[WARNING] Weather API returned empty data for (${lat}, ${lng})`);
    }

    await redis.set(cacheKey, JSON.stringify(data), 'EX', 600);
    console.log(`[CACHE SET] Cached weather data for key: ${cacheKey}`);
    return data || [];
  } catch (error) {
    console.error(`[WEATHER ERROR]`, error.message || error);
    return [];
  }
}

// Tolls
async function getCachedOrFetchTolls(req, cacheKey, origin, destination) {
  let redis;
  try {
    redis = getRedisClient(req);

    const cached = await redis.get(cacheKey);
    if (cached) {
      console.log(`[CACHE HIT] Tolls for key: ${cacheKey}`);
      return JSON.parse(cached);
    }

    console.log(`[CACHE MISS] Fetching toll data for trip...`);
    const tollCheck = await CheckTolls(origin, destination);
    const tolls = tollCheck?.routes || {};

    await redis.set(cacheKey, JSON.stringify(tolls), 'EX', 900);
    console.log(`[CACHE SET] Cached toll data for key: ${cacheKey}`);
    return tolls;
  } catch (error) {
    console.error(`[TOLLS ERROR]`, error.message || error);
    return {};
  }
}

module.exports = {
  getCachedOrFetchDirections,
  getCachedOrFetchWeather,
  getCachedOrFetchTolls
};
