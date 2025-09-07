// const TiffinPlan = require("../models/TiffinPlan");
const TiffinPlan = require("../models/Tiifins/Restaurant.package.model");
const { uploadSingleImage } = require("../utils/cloudinary");

// Create a new Custom Tiffin Plan
exports.createCustomTiffin = async (req, res) => {
    try {
        // console.log("i am hit", req.body)
        const { packageName, duration, meals, preferences, totalPrice, restaurant_id } = req.body;

        // Check for missing fields
        const emptyFields = [];
        if (!duration) emptyFields.push("duration");
        if (!meals) emptyFields.push("meals");
        if (!preferences) emptyFields.push("preferences");

        if (emptyFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Please fill in the following fields: ${emptyFields.join(", ")}`
            });
        }
        const newTiffinPlan = {
            duration: Number(duration),
            meals: JSON.parse(meals),
            preferences: JSON.parse(preferences),
            totalPrice: Number(totalPrice),
            packageName,
            restaurant_id
        }

        if (req.file) {
            // console.log("file upload", req.file);
            try {
                const imgUrl = await uploadSingleImage(req.file.buffer);
                // console.log("imgurl", imgUrl);
                const { image, public_id } = imgUrl;
                newTiffinPlan.images = { url: image, public_id };
            } catch (error) {
                console.error("Image upload failed:", error.message);
            }
        }
        // console.log("newTiffinPlan", newTiffinPlan)
        const tiffin = new TiffinPlan(newTiffinPlan);
        await tiffin.save();
        // console.log("i am done")
        res.status(200).json({
            success: true,
            message: "Tiffin Plan created successfully",
            data: tiffin
        });

    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

// Get all Tiffin Plans
exports.getAllTiffinPlans = async (req, res) => {
    try {
        const plans = await TiffinPlan.find();
        res.status(200).json({ success: true, data: plans });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

// Get a single Tiffin Plan by ID
exports.getTiffinPlanById = async (req, res) => {
    try {
        const plan = await TiffinPlan.findById(req.params.id);
        if (!plan) return res.status(404).json({ success: false, message: "Tiffin Plan not found" });

        res.status(200).json({ success: true, data: plan });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

// Update a Tiffin Plan
exports.updateTiffinPlan = async (req, res) => {
    try {
        const { duration, meals, preferences } = req.body;
        let totalPrice = 0;

        // Recalculate total price
        Object.values(meals).forEach(meal => {
            if (meal.enabled) {
                totalPrice += meal.items.reduce((sum, item) => sum + item.price, 0);
            }
        });

        const days = preferences.includeWeekends ? duration : Math.floor(duration * 5 / 7);
        totalPrice *= days;

        const updatedPlan = await TiffinPlan.findByIdAndUpdate(
            req.params.id,
            { duration, meals, preferences, totalPrice },
            { new: true, runValidators: true }
        );

        if (!updatedPlan) return res.status(404).json({ success: false, message: "Tiffin Plan not found" });

        res.status(200).json({ success: true, message: "Tiffin Plan updated", data: updatedPlan });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

// Delete a Tiffin Plan
exports.deleteTiffinPlan = async (req, res) => {
    try {
        const deletedPlan = await TiffinPlan.findByIdAndDelete(req.params.id);
        if (!deletedPlan) return res.status(404).json({ success: false, message: "Tiffin Plan not found" });

        res.status(200).json({ success: true, message: "Tiffin Plan deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: "Server error", error: error.message });
    }
};

exports.updateAvailableTiffinPlans = async (req, res) => {
    try {
        const { id } = req.params;
        const { food_availability } = req.body;
        const plan = await TiffinPlan.findById(id);
        if (!plan) return res.status(404).json({
            success: false,
            message: "Tiffin Plan not found"
        });
        plan.food_availability = food_availability;
        await plan.save();
        res.status(200).json({
            success: true,
            message: "Tiffin Plan updated successfully",
            data: plan
        })

    } catch (error) {
        console.log("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}