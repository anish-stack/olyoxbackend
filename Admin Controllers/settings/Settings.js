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
        const setting = await settings.findOneAndUpdate({}, data, { new: true, upsert: true });
        res.status(200).json({
            success: true,
            message: 'Setting updated successfully',
            data: setting
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};
