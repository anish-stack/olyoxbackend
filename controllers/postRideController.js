const PostRides = require("../models/Post_Rides/PostRides"); // Adjust path as needed
const mongoose = require("mongoose");
const axios = require("axios");
const SendWhatsAppMessageNormal = require("../utils/normalWhatsapp");
const calculateDistance = (coord1, coord2) => {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Earth's radius in km
  const dLat = toRad(coord2[1] - coord1[1]);
  const dLon = toRad(coord2[0] - coord1[0]);
  const lat1 = toRad(coord1[1]);
  const lat2 = toRad(coord2[1]);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const createPostRide = async (req, res) => {
  try {
    const {
      vehicleType,
      pickupLocation,
      dropLocation,
      pick_desc,
      drop_desc,
      fare,
      tripType = "oneway",
      isLater = false,
      scheduledDate,
      scheduledTime,
      distance,
      couponCode,
      discount = 0,
      specialRequests,
      userName: bodyUserName,
      phone: bodyPhone,
    } = req.body;

    console.log("📥 req.body:", req.body);

    const userId = req.user?.user?._id;
    const userName = req.user?.user?.name || bodyUserName;
    const phone = req.user?.user?.number || bodyPhone;

    // 🔐 Auth check
    if (!userId || !phone) {
      return res.status(401).json({
        success: false,
        message: "User authentication required",
      });
    }

    // ❌ Required fields
    if (!vehicleType || !pickupLocation || !dropLocation || !fare) {
      return res.status(400).json({
        success: false,
        message: "Missing required fields",
      });
    }

    // 📍 Validate location format
    const isValidLocation = (loc) =>
      loc &&
      typeof loc.latitude === "number" &&
      typeof loc.longitude === "number";

    if (!isValidLocation(pickupLocation) || !isValidLocation(dropLocation)) {
      return res.status(400).json({
        success: false,
        message: "Invalid pickup or drop location coordinates",
      });
    }

    // 📏 Calculate distance if not provided
    let finalDistance = distance;
    if (!finalDistance) {
      finalDistance = calculateDistance(
        [pickupLocation.longitude, pickupLocation.latitude],
        [dropLocation.longitude, dropLocation.latitude]
      ).toFixed(2);
    }

    // 📝 Create ride in DB
    const postRide = await PostRides.create({
      userId,
      userName,
      phone,
      vehicleType,

      pickupLocation: {
        type: "Point",
        coordinates: [pickupLocation.longitude, pickupLocation.latitude],
        address: pickupLocation.address,
      },

      dropLocation: {
        type: "Point",
        coordinates: [dropLocation.longitude, dropLocation.latitude],
        address: dropLocation.address,
      },

      pick_desc: pick_desc || pickupLocation.address,
      drop_desc: drop_desc || dropLocation.address,

      fare,
      tripType,
      isLater,

      scheduledDate: isLater ? scheduledDate : undefined,
      scheduledTime: isLater ? scheduledTime : undefined,

      distance: Number(finalDistance),
      couponCode,
      discount,
      specialRequests,

      status: "pending",
    });

    // 🚀 SEND WHATSAPP THANK YOU MESSAGE TO USER (English)
// Updated Short & Clean WhatsApp Thank You Message (English, No Emojis)

const whatsappThankYouMessage = `
Thank You! Your Ride Has Been Booked Successfully

Hello ${userName},

Pickup: ${pick_desc || pickupLocation.address}
Drop: ${drop_desc || dropLocation.address}

Vehicle: ${vehicleType.toUpperCase()}
Fare: ₹${fare}${discount > 0 ? ` (After discount: ₹${fare - discount})` : ""}
Distance: ~${finalDistance} km
Trip Type: ${tripType === "round" ? "Round Trip" : "One Way"}
${isLater ? `Scheduled: ${new Date(scheduledDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })} at ${scheduledTime}` : "Immediate Ride"}

We will send you the driver's details soon. Please wait.

Download the Olyox App for great offers & instant rides:
iOS: https://apps.apple.com/in/app/olyox/id6529528473
Play Store: https://play.google.com/store/apps/details?id=com.happy_coding.olyox&hl=en_IN


Thank you,
Team Olyox
`.trim();
    await SendWhatsAppMessageNormal(whatsappThankYouMessage, phone);

    // ✅ Success response
    return res.status(201).json({
      success: true,
      message: "Ride posted successfully",
      data: postRide,
    });
  } catch (error) {
    console.error("❌ Create Post Ride Error:", error);

    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};
// @desc    Get all posted rides for logged-in user
// @route   GET /api/post-rides/my-rides
// @access  Private
const getMyPostRides = async (req, res) => {
  try {
    const userId = req.user?._id;
    const phone = req.user?.phone;

    if (!userId && !phone) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const rides = await PostRides.find({
      $or: [{ userId }, { phone }],
    })
      .sort({ createdAt: -1 })
      .select("-__v");

    res.status(200).json({
      success: true,
      count: rides.length,
      data: rides,
    });
  } catch (error) {
    console.error("Get My Rides Error:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
};

// @desc    Get single posted ride by ID
// @route   GET /api/post-rides/:id
// @access  Private (user or driver)
const getPostRideById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid ride ID" });
    }

    const ride = await PostRides.findById(id);

    if (!ride) {
      return res
        .status(404)
        .json({ success: false, message: "Ride not found" });
    }

    // Optional: Restrict access to user or assigned driver
    const isOwner = ride.phone === req.user?.phone;
    const isAssignedDriver =
      ride.driverAssignment?.driverId?.toString() === req.user?._id?.toString();

    if (!isOwner && !isAssignedDriver && req.user?.role !== "admin") {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    res.status(200).json({
      success: true,
      data: ride,
    });
  } catch (error) {
    console.error("Get Ride By ID Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// @desc    Update ride status (e.g., driver accepts)
// @route   PATCH /api/post-rides/:id/status
// @access  Private (driver)
const updateRideStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, driverInfo } = req.body; // driverInfo: { driverId, driverName, driverPhone, vehiclePlate }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid ride ID" });
    }

    const validStatuses = ["confirmed", "inProgress", "completed", "cancelled"];
    if (!validStatuses.includes(status)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid status" });
    }

    const ride = await PostRides.findById(id);
    if (!ride) {
      return res
        .status(404)
        .json({ success: false, message: "Ride not found" });
    }

    if (ride.status !== "pending" && status === "confirmed") {
      return res.status(400).json({
        success: false,
        message: "Ride is no longer available",
      });
    }

    const updateData = { status };

    if (status === "confirmed" && driverInfo) {
      updateData.driverAssignment = {
        driverId: driverInfo.driverId,
        driverName: driverInfo.driverName,
        driverPhone: driverInfo.driverPhone,
        driverRating: driverInfo.driverRating || 0,
        vehiclePlate: driverInfo.vehiclePlate,
        assignedAt: new Date(),
      };
      updateData.rideStartTime = new Date(); // optional
    }

    if (status === "completed") {
      updateData.rideEndTime = new Date();
      updateData.paymentStatus = "completed"; // or based on payment
    }

    const updatedRide = await PostRides.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      message: "Ride status updated",
      data: updatedRide,
    });
  } catch (error) {
    console.error("Update Status Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// @desc    Cancel a posted ride
// @route   PATCH /api/post-rides/:id/cancel
// @access  Private (user who posted)
const cancelPostRide = async (req, res) => {
  try {
    const { id } = req.params;
    const { cancellationReason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid ride ID" });
    }

    const ride = await PostRides.findById(id);
    if (!ride) {
      return res
        .status(404)
        .json({ success: false, message: "Ride not found" });
    }

    if (ride.status !== "pending") {
      return res.status(400).json({
        success: false,
        message: "Cannot cancel ride in current status",
      });
    }

    if (ride.phone !== req.user?.phone) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized" });
    }

    const updatedRide = await PostRides.findByIdAndUpdate(
      id,
      {
        status: "cancelled",
        cancellationReason: cancellationReason || "User cancelled",
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: "Ride cancelled successfully",
      data: updatedRide,
    });
  } catch (error) {
    console.error("Cancel Ride Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// @desc    Find nearby posted rides (for drivers)
// @route   GET /api/post-rides/nearby?lat=&lng=&radius=10
// @access  Private (driver)
const getNearbyPostRides = async (req, res) => {
  try {
    const { lat, lng, radius = 10 } = req.query; // radius in km

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        message: "Latitude and longitude are required",
      });
    }

    const rides = await PostRides.find({
      status: "pending",
      "pickupLocation.coordinates": {
        $nearSphere: {
          $geometry: {
            type: "Point",
            coordinates: [parseFloat(lng), parseFloat(lat)],
          },
          $maxDistance: radius * 1000, // convert km to meters
        },
      },
    }).limit(20);

    res.status(200).json({
      success: true,
      count: rides.length,
      data: rides,
    });
  } catch (error) {
    console.error("Nearby Rides Error:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = {
  createPostRide,
  getMyPostRides,
  getPostRideById,
  updateRideStatus,
  cancelPostRide,
  getNearbyPostRides,
};
