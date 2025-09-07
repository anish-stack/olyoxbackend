const { uploadSingleImage, deleteImage } = require("../../utils/cloudinary");
const OnboardModel = require('../../models/Admin/OnboardingSlides');

exports.create_onboarding_slide = async (req, res) => {
    try {
        const file = req.file;
        // console.log(file);
        const { title, description, slug } = req.body;

        // ✅ Validate required fields
        if (!title || !description || !slug) {
            return res.status(400).json({
                success: false,
                message: 'All fields (title, description, slug) are required.',
            });
        }

        // ✅ Validate image file
        if (!file) {
            return res.status(400).json({
                success: false,
                message: 'Image is required.',
            });
        }

        // ✅ Upload image to Cloudinary
        const result = await uploadSingleImage(file.buffer, 'onboarding_slides');
        if (!result) {
            return res.status(500).json({
                success: false,
                message: 'Failed to upload image.',
            });
        }
        // console.log(result);
        const { image, public_id } = result;

        // ✅ Save the onboarding slide to the database
        const newSlide = new OnboardModel({
            title,
            description,
            slug,
            imageUrl:{
                image: image,
                public_id: public_id
            },
       
        });

        await newSlide.save();

        return res.status(201).json({
            success: true,
            message: 'Onboarding slide created successfully.',
            data: newSlide
        });

    } catch (error) {
        console.error("Error creating onboarding slide:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
};




exports.get_onboarding_slides = async (req, res) => {
    try {
        const slides = await OnboardModel.find();
        return res.status(200).json({
            success: true,
            message: 'Onboarding slides retrieved successfully.',
            data: slides
        });
    } catch (error) {
        console.error("Error retrieving onboarding slides:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
};

// GET: Retrieve a specific onboarding slide by ID
exports.get_onboarding_slide_by_id = async (req, res) => {
    const { id } = req.params;
    try {
        const slide = await OnboardModel.findById(id);
        if (!slide) {
            return res.status(404).json({
                success: false,
                message: 'Onboarding slide not found.'
            });
        }
        return res.status(200).json({
            success: true,
            message: 'Onboarding slide retrieved successfully.',
            data: slide
        });
    } catch (error) {
        console.error("Error retrieving onboarding slide:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
};

// DELETE: Delete an onboarding slide by ID
exports.delete_onboarding_slide = async (req, res) => {
    const { id } = req.params;
    try {
        const slide = await OnboardModel.findByIdAndDelete(id);
        if (!slide) {
            return res.status(404).json({
                success: false,
                message: 'Onboarding slide not found.'
            });
        }
        return res.status(200).json({
            success: true,
            message: 'Onboarding slide deleted successfully.'
        });
    } catch (error) {
        console.error("Error deleting onboarding slide:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
};

// UPDATE: Update an onboarding slide by ID and upload a new image if provided
exports.update_onboarding_slide = async (req, res) => {
    const { id } = req.params;
    const { title, description, slug } = req.body;
    let file = req.file;

    try {
        // ✅ Find the existing onboarding slide
        const slide = await OnboardModel.findById(id);
        if (!slide) {
            return res.status(404).json({
                success: false,
                message: 'Onboarding slide not found.'
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

            const result = await uploadSingleImage(file.buffer, 'onboarding_slides');
            if (!result) {
                return res.status(500).json({
                    success: false,
                    message: 'Failed to upload image.'
                });
            }
            const { image, public_id } = result;

            // Update the slide with the new image
            slide.imageUrl = { image, public_id };
        }

        // ✅ Update the slide data
        slide.title = title;
        slide.description = description;
        slide.slug = slug;

        await slide.save();

        return res.status(200).json({
            success: true,
            message: 'Onboarding slide updated successfully.',
            data: slide
        });

    } catch (error) {
        console.error("Error updating onboarding slide:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.',
            error: error.message
        });
    }
};