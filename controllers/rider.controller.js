const CabRiderTimes = require("../models/CabRiderTimes");
const rideRequestModel = require("../models/ride.request.model");
const Rider = require("../models/Rider.model");
const generateOtp = require("../utils/Otp.Genreator");
const send_token = require("../utils/send_token");
const SendWhatsAppMessage = require("../utils/whatsapp_send");
const axios = require("axios");
const cloudinary = require("cloudinary").v2;
const moment = require("moment");
const momentTz = require("moment-timezone");
const VehicleAdds = require("../models/AddNewVheicleForDriver");
const fs = require("fs");
const path = require("path");
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const sharp = require("sharp");
const Bonus_Model = require("../models/Bonus_Model/Bonus_Model");
const Parcel_Request = require("../models/Parcel_Models/Parcel_Request");
const { sendDltMessage } = require("../utils/DltMessageSend");
const { checkBhAndDoRechargeOnApp } = require("../PaymentWithWebDb/razarpay");
const NewRideModelModel = require("../src/New-Rides-Controller/NewRideModel.model");
const sendNotification = require("../utils/sendNotification");
const SendWhatsAppMessageNormal = require("../utils/normalWhatsapp");
cloudinary.config({
  cloud_name: "daxbcusb5",
  api_key: "984861767987573",
  api_secret: "tCBu9JNxC_iaUENm1kDwLrdXL0k",
});
// Register a new rider

exports.registerRider = async (req, res) => {
  try {
    const {
      name,
      phone,
      rideVehicleInfo,
      BH,
      role,
      aadharNumber,
      isNew = true,
    } = req.body;

    const {
      vehicleName,
      vehicleType,
      PricePerKm,
      VehicleNumber,
      RcExpireDate,
    } = rideVehicleInfo || {};

    // 1️⃣ Validate input
    if (!BH) {
      console.log("[RegisterRider] ❌ BH Number missing");
      return res.status(400).json({
        success: false,
        message: "Please enter your BH Number.",
      });
    }

    if (!name || !phone || !vehicleName || !vehicleType || !VehicleNumber) {
      console.log("[RegisterRider] ❌ Missing required fields");
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled.",
      });
    }

    // 2️⃣ Check for duplicate BH
    const bhExists = await Rider.findOne({ BH, isDocumentUpload: true });
    if (bhExists) {
      console.log(`[RegisterRider] 🚫 BH ${BH} already exists`);
      return res.status(400).json({
        success: false,
        message: `A rider is already registered with BH Number: ${BH}. Please use a different BH Number.`,
      });
    }

    // 3️⃣ Check if phone exists
    let existingRider = await Rider.findOne({ phone });
    console.log("[RegisterRider] Found existing rider:", existingRider);

    if (existingRider) {
      if (!existingRider.isOtpVerify) {
        console.log("[RegisterRider] Rider exists but OTP not verified");

        if (existingRider.howManyTimesHitResend >= 5) {
          existingRider.isOtpBlock = true;
          existingRider.isDocumentUpload = false;
          existingRider.otpUnblockAfterThisTime = new Date(Date.now() + 30 * 60 * 1000);
          await existingRider.save();

          if (isNew) {
            await SendWhatsAppMessage(
              `Hi ${existingRider.name || "User"},\n\nYou’ve attempted OTP verification too many times.\nYour account has been temporarily locked for 30 minutes. Please try again later.\n\n- Team Olyox`,
              phone
            );

          } else {

            return res.status(429).json({
              success: false,
              message: "Too many OTP attempts. You are blocked for 30 minutes.",
            });
          }

        }

        // Generate new OTP
        const otp = generateOtp();
        console.log("[RegisterRider] 🔄 Generated new OTP:", otp);

        if (!isNew) {
          // Only send OTP if isNew = false
          const otpResult = await sendDltMessage(otp, phone);
          console.log("[RegisterRider] DLT Response:", otpResult);

          existingRider.otp = otp;
          existingRider.howManyTimesHitResend += 1;
          existingRider.isDocumentUpload = false;
          if (otpResult?.messageId) existingRider.messageId = otpResult.messageId;
          await existingRider.save();

          await SendWhatsAppMessage(
            `Hi ${existingRider.name || "User"},\n\nYour OTP for registering as ${role} rider is: ${otp}\n\nPlease use this to complete your registration.\n\n- Team Olyox`,
            phone
          );

          return res.status(200).json({
            success: true,
            message: "OTP resent successfully. Please verify to continue registration.",
          });
        }

        // If isNew = true, skip OTP and mark verified
        existingRider.isOtpVerify = true;
        existingRider.isDocumentUpload = true;
        await existingRider.save();

        return send_token(existingRider, { type: "CAB" }, res, req);
      }

      console.log("[RegisterRider] Phone already registered and verified");
      return res.status(409).json({
        success: false,
        message: "Phone number already registered with a verified account.",
      });
    }

    // 4️⃣ Check if Aadhar already exists
    const existingAadhar = await Rider.findOne({ aadharNumber });
    if (existingAadhar) {
      console.log("[RegisterRider] Duplicate Aadhar found");
      return res.status(409).json({
        success: false,
        message:
          "Aadhar number already exists. Please use a different Aadhar or log in if it's your account.",
      });
    }

    // 5️⃣ Check if vehicle number already registered
    const existingVehicle = await Rider.findOne({
      "rideVehicleInfo.VehicleNumber": VehicleNumber,
    });
    if (existingVehicle) {
      console.log("[RegisterRider] Vehicle number already registered:", VehicleNumber);
      return res.status(409).json({
        success: false,
        message: `Vehicle number ${VehicleNumber} is already registered with another rider.`,
      });
    }

    // 6️⃣ Create new rider entry
    const otp = generateOtp();
    console.log("[RegisterRider] Generated OTP:", otp);

    const newRider = new Rider({
      name,
      phone,
      rideVehicleInfo: {
        vehicleName,
        vehicleType,
        PricePerKm,
        VehicleNumber,
        RcExpireDate,
      },
      BH,
      category: role,
      aadharNumber,
      otp: isNew ? null : otp,
      isOtpVerify: isNew, // ✅ Skip OTP if isNew = true
      isDocumentUpload: false, // ✅ Mark as uploaded if isNew = true
      howManyTimesHitResend: 0,
      isOtpBlock: false,
    });

    // 7️⃣ Send OTP only if isNew = false
    if (!isNew) {
      const otpResult = await sendDltMessage(otp, phone);
      console.log("[RegisterRider] DLT Send Result:", otpResult);
      if (otpResult?.messageId) newRider.messageId = otpResult.messageId;

      await SendWhatsAppMessage(
        `Hi ${name},\n\nWelcome to Olyox!\nYour OTP for registering as a ${role} rider is: ${otp}.\n\nPlease verify your OTP to complete your registration.\n\nThank you for choosing us!\n- Team Olyox`,
        phone
      );
    }

    const savedRider = await newRider.save();
    console.log("[RegisterRider] ✅ Rider saved successfully:", savedRider._id);

    // 8️⃣ If OTP skipped, send token immediately
    if (isNew) {
      console.log("[RegisterRider] 🚀 isNew=true → skipping OTP, sending token");
      return send_token(savedRider, { type: "CAB" }, res, req);
    }

    // 9️⃣ Else, ask user to verify OTP
    return res.status(200).json({
      success: true,
      message: "Rider registered successfully. OTP sent for verification.",
    });
  } catch (error) {
    console.error("[RegisterRider] ❌ Error registering rider:", error);

    return res.status(500).json({
      success: false,
      message:
        "Something went wrong during registration. Please try again later.",
      error: error.message,
    });
  }
};


exports.getSingleRider = async (req, res) => {
  try {
  } catch (error) {
    console.log("Internal server error", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
exports.updateRechargeDetails = async (req, res) => {
  try {
    const { rechargePlan, expireData, approveRecharge, BH } = req.body || {};
    // Validate required fields
    if (!BH) {
      return res
        .status(400)
        .json({ success: false, message: "BH is required" });
    }

    // Find the rider by BH
    const foundRider = await Rider.findOne({ BH });
    if (!foundRider) {
      return res
        .status(404)
        .json({ success: false, message: "Rider not found" });
    }

    // If approveRecharge is true, update the recharge details
    if (approveRecharge) {
      foundRider.RechargeData = {
        rechargePlan,
        expireData,
        approveRecharge: true,
      };
      foundRider.isPaid = true;

      await foundRider.save();

      return res.status(200).json({
        success: true,
        message: "Recharge approved and rider marked as paid.",
        data: foundRider,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Recharge approval is required.",
      });
    }
  } catch (error) {
    console.error("Error updating recharge details:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error." });
  }
};

exports.login = async (req, res) => {
  try {
    const { number, otpType, fcmToken, AppVersion } = req.body;

    // ✅ Step 1: Basic validation
    if (!number) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    // ✅ Step 2: Find partner (Rider)
    let partner = await Rider.findOne({ phone: number });

    // ✅ Step 3: Handle not-found partner (check website provider)
    if (!partner) {
      try {
        const { data } = await axios.post(
          "https://webapi.olyox.com/api/v1/getProviderDetailsByNumber",
          { number }
        );

        if (data.success) {
          return res.status(403).json({
            success: false,
            message:
              "You are registered with us on website but on vendor complete profile first!!",
            redirect: "complete-profile",
          });
        }
      } catch (err) {
        return res.status(402).json({
          success: false,
          message:
            "Profile not found on website and app. Please register first!",
        });
      }
    }

    // ✅ Step 4: Generate token (partner confirmed)
    const token = jwt.sign(
      { userId: partner._id },
      "dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih",
      { expiresIn: "30d" }
    );
    console.log("[LOGIN] token:", token);

    // ✅ Step 5: Check admin block
    if (partner.isBlockByAdmin) {
      return res.status(401).json({
        success: false,
        message: "Your account has been blocked by admin. Contact support.",
      });
    }

    // ✅ Step 6: OTP block check
    if (partner.isOtpBlock && partner.otpUnblockAfterThisTime) {
      const unblockTime = new Date(partner.otpUnblockAfterThisTime);
      if (new Date() < unblockTime) {
        return res.status(403).json({
          success: false,
          message: `You are blocked from requesting OTP. Please try again after ${unblockTime.toLocaleTimeString()}`,
        });
      }
    }

    // ✅ Step 7: Check profile/document completion
    if (!partner.isDocumentUpload) {
      return res.status(200).json({
        success: true,
        token,
        rider: partner,
        message: "Please complete your document upload.",
        redirect: "document-upload",
      });
    }

    if (!partner.isProfileComplete) {
      return res.status(200).json({
        success: true,
        token,
        rider: partner,
        message: "Your profile is under review. Please wait.",
        redirect: "wait-screen",
      });
    }

    // ✅ Step 8: Generate OTP
    const isTestNumber = ["8287229430", "7272727212"].includes(number);
    const otp = isTestNumber ? "123456" : await generateOtp();


    const updatePromise = Rider.updateOne(
      { _id: partner._id },
      {
        $set: {
          otp,
          AppVersion: AppVersion || "1.0.1",
          fcmToken: fcmToken || partner.fcmToken,
          isOtpBlock: false,
          otpUnblockAfterThisTime: null,
          howManyTimesHitResend: 0,
        },
      }
    );

    // ✅ Only send OTP if not test number
    let otpSendPromise = Promise.resolve();
    if (!isTestNumber) {
      otpSendPromise =
        otpType === "text"
          ? sendDltMessage(otp, number)
          : SendWhatsAppMessage(`Your OTP for CaB registration is: ${otp}`, number);
    }

    await Promise.all([updatePromise, otpSendPromise]);

    console.log("[LOGIN] OTP:", otp);

    // ✅ Step 10: Send final success response
    return res.status(201).json({
      success: true,
      rider: partner,
      message: "Please verify OTP sent to your phone.",
      otp, // ⚠️ remove this in production
    });

  } catch (error) {
    console.error("[LOGIN] Error:", error);
    return res.status(501).json({
      success: false,
      error: error.message || "Something went wrong",
    });
  }
};


exports.saveFcmTokenToken = async (req, res) => {
  try {
    const riderId = req.user?.userId;
    let { fcmToken, platform, deviceId, timestamp } = req.body;

    if (!fcmToken) {
      return res.status(400).json({
        success: false,
        message: "FCM token is required",
      });
    }

    console.log("📩 Incoming FCM token:", fcmToken);

    // Default values
    deviceId = deviceId || "unknown";
    platform = platform || "unknown";
    timestamp = timestamp ? new Date(timestamp) : new Date();

    const rider = await Rider.findById(riderId);
    if (!rider) {
      return res.status(401).json({
        success: false,
        message: "Rider not found",
      });
    }

    const now = new Date();
    const lastUpdate = rider.fcmUpdatedAt || new Date(0);
    const diffMinutes = (now - lastUpdate) / (1000 * 60);

    const shouldUpdate =
      rider.fcmToken !== fcmToken ||
      rider.deviceId !== deviceId ||
      diffMinutes >= 10;

    if (shouldUpdate) {
      rider.fcmToken = fcmToken;
      rider.deviceId = deviceId;
      rider.platform = platform;
      rider.fcmUpdatedAt = timestamp;
      await rider.save();

      console.log(
        `✅ FCM updated for rider ${riderId} | Platform: ${platform} | Device: ${deviceId} | After ${diffMinutes.toFixed(
          1
        )} min`
      );

      return res.status(201).json({
        success: true,
        message: "FCM token updated successfully",
        data: {
          riderId,
          fcmToken,
          platform,
          deviceId,
          lastUpdated: timestamp,
        },
      });
    } else {
      console.log(
        `ℹ️ FCM token and deviceId unchanged for rider ${riderId}, last updated ${diffMinutes.toFixed(
          1
        )} min ago`
      );

      return res.status(200).json({
        success: true,
        message: `FCM token unchanged (last updated ${diffMinutes.toFixed(
          1
        )} min ago)`,
      });
    }
  } catch (error) {
    console.error("❌ Error saving FCM token:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};



exports.logoutRider = async (req, res) => {
  try {
    const { rider_id } = req.params || {};

    const foundRider = await Rider.findById(rider_id);
    if (!foundRider) {
      return res.status(401).json({
        success: false,
        message: "Please log in to access this feature.",
      });
    }

    // Prevent logout if there's an active ride
    if (foundRider.on_ride_id) {
      return res.status(402).json({
        success: false,
        message:
          "You currently have an ongoing ride. Please complete the ride before logging out.",
      });
    }

    // Update rider status
    foundRider.isAvailable = false;
    foundRider.on_ride_id = null;
    await foundRider.save(); // important to persist the changes

    // Clear authentication token
    res.clearCookie("auth_token", {
      httpOnly: true,
      secure: true, // set to true in production
      sameSite: "None",
    });

    return res.status(200).json({
      success: true,
      message: "You have been logged out successfully. See you next time!",
    });
  } catch (error) {
    console.error("Logout error:", error);
    return res.status(500).json({
      success: false,
      message:
        "Oops! Something went wrong while logging out. Please try again later.",
    });
  }
};

exports.resendOtp = async (req, res) => {
  try {
    const { number } = req.body;

    if (!number) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    const partner = await Rider.findOne({ phone: number });

    if (!partner) {
      return res.status(400).json({
        success: false,
        message: "Phone number is not registered",
      });
    }
    if (partner.isOtpVerify) {
      return res.status(400).json({
        success: false,
        message: "You have already verified your OTP",
      });
    }

    // Check if OTP is blocked
    if (partner.isOtpBlock) {
      // Check if the unblock time has passed
      const currentTime = new Date();
      if (currentTime < partner.otpUnblockAfterThisTime) {
        const timeRemaining =
          (partner.otpUnblockAfterThisTime - currentTime) / 1000;
        return res.status(400).json({
          success: false,
          message: `OTP resend is blocked. Try again in ${Math.ceil(
            timeRemaining
          )} seconds.`,
        });
      } else {
        // Unblock the OTP after the set time has passed
        partner.isOtpBlock = false;
        partner.howManyTimesHitResend = 0; // Reset the resend attempts
        partner.otpUnblockAfterThisTime = null; // Clear the unblock time
        await partner.save();
      }
    }

    // If resend limit is reached, block the OTP and set the unblock time
    if (partner.howManyTimesHitResend >= 5) {
      // Block the OTP and set the time for when it will be unblocked (e.g., 30 minutes)
      partner.isOtpBlock = true;
      partner.otpUnblockAfterThisTime = new Date(Date.now() + 30 * 60 * 1000); // Block for 30 minutes
      await partner.save();

      return res.status(400).json({
        success: false,
        message: "OTP resend limit reached. Please try again later.",
      });
    }

    const otp = number === "8287229430" ? "123456" : await generateOtp();
    partner.otp = otp;
    partner.howManyTimesHitResend += 1;
    await partner.save();

    const otpMessage = `Your OTP for cab registration is: ${otp}`;
    const data = await SendWhatsAppMessage(otpMessage, number);
    const dlt = await sendDltMessage(otp, number);
    console.log(data);
    res.status(200).json({
      success: true,
      message: "OTP resent successfully. Please check your phone.",
      otp: otp,
    });
  } catch (error) {
    res.status(501).json({
      success: false,
      error: error.message || "Something went wrong",
    });
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const { number, otp } = req.body;

    if (!number || !otp) {
      return res.status(400).json({
        success: false,
        message: "Phone number and OTP are required",
      });
    }

    const partner = await Rider.findOne({ phone: number }).lean(); // lean = faster plain object
    if (!partner) {
      return res.status(400).json({
        success: false,
        message: "Phone number is not registered",
      });
    }

    if (partner.otp !== otp) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    // --- Prepare base update ---
    const updateData = {
      otp: null,
      isOtpVerify: true,
      howManyTimesHitResend: 0,
      isOtpBlock: false,
      otpUnblockAfterThisTime: null,
    };

    // ✅ Handle document upload check
    if (!partner.isDocumentUpload) {
      const docCount = Object.keys(partner.documents || {}).length;
      if (docCount === 6) updateData.isDocumentUpload = true;
    }

    // --- Run recharge check + update in parallel ---
    const rechargePromise = (!partner.isPaid
      ? checkBhAndDoRechargeOnApp({ number: partner.phone })
        .then(({ success, payment_id, member_id }) => {
          if (
            success &&
            payment_id?.end_date &&
            member_id?.title &&
            member_id?.HowManyMoneyEarnThisPlan !== undefined &&
            payment_id?.createdAt &&
            typeof payment_id?.payment_approved !== "undefined"
          ) {
            updateData.RechargeData = {
              rechargePlan: member_id.title,
              expireData: payment_id.end_date,
              onHowManyEarning: member_id.HowManyMoneyEarnThisPlan,
              whichDateRecharge: payment_id.createdAt,
              approveRecharge: payment_id.payment_approved,
            };
            updateData.isPaid = true;
          }
        })
        .catch((err) => {
          console.error("❌ Recharge Fetch Failed:", err.message);
        })
      : Promise.resolve()
    );

    // ✅ Update partner in DB + wait for recharge check
    await Promise.all([
      rechargePromise,
      Rider.updateOne({ phone: number }, { $set: updateData }),
    ]);

    // ✅ Refetch updated partner for token
    const updatedPartner = await Rider.findOne({ phone: number });

    await send_token(updatedPartner, { type: "CAB" }, res, req);
  } catch (error) {
    console.error("❌ OTP Verification Error:", error.message);
    res.status(501).json({
      success: false,
      error: error.message || "Something went wrong",
    });
  }
};


exports.getAllRiders = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim();

    const category = req.query.category;
    const document = req.query.document;
    const duty = req.query.duty;
    const recharge = req.query.recharge; // 'yes', 'no', 'all'

    let filter = {};

    // Search filter
    if (search) {
      const regex = new RegExp(search, "i");
      const orConditions = [
        search.match(/^[0-9a-fA-F]{24}$/) ? { _id: search } : null,
        { name: regex },
        { phone: regex },
        { aadharNumber: regex },
        { "rideVehicleInfo.vehicleName": regex },
        { "rideVehicleInfo.vehicleType": regex },
        { "rideVehicleInfo.VehicleNumber": regex },
        { BH: regex },
        { category: regex },
      ].filter(Boolean);

      if (orConditions.length > 0) {
        filter.$or = orConditions;
      }
    }

    // Category filter
    if (category && category !== 'all') {
      if (category === 'non-parcel') {
        filter.category = { $ne: 'parcel' };
      } else {
        filter.category = category;
      }
    }

    // Document status filter
    if (document && document !== 'all') {
      if (document === 'verified') {
        filter.DocumentVerify = true;
      } else if (document === 'under-review') {
        filter.isDocumentUpload = true;
        filter.DocumentVerify = false;
      } else if (document === 'not-verified') {
        filter.DocumentVerify = false;
      }
    }

    // === RECHARGE FILTER (FIXED) ===
    if (recharge && recharge !== 'all') {
      if (recharge === 'yes') {
        filter['RechargeData.approveRecharge'] = true;
      } else if (recharge === 'no') {
        // Riders with expired/inactive recharge OR no recharge at all
        filter.$or = [
          { 'RechargeData.approveRecharge': false },
          { RechargeData: { $exists: false } }
        ];
      }
    }

    // Duty status filter
    if (duty && duty !== 'all') {
      filter.isAvailable = duty === 'on-duty';
    }

    const [riders, total] = await Promise.all([
      Rider.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .select("-preferences -updateLogs -activityLog -howManyTimesHitResend -her_referenced -rides")
        .lean(),
      Rider.countDocuments(filter),
    ]);

    res.status(200).json({
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      riders,
    });
  } catch (error) {
    console.error("Error fetching riders:", error);
    res.status(500).json({ error: error.message });
  }
};

exports.getAllRidersFcmToken = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const search = req.query.search?.trim();

    // Base filter: only riders with valid FCM tokens
    const baseFilter = {
      fcmToken: { $exists: true, $ne: null, $ne: "" },
    };

    // Add search filter if search term provided
    let searchFilter = {};
    if (search) {
      const regex = new RegExp(search, "i"); // case-insensitive
      searchFilter = {
        $or: [
          // Only match _id if it's a valid ObjectId
          search.match(/^[0-9a-fA-F]{24}$/) ? { _id: search } : null,
          { name: regex },
          { phone: regex },
        ].filter(Boolean),
      };
    }

    // Combine both filters
    const filter = { ...baseFilter, ...searchFilter };

    const [riders, total] = await Promise.all([
      Rider.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .select("name phone _id fcmToken createdAt")
        .lean(),
      Rider.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      message: "Riders with valid FCM tokens fetched successfully",
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      data: riders,
    });
  } catch (error) {
    console.error("Error fetching riders:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


exports.riderDocumentsVerify = async (req, res) => {
  try {
    const { id } = req.params;
    const { DocumentVerify } = req.body;

    const updateResult = await Rider.updateOne(
      { _id: id },
      { $set: { DocumentVerify } }
    );

    if (updateResult.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: "Rider not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Documents verified successfully",
    });
  } catch (error) {
    console.error("Internal server error", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};


// Change location of a rider
exports.changeLocation = async (req, res) => {
  try {
    const { riderId } = req.params;
    const { location } = req.body;

    if (
      !location ||
      !Array.isArray(location.coordinates) ||
      location.coordinates.length !== 2
    ) {
      return res.status(400).json({ error: "Invalid location format" });
    }

    const updatedRider = await Rider.findByIdAndUpdate(
      riderId,
      { location },
      { new: true }
    );

    if (!updatedRider) {
      return res.status(404).json({ error: "Rider not found" });
    }

    res
      .status(200)
      .json({ message: "Location updated successfully", rider: updatedRider });
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).json({ error: "Failed to update location" });
  }
};

exports.uploadDocuments = async (req, res) => {
  const startTime = Date.now();

  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const rider = await Rider.findById(userId);
    if (!rider) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    if (rider.isDocumentUpload && rider.DocumentVerify === true) {
      return res.status(400).json({
        success: false,
        message: "Documents already uploaded and verified. Please login.",
      });
    }

    const files = req.files || [];
    if (files.length === 0) {
      return res.status(400).json({ success: false, message: "No files uploaded." });
    }

    const uploadedDocs = {};

    // Parallel file uploads
    await Promise.all(
      files.map(async (file) => {
        const originalSizeMB = file.size / 1024 / 1024;
        let uploadPath = file.path;
        let compressed = false;

        // ✅ Try to compress if file is larger than 1MB
        if (originalSizeMB > 1) {
          const compressedPath = file.path.replace(/\.(jpg|jpeg|png)$/, "-compressed.jpg");
          try {
            await sharp(file.path)
              .resize({ width: 1200, withoutEnlargement: true }) // maintain good quality
              .jpeg({ quality: 70 }) // compress quality
              .toFile(compressedPath);

            const compressedStats = await fs.promises.stat(compressedPath);
            const compressedSizeMB = compressedStats.size / 1024 / 1024;

            if (compressedSizeMB < originalSizeMB) {
              uploadPath = compressedPath;
              compressed = true;
            }
          } catch (err) {
            console.warn(`⚠️ Compression failed for ${file.originalname}: ${err.message}`);
          }
        }

        // ✅ Upload to Cloudinary (either compressed or original)
        const uploaded = await cloudinary.uploader.upload(uploadPath, {
          folder: "rider_documents",
          quality: "auto:low",
          format: "jpg",
        });

        // cleanup
        await fs.promises.unlink(file.path).catch(() => { });
        if (compressed) await fs.promises.unlink(uploadPath).catch(() => { });

        // map file to correct document field
        if (file.originalname.includes("dl")) uploadedDocs.license = uploaded.secure_url;
        else if (file.originalname.includes("rc")) uploadedDocs.rc = uploaded.secure_url;
        else if (file.originalname.includes("insurance")) uploadedDocs.insurance = uploaded.secure_url;
        else if (file.originalname.includes("aadharBack")) uploadedDocs.aadharBack = uploaded.secure_url;
        else if (file.originalname.includes("aadharFront")) uploadedDocs.aadharFront = uploaded.secure_url;
        else if (file.originalname.includes("pancard")) uploadedDocs.pancard = uploaded.secure_url;
        else if (file.originalname.includes("profile")) uploadedDocs.profile = uploaded.secure_url;
      })
    );

    // Prepare VehicleAdds document structure
    const documents = {
      rc: { url: uploadedDocs.rc || "", status: "pending", note: "" },
      pollution: { url: "", status: "pending", note: "", expiryDate: null },
      aadharFront: { url: uploadedDocs.aadharFront || "", status: "pending", note: "" },
      aadharBack: { url: uploadedDocs.aadharBack || "", status: "pending", note: "" },
      permit: { url: "", status: "pending", note: "", expiryDate: null },
      licence: { url: uploadedDocs.license || "", status: "pending", note: "", expiryDate: null },
      insurance: { url: uploadedDocs.insurance || "", status: "pending", note: "", expiryDate: null },
      panCard: { url: uploadedDocs.pancard || "", status: "pending", note: "" },
    };

    // Parallel DB update
    await Promise.all([
      Rider.updateOne(
        { _id: userId },
        {
          $set: {
            documents: uploadedDocs,
            isDocumentUpload: true,
            isProfileComplete: true,
          },
        }
      ),
      new VehicleAdds({
        riderId: userId,
        vehicleDetails: {
          name: rider?.rideVehicleInfo?.vehicleName || "",
          type: rider?.rideVehicleInfo?.vehicleType || "",
          numberPlate: rider?.rideVehicleInfo?.VehicleNumber?.toUpperCase() || "",
        },
        isDefault: true,
        isActive: false,
        documents,
      }).save(),
    ]);

    const endTime = Date.now();
    console.log(`✅ /uploadDocuments executed in ${endTime - startTime} ms`);

    return res.status(201).json({
      success: true,
      message: "Documents uploaded successfully",
      data: uploadedDocs,
    });
  } catch (error) {
    console.error("❌ /uploadDocuments error:", error.message);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};

// 7890987666
exports.uploadPaymentQr = async (req, res) => {
  try {
    console.log("📥 Incoming QR Upload Request");

    const file = req.file;
    const userId = req.user.userId;

    console.log("📌 User ID:", userId);

    if (!file || !file.path) {
      console.log("❌ No file uploaded");
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const findRider = await Rider.findById(userId);
    if (!findRider) {
      console.log("❌ Rider not found");
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    console.log("☁️ Uploading to Cloudinary:", file.path);
    const uploadResponse = await cloudinary.uploader.upload(file.path, {
      folder: "rider_qrs",
    });

    console.log("✅ Uploaded to Cloudinary:", uploadResponse.secure_url);

    // Remove temp file
    fs.unlinkSync(file.path);
    console.log("🧹 Temp file deleted from server");

    // Save URL to rider profile
    findRider.YourQrCodeToMakeOnline = uploadResponse.secure_url;
    await findRider.save();

    console.log("📦 Rider document updated with QR");

    return res.status(201).json({
      success: true,
      message: "QR code uploaded successfully",
      data: uploadResponse,
    });
  } catch (error) {
    console.error("🚨 Error uploading QR code:", error);
    return res.status(500).json({
      success: false,
      message: "QR code upload failed",
      error: error.message,
    });
  }
};

exports.details = async (req, res) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    // Only fetch required fields (projection for speed)
    const partner = await Rider.findById(userId)
      .select("-rides -preferences -recentRejections -updateLogs -activityLog") // space separated
      .lean(); // return plain JS object → faster than Mongoose doc

    if (!partner) {
      return res.status(404).json({ success: false, message: "Partner not found" });
    }

    return res.status(200).json({ success: true, partner });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


exports.getMyAllDetails = async (req, res) => {
  try {
    const { user_id } = req.query
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const driver = await Rider.findById(user_id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    const completedRides = await NewRideModelModel.find({
      driver: user_id,
      ride_status: "completed",
    });

    const currentRide = driver?.on_ride_id
      ? await NewRideModelModel.findById(driver.on_ride_id)
      : null;

    const todayIST = moment().tz("Asia/Kolkata").format("YYYY-MM-DD");

    const todaySessionDoc = await CabRiderTimes.findOne({
      riderId: user_id,
      date: todayIST,
    });

    let totalSeconds = 0;
    if (todaySessionDoc?.sessions?.length > 0) {
      totalSeconds = todaySessionDoc.sessions.reduce((acc, session) => {
        return acc + (session.duration || 0);
      }, 0);
    }

    const totalHours = parseFloat((totalSeconds / 3600).toFixed(2));
    const formattedHours = `${Math.floor(totalSeconds / 3600)}h ${Math.floor(
      (totalSeconds % 3600) / 60
    )}m`;

    const totalRides = completedRides.length;
    const totalEarnings = completedRides.reduce((sum, ride) => {
      return sum + Number(ride?.pricing?.total_fare || 0);
    }, 0);

    const totalRatings = completedRides.reduce((sum, ride) => {
      return sum + Number(ride?.driver_rating?.rating || 0);
    }, 0);

    const averageRating =
      totalRides > 0 ? parseFloat((totalRatings / totalRides).toFixed(2)) : 0;

    // === Extracting Today's Specific Data ===
    const startOfToday = moment().tz("Asia/Kolkata").startOf("day").toDate();
    const endOfToday = moment().tz("Asia/Kolkata").endOf("day").toDate();

    const todayCompletedRides = await NewRideModelModel.find({
      driver: user_id,
      ride_status: "completed",
      created_at: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
    });

    const todayEarnings = todayCompletedRides.reduce((sum, ride) => {
      return sum + Number(ride?.pricing?.total_fare || 0);
    }, 0);

    const todayTrips = todayCompletedRides.length;
    const timestamp = new Date().toISOString();


    return res.status(200).json({
      isOnRide: !!driver.on_ride_id,
      isAvailable: driver.isAvailable,
      currentRide: currentRide || null,
      totalRides,
      totalEarnings,
      averageRating,
      loggedInHours: totalHours,
      currentDate: todayIST,
      location: driver.location?.coordinates,

      // ✅ Today-specific fields
      earnings: todayEarnings || 0,
      trips: todayTrips || 0,
      hours: formattedHours,
      points: driver.points || 0,
      lastUpdated: timestamp,
    });
  } catch (error) {
    console.error("Error fetching driver ride details:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


exports.getMyAllRides = async (req, res) => {
  try {
    const user_id = req.user?.userId;
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const findRideDetails = await NewRideModelModel.find({
      driver: user_id,
    }).sort({
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      message: "Ride details fetched successfully",
      count: findRideDetails.length,
      data: findRideDetails,
    });
  } catch (error) {
    console.error("Error fetching ride details:", error);
    return res.status(500).json({ message: "Internal server error" });
  }
};


exports.toggleWorkStatusOfRider = async (req, res) => {
  try {
    const user_id = req.user?.userId;
    if (!user_id) return res.status(401).json({ message: "User ID is required" });

    // Fetch minimal rider info needed
    const rider = await Rider.findById(user_id, "isAvailable isPaid on_ride_id").lean();
    if (!rider) return res.status(404).json({ message: "Rider not found" });

    if (!rider.isPaid) {
      return res.status(400).json({
        message: "Oops! It looks like your account isn’t recharged. Please top up to proceed.",
      });
    }

    const newStatus = !rider.isAvailable;

    if (!newStatus && rider.on_ride_id) {
      return res.status(400).json({
        message: "You currently have an active ride. Please complete the ride before going offline.",
      });
    }

    // Update rider status atomically
    const toggleResult = await Rider.findByIdAndUpdate(
      user_id,
      { isAvailable: newStatus },
      { new: true }
    );

    const today = moment().format("YYYY-MM-DD");

    // Prepare session update
    let sessionUpdate = {};
    if (newStatus) {
      // Going online → add new session
      sessionUpdate = {
        $push: { sessions: { onlineTime: new Date(), offlineTime: null, duration: null } },
        $set: { status: "online" },
      };
    } else {
      // Going offline → update last session
      const cabRiderDoc = await CabRiderTimes.findOne({ riderId: user_id, date: today });
      if (cabRiderDoc && cabRiderDoc.sessions?.length > 0) {
        const lastSession = cabRiderDoc.sessions[cabRiderDoc.sessions.length - 1];
        const duration = lastSession.onlineTime
          ? Math.round((new Date() - lastSession.onlineTime) / 60000)
          : 0;
        sessionUpdate = {
          $set: {
            status: "offline",
            [`sessions.${cabRiderDoc.sessions.length - 1}.offlineTime`]: new Date(),
            [`sessions.${cabRiderDoc.sessions.length - 1}.duration`]: duration,
          },
        };
      } else {
        sessionUpdate = { $set: { status: "offline" } };
      }
    }

    const cabRider = await CabRiderTimes.findOneAndUpdate(
      { riderId: user_id, date: today },
      sessionUpdate,
      { new: true, upsert: true }
    ).select("status");

    console.log("I am update stauts")
    return res.status(200).json({
      success: true,
      message: `Status updated to ${newStatus ? "Available (Online)" : "Unavailable (Offline)"} successfully.`,
      cabRider: cabRider?.status,
    });
  } catch (error) {
    console.error("Error toggling work status:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.AdmintoggleWorkStatusOfRider = async (req, res) => {
  try {
    const user_id = req.params.id;

    if (!user_id) {
      return res.status(401).json({ message: "User ID is required" });
    }

    // Fetch the current status of the rider
    const rider = await Rider.findById({ _id: user_id });
    if (!rider) {
      return res.status(404).json({ message: "Rider not found" });
    }

    if (!rider.isPaid) {
      return res.status(400).json({
        message:
          "Oops! It looks like your account isn’t recharged. Please top up to proceed.",
      });
    }

    // Toggle the status dynamically
    const newStatus = !rider.isAvailable;

    // Check if rider is trying to go offline while having an active ride
    if (!newStatus && rider.on_ride_id) {
      return res.status(400).json({
        message:
          "You currently have an active ride. Please complete the ride before going offline.",
      });
    }

    // Update rider's isAvailable status
    const toggleStatus = await Rider.updateOne(
      { _id: user_id },
      { $set: { isAvailable: newStatus } }
    );

    if (toggleStatus.modifiedCount !== 1) {
      return res.status(400).json({ message: "Status update failed" });
    }

    // Handle CabRider session tracking
    const today = moment().format("YYYY-MM-DD");
    let cabRider = await CabRiderTimes.findOne({
      riderId: user_id,
      date: today,
    });

    if (!cabRider) {
      cabRider = new CabRiderTimes({
        riderId: user_id,
        status: newStatus ? "online" : "offline",
        date: today,
        sessions: [],
      });
    } else {
      // Update status
      cabRider.status = newStatus ? "online" : "offline";
    }

    if (newStatus) {
      // Rider is going online - start a new session
      cabRider.sessions.push({
        onlineTime: new Date(),
        offlineTime: null,
        duration: null,
      });
    } else {
      // Rider is going offline - close the last session
      const lastSession = cabRider.sessions[cabRider.sessions.length - 1];
      if (lastSession && !lastSession.offlineTime) {
        lastSession.offlineTime = new Date();
        lastSession.duration = Math.round(
          (new Date() - new Date(lastSession.onlineTime)) / 60000
        );
      }
    }

    await cabRider.save();

    return res.status(200).json({
      success: true,
      message: `Status updated to ${newStatus ? "Available (Online)" : "Unavailable (Offline)"
        } successfully.`,
      cabRider,
    });
  } catch (error) {
    console.error("Error toggling work status:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.markPaid = async (req, res) => {
  try {
    const { rechargePlan, expireData, approveRecharge, riderBh } =
      req.body || {};

    // Find the rider by ID
    const findRider = await Rider.findOne({ BH: riderBh });

    if (!findRider) {
      return res
        .status(404)
        .json({ success: false, message: "Rider not found" });
    }

    // If approveRecharge is true, update the recharge details
    if (approveRecharge) {
      findRider.RechargeData = {
        rechargePlan: rechargePlan,
        expireData: expireData,
        approveRecharge: true,
      };
      findRider.isPaid = true;

      // Save the updated rider details
      await findRider.save();

      return res.status(200).json({
        success: true,
        message: "Recharge approved and rider marked as paid.",
        data: findRider,
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Recharge approval is required.",
      });
    }
  } catch (error) {
    console.error("Error in markPaid:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getMySessionsByUserId = async (req, res) => {
  try {
    const userId = req.query.userId;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required in query." });
    }

    const sessionsData = await CabRiderTimes.find({ riderId: userId }).sort({
      date: -1,
    });

    if (!sessionsData.length) {
      return res
        .status(404)
        .json({ message: "No session data found for this user." });
    }

    // Prepare response data
    const result = sessionsData.map((daySession) => {
      let totalDurationInSeconds = 0;

      // Calculate total duration and format individual sessions
      const formattedSessions = daySession.sessions.map((session) => {
        if (session.onlineTime && session.offlineTime) {
          totalDurationInSeconds += session.duration * 60;
        }

        return {
          onlineTime: session.onlineTime,
          offlineTime: session.offlineTime || "Active", // If still online
          duration: session.duration
            ? `${Math.floor(session.duration)} min`
            : "Ongoing",
        };
      });

      // Format total time for the day
      const hours = Math.floor(totalDurationInSeconds / 3600);
      const minutes = Math.floor((totalDurationInSeconds % 3600) / 60);
      const seconds = totalDurationInSeconds % 60;

      const totalTimeFormatted = `${hours}h ${minutes}m ${seconds}s`;

      return {
        date: daySession.date,
        totalSessions: daySession.sessions.length,
        totalTimeOnline: totalTimeFormatted,
        sessions: formattedSessions,
      };
    });

    return res.status(200).json({
      message: "Session data fetched successfully.",
      data: result,
    });
  } catch (error) {
    console.error("Error fetching session data:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.verifyDocument = async (req, res) => {
  try {
    const BH = req.query.bh || {};
    const findRider = await Rider.findOne({ BH });

    if (!findRider) {
      return res.status(404).json({ message: "Rider not found" });
    }

    if (findRider.DocumentVerify === true) {
      return res.status(200).json({ message: "Document already verified" });
    }

    const verifyDocument = await Rider.updateOne(
      { BH },
      { $set: { DocumentVerify: true } }
    );

    if (verifyDocument.modifiedCount === 1) {
      // Send WhatsApp confirmation message
      const congratsMessage = `🎉 Congratulations ${findRider.name}! 

Your documents have been successfully verified, and you are now officially part of our team. 

🚀 Get ready to start your journey with us, delivering excellence and earning great rewards. We appreciate your dedication and look forward to seeing you grow with us.

💡 Stay active, provide the best service, and unlock more opportunities in the future.

Welcome aboard! 🚖💨`;

      await SendWhatsAppMessage(congratsMessage, findRider.phone);

      return res
        .status(200)
        .json({ message: "Document verified successfully" });
    }

    return res
      .status(400)
      .json({ message: "Verification failed, please try again." });
  } catch (error) {
    console.error("Error verifying document:", error);
    return res.status(500).json({ message: "Internal Server Error" });
  }
};

exports.updateBlockStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isBlockByAdmin } = req.body;
    const riderData = await Rider.findById(id);
    if (!riderData) {
      return res
        .status(404)
        .json({ success: false, message: "Rider not found." });
    }

    riderData.isBlockByAdmin = isBlockByAdmin;
    const result = await riderData.save();
    return res.status(200).json({
      success: true,
      message: "Block status updated successfully",
      data: result,
    });
  } catch (error) {
    console.error("Error updating block status:", error);
    return res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

exports.getSingleRider = async (req, res) => {
  try {
    const { id } = req.params;
    const rider = await Rider.findById(id);
    if (!rider) {
      return res
        .status(404)
        .json({ success: false, message: "Rider not found" });
    }
    res.status(200).json({
      success: true,
      message: "Rider found successfully",
      data: rider,
    });
  } catch (error) {
    console.log("Internal server error", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
exports.updateRiderDocumentVerify = async (req, res) => {
  try {
    const { id } = req.params;
    const { DocumentVerify } = req.body || req.query;

    console.log("Incoming Request 👉", {
      riderId: id,
      DocumentVerify: DocumentVerify,
    });

    const rider = await Rider.findById(id);
    if (!rider) {
      console.log("❌ Rider not found with ID:", id);
      return res.status(404).json({
        success: false,
        message: "Rider not found",
      });
    }

    const riderPhone = rider.phone;

    try {
      const fetchWebVendorResponse = await axios.get(
        `https://www.webapi.olyox.com/api/v1/get_vendor_by_number/${riderPhone}`,
        { timeout: 5000 } // Add timeout to prevent hanging
      );

      console.log("fetchWebVendorResponse", fetchWebVendorResponse.data)

      // Validate response status and data
      if (!fetchWebVendorResponse?.data?.data || !Array.isArray(fetchWebVendorResponse.data.data) || fetchWebVendorResponse.data.data.length === 0) {
        console.log("❌ Web Vendor not found for phone:", riderPhone);
        return res.status(400).json({
          success: false,
          message: 'Web Vendor not found',
        });
      }

      const webVendor = fetchWebVendorResponse.data.data[0]; // Access the first vendor
      const webVendorId = webVendor._id;

      if (!webVendorId) {
        console.log("❌ Web Vendor ID is missing in response:", fetchWebVendorResponse.data);
        return res.status(400).json({
          success: false,
          message: 'Invalid Web Vendor data: ID missing',
        });
      }

      console.log("✅ Web Vendor found:", { phone: riderPhone, webVendorId });

      // Proceed with document verification
      const verifyDocumentResponse = await axios.post(
        `https://www.webapi.olyox.com/api/v1/verify_document?id=${webVendorId}`,
        {},
        { timeout: 5000 }
      );

      // Validate verification response
      if (!verifyDocumentResponse?.data?.success) {
        console.log("❌ Document verification failed for Web Vendor ID:", webVendorId);
        return res.status(400).json({
          success: false,
          message: 'Document verification failed',
        });
      }

      console.log("✅ Document verified successfully for Web Vendor ID:", webVendorId);
    } catch (error) {
      console.error("🔥 Error in Web Vendor API interaction:", {
        message: error.message,
        response: error.response?.data,
        phone: riderPhone,
      });
      return res.status(500).json({
        success: false,
        message: 'Failed to interact with Web Vendor API',
      });
    }

    console.log("✅ Rider found:", {
      name: rider.name,
      phone: rider.phone,
      category: rider.category,
      vehicleInfo: rider.rideVehicleInfo,
    });

    // Update document verification status
    rider.DocumentVerify = DocumentVerify;
    console.log("📌 DocumentVerify updated to:", DocumentVerify);

    async function grantFreeTier(rider) {
      console.log("🎁 Granting Free Tier membership to rider:", rider._id);

      rider.isFreeMember = true;
      rider.isPaid = true;

      const oneMonthLater = new Date();
      oneMonthLater.setMonth(oneMonthLater.getMonth() + 1); // Add 1 month

      console.log("📅 Free Tier valid until:", oneMonthLater.toDateString());
      rider.freeTierEndData = oneMonthLater;

      rider.RechargeData = {
        rechargePlan: "Free Tier",
        expireData: oneMonthLater,
        onHowManyEarning: 50000,
        approveRecharge: true,
      };

      console.log("📌 Free Tier details set:", rider.RechargeData);

      await SendWhatsAppMessage(
        `🎉 Dear ${rider.name}, your documents have been successfully verified, and you've been granted 1 month of Free Tier membership! 🗓️

        ✅ Plan: Free Tier  
        ✅ Valid Till: ${oneMonthLater.toDateString()}  
        ✅ Recharge Status: Approved

        We’re excited to have you on board. Let’s make your journey productive and rewarding. Stay safe and deliver with pride! 🚀  
        — Team Support`,
        rider.phone
      );

      console.log("📨 WhatsApp Free Tier message sent to:", rider.phone);
    }

    const vehicleName = rider.rideVehicleInfo?.vehicleName?.toLowerCase();
    const vehicleType = rider.rideVehicleInfo?.vehicleType?.toLowerCase();

    console.log("🚘 Vehicle Info:", { vehicleName, vehicleType });

    if (rider.category === "parcel") {
      console.log("📦 Rider category is parcel → Grant Free Tier");
      await grantFreeTier(rider);
    } else if (
      rider.category === "cab" &&
      (vehicleName === "bike" || vehicleType === "bike")
    ) {
      console.log("🏍️ Rider category is cab with bike → Grant Free Tier");
      await grantFreeTier(rider);
    } else {
      console.log("🚖 Rider category is other → Normal approval message");
      await SendWhatsAppMessage(
        `✅ Hello ${rider.name}, your documents have been successfully verified! 🎉
    
        You are now fully approved to continue providing your services on our platform.
    
        Thank you for your patience and welcome to the community! 😊  
        — Team Support`,
        rider.phone
      );
      console.log("📨 Normal approval WhatsApp message sent to:", rider.phone);
    }

    const result = await rider.save();
    console.log("💾 Rider saved successfully:", result._id);

    return res.status(200).json({
      success: true,
      message: "Rider documents verified and updated successfully.",
      data: result,
    });
  } catch (error) {
    console.error("🔥 Internal server error in updateRiderDocumentVerify:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while verifying the documents.",
    });
  }
};


exports.updateRiderDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone, rideVehicleInfo, category } = req.body;
    console.log("name, phone, rideVehicleInfo, category", name, phone, rideVehicleInfo, category)

    // Find the existing rider
    const existingData = await Rider.findById(id);
    if (!existingData) {
      return res
        .status(404)
        .json({ success: false, message: "Rider not found" });
    }

    console.log("Existing Rider Data:", existingData);

    // Update basic details if provided
    if (name) existingData.name = name;
    if (phone) existingData.phone = phone;
    if (category) existingData.category = category;

    // Update ride vehicle details if provided
    if (rideVehicleInfo) {
      existingData.rideVehicleInfo = {
        ...existingData.rideVehicleInfo,
        ...rideVehicleInfo, // Merge existing & new data
      };
    }

    console.log("Received Files:", req.files);

    // Handle document uploads if files are provided
    if (req.files && req.files.length > 0) {
      const uploadedDocs = { ...existingData.documents };

      for (const file of req.files) {
        // Upload file to Cloudinary
        const uploadResponse = await cloudinary.uploader.upload(file.path, {
          folder: "rider_documents",
        });

        console.log(
          `Uploading file: ${file.fieldname} -> ${uploadResponse.secure_url}`
        );

        // Assign uploaded file URL dynamically based on fieldname
        uploadedDocs[file.fieldname] = uploadResponse.secure_url;

        // Delete the local file after upload
        fs.unlinkSync(file.path);
      }

      // Merge updated documents with existing ones
      existingData.documents = { ...existingData.documents, ...uploadedDocs };
      existingData.markModified("documents"); // Ensure Mongoose detects the change
    }

    // Save the updated rider details
    await existingData.save();

    console.log("Updated Rider Data:", await Rider.findById(id));

    res.status(200).json({
      success: true,
      message: "Rider details updated successfully",
      data: existingData,
    });
  } catch (error) {
    console.error("Internal server error", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getOnlineTimeByRiderId = async (req, res) => {
  try {
    const { id } = req.params;
    const riderStatus = await CabRiderTimes.find({ riderId: id });
    if (!riderStatus) {
      return res
        .status(404)
        .json({ success: false, message: "No data found", data: [] });
    }
    res.status(200).json({
      success: true,
      message: "Online time found successfully",
      data: riderStatus,
    });
  } catch (error) {
    console.log("Internal server error", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.deleteRider = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedRider = await Rider.findByIdAndDelete(id);
    if (!deletedRider) {
      return res
        .status(404)
        .json({ success: false, message: "Rider not found" });
    }
    res.status(200).json({
      success: true,
      message: "Rider deleted successfully",
      data: deletedRider,
    });
  } catch (error) {
    console.log("Internal server error", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};

exports.getMyEligibleBonus = async (req, res) => {
  try {
    const userId = req.user?.userId || req.query.userId || req.params.userId;
    // console.log("UserId:", userId);

    if (!userId) {
      return res.status(400).json({ message: "User ID is required in query." });
    }

    const sessionsData = await CabRiderTimes.find({ riderId: userId }).sort({
      date: -1,
    });
    // console.log("Fetched sessionsData:", sessionsData.length);

    if (!sessionsData.length) {
      return res
        .status(404)
        .json({ message: "No session data found for this user." });
    }

    const BonusAvailableInDb = await Bonus_Model.find();
    // console.log("Fetched BonusAvailableInDb:", BonusAvailableInDb.length);

    if (!BonusAvailableInDb.length) {
      return res.status(404).json({ message: "No bonuses available." });
    }

    let eligibleBonus = [];
    let notEligibleBonus = [];

    let totalDurationHours = 0;

    // Calculate total working hours
    for (let sessionData of sessionsData) {
      for (let session of sessionData.sessions) {
        // console.log("Processing session:", session);

        const onlineTime = momentTz(session.onlineTime).tz("Asia/Kolkata");
        const offlineTime = momentTz(session.offlineTime).tz("Asia/Kolkata");

        // console.log("OnlineTime:", onlineTime.isValid() ? onlineTime.format() : "Invalid");
        // console.log("OfflineTime:", offlineTime.isValid() ? offlineTime.format() : "Invalid");

        if (!onlineTime.isValid() || !offlineTime.isValid()) {
          // console.log("Skipping invalid session times.");
          continue; // skip this session
        }

        const durationMinutes = offlineTime.diff(onlineTime, "minutes");
        const durationHours = durationMinutes / 60;

        // console.log("Session durationMinutes:", durationMinutes, "durationHours:", durationHours);

        if (!isNaN(durationHours)) {
          totalDurationHours += durationHours;
        } else {
          console.log("Invalid durationHours, skipping...");
        }
      }
    }

    // console.log("Total Duration Hours:", totalDurationHours);

    // Now check for bonuses
    BonusAvailableInDb.forEach((bonus) => {
      // console.log("Checking bonus:", bonus);

      const anyRequiredField = [
        `Complete login hours: ${bonus.requiredHours} hours worked.`,
        "Do not reject more than 5 bonus claims per month to maintain eligibility.",
        "Requires regular check-ins and updates for performance.",
      ];

      if (totalDurationHours >= bonus.requiredHours) {
        console.log(
          `Eligible: totalDurationHours(${totalDurationHours}) >= requiredHours(${bonus.requiredHours})`
        );

        eligibleBonus.push({
          requiredHours: bonus.requiredHours,
          bonusCouponCode: bonus.bonusCouponCode,
          bonusType: bonus.bonusType,
          bonusValue: bonus.bonusValue,
          bonusStatus: bonus.bonusStatus,
          any_required_field: anyRequiredField,
          remainingHours: parseFloat(
            (totalDurationHours - bonus.requiredHours).toFixed(2)
          ),
        });
      } else {
        // console.log(`Not Eligible: totalDurationHours(${totalDurationHours}) < requiredHours(${bonus.requiredHours})`);

        notEligibleBonus.push({
          requiredHours: bonus.requiredHours,
          bonusCouponCode: bonus.bonusCouponCode,
          bonusType: bonus.bonusType,
          bonusValue: bonus.bonusValue,
          bonusStatus: bonus.bonusStatus,
          any_required_field: anyRequiredField,
          remainingHours: parseFloat(
            (bonus.requiredHours - totalDurationHours).toFixed(2)
          ),
        });
      }
    });

    // console.log("Eligible Bonuses:", eligibleBonus);
    // console.log("Not Eligible Bonuses:", notEligibleBonus);

    return res.status(200).json({
      message:
        "Rider's eligible and not eligible bonuses fetched successfully.",
      eligibleBonus,
      notEligibleBonus,
    });
  } catch (error) {
    console.error("Error fetching eligible bonus:", error);
    return res.status(500).json({
      message: "An error occurred while fetching eligible bonuses.",
      error: error.message,
    });
  }
};

exports.inProgressOrder = async (req, res) => {
  try {
    const userId = req.user?.userId || req.query.userId || req.params.userId;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required in query." });
    }

    const rider = await Rider.findOne({ _id: userId, category: "parcel" });
    if (!rider) {
      return res
        .status(404)
        .json({ success: false, message: "Rider not found" });
    }

    // Fetch all accepted orders for this rider
    const inProgress = await Parcel_Request.find({
      rider_id: userId,
      status: {
        $not: /^(pending|delivered|cancelled)$/i,
      },
    });

    if (inProgress.length === 0) {
      // No in-progress orders found
      return res.status(200).json({
        success: true,
        message: "No in-progress orders found.",
        inProgressOrders: [],
      });
    }

    return res.status(200).json({
      success: true,
      message: "In-progress orders fetched successfully.",
      inProgressOrders: inProgress,
    });
  } catch (error) {
    console.error("Error fetching in-progress orders:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while fetching in-progress orders.",
      error: error.message,
    });
  }
};

exports.parcelDashboardData = async (req, res) => {
  try {
    const userId = req.user?.userId || req.query.userId || req.params.userId;

    if (!userId) {
      return res.status(400).json({ message: "User ID is required in query." });
    }

    const rider = await Rider.findOne({ _id: userId, category: "parcel" });
    if (!rider) {
      return res
        .status(404)
        .json({ success: false, message: "Rider not found" });
    }

    const howManyDeliverDone = await Parcel_Request.countDocuments({
      rider_id: userId,
      status: "delivered",
    });

    const inProgress = await Parcel_Request.find({
      rider_id: userId,
      status: {
        $not: /^(pending|delivered|cancelled)$/i,
      },
    });

    const deliveredRequests = await Parcel_Request.find({
      rider_id: userId,
      status: "delivered",
    });

    const totalMoneyEarned = deliveredRequests.reduce(
      (acc, cur) => acc + Number(cur?.fares?.payableAmount || 0),
      0
    );

    return res.status(200).json({
      success: true,
      message: "Parcel dashboard data fetched successfully.",
      data: {
        totalDeliveries: howManyDeliverDone,
        inProgressDeliveries: inProgress.length,
        totalEarnings: totalMoneyEarned,
        ridesRejected: rider.ridesRejected,
      },
    });
  } catch (error) {
    console.error("Internal server error:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while fetching dashboard data.",
      error: error.message,
    });
  }
};

exports.assignFreeRechargeToRider = async (req, res) => {
  try {
    console.log("📩 Incoming request for free recharge, rider number:", req.body.number);

    const { number, rechargeData } = req.body;

    if (!number || !rechargeData) {
      console.error("❌ Missing required fields in request body");
      return res.status(400).json({
        success: false,
        message: "Phone number and recharge data are required",
      });
    }

    // Find rider
    const rider = await Rider.findOne({ phone: number });
    if (!rider) {
      console.warn(`⚠️ Rider not found with number: ${number}`);
      return res.status(404).json({
        success: false,
        message: "Rider not found",
      });
    }

    console.log("✅ Rider found:", rider._id);

    // Current expiry
    const currentExpire = rider.RechargeData?.expireData
      ? new Date(rider.RechargeData.expireData)
      : new Date();

    // Parse new expiry from API
    const newExpireDate = rechargeData?.end_date
      ? new Date(rechargeData.end_date)
      : new Date(new Date().setFullYear(new Date().getFullYear() + 1));

    console.log("📆 Current Expiry:", currentExpire);
    console.log("📆 New Expiry from API:", newExpireDate);

    // Final expiry = max of current expiry and new expiry
    const finalExpire =
      currentExpire > newExpireDate ? currentExpire : newExpireDate;

    // 🔄 Overwrite RechargeData
    rider.RechargeData = {
      onHowManyEarning: Number(rechargeData.HowManyMoneyEarnThisPlan) || 50000,
      whichDateRecharge: new Date(),
      rechargePlan:
        rechargeData?.plan?.title || rechargeData?.trn_no || "Free Tier",
      expireData: finalExpire,
      approveRecharge: true,
    };

    rider.isPaid = true;
    rider.isFreeMember = true;
    rider.freeTierEndData = finalExpire;

    // Save rider
    const result = await rider.save();
    console.log("💾 Rider updated successfully:", result._id);

    return res.status(200).json({
      success: true,
      message: "Rider marked as paid with free recharge",
      data: result,
    });
  } catch (error) {
    console.error("🔥 Error in assignFreeRechargeToRider:", error.message, error.stack);
    return res.status(500).json({
      success: false,
      message: "Internal server error while assigning free recharge",
      error: error.message,
    });
  }
};


exports.addOnVehicle = async (req, res) => {
  try {
    const user_id = req.user?.userId;
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const driver = await Rider.findById(user_id);
    if (!driver) {
      return res.status(404).json({ message: "Driver not found" });
    }

    const { vehicleDetails } = req.body;
    const files = req.files; // Uploaded files array

    // Initialize documents object with all keys
    const documents = {
      rc: { url: "", status: "pending", note: "" },
      pollution: { url: "", status: "pending", note: "", expiryDate: null },
      aadharFront: { url: "", status: "pending", note: "" },
      aadharBack: { url: "", status: "pending", note: "" },
      permit: { url: "", status: "pending", note: "", expiryDate: null },
      licence: { url: "", status: "pending", note: "", expiryDate: null },
      insurance: { url: "", status: "pending", note: "", expiryDate: null },
      panCard: { url: "", status: "pending" },
    };

    // Upload each file to Cloudinary and assign to proper field
    if (files && files.length > 0) {
      for (let file of files) {
        // Determine document type from originalname (before extension)
        const docType = file.originalname.split(".")[0]; // e.g., "aadharBack"

        if (documents.hasOwnProperty(docType)) {
          const uploaded = await cloudinary.uploader.upload(file.path, {
            folder: `vehicles/${driver._id}/${vehicleDetails.numberPlate}`,
          });

          // Assign secure URL to the corresponding document
          documents[docType].url = uploaded.secure_url;

          // Optional: log the uploaded URL
          console.log(`Uploaded ${docType}:`, uploaded.secure_url);
        }
      }
    }

    // Create new Vehicle record
    const newVehicle = new VehicleAdds({
      riderId: driver._id,
      vehicleDetails: {
        name: vehicleDetails.name,
        type: vehicleDetails.type,
        numberPlate: vehicleDetails.numberPlate.toUpperCase(),
      },
      documents, // Assign all documents
    });

    await newVehicle.save();

    console.log("Vehicle Added Successfully:", newVehicle);

    return res.status(200).json({
      success: true,
      message: "Vehicle registered successfully",
      data: newVehicle,
    });
  } catch (error) {
    console.error("Error in addOnVehicle:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};

exports.updateVehicle = async (req, res) => {
  try {
    const user_id = req.user?.userId;
    const { vehicleId } = req.params;
    const { documentTypes } = req.body; // e.g., 'rc'
    const files = req.files || [];

    console.log("Incoming updateVehicle request:", { user_id, vehicleId, files });
    console.log("req.body", req.body);

    if (!user_id) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    // Find driver
    const driver = await Rider.findById(user_id);
    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }

    // Find vehicle
    const vehicle = await VehicleAdds.findById(vehicleId);
    if (!vehicle) {
      return res.status(404).json({ success: false, message: "Vehicle not found" });
    }

    console.log("🔧 Updating vehicle document:", documentTypes);

    // Only handle uploaded files
    for (const file of files) {
      const docType = documentTypes; // single docType from body
      if (!vehicle.documents[docType]) {
        console.log(`⚠️ Document type "${docType}" not found in vehicle.documents`);
        continue;
      }

      const oldUrl = vehicle.documents[docType]?.url || null;
      console.log(`🪶 Document Type: ${docType}`);
      console.log(`🔸 Old Image URL: ${oldUrl || "No previous file"}`);

      // Upload to Cloudinary
      const upload = await cloudinary.uploader.upload(file.path, {
        folder: `vehicles/${driver._id}/${vehicle.vehicleDetails.numberPlate}`,
      });

      vehicle.documents[docType].url = upload.secure_url;
      vehicle.documents[docType].status = "pending"; // mark for re-verification

      console.log(`🔹 New Image URL: ${upload.secure_url}`);
      console.log(`✅ ${docType} updated successfully!\n`);

      // Delete local file
      fs.unlinkSync(file.path);
    }

    await vehicle.save();

    console.log("✅ Vehicle document updated successfully:", vehicle._id);

    return res.status(200).json({
      success: true,
      message: "Vehicle document updated successfully",
      data: vehicle,
    });
  } catch (error) {
    console.error("❌ Error in updateVehicle:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
      error: error.message,
    });
  }
};


exports.getMyAddOnVehicle = async (req, res) => {
  try {
    const user_id = req.user?.userId;
    if (!user_id) {
      return res.status(400).json({ message: "User ID is required" });
    }

    const findDetails = await VehicleAdds.find({ riderId: user_id }); // ✅ fixed

    if (!findDetails || findDetails.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        message: "No Other Vehicle Adds Request Raised",
      });
    }

    res.status(200).json({
      success: true,
      data: findDetails,
      message: "Details Found Successfully",
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      data: [],
      message: error.message || "Internal Server Error",
    });
  }
};

exports.getAddOnVehicleAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const findDetails = await VehicleAdds.find({ riderId: id }).populate('riderId');
    if (!findDetails) {
      return res.status(400).json({
        success: false,
        message: 'No Add On Vehicle founded by this rider id'
      })
    }
    return res.status(200).json({
      success: true,
      data: findDetails
    })
  } catch (error) {
    console.log("Internal server error", error)
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    })
  }
}

exports.getAllAddOnVehicleAdmin = async (req, res) => {
  try {
    const { page = 1, limit = 10, search = '' } = req.query;

    const currentPage = parseInt(page, 10);
    const itemsPerPage = parseInt(limit, 10);

    let searchQuery = {};
    if (search) {
      searchQuery = {
        $or: [
          { 'vehicleDetails.name': { $regex: search.trim(), $options: 'i' } },
          { 'vehicleDetails.type': { $regex: search.trim(), $options: 'i' } },
          { 'vehicleDetails.numberPlate': { $regex: search.trim(), $options: 'i' } },
          {
            riderId: {
              $in: await Rider.find({
                $or: [
                  { name: { $regex: search.trim(), $options: 'i' } },
                  { phone: { $regex: search.trim(), $options: 'i' } },
                  { BH: { $regex: search.trim(), $options: 'i' } },
                ],
              }).distinct('_id'),
            },
          },
        ],
      };
    }

    // Fetch vehicles with search, sort by createdAt DESC, then paginate
    const findDetails = await VehicleAdds.find(searchQuery)
      .populate('riderId', 'name phone BH')
      .sort({ createdAt: -1 }) // This ensures newest first
      .skip((currentPage - 1) * itemsPerPage)
      .limit(itemsPerPage);

    const totalItems = await VehicleAdds.countDocuments(searchQuery);
    const totalPages = Math.ceil(totalItems / itemsPerPage);

    if (!findDetails || findDetails.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'No add-on vehicles found',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Vehicles found',
      data: findDetails,
      totalPages,
      currentPage,
      totalItems,
    });
  } catch (error) {
    console.error('Internal server error:', error);
    return res.status(500).json({
      success: false,
      message: 'Internal server error in fetching add-on vehicles for admin',
    });
  }
};

exports.updateVehicleDetailsForDriver = async (req, res) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(400).json({ success: false, message: "User ID is required" });
    }

    const driver = await Rider.findById(userId);
    if (!driver) {
      return res.status(404).json({ success: false, message: "Driver not found" });
    }

    const { activeVehicleId } = req.body;
    if (!activeVehicleId) {
      return res.status(400).json({ success: false, message: "activeVehicleId is required" });
    }

    const vehicleDoc = await VehicleAdds.findOne({ riderId: userId, _id: activeVehicleId });
    if (!vehicleDoc) {
      return res.status(404).json({
        success: false,
        message: "Vehicle not found for this driver",
      });
    }

    // Only allow update if approved
    if (vehicleDoc.vehicleApprovedForRunning?.status === "approved") {
      driver.rideVehicleInfo = {
        vehicleName: vehicleDoc.vehicleDetails?.name || "",
        vehicleType: vehicleDoc.vehicleDetails?.type || "",
        VehicleNumber: vehicleDoc.vehicleDetails?.numberPlate || "",
      };

      await driver.save();

      // Reset other vehicles' isActive flag and set this one
      await VehicleAdds.updateMany(
        { riderId: userId },
        { $set: { isActive: false } }
      );
      vehicleDoc.isActive = true;

      await vehicleDoc.save();

      return res.status(200).json({
        success: true,
        message: "Driver vehicle updated successfully",
        data: {
          rider: driver,
          activeVehicle: vehicleDoc,
        },
      });
    } else {
      return res.status(400).json({
        success: false,
        message: "Selected vehicle is not approved for running",
      });
    }
  } catch (error) {
    console.error("❌ Error in updateVehicleDetailsForDriver:", error);
    return res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
};


exports.updateDriverVehicleAddsOn = async (req, res) => {
  try {
    // Fetch all riders
    const drivers = await Rider.find();

    if (!drivers || drivers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No drivers found",
      });
    }

    let created = [];

    for (let index = 0; index < drivers.length; index++) {
      const element = drivers[index];

      // Prepare documents object
      const documents = {
        rc: { url: element?.documents?.rc || "", status: "approved", note: "" },
        pollution: { url: "", status: "approved", note: "", expiryDate: null },
        aadharFront: {
          url: element?.documents?.aadharFront || "",
          status: "approved",
          note: "",
        },
        aadharBack: {
          url: element?.documents?.aadharBack || "",
          status: "approved",
          note: "",
        },
        permit: { url: "", status: "approved", note: "", expiryDate: null },
        licence: {
          url: element?.documents?.license || "",
          status: "approved",
          note: "",
          expiryDate: null,
        },
        insurance: {
          url: element?.documents?.insurance || "",
          status: "approved",
          note: "",
          expiryDate: null,
        },
        panCard: {
          url: element?.documents?.pancard || "",
          status: "approved",
          note: "",
        },
      };

      // Skip if no vehicle info
      if (!element?.rideVehicleInfo) continue;

      const newVehicle = new VehicleAdds({
        riderId: element._id,
        vehicleDetails: {
          name: element?.rideVehicleInfo?.vehicleName || "",
          type: element?.rideVehicleInfo?.vehicleType || "",
          numberPlate:
            element?.rideVehicleInfo?.VehicleNumber?.toUpperCase() || "",
        },
        documents,
      });

      await newVehicle.save();
      created.push(newVehicle);
    }

    res.status(200).json({
      success: true,
      message: "VehicleAdds records created successfully",
      count: created.length,
      data: created,
    });
  } catch (error) {
    console.error("Error in updateDriverVehicleAddsOn:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

// Controller to approve a specific document and update vehicle approval status
exports.approveVehicleDocument = async (req, res) => {
  try {
    const { vehicleId, documentType } = req.params;
    const { status, note } = req.body; // Status: "approved" or "rejected", note: optional

    // Validate inputs
    if (!mongoose.Types.ObjectId.isValid(vehicleId)) {
      console.log('❌ Invalid vehicle ID:', vehicleId);
      return res.status(400).json({
        success: false,
        message: 'Invalid vehicle ID',
      });
    }

    if (!['rc', 'pollution', 'aadharFront', 'aadharBack', 'permit', 'licence', 'insurance', 'panCard'].includes(documentType)) {
      console.log('❌ Invalid document type:', documentType);
      return res.status(400).json({
        success: false,
        message: 'Invalid document type',
      });
    }

    if (!['approved', 'rejected'].includes(status)) {
      console.log('❌ Invalid status:', status);
      return res.status(400).json({
        success: false,
        message: 'Status must be "approved" or "rejected"',
      });
    }

    // Find the vehicle
    const vehicle = await VehicleAdds.findById(vehicleId).populate('riderId', 'name phone');
    if (!vehicle) {
      console.log('❌ Vehicle not found with ID:', vehicleId);
      return res.status(404).json({
        success: false,
        message: 'Vehicle not found',
      });
    }

    // Update the specific document's status and note
    if (vehicle.documents[documentType]) {
      vehicle.documents[documentType].status = status;
      if (note) vehicle.documents[documentType].note = note;
      console.log(`📌 Updated ${documentType} status to:`, status, note ? `with note: ${note}` : '');
    } else {
      console.log('❌ Document type not found in vehicle:', documentType);
      return res.status(400).json({
        success: false,
        message: `Document type ${documentType} not found`,
      });
    }

    // Check if all required documents are approved
    const requiredDocuments = ['rc', 'pollution', 'aadharFront', 'aadharBack', 'permit', 'licence', 'insurance', 'panCard'];
    const allDocumentsApproved = requiredDocuments.every(
      (doc) => vehicle.documents[doc]?.status === 'approved'
    );

    // Update vehicleApprovedForRunning status
    if (allDocumentsApproved) {
      vehicle.vehicleApprovedForRunning.status = 'approved';
      vehicle.vehicleApprovedForRunning.date = new Date();
      vehicle.isActive = true;
      console.log('✅ All documents approved, vehicle approved for running:', vehicleId);

      // Send WhatsApp notification to rider
      const rider = vehicle.riderId;
      if (rider?.phone) {
        await SendWhatsAppMessageNormal(
          `🎉 Dear ${rider.name}, all documents for your vehicle (Number Plate: ${vehicle.vehicleDetails.numberPlate}) have been approved! 🚗

          ✅ Vehicle Status: Approved
          ✅ Approved On: ${new Date().toLocaleDateString('en-GB')}

          You are now ready to start providing services. Stay safe and drive with pride! 🚀
          — Team Support`,
          rider.phone
        );
        console.log('📨 WhatsApp approval message sent to:', rider.phone);
      }
    } else {
      vehicle.vehicleApprovedForRunning.status = 'pending';
      console.log('⏳ Not all documents approved, vehicle status set to pending:', vehicleId);
    }

    // Save the updated vehicle
    const updatedVehicle = await vehicle.save();
    console.log('💾 Vehicle saved successfully:', updatedVehicle._id);

    return res.status(200).json({
      success: true,
      message: `Document ${documentType} ${status} successfully`,
      data: updatedVehicle,
    });
  } catch (error) {
    console.error('🔥 Error in approveVehicleDocument:', {
      message: error.message,
      stack: error.stack,
    });
    return res.status(500).json({
      success: false,
      message: 'Something went wrong while approving the document',
    });
  }
};

exports.updateRiderProfileCompleted = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate the ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Rider ID',
      });
    }

    // Find the rider
    const findRider = await Rider.findById(id);
    if (!findRider) {
      return res.status(404).json({
        success: false,
        message: 'No rider found with this ID',
      });
    }

    // Toggle the fields
    findRider.isProfileComplete = !findRider.isProfileComplete;
    findRider.isDocumentUpload = !findRider.isDocumentUpload;

    await findRider.save();

    return res.status(200).json({
      success: true,
      message: 'Rider profile flags toggled successfully',
      data: {
        isProfileComplete: findRider.isProfileComplete,
        isDocumentUpload: findRider.isDocumentUpload,
      },
    });

  } catch (error) {
    console.error("Internal server error:", error.message);
    res.status(500).json({
      success: false,
      message: 'Internal server error in updating rider profile',
    });
  }
};