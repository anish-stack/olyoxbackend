const { uploadSingleImage, deleteImage } = require("../../utils/cloudinary");
const HomeScreenSlider = require('../../models/Admin/HomeScreenSlider');

// In-memory cache
const homeSlideCache = new Map();
const CACHE_KEY = 'allHomeSlides';

// Create home slide
exports.create_home_slide = async (req, res) => {
    try {
        const file = req.file;
        const { active } = req.body;

        if (!file) {
            return res.status(400).json({
                success: false,
                message: 'Image is required.',
            });
        }

        const result = await uploadSingleImage(file.buffer, 'homeslide_slides');
        if (!result) {
            return res.status(500).json({
                success: false,
                message: 'Failed to upload image.',
            });
        }

        const { image, public_id } = result;

        const newSlide = new HomeScreenSlider({
            imageUrl: { image, public_id },
            active
        });
        await newSlide.save();

        // Invalidate cache
        homeSlideCache.delete(CACHE_KEY);

        return res.status(201).json({
            success: true,
            message: 'homeslide slide created successfully.',
            data: newSlide
        });
    } catch (error) {
        console.error("Error creating homeslide slide:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
};

// Get all home slides (with cache)
exports.get_home_slides = async (req, res) => {
    try {
        if (homeSlideCache.has(CACHE_KEY)) {
            return res.status(200).json({
                success: true,
                message: 'Home slides retrieved successfully.',
                data: homeSlideCache.get(CACHE_KEY)
            });
        }

        const slides = await HomeScreenSlider.find().lean();
        homeSlideCache.set(CACHE_KEY, slides);

        return res.status(200).json({
            success: true,
            message: 'Home slides retrieved successfully.',
            data: slides
        });
    } catch (error) {
        console.error("Error retrieving Home slides:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
};

// Get single home slide
exports.get_Home_slide_by_id = async (req, res) => {
    const { id } = req.params;
    try {
        const slide = await HomeScreenSlider.findById(id);
        if (!slide) {
            return res.status(404).json({
                success: false,
                message: 'home slide not found.'
            });
        }
        return res.status(200).json({
            success: true,
            message: 'home slide retrieved successfully.',
            data: slide
        });
    } catch (error) {
        console.error("Error retrieving homeslide slide:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
};

// Delete home slide
exports.delete_homeslide_slide = async (req, res) => {
    const { id } = req.params;
    try {
        const slide = await HomeScreenSlider.findByIdAndDelete(id);
        if (!slide) {
            return res.status(404).json({
                success: false,
                message: 'homeslide slide not found.'
            });
        }

        if (slide.imageUrl.public_id) {
            await deleteImage(slide.imageUrl.public_id);
        }

        // Invalidate cache
        homeSlideCache.delete(CACHE_KEY);

        return res.status(200).json({
            success: true,
            message: 'homeslide slide deleted successfully.'
        });
    } catch (error) {
        console.error("Error deleting homeslide slide:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
};

// Update home slide
exports.update_homeslide_slide = async (req, res) => {
    const { id } = req.params;
    const { active } = req.body;
    let file = req.file;

    try {
        const slide = await HomeScreenSlider.findById(id);
        if (!slide) {
            return res.status(404).json({
                success: false,
                message: 'homeslide slide not found.'
            });
        }

        // If a new image is uploaded
        if (file) {
            if (slide.imageUrl?.public_id) {
                await deleteImage(slide.imageUrl.public_id);
            }

            const result = await uploadSingleImage(file.buffer, 'homeslide_slides');
            if (!result) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to upload image.'
                });
            }

            const { image, public_id } = result;
            slide.imageUrl = { image, public_id };
        }

        slide.active = active;
        await slide.save();

        // Invalidate cache
        homeSlideCache.delete(CACHE_KEY);

        return res.status(200).json({
            success: true,
            message: 'home slide updated successfully.',
            data: slide
        });
    } catch (error) {
        console.error("Error updating homeslide slide:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
};
