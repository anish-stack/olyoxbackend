const settings = require('../../models/Admin/Settings')

exports.createSetting = async (req, res) => {
    try {
        const data = req.body
        const setting = await settings.create(data)
        res.status(201).json({
            success: true,
            message: 'Setting created successfully',
            data: setting
        })

    } catch (error) {
        res.status(500).json({ message: error.message })

    }
}

exports.getSetting = async (req, res) => {
    try {
        const setting = await settings.findOne();
        if (!setting) {
            return res.status(404).json({ message: "Settings not found" });
        }
        res.status(200).json(setting);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Update settings
exports.updateSetting = async (req, res) => {
    try {
        const data = req.body;

        // Define required fields
        const requiredFields = ['appName', 'appUrl', 'adminEmail'];
        const errors = [];

        // Check required fields
        requiredFields.forEach((field) => {
            if (!data[field]) {
                errors.push(`${field} is required`);
            }
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
        res.status(200).json({
            success: true,
            message: 'Setting updated successfully',
            data: setting,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
