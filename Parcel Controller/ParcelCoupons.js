const Parcel_CouponsModel = require("../models/Parcel_Models/Parcel_Coupons.model");

// 🔹 Create Coupon
exports.create_Coupons = async (req, res) => {
  try {
    const coupon = new Parcel_CouponsModel(req.body);
    await coupon.save();
    res.status(201).json({ success: true, data: coupon });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// 🔹 Get All Coupons
exports.getAll_Coupons = async (req, res) => {
  try {
    const coupons = await Parcel_CouponsModel.find();
    res.status(200).json({ success: true, data: coupons });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🔹 Get Single Coupon by ID
exports.getOne_Coupon = async (req, res) => {
  try {
    const coupon = await Parcel_CouponsModel.findById(req.params.id);
    if (!coupon) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }
    res.status(200).json({ success: true, data: coupon });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

// 🔹 Update Coupon
exports.update_Coupon = async (req, res) => {
  try {
    const updatedCoupon = await Parcel_CouponsModel.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!updatedCoupon) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }
    res.status(200).json({ success: true, data: updatedCoupon });
  } catch (error) {
    res.status(400).json({ success: false, error: error.message });
  }
};

// 🔹 Delete Coupon
exports.delete_Coupon = async (req, res) => {
  try {
    const deletedCoupon = await Parcel_CouponsModel.findByIdAndDelete(req.params.id);
    if (!deletedCoupon) {
      return res.status(404).json({ success: false, message: "Coupon not found" });
    }
    res.status(200).json({ success: true, message: "Coupon deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};


exports.updateisActiveToggle = async(req,res) => {
  try {
    const {id} = req.params;
    const {isActive} = req.body;
    const findCoupon = await Parcel_CouponsModel.findById(id)
    if(!findCoupon){
      return res.status(400).json({
        success: false,
        message: 'Coupon not found'
      })
    }
    findCoupon.isActive = isActive;
    await findCoupon.save()
  } catch (error) {
    console.log('Internal server error',error)
    res.status(500).json({
      success: false,
      message: 'Internal servere error',
      error: error.message
    })
  }
}