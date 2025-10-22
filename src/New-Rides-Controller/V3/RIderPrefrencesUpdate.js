const RiderModel = require("../../../models/Rider.model");
const mongoose = require('mongoose');
const SendWhatsAppMessageNormal = require("../../../utils/normalWhatsapp");
const sendNotification = require("../../../utils/sendNotification");

// Get available preferences based on vehicle type
const getAvailablePreferences = (vehicleType) => {
    const basePreferences = ["OlyoxPriority"];

    switch (vehicleType?.toLowerCase()) {
        case 'auto':
            return basePreferences;

        case 'bike':
            return [...basePreferences , "FoodDelivery", "ParcelDelivery"];

        case 'mini':
            return [...basePreferences, "OlyoxIntercity"];

        case 'sedan':
            return [...basePreferences, "OlyoxIntercity", "OlyoxAcceptMiniRides"];

        case 'suv':
        case 'xl':
            return [...basePreferences, "OlyoxIntercity", "OlyoxAcceptMiniRides", "OlyoxAcceptSedanRides"];

        default:
            return [...basePreferences, "OlyoxIntercity", "OlyoxAcceptMiniRides", "OlyoxAcceptSedanRides"];
    }
};

// Validate preference updates based on vehicle type
const validatePreferencesForVehicle = (preferences, vehicleType) => {
    const availablePreferences = getAvailablePreferences(vehicleType);
    const invalidPreferences = [];

    Object.keys(preferences).forEach(pref => {
        if (!availablePreferences.includes(pref)) {
            invalidPreferences.push(pref);
        }
    });

    return {
        isValid: invalidPreferences.length === 0,
        invalidPreferences,
        availablePreferences
    };
};

// Update rider preferences API
exports.updateRiderPreferences = async (req, res) => {
    try {
        const { riderId, preferences, changedBy = 'rider', reason = '' } = req.body;
        console.log("Body have", req.body)

        // Validate required fields
        if (!riderId || !preferences) {
            return res.status(400).json({
                success: false,
                message: "riderId and preferences are required"
            });
        }

        // Validate riderId format
        if (!mongoose.Types.ObjectId.isValid(riderId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid riderId format"
            });
        }

        // Find rider
        const rider = await RiderModel.findById(riderId);
        if (!rider) {
            return res.status(404).json({
                success: false,
                message: "Rider not found"
            });
        }

        // Get vehicle type
        const vehicleType = rider.rideVehicleInfo?.vehicleType;
        if (!vehicleType) {
            return res.status(400).json({
                success: false,
                message: "Vehicle type not found for rider. Please update vehicle information first."
            });
        }

        // Validate preferences based on vehicle type
        const validation = validatePreferencesForVehicle(preferences, vehicleType);
        if (!validation.isValid) {
            return res.status(400).json({
                success: false,
                message: `Invalid preferences for vehicle type '${vehicleType}'. Invalid preferences: ${validation.invalidPreferences.join(', ')}`,
                availablePreferences: validation.availablePreferences,
                vehicleType: vehicleType
            });
        }

        // Track changes made
        const changesLog = [];
        const updatedPreferences = {};

        // Update each preference
        for (const [prefName, enabled] of Object.entries(preferences)) {
            if (typeof enabled !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    message: `Preference '${prefName}' must be a boolean value`
                });
            }

            // Get current preference state
            const currentPref = rider.preferences?.[prefName];
            const currentState = currentPref?.enabled || false;

            // Only update if there's a change
            if (currentState !== enabled) {
                try {
                    await rider.updatePreference(prefName, enabled, changedBy, reason);

                    changesLog.push({
                        preference: prefName,
                        previousState: currentState,
                        newState: enabled,
                        changedAt: new Date()
                    });

                    updatedPreferences[prefName] = enabled;
                } catch (updateError) {
                    console.error(`Error updating preference ${prefName}:`, updateError);
                    return res.status(500).json({
                        success: false,
                        message: `Failed to update preference: ${prefName}`,
                        error: updateError.message
                    });
                }
            }
        }

        // Log activity
        rider.activityLog.push({
            action: 'preferences_updated',
            timestamp: new Date(),
            details: {
                updatedPreferences,
                changedBy,
                reason,
                vehicleType
            }
        });

        await rider.save();

        // Send notifications if preferences were changed
        if (changesLog.length > 0) {
            try {
                // Send push notification
                console.log('Sending notification to rider:', rider.fcmToken);
                const notificationMessage = `Your ride preferences have been updated successfully.`;
                // await sendNotification.sendNotification(rider.fcmToken, 'Preferences Updated', notificationMessage, {}, 'app_notification_channel');

                // Send WhatsApp notification if enabled
                if (rider.notificationSettings?.smsNotifications) {
                    const whatsappMessage = `Hi ${rider.name}, your Olyox ride preferences have been updated. Changes: ${changesLog.map(c => `${c.preference}: ${c.newState ? 'Enabled' : 'Disabled'}`).join(', ')}`;
                    await SendWhatsAppMessageNormal(rider.phone, whatsappMessage);
                }
            } catch (notificationError) {
                console.error('Notification sending failed:', notificationError);
                // Don't fail the API if notification fails
            }
        }

        // Return response
        return res.status(200).json({
            success: true,
            message: changesLog.length > 0 ? "Preferences updated successfully" : "No changes made",
            data: {
                riderId: rider._id,
                vehicleType: vehicleType,
                availablePreferences: validation.availablePreferences,
                updatedPreferences: updatedPreferences,
                changes: changesLog,
                currentPreferences: Object.keys(validation.availablePreferences).reduce((acc, pref) => {
                    acc[pref] = rider.preferences[pref]?.enabled || false;
                    return acc;
                }, {})
            }
        });

    } catch (error) {
        console.error('Error updating rider preferences:', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get rider preferences based on vehicle type API
exports.getRiderPreferences = async (req, res) => {
    try {
        const { riderId } = req.params;

        // Validate riderId
        if (!mongoose.Types.ObjectId.isValid(riderId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid riderId format"
            });
        }

        // Find rider
        const rider = await RiderModel.findById(riderId).select('preferences rideVehicleInfo name');
        if (!rider) {
            return res.status(404).json({
                success: false,
                message: "Rider not found"
            });
        }

        const vehicleType = rider.rideVehicleInfo?.vehicleType;
        if (!vehicleType) {
            return res.status(400).json({
                success: false,
                message: "Vehicle type not found for rider"
            });
        }

        // Get available preferences for vehicle type
        const availablePreferences = getAvailablePreferences(vehicleType);

        // Build response with current preference states
        const currentPreferences = {};
        const preferencesAnalytics = {};

        availablePreferences.forEach(pref => {
            const preference = rider.preferences?.[pref];
            currentPreferences[pref] = {
                enabled: preference?.enabled || false,
                lastChanged: preference?.lastChanged,
                totalChanges: (preference?.enabledCount || 0) + (preference?.disabledCount || 0)
            };

            // Get analytics if preference exists
            if (preference) {
                preferencesAnalytics[pref] = rider.getPreferenceAnalytics(pref);
            }
        });

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
                    suv: ["OlyoxPriority", "OlyoxIntercity", "OlyoxAcceptMiniRides", "OlyoxAcceptSedanRides"],
                    xl: ["OlyoxPriority", "OlyoxIntercity", "OlyoxAcceptMiniRides", "OlyoxAcceptSedanRides"]
                }
            }
        });

    } catch (error) {
        console.error('Error fetching rider preferences:', error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

