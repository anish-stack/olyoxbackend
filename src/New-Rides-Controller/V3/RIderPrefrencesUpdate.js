const RiderModel = require("../../../models/Rider.model");
const mongoose = require("mongoose");
const SendWhatsAppMessageNormal = require("../../../utils/normalWhatsapp");
const sendNotification = require("../../../utils/sendNotification");

/**
 * Get available preferences based on vehicle type and rider category
 */
const getAvailablePreferences = (vehicleType, category) => {
  const basePreferences = ["OlyoxPriority"];
  const type = vehicleType?.toLowerCase();
  const cat = category?.toLowerCase();

  // 🚚 Parcel Driver Logic
  if (cat === "parcel") {
    if (type === "bike") {
      return ["OlyoxPriority", "FoodDelivery", "ParcelDelivery"];
    } else {
      return []; // ❌ No preferences allowed for non-bike parcel drivers
    }
  }

  // 🚕 Cab Driver Logic
  if (cat === "cab") {
    switch (type) {
      case "bike":
        return ["OlyoxPriority", "FoodDelivery", "ParcelDelivery"];
      case "auto":
        return [...basePreferences];
      case "mini":
        return [...basePreferences, "OlyoxIntercity"];
      case "sedan":
        return [...basePreferences, "OlyoxIntercity", "OlyoxAcceptMiniRides"];
      case "suv":
      case "xl":
      case "suv/xl":

        return [
          ...basePreferences,
          "OlyoxIntercity",
          "OlyoxAcceptMiniRides",
          "OlyoxAcceptSedanRides",
        ];
      default:
        return [...basePreferences];
    }
  }

  return basePreferences;
};

/**
 * Validate preferences based on vehicle type and category
 */
const validatePreferencesForVehicle = (preferences, vehicleType, category) => {
  const availablePreferences = getAvailablePreferences(vehicleType, category);
  const invalidPreferences = [];

  Object.keys(preferences).forEach((pref) => {
    if (!availablePreferences.includes(pref)) {
      invalidPreferences.push(pref);
    }
  });

  return {
    isValid: invalidPreferences.length === 0,
    invalidPreferences,
    availablePreferences,
  };
};

/**
 * Update rider preferences
 */
