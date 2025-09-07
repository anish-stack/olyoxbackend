const axios =require('axios')

exports.checkWeather = async (lat,lng) => {
  if (!lat || !lng) {
    throw new Error("Latitude and Longitude are required");
  }

  const apiKey = process.env.OPEN_WEATHER_API_KEY;

  if (!apiKey) {
    throw new Error("API Key is required");
  }

  try {
    const response = await axios.get("https://api.openweathermap.org/data/2.5/weather", {
      params: {
        lat,
        lon: lng,
        appid: apiKey,
        units: "metric", // Optional: for Celsius temperature
      },
    });

    const data = response.data;

    const weatherDescriptions = data.weather.map((w) => w.description.toLowerCase());
    const isRaining =
      weatherDescriptions.some((desc) =>
        desc.includes("rain")
      ) || !!data.rain;

    return {
      isRaining,
      temperature: data.main?.temp,
      humidity: data.main?.humidity,
      weatherDescriptions,
      raw: data, // optional: include full response for debugging
    };
  } catch (error) {
    console.error("Weather API Error:", error.message);
    throw new Error("Failed to fetch weather data");
  }
};
