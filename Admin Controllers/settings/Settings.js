const settings = require('../../models/Admin/Settings');

// In-memory cache
const settingsCache = new Map();
const CACHE_KEY = 'appSettings';

// Create Setting
exports.createSetting = async (req, res) => {
  try {
    const data = req.body;
    const setting = await settings.create(data);

    // Invalidate cache
    settingsCache.delete(CACHE_KEY);

    res.status(201).json({
      success: true,
      message: 'Setting created successfully',
      data: setting,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get Setting (uses cache if available)
exports.getSetting = async (req, res) => {
  try {
    if (settingsCache.has(CACHE_KEY)) {
      return res.status(200).json(settingsCache.get(CACHE_KEY));
    }

    const setting = await settings.findOne().lean();
    if (!setting) {
      return res.status(404).json({ message: 'Settings not found' });
    }

    // Store in cache
    settingsCache.set(CACHE_KEY, setting);

    res.status(200).json(setting);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Setting
exports.updateSetting = async (req, res) => {
  try {
    const data = req.body;

    // Define required fields
    const requiredFields = ['appName', 'appUrl', 'adminEmail'];
    const errors = [];

    // Check required fields
    requiredFields.forEach((field) => {
      if (!data[field]) errors.push(`${field} is required`);
    });

    // Validate number fields
    const numberFields = [
      'ride_percentage_off',
      'BasicFare',
      'BasicFarePerKm',
      'RainModeFareOnEveryThreeKm',
      'foodDeliveryPrice',
      'trafficDurationPricePerMinute',
      'waitingTimeInMinutes',
      'first_recharge_commisons',
      'second_recharge_commisons',
    ];
    numberFields.forEach((field) => {
      if (data[field] !== undefined && (typeof data[field] !== 'number' || isNaN(data[field]))) {
        errors.push(`${field} must be a valid number`);
      }
    });

    if (errors.length > 0) {
      return res.status(400).json({ success: false, message: errors.join(', ') });
    }

    const setting = await settings.findOneAndUpdate({}, data, { new: true, upsert: true });

    // Invalidate cache
    settingsCache.delete(CACHE_KEY);

    res.status(200).json({
      success: true,
      message: 'Setting updated successfully',
      data: setting,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