exports.updateRiderPreferences = async (req, res) => {
  try {
    const { riderId, preferences, changedBy = "rider", reason = "" } = req.body;

    if (!riderId || !preferences) {
      return res
        .status(400)
        .json({ success: false, message: "riderId and preferences are required" });
    }

    if (!mongoose.Types.ObjectId.isValid(riderId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid riderId format" });
    }

    const rider = await RiderModel.findById(riderId);
    if (!rider) {
      return res.status(404).json({ success: false, message: "Rider not found" });
    }

    const vehicleType =
      rider.category === "parcel"
        ? rider.rideVehicleInfo?.vehicleName
        : rider.rideVehicleInfo?.vehicleType;
    const category = rider.category;

    if (!vehicleType) {
      return res.status(400).json({
        success: false,
        message:
          "Vehicle type not found for rider. Please update vehicle information first.",
      });
    }

    // 🚨 Restrict Parcel Drivers with Non-Bike Vehicles
    if (category?.toLowerCase() === "parcel" && vehicleType?.toLowerCase() !== "bike") {
      return res.status(400).json({
        success: false,
        message: `You can only accept parcel deliveries in your own vehicle type ${vehicleType}.`,
        availablePreferences: [],
      });
    }

    // 🚫 Prevent parcel category from disabling ParcelDelivery
    if (category?.toLowerCase() === "parcel") {
      const parcelPref = preferences?.ParcelDelivery;
      if (parcelPref === false) {
        return res.status(400).json({
          success: false,
          message:
            "ParcelDelivery is a default required preference for parcel riders and cannot be turned off.",
        });
      }
      // Enforce it as true just to be safe
      preferences.ParcelDelivery = true;
    }

    // ✅ Validate preferences based on vehicle type and category
    const validation = validatePreferencesForVehicle(preferences, vehicleType, category);

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: `Invalid preferences for vehicle type '${vehicleType}' and category '${category}'. Invalid: ${validation.invalidPreferences.join(
          ", "
        )}`,
        availablePreferences: validation.availablePreferences,
        vehicleType,
        category,
      });
    }

    const changesLog = [];
    const updatedPreferences = {};

    for (const [prefName, enabled] of Object.entries(preferences)) {
      if (typeof enabled !== "boolean") {
        return res.status(400).json({
          success: false,
          message: `Preference '${prefName}' must be a boolean value`,
        });
      }

      const currentState = rider.preferences?.[prefName]?.enabled || false;

      if (currentState !== enabled) {
        await rider.updatePreference(prefName, enabled, changedBy, reason);

        changesLog.push({
          preference: prefName,
          previousState: currentState,
          newState: enabled,
          changedAt: new Date(),
        });

        updatedPreferences[prefName] = enabled;
      }
    }

    rider.activityLog.push({
      action: "preferences_updated",
      timestamp: new Date(),
      details: { updatedPreferences, changedBy, reason, vehicleType, category },
    });

    await rider.save();

    // 🔔 Send notification if any preference changed
    if (changesLog.length > 0) {
      try {
        const notificationMessage = `Your ride preferences have been updated successfully.`;

        if (rider.notificationSettings?.smsNotifications) {
          const whatsappMessage = `Hi ${rider.name
            }, your Olyox ride preferences have been updated. Changes: ${changesLog
              .map((c) => `${c.preference}: ${c.newState ? "Enabled" : "Disabled"}`)
              .join(", ")}`;
          await SendWhatsAppMessageNormal(rider.phone, whatsappMessage);
        }
      } catch (notificationError) {
        console.error("⚠️ Notification sending failed:", notificationError);
      }
    }

    // 🧾 Send final structured response (old format)
    return res.status(200).json({
      success: true,
      message:
        changesLog.length > 0
          ? "Preferences updated successfully"
          : "No changes made",
      data: {
        riderId: rider._id,
        riderName: rider.name,
        vehicleType: vehicleType,
        category,
        availablePreferences: validation.availablePreferences,
        currentPreferences: {
          ...rider.preferences,
          ...updatedPreferences,
        },
        vehicleTypeRules: {
          bike: ["OlyoxPriority", "FoodDelivery", "ParcelDelivery"],
          mini: ["OlyoxPriority", "OlyoxIntercity"],
          sedan: ["OlyoxPriority", "OlyoxIntercity", "OlyoxAcceptMiniRides"],
          suv: [
            "OlyoxPriority",
            "OlyoxIntercity",
            "OlyoxAcceptMiniRides",
            "OlyoxAcceptSedanRides",
          ],
          xl: [
            "OlyoxPriority",
            "OlyoxIntercity",
            "OlyoxAcceptMiniRides",
            "OlyoxAcceptSedanRides",
          ],
        },
        changes: changesLog,
      },
    });
  } catch (error) {
    console.error("💥 Error updating rider preferences:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


/**
 * Get rider preferences
 */
exports.getRiderPreferences = async (req, res) => {
  try {
    const { riderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(riderId)) {
      return res.status(400).json({ success: false, message: "Invalid riderId format" });
    }

    const rider = await RiderModel.findById(riderId).select(
      "preferences rideVehicleInfo name category"
    );
    if (!rider)
      return res.status(404).json({ success: false, message: "Rider not found" });

    const vehicleType = rider.category === "parcel" ? rider.rideVehicleInfo?.vehicleName : rider.rideVehicleInfo?.vehicleType;
    const category = rider.category;

    if (!vehicleType) {
      return res
        .status(400)
        .json({ success: false, message: "Vehicle type not found for rider" });
    }

    const availablePreferences = getAvailablePreferences(vehicleType, category);

    // 🚨 Restrict Parcel Drivers with Non-Bike Vehicles
    if (category?.toLowerCase() === "parcel" && vehicleType?.toLowerCase() !== "bike") {
      return res.status(400).json({
        success: false,
        message:
          `You can only accept parcel deliveries in your own vehicle type ${vehicleType}.`,
        availablePreferences: [],
      });
    }

    const currentPreferences = {};
    const preferencesAnalytics = {};

    availablePreferences.forEach((pref) => {
      const preference = rider.preferences?.[pref];
      currentPreferences[pref] = {
        enabled: preference?.enabled || false,
        lastChanged: preference?.lastChanged,
        totalChanges:
          (preference?.enabledCount || 0) + (preference?.disabledCount || 0),
      };

      if (preference) {
        preferencesAnalytics[pref] = rider.getPreferenceAnalytics(pref);
      }
    });

    // ✅ Response format same as your old code
    return res.status(200).json({
      success: true,
      data: {
        riderId: rider._id,
        riderName: rider.name,
        vehicleType: vehicleType,
        availablePreferences: availablePreferences,
        currentPreferences: currentPreferences,
        vehicleTypeRules: {
          bike: ["OlyoxPriority", "FoodDelivery", "ParcelDelivery"],
          mini: ["OlyoxPriority", "OlyoxIntercity"],
          sedan: ["OlyoxPriority", "OlyoxIntercity", "OlyoxAcceptMiniRides"],
          suv: [
            "OlyoxPriority",
            "OlyoxIntercity",
            "OlyoxAcceptMiniRides",
            "OlyoxAcceptSedanRides",
          ],
          xl: [
            "OlyoxPriority",
            "OlyoxIntercity",
            "OlyoxAcceptMiniRides",
            "OlyoxAcceptSedanRides",
          ],
        },
      },
    });
  } catch (error) {
    console.error("Error fetching rider preferences:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error", error: error.message });
  }
};
