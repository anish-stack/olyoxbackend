const axios = require('axios');

/**
 * Check toll information between origin and destination
 * @param {Object} origin - { latitude, longitude }
 * @param {Object} destination - { latitude, longitude }
 * @returns {Promise<Object|null>}
 */
const CheckTolls = async (origin, destination) => {
  if (!origin || !destination) {
    throw new Error("Origin and destination are required");
  }

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    throw new Error("Google API Key is required");
  }

  try {
    const requestBody = {
      origin: { location: { latLng: origin } },
      destination: { location: { latLng: destination } },
      travelMode: "DRIVE",
      extraComputations: ["TOLLS"],
      regionCode: "IN",
      computeAlternativeRoutes: true,
    };

    const url = `https://routes.googleapis.com/directions/v2:computeRoutes?key=${apiKey}`;

    const { data } = await axios.post(url, requestBody, {
      headers: {
        "Content-Type": "application/json",
        "X-Goog-FieldMask": "routes.distanceMeters,routes.duration,routes.travelAdvisory.tollInfo",
      },
    });

    if (!data || !data.routes || !data.routes.length) {
      console.warn("No routes returned from Toll API");
      return null;
    }

    console.log("Toll route data received:", data.routes);
    return data;
  } catch (error) {
    console.error("Routes API Error checktoll:", error.message || error);
    throw new Error("Failed to fetch toll route data");
  }
};

module.exports = {
  CheckTolls,
};
