
const Coupon = require('../models/Admin/couponModel')

// Create a new coupon
exports.createCoupon = async (req, res) => {
    try {
        const { code, discount, expiryDate } = req.body;

     
        const existingCoupon = await Coupon.findOne({ code });
        if (existingCoupon) {
            return res.status(400).json({
                success: false,
                message: "Coupon code already exists"
            });
        }

        const newCoupon = new Coupon({
            code,
            discount,
            expiryDate
        });

        await newCoupon.save();
        res.status(201).json({
            success: true,
            message: "Coupon created successfully",
            coupon: newCoupon
        });
    } catch (error) {
        console.error("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error.message
        });
    }
};

// Get all coupons
exports.getAllCoupons = async (req, res) => {
    try {
        const coupons = await Coupon.find();
        res.status(200).json({
            success: true,
            data: coupons
        });
    } catch (error) {
        console.error("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error.message
        });
    }
};

// Get a single coupon by ID
exports.getCouponById = async (req, res) => {
    try {
        const { id } = req.params;
        const coupon = await Coupon.findById(id);
        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found"
            });
        }
        res.status(200).json({
            success: true,
            data: coupon
        });
    } catch (error) {
        console.error("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error.message
        });
    }
};

// Update a coupon by ID
exports.updateCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const updatedCoupon = await Coupon.findByIdAndUpdate(id, req.body, { new: true });
        if (!updatedCoupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found"
            });
        }
        res.status(200).json({
            success: true,
            message: "Coupon updated successfully",
            data: updatedCoupon
        });
    } catch (error) {
        console.error("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error.message
        });
    }
};

// Delete a coupon by ID
exports.deleteCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const deletedCoupon = await Coupon.findByIdAndDelete(id);
        if (!deletedCoupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found"
            });
        }
        res.status(200).json({
            success: true,
            message: "Coupon deleted successfully"
        });
    } catch (error) {
        console.error("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error.message
        });
    }
};

exports.checkCouponIsAvailable = async (req, res) => {
    try {
        const { code } = req.body;
        const findCoupon = await Coupon.findOne({ code });

        if (!findCoupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found"
            });
        }

        // Check if the coupon is active and not expired
        if (findCoupon.active && findCoupon.expiryDate > Date.now()) {
            return res.status(200).json({
                success: true,
                message: "Coupon is available",
                data: findCoupon
            });
        }

        // If coupon is found but does not meet the above condition, return an appropriate response
        return res.status(400).json({
            success: false,
            message: "Coupon is not available or expired",
            data: findCoupon
        });

    } catch (error) {
        console.error("Internal server error", error);
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error.message
        });
    }
};

exports.updateIsActiveStatus = async (req,res) => {
    try {
        const {id} = req.params;
        const {active} = req.body;
        const updatedCoupon = await Coupon.findByIdAndUpdate(id,{active},{new:true});
        if(!updatedCoupon){
            return res.status(404).json({
                success: false,
                message: "Coupon not found"
            });
        }
        res.status(200).json({
            success: true,
            message: "Coupon updated successfully",
            data: updatedCoupon
        });
    } catch (error) {
        console.log("Internal server error",error)
        return res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error.message
            });
    }
}