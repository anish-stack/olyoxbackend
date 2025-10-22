const PersonalCoupon = require("../models/Admin/PersonalCoupons");
const Heavy_vehicle_partners = require("../models/Heavy_vehicle/Heavy_vehicle_partners");
const HotelUser = require("../models/Hotel.user");
const RiderModel = require("../models/Rider.model");
const Restaurant = require("../models/Tiifins/Resturant_register.model");



exports.getAllPartnersNameAndBHAndId = async (req, res) => {
    try {
        console.log('Starting to fetch all partners data');

        // Corrected query to select only needed fields instead of using populate incorrectly
        const cabAndParcel = await RiderModel.find({}, 'name BH _id');
        console.log(`Found ${cabAndParcel.length} cab and parcel partners`);

        const restaurantUsers = await Restaurant.find({}, 'restaurant_name restaurant_BHID _id');
        console.log(`Found ${restaurantUsers.length} restaurant partners`);

        const hotelUsers = await HotelUser.find({}, 'hotel_name bh _id');
        console.log(`Found ${hotelUsers.length} hotel partners`);

        const heavyVehicles = await Heavy_vehicle_partners.find({}, 'name Bh_Id _id');
        console.log(`Found ${heavyVehicles.length} heavy vehicle partners`);

        // Format the response in a consistent way
        const response = {
            success: true,
            data: {
                cabAndParcel: cabAndParcel.map(item => ({
                    _id: item._id,
                    name: item.name,
                    BH: item.BH
                })),
                restaurants: restaurantUsers.map(item => ({
                    _id: item._id,
                    name: item.restaurant_name,
                    BH: item.restaurant_BHID
                })),
                hotels: hotelUsers.map(item => ({
                    _id: item._id,
                    name: item.hotel_name,
                    BH: item.bh
                })),
                heavyVehicles: heavyVehicles.map(item => ({
                    _id: item._id,
                    name: item.name,
                    BH: item.Bh_Id
                }))
            }
        };

        console.log('Successfully formatted all partners data');
        return res.status(200).json(response);

    } catch (error) {
        console.error('Error fetching partners data:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch partners data',
            error: error.message
        });
    }
};


exports.createPCoupon = async (req, res) => {
    try {
        const { code, discount, expirationDate, assignedTo, onModel } = req.body;

        // Check if the coupon code already exists
        const existingCoupon = await PersonalCoupon.findOne({ code });
        if (existingCoupon) {
            return res.status(400).json({ message: 'Coupon code already exists' });
        }

        // Create a new coupon
        const newCoupon = new PersonalCoupon({
            code,
            discount,
            expirationDate,
            assignedTo,
            onModel,
        });

        // Save the coupon to the database
        await newCoupon.save();
        return res.status(201).json({ message: 'Coupon created successfully', coupon: newCoupon });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Get all active coupons
exports.getActivePCoupons = async (req, res) => {
    try {
        const activeCoupons = await PersonalCoupon.find({ isActive: true }).populate('assignedTo');
        return res.status(200).json(activeCoupons);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
};

exports.getAllPCoupons = async (req, res) => {
    try {
        const activeCoupons = await PersonalCoupon.find().populate('assignedTo');
        return res.status(200).json(activeCoupons);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Get a coupon by its ID
exports.getCouponPById = async (req, res) => {
    try {
        const { id } = req.params;
        const coupon = await PersonalCoupon.findById(id).populate('assignedTo');

        if (!coupon) {
            return res.status(404).json({ message: 'Coupon not found' });
        }

        return res.status(200).json(coupon);
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Update a coupon (e.g., change isActive status or expiration date)
exports.updatePCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const { discount, expirationDate, isActive } = req.body;

        const updatedCoupon = await PersonalCoupon.findByIdAndUpdate(id, {
            discount,
            expirationDate,
            isActive
        }, { new: true });

        if (!updatedCoupon) {
            return res.status(404).json({ message: 'Coupon not found' });
        }

        return res.status(200).json({ message: 'Coupon updated successfully', coupon: updatedCoupon });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
};

// Delete a coupon
exports.deletePCoupon = async (req, res) => {
    try {
        const { id } = req.params;

        const deletedCoupon = await PersonalCoupon.findByIdAndDelete(id);

        if (!deletedCoupon) {
            return res.status(404).json({ message: 'Coupon not found' });
        }

        return res.status(200).json({ message: 'Coupon deleted successfully' });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: 'Server error' });
    }
};

exports.getCouponpAById = async (req, res) => {
    try {
        const { id } = req.params;
        console.log("🔍 Fetching coupons for user ID:", id);

        // Fetch all coupons with assignedTo populated
        let coupons = await PersonalCoupon.find({ assignedTo: id })
            .populate('assignedTo', 'name phone BH aadharNumber isActive');
        console.log(`📝 Total coupons fetched: ${coupons.length}`);

        // Filter coupons assigned to the specific user
        coupons = coupons.filter((item) => {
            const assignedId = item?.assignedTo?._id?.toString();
            const match = assignedId === id;
            console.log(`Coupon ID: ${item._id}, assignedTo: ${assignedId}, match: ${match}`);
            return match;
        });

        console.log(`✅ Coupons after filtering for user: ${coupons.length}`);

        if (coupons.length === 0) {
            console.log("⚠️ No coupons found for this user");
            return res.status(404).json({ message: 'Coupon not found' });
        }

        // Return the found coupons
        return res.status(200).json({
            success: true,
            data: coupons,
        });

    } catch (error) {
        console.error("❌ Error in getCouponpAById:", error);
        return res.status(500).json({ message: 'Server error' });
    }
};

