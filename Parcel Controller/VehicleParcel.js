const Parcel_VehicleModel = require("../models/Parcel_Models/Parcel_VehicleSchema.model");
const cloudinary = require("cloudinary").v2;
const fs = require("fs");

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

const getUniquePosition = async () => {
    const usedPositions = await Parcel_VehicleModel.find().distinct("position");
    let position = 1;
    while (usedPositions.includes(position)) {
        position++;
    }
    return position;
};

// CREATE
exports.createVehicleForParcel = async (req, res) => {
    try {
        const {
            BaseFare,
            title,
            info,
            max_weight,
            price_per_km,
            status,
            anyTag,
            tag,
            time_can_reach,
            position,
        } = req.body;

        let uploadedImage = null;
        if (req.file?.path) {
            uploadedImage = await cloudinary.uploader.upload(req.file.path, {
                folder: "parcel_vehicles/vehicles",
            });
        }

        const uniquePosition =
            position && !(await Parcel_VehicleModel.findOne({ position }))
                ? position
                : await getUniquePosition();

        const newVehicle = await Parcel_VehicleModel.create({
            image: uploadedImage
                ? {
                    url: uploadedImage.secure_url,
                    public_id: uploadedImage.public_id,
                }
                : null,
            title,
            BaseFare,

            info,
            max_weight,
            price_per_km,
            status,
            anyTag,
            tag,
            time_can_reach,
            position: uniquePosition,
        });

        res.status(201).json({ success: true, data: newVehicle });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET ALL
exports.getAllVehicles = async (req, res) => {
    try {
        const vehicles = await Parcel_VehicleModel.find().sort("position");
        res.status(200).json({ success: true, data: vehicles });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET SINGLE
exports.getVehicleById = async (req, res) => {
    try {
        const vehicle = await Parcel_VehicleModel.findById(req.params.id);
        if (!vehicle) {
            return res.status(404).json({ success: false, message: "Vehicle not found" });
        }
        res.status(200).json({ success: true, data: vehicle });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// UPDATE
exports.updateVehicle = async (req, res) => {
    try {
        const existing = await Parcel_VehicleModel.findById(req.params.id);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Vehicle not found" });
        }

        // Handle image update
        if (req.file?.path) {
            // Delete old image if exists
            if (existing.image?.public_id) {
                await cloudinary.uploader.destroy(existing.image.public_id);
            }

            const newImage = await cloudinary.uploader.upload(req.file.path, {
                folder: "parcel_vehicles/vehicles",
            });

            existing.image = {
                url: newImage.secure_url,
                public_id: newImage.public_id,
            };
        }


        // Update other fields
        existing.BaseFare = req.body.BaseFare ?? existing.BaseFare;
        existing.title = req.body.title ?? existing.title;
        existing.info = req.body.info ?? existing.info;
        existing.max_weight = req.body.max_weight ?? existing.max_weight;
        existing.price_per_km = req.body.price_per_km ?? existing.price_per_km;
        existing.status = req.body.status ?? existing.status;
        existing.anyTag = req.body.anyTag ?? existing.anyTag;
        existing.tag = req.body.tag ?? existing.tag;
        existing.time_can_reach = req.body.time_can_reach ?? existing.time_can_reach;

        // Update position only if unique or assign new
        if (
            req.body.position &&
            req.body.position !== existing.position &&
            !(await Parcel_VehicleModel.findOne({ position: req.body.position }))
        ) {
            existing.position = req.body.position;
        }

        await existing.save();
        res.status(200).json({ success: true, data: existing });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// DELETE
exports.deleteVehicle = async (req, res) => {
    try {
        const vehicle = await Parcel_VehicleModel.findById(req.params.id);
        if (!vehicle) {
            return res.status(404).json({ success: false, message: "Vehicle not found" });
        }

        // Delete Cloudinary image
        if (vehicle.image?.public_id) {
            await cloudinary.uploader.destroy(vehicle.image.public_id);
        }

        await vehicle.deleteOne();

        res.status(200).json({ success: true, message: "Vehicle deleted successfully" });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



exports.updateVehicleStatus = async (req, res) => {
    try{
        const {id} = req.params;
        const {status} = req.body;
        const vehicle = await Parcel_VehicleModel.findById(id);
        if(!vehicle){
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found'
            })
        }
        vehicle.status = status;
        await vehicle.save();
        res.status(200).json({
            success: true,
            data: vehicle
        })
    }catch(error){
        console.log('Internal server error',error)
        res.status(500).json({
            success: false,
            messsage: 'Internal server error',
            error: error.message
        })
    }
}