const HeavyTransportModel = require("../../models/Admin/HeavyTransport.model");
const cloudinary = require("cloudinary").v2;
require("dotenv").config();
const fs = require("fs").promises;
const streamifier = require("streamifier");

cloudinary.config({
    cloud_name: "dsd8nepa5",
    api_key: "634914486911329",
    api_secret: "dOXqEsWHQMjHNJH_FU6_iHlUHBE",
});

// Helper function to upload image to Cloudinary
const uploadToCloudinary = (buffer) => {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            { folder: "heavy-transport" },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        streamifier.createReadStream(buffer).pipe(uploadStream);
    });
};

// Helper function to delete image from Cloudinary
const deleteFromCloudinary = async (publicId) => {
    if (!publicId) return;
    try {
        await cloudinary.uploader.destroy(publicId);
    } catch (error) {
        console.error("Error deleting image from Cloudinary:", error);
    }
};

// Create a new heavy transport option
exports.createHeavyOption = async (req, res) => {
    try {
        const file = req.file || {};
        if (!file) {
            return res.status(400).json({ message: "Please upload a file" });
        }

        const { title, category, backgroundColour, active } = req.body || {};

        // Validate required fields
        if (!title || !category || !backgroundColour) {
            return res.status(400).json({ message: "All fields are required" });
        }

        // Upload image to Cloudinary
        const cloudinaryResult = await uploadToCloudinary(file.buffer);

        // Create new heavy transport entry
        const newHeavyTransport = new HeavyTransportModel({
            title,
            category,
            backgroundColour,
            active: active === "true" || active === true,
            image: {
                url: cloudinaryResult.secure_url,
                public_id: cloudinaryResult.public_id,
            },
        });

        await newHeavyTransport.save();

        return res.status(201).json({
            success: true,
            message: "Heavy transport option created successfully",
            data: newHeavyTransport,
        });
    } catch (error) {
        console.error("Error creating heavy transport option:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create heavy transport option",
            error: error.message,
        });
    }
};

// Get all heavy transport options
exports.getAllHeavyTransports = async (req, res) => {
    try {
        const { category, active } = req.query;

        // Build filter object based on query parameters
        const filter = {};
        if (category) filter.category = category;
        if (active !== undefined) filter.active = active === "true";

        const heavyTransports = await HeavyTransportModel.find(filter).sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: heavyTransports.length,
            data: heavyTransports,
        });
    } catch (error) {
        console.error("Error fetching heavy transport options:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch heavy transport options",
            error: error.message,
        });
    }
};

// Get a single heavy transport option by ID
exports.getHeavyTransportById = async (req, res) => {
    try {
        const { id } = req.params;

        const heavyTransport = await HeavyTransportModel.findById(id);

        if (!heavyTransport) {
            return res.status(404).json({
                success: false,
                message: "Heavy transport option not found",
            });
        }

        return res.status(200).json({
            success: true,
            data: heavyTransport,
        });
    } catch (error) {
        console.error("Error fetching heavy transport option:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch heavy transport option",
            error: error.message,
        });
    }
};

// Update a heavy transport option
exports.updateHeavyTransport = async (req, res) => {
    try {
        const { id } = req.params;
        const { title, category, backgroundColour, active } = req.body || {};

        // Find the heavy transport option
        const heavyTransport = await HeavyTransportModel.findById(id);

        if (!heavyTransport) {
            return res.status(404).json({
                success: false,
                message: "Heavy transport option not found",
            });
        }

        // Update fields if provided
        if (title) heavyTransport.title = title;
        if (category) heavyTransport.category = category;
        if (backgroundColour) heavyTransport.backgroundColour = backgroundColour;
        if (active !== undefined) heavyTransport.active = active === "true" || active === true;

        // Update image if a new one is provided
        if (req.file) {
            // Delete old image from Cloudinary
            if (heavyTransport.image?.public_id) {
                await deleteFromCloudinary(heavyTransport.image.public_id);
            }

            // Upload new image
            const cloudinaryResult = await uploadToCloudinary(req.file.buffer);

            heavyTransport.image = {
                url: cloudinaryResult.secure_url,
                public_id: cloudinaryResult.public_id,
            };
        }

        await heavyTransport.save();

        return res.status(200).json({
            success: true,
            message: "Heavy transport option updated successfully",
            data: heavyTransport,
        });
    } catch (error) {
        console.error("Error updating heavy transport option:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update heavy transport option",
            error: error.message,
        });
    }
};

// Delete a heavy transport option
exports.deleteHeavyTransport = async (req, res) => {
    try {
        const { id } = req.params;

        const heavyTransport = await HeavyTransportModel.findById(id);

        if (!heavyTransport) {
            return res.status(404).json({
                success: false,
                message: "Heavy transport option not found",
            });
        }

        // Delete image from Cloudinary if exists
        if (heavyTransport.image?.public_id) {
            await deleteFromCloudinary(heavyTransport.image.public_id);
        }

        // Delete the document
        await HeavyTransportModel.findByIdAndDelete(id);

        return res.status(200).json({
            success: true,
            message: "Heavy transport option deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting heavy transport option:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to delete heavy transport option",
            error: error.message,
        });
    }
};

// Toggle active status
exports.toggleActiveStatus = async (req, res) => {
    try {
        const { id } = req.params;

        const heavyTransport = await HeavyTransportModel.findById(id);

        if (!heavyTransport) {
            return res.status(404).json({
                success: false,
                message: "Heavy transport option not found",
            });
        }

        // Toggle the active status
        heavyTransport.active = !heavyTransport.active;

        await heavyTransport.save();

        return res.status(200).json({
            success: true,
            message: `Heavy transport option ${heavyTransport.active ? 'activated' : 'deactivated'} successfully`,
            data: heavyTransport,
        });
    } catch (error) {
        console.error("Error toggling active status:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to toggle active status",
            error: error.message,
        });
    }
};