const AppVersion = require("../models/AppVersionModel");

// Create a new app version
exports.createAppVersion = async (req, res) => {
    try {
        const { version, app_type, isMandatory, description, downloadAppUrl } = req.body;

        const newVersion = new AppVersion({
            version,
            app_type,
            isMandatory,
            description,
            downloadAppUrl
        });

        await newVersion.save();

        res.status(201).json({
            success: true,
            message: '✅ App version created successfully.',
            data: newVersion
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '❌ Failed to create app version.',
            error: error.message
        });
    }
};

// Delete an app version by ID
exports.deleteAppVersion = async (req, res) => {
    try {
        const { id } = req.params;
        const deleted = await AppVersion.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({
                success: false,
                message: '⚠️ App version not found.',
            });
        }

        res.json({
            success: true,
            message: '🗑️ App version deleted successfully.',
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '❌ Failed to delete app version.',
            error: error.message
        });
    }
};

// Get all versions by app_type
exports.getLatestAppVersionByType = async (req, res) => {
    try {
        const { app_type } = req.params;

        const latestVersion = await AppVersion.findOne({ app_type })
            .sort({ releaseDate: -1 });

        if (!latestVersion) {
            return res.status(404).json({
                success: false,
                message: `⚠️ No version found for app_type "${app_type}".`
            });
        }

        res.json({
            success: true,
            data: latestVersion
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '❌ Failed to fetch the latest app version.',
            error: error.message
        });
    }
};


// Get all app versions
exports.getAllAppVersions = async (req, res) => {
    try {
        const allVersions = await AppVersion.find().sort({ releaseDate: -1 });

        res.json({
            success: true,
            data: allVersions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: '❌ Failed to fetch all app versions.',
            error: error.message
        });
    }
};
