const AppHomeBanner = require('../models/Admin/AppHomeBanner.model.js');
const { uploadSingleImage, deleteImage } = require('../utils/cloudinary');

// Create Banner
exports.createAppHomeBanner = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Image is required'
            });
        }

        // Upload image to Cloudinary
        const uploadedImage = await uploadSingleImage(req.file.buffer);
        if(!uploadedImage) {
            return res.status(500).json({
                success: false,
                message: 'Failed to upload image'
            });
        }
        const { image, public_id } = uploadedImage;

        // Save banner
        const banner = new AppHomeBanner({
            image: {
                url: image,
                public_id: public_id
            }
        });
        await banner.save();

        res.status(201).json({
            success: true,
            message: 'Banner created successfully',
            data: banner
        });
    } catch (error) {
        console.error("Internal server error", error);
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        });
    }
};

// Get All Banners
exports.getAllAppHomeBanners = async (req, res) => {
    try {
        const banners = await AppHomeBanner.find().sort({ createdAt: -1 });
        res.status(200).json({
            success: true,
            data: banners
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch banners',
            error: error.message
        });
    }
};

// Get Single Banner
exports.getSingleAppHomeBanner = async (req, res) => {
    try {
        const banner = await AppHomeBanner.findById(req.params.id);
        if (!banner) {
            return res.status(404).json({
                success: false,
                message: 'Banner not found'
            });
        }

        res.status(200).json({
            success: true,
            data: banner
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to fetch banner',
            error: error.message
        });
    }
};

// Update Banner
exports.updateAppHomeBanner = async (req, res) => {
    try {
        const banner = await AppHomeBanner.findById(req.params.id);
        if (!banner) {
            return res.status(404).json({
                success: false,
                message: 'Banner not found'
            });
        }

        // Update image if provided
        if (req.file) {
            if(banner.image.public_id){
                await deleteImage(banner.image.public_id);
            }
            const uploadedImage = await uploadSingleImage(req.file.buffer);
            banner.image = {
                url: uploadedImage.image,
                public_id: uploadedImage.public_id
            };
        }

        // Update is_active if provided
        if (typeof req.body.is_active !== 'undefined') {
            banner.is_active = req.body.is_active;
        }

        await banner.save();

        res.status(200).json({
            success: true,
            message: 'Banner updated successfully',
            data: banner
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update banner',
            error: error.message
        });
    }
};

// Delete Banner
exports.deleteAppHomeBanner = async (req, res) => {
    try {
        const banner = await AppHomeBanner.findById(req.params.id);
        if (!banner) {
            return res.status(404).json({
                success: false,
                message: 'Banner not found'
            });
        }

        if(banner.image.public_id){
            await deleteImage(banner.image.public_id);
        }

        res.status(200).json({
            success: true,
            message: 'Banner deleted successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to delete banner',
            error: error.message
        });
    }
};

exports.updateAppHomeBannerStatus = async (req, res) => {
    try {
        const banner = await AppHomeBanner.findById(req.params.id);
        if (!banner) {
            return res.status(404).json({
                success: false,
                message: 'Banner not found'
            });
        }

        banner.is_active = !banner.is_active;
        await banner.save();

        res.status(200).json({
            success: true,
            message: 'Banner status updated successfully',
            data: banner
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to update banner status',
            error: error.message
        });
    }
};