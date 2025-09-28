const RiderModel = require('../models/Rider.model');

const Settings = require('../models/Admin/Settings');
const axios = require('axios');
const Heavy_vehicle_partners = require('../models/Heavy_vehicle/Heavy_vehicle_partners');
const Restaurant = require('../models/Tiifins/Resturant_register.model');

exports.FindWeather = async (lat, lon) => {
  if (!lat || !lon) {
    throw new Error('Latitude and Longitude are required');
  }

  try {
    const foundKey = await Settings.findOne();
    const apiKey = foundKey?.openMapApiKey;

    if (!apiKey) {
      throw new Error('API Key is required');
    }

    const { data } = await axios.get(
      `https://api.openweathermap.org/data/2.5/weather`,
      {
        params: { lat, lon, appid: apiKey }
      }
    );

    return data.weather || data;
  } catch (error) {
    console.error('Weather API Error:', error.message);
    throw new Error(error.message);
  }
};


exports.CheckTolls = async (origin, destination) => {

  if (!origin || !destination) {
    throw new Error('Origin and destination are required');
  }

  try {
    const foundKey = await Settings.findOne();
    const apiKey = foundKey?.googleApiKey;

    if (!apiKey) {
      throw new Error('Google API Key is required');
    }

    const requestBody = {
      origin: { location: { latLng: origin } },
      destination: { location: { latLng: destination } },
      travelMode: "DRIVE",
      extraComputations: ["TOLLS"],
      regionCode: "IN",
      computeAlternativeRoutes: true
    };


    const { data } = await axios.post(
      `https://routes.googleapis.com/directions/v2:computeRoutes?key=${apiKey}`,
      requestBody,
      {
        headers: {
          'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.travelAdvisory.tollInfo'
        }
      }
    );

    console.log(data.routes)
    return data.routes[1] || data || {}
  } catch (error) {
    console.error('Routes API Error check tolls api js:', error.message);
    throw new Error(error.message);
  }
};


exports.updateRechargeDetails = async ({ rechargePlan, expireData, approveRecharge, BH, onHowManyEarning }) => {

  console.log("onHowManyEarning", onHowManyEarning)
  try {
    if (!BH) {
      return { success: false, message: "BH is required." };
    }

    let RestaurantRecharge = false
    let foundRider = await RiderModel.findOne({ BH });

    if (!foundRider) {
      foundRider = await Heavy_vehicle_partners.findOne({ Bh_Id: BH });
    }

    if (!foundRider) {
      foundRider = await Restaurant.findOne({ restaurant_BHID: BH });
      RestaurantRecharge = true
    }

    if (!foundRider) {
      return { success: false, message: "No user found with the provided BH ID." };
    }

    if (!approveRecharge) {
      return { success: false, message: "Recharge approval is required." };
    }

    // Mark first recharge done
    foundRider.isFirstRechargeDone = true;

    if (foundRider.isFreeMember) {
      foundRider.isFreeMember = false;
      foundRider.freeTierEndData = null;
    }

    // Update recharge details
    foundRider.RechargeData = {
      rechargePlan,
      expireData,
      whichDateRecharge: new Date(),
      onHowManyEarning,
      approveRecharge: true
    };

    foundRider.isPaid = true;
    if (RestaurantRecharge) {
      foundRider.is_restaurant_in_has_valid_recharge = true
      foundRider.IsProfileComplete = true
    }

    await foundRider.save();

    return {
      success: true,
      message: "Recharge approved and user marked as paid.",
      data: foundRider
    };

  } catch (error) {
    console.error("Error updating recharge details:", error);
    return {
      success: false,
      message: "Internal server error.",
      error: error.message
    };
  }
};
