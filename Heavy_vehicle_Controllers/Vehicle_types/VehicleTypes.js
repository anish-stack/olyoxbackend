const Vehicle = require('../../models/Heavy_vehicle/Vehicle_types.model');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');


cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});


exports.createVehicle = async (req, res) => {
    try {

        if (!req.body.name || !req.body.vehicleType) {
            return res.status(400).json({
                success: false,
                message: 'Please provide name and vehicleType'
            });
        }


        const validTypes = ['Big', 'Small', 'Medium'];
        if (!validTypes.includes(req.body.vehicleType)) {
            return res.status(400).json({
                success: false,
                message: 'Vehicle type must be Big, Small, or Medium'
            });
        }

        const vehicleData = {
            name: req.body.name,
            vehicleType: req.body.vehicleType,
            categoryId: req.body.categoryId,
            isAvailable: req.body.isAvailable !== undefined ? req.body.isAvailable : true
        };


        if (req.file) {

            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'vehicles'
            });

            fs.unlinkSync(req.file.path);

            vehicleData.image = {
                url: result.secure_url,
                public_id: result.public_id
            };
        }


        const vehicle = await Vehicle.create(vehicleData);

        return res.status(201).json({
            success: true,
            message: 'Vehicle created successfully',
            data: vehicle
        });
    } catch (error) {
        console.error('Error creating vehicle:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to create vehicle',
            error: error.message
        });
    }
};


exports.getAllVehicles = async (req, res) => {
    try {
        const { vehicleType, isAvailable, name, categoryId } = req.query;
        const filter = {};

        if (vehicleType) filter.vehicleType = vehicleType;
        if (isAvailable !== undefined) filter.isAvailable = isAvailable === 'true';
        if (name) filter.name = { $regex: name, $options: 'i' };
        if (categoryId) filter.categoryId = categoryId;
        console.log("categoryId", categoryId)
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const vehicles = await Vehicle.find(filter)
            .populate({
                path: 'categoryId',
                select: 'title',
            })
            .skip(skip)
            .limit(limit)
            .sort({ createdAt: -1 });

        const totalVehicles = await Vehicle.countDocuments(filter);

        return res.status(200).json({
            success: true,
            count: vehicles.length,
            totalPages: Math.ceil(totalVehicles / limit),
            currentPage: page,
            data: vehicles
        });
    } catch (error) {
        console.error('Error getting vehicles:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get vehicles',
            error: error.message
        });
    }
};

exports.getcategoryIdVehicles = async (req, res) => {
    try {
        const { categoryId } = req.query;
        console.log(categoryId);

        const vehicles = await Vehicle.find({ categoryId: categoryId })
            .populate({
                path: 'categoryId',
                select: 'title',
            })

            .sort({ createdAt: -1 });

        return res.status(200).json({
            success: true,
            count: vehicles.length,

            data: vehicles
        });
    } catch (error) {
        console.error('Error getting vehicles:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to get vehicles',
            error: error.message
        });
    }
};


exports.getVehicle = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Please provide vehicle ID'
            });
        }

        const vehicle = await Vehicle.findById(id).populate('categoryId');

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found'
            });
        }

        return res.status(200).json({
            success: true,
            data: vehicle
        });
    } catch (error) {
        console.error('Error getting vehicle:', error);

        // Handle invalid ID format
        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid vehicle ID format'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Failed to get vehicle',
            error: error.message
        });
    }
};

// Update vehicle
exports.updateVehicle = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Please provide vehicle ID'
            });
        }

        // Find vehicle to update
        const vehicle = await Vehicle.findById(id);

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found'
            });
        }

        // Prepare update data
        const updateData = {};

        // Update basic fields if provided
        if (req.body.name) updateData.name = req.body.name;
        if (req.body.categoryId) updateData.categoryId = req.body.categoryId;

        if (req.body.vehicleType) {
            // Validate vehicle type
            const validTypes = ['Big', 'Small', 'Medium'];
            if (!validTypes.includes(req.body.vehicleType)) {
                return res.status(400).json({
                    success: false,
                    message: 'Vehicle type must be Big, Small, or Medium'
                });
            }
            updateData.vehicleType = req.body.vehicleType;
        }
        if (req.body.isAvailable !== undefined) updateData.isAvailable = req.body.isAvailable;

        // Handle image update if provided
        if (req.file) {
            // Delete previous image from cloudinary if exists
            if (vehicle.image && vehicle.image.public_id) {
                await cloudinary.uploader.destroy(vehicle.image.public_id);
            }

            // Upload new image
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'vehicles'
            });

            // Delete file from server after upload
            fs.unlinkSync(req.file.path);

            // Update image data
            updateData.image = {
                url: result.secure_url,
                public_id: result.public_id
            };
        }

        // Update vehicle
        const updatedVehicle = await Vehicle.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        );

        return res.status(200).json({
            success: true,
            message: 'Vehicle updated successfully',
            data: updatedVehicle
        });
    } catch (error) {
        console.error('Error updating vehicle:', error);


        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid vehicle ID format'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Failed to update vehicle',
            error: error.message
        });
    }
};


exports.deleteVehicle = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Please provide vehicle ID'
            });
        }

        // Find vehicle to delete
        const vehicle = await Vehicle.findById(id);

        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found'
            });
        }

        // Delete image from cloudinary if exists
        if (vehicle.image && vehicle.image.public_id) {
            await cloudinary.uploader.destroy(vehicle.image.public_id);
        }

        // Delete vehicle
        await Vehicle.findByIdAndDelete(id);

        return res.status(200).json({
            success: true,
            message: 'Vehicle deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting vehicle:', error);

        // Handle invalid ID format
        if (error.name === 'CastError') {
            return res.status(400).json({
                success: false,
                message: 'Invalid vehicle ID format'
            });
        }

        return res.status(500).json({
            success: false,
            message: 'Failed to delete vehicle',
            error: error.message
        });
    }
};