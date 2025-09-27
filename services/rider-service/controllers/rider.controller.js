const { publishEvent } = require('../RabbitMQ/mq')

const Rider = require("../models/Rider.model");
const generateOtp = require("../utils/Otp.Genreator");
const mongoose = require("mongoose");



// ✅ register rider
exports.registerRider = async (req, res) => {
  try {
    const { name, phone, rideVehicleInfo, BH, role, aadharNumber } = req.body;
    const { vehicleName, vehicleType, PricePerKm, VehicleNumber, RcExpireDate } =
      rideVehicleInfo || {};

    // 1. Input validation
    if (!BH) return res.status(400).json({ success: false, message: "BH Number required." });
    if (!name || !phone || !vehicleName || !vehicleType || !VehicleNumber) {
      return res.status(400).json({ success: false, message: "All required fields must be filled." });
    }

    // 2. Duplicate checks (parallel)
    const [bhExists, phoneExists, aadharExists, vehicleExists] = await Promise.all([
      Rider.findOne({ BH, isDocumentUpload: true }),
      Rider.findOne({ phone }),
      Rider.findOne({ aadharNumber }),
      Rider.findOne({ "rideVehicleInfo.VehicleNumber": VehicleNumber }),
    ]);

    if (bhExists) return res.status(409).json({ success: false, message: `BH ${BH} already registered.` });
    if (aadharExists) return res.status(409).json({ success: false, message: "Aadhar already registered." });
    if (vehicleExists) return res.status(409).json({ success: false, message: `Vehicle ${VehicleNumber} already registered.` });

    // 3. Existing rider (unverified OTP case)
    if (phoneExists) {
      const rider = phoneExists;

      if (!rider.isOtpVerify) {
        if (rider.howManyTimesHitResend >= 5) {
          rider.isOtpBlock = true;
          rider.isDocumentUpload = false;
          rider.otpUnblockAfterThisTime = new Date(Date.now() + 30 * 60 * 1000);
          await rider.save();

          // 🔔 publish block event (Notification Service handle karega)
          publishEvent("rider.otp.blocked", { riderId: String(rider._id), phone, name });

          return res.status(429).json({ success: false, message: "Too many OTP attempts. Blocked for 30 min." });
        }

        // resend OTP
        const otp = generateOtp();
        rider.otp = otp;
        rider.howManyTimesHitResend += 1;
        rider.isDocumentUpload = false;
        await rider.save();

        // 🔔 publish OTP resent event
        publishEvent("rider.otp.resent", { riderId: String(rider._id), phone, name, role, otp });

        return res.json({ success: true, message: "OTP resent. Please verify to continue." });
      }

      return res.status(409).json({ success: false, message: "Phone already registered & verified." });
    }

    // 4. New Rider
    const otp = generateOtp();
    const newRider = await Rider.create({
      name,
      phone,
      rideVehicleInfo: { vehicleName, vehicleType, PricePerKm, VehicleNumber, RcExpireDate },
      BH,
      category: role,
      aadharNumber,
      otp,
      isOtpVerify: false,
      isDocumentUpload: false,
      howManyTimesHitResend: 0,
      isOtpBlock: false,
    });

    // 🔔 publish rider.created event
    publishEvent("rider.created", { riderId: String(newRider._id), phone, name, role, otp });

    return res.status(201).json({
      success: true,
      message: "Rider registered. OTP sent via Notification Service.",
      riderId: newRider._id,
    });
  } catch (err) {
    console.error("❌ registerRider error:", err);
    return res.status(500).json({ success: false, message: "Internal server error" });
  }
};


exports.getAllRiders = async (req, res) => {
  try {
    // Pagination params
    const page = Math.max(1, parseInt(req.query.page)) || 1;
    const limit = Math.min(100, parseInt(req.query.limit) || 20); // hard cap for safety
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim();

    // Build filter
    let filter = {};
    if (search) {
      const regex = new RegExp(search, "i");

      filter = {
        $or: [
          // Only valid ObjectId match
          mongoose.Types.ObjectId.isValid(search) ? { _id: search } : null,
          { name: regex },
          { phone: regex },
          { aadharNumber: regex },
          { "rideVehicleInfo.vehicleName": regex },
          { "rideVehicleInfo.vehicleType": regex },
          { "rideVehicleInfo.VehicleNumber": regex },
          { BH: regex },
          { category: regex },
        ].filter(Boolean),
      };
    }

    // Run queries in parallel
    const [riders, total] = await Promise.all([
      Rider.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .select(
          "-preferences -updateLogs -activityLog -howManyTimesHitResend -her_referenced -rides"
        )
        .lean(),
      Rider.countDocuments(filter),
    ]);

    // Microservice-friendly response
    return res.status(200).json({
      success: true,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      data: riders,
    });
  } catch (err) {
    console.error("❌ Error fetching riders:", err);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch riders",
      error: err.message,
    });
  }
};