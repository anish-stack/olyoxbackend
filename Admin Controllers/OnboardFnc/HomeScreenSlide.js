const { uploadSingleImage, deleteImage } = require("../../utils/cloudinary");
const HomeScreenSlider = require('../../models/Admin/HomeScreenSlider');

exports.create_home_slide = async (req, res) => {
    try {
        const file = req.file;
        const { active } = req.body;

        // ✅ Validate image file
        if (!file) {
            return res.status(400).json({
                success: false,
                message: 'Image is required.',
            });
        }

        // ✅ Upload image to Cloudinary
        const result = await uploadSingleImage(file.buffer, 'homeslide_slides');
        if (!result) {
            return res.status(500).json({
                success: false,
                message: 'Failed to upload image.',
            });
        }
        // console.log(result);
        const { image, public_id } = result;

        // ✅ Save the homeslide slide to the database
        const newSlide = new HomeScreenSlider({

            imageUrl: {
                image: image,
                public_id: public_id
            },
            active
        });

        await newSlide.save();

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

exports.get_home_slides = async (req, res) => {
    try {
        const slides = await HomeScreenSlider.find();
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
        await deleteImage(slide.imageUrl.public_id)
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
exports.update_homeslide_slide = async (req, res) => {
    const { id } = req.params;
    const { active } = req.body;
    let file = req.file;

    try {
        // ✅ Find the existing homeslide slide
        const slide = await HomeScreenSlider.findById(id);
        if (!slide) {
            return res.status(404).json({
                success: false,
                message: 'homeslide slide not found.'
            });
        }

        // ✅ Validate required fields
        if (!title || !description || !slug) {
            return res.status(400).json({
                success: false,
                message: 'All fields (title, description, slug) are required.'
            });
        }

        // ✅ If a new image is uploaded, upload to Cloudinary
        if (file) {
            // Delete old image from Cloudinary (optional, but recommended for cleanup)
            if (slide.imageUrl?.public_id) {
                // Assuming you have a deleteImage function in cloudinary utils
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