const HotelUser = require("../models/Hotel.user");
const HotelListing = require("../models/Hotels.model");
const BookingRequestSchema = require("../models/Hotel.booking_request");
const generateOtp = require("../utils/Otp.Genreator");
const sendToken = require("../utils/SendToken");
const SendWhatsAppMessage = require("../utils/whatsapp_send");
const cloudinary = require("cloudinary").v2;
require("dotenv").config();
const axios = require("axios");
const moment = require("moment");
const mongoose = require("mongoose");
const { sendDltMessage } = require("../utils/DltMessageSend");
const { checkBhAndDoRechargeOnApp } = require("../PaymentWithWebDb/razarpay");

cloudinary.config({
  cloud_name: "dsd8nepa5",
  api_key: "634914486911329",
  api_secret: "dOXqEsWHQMjHNJH_FU6_iHlUHBE",
});
exports.register_hotel_user = async (req, res) => {
  try {
    // Destructure request body
    const {
      bh,
      hotel_name,
      BhJsonData,
      hotel_zone,
      hotel_address,
      hotel_owner,
      hotel_phone,
      amenities,
      area,
      hotel_geo_location,
      Documents,
    } = req.body;

    // Check for required fields
    const emptyFields = [];
    if (!hotel_name) emptyFields.push("hotel_name");
    if (!hotel_zone) emptyFields.push("hotel_zone");
    if (!hotel_address) emptyFields.push("hotel_address");
    if (!hotel_phone) emptyFields.push("hotel_phone");
    if (!hotel_geo_location) emptyFields.push("hotel_geo_location");
    if (!bh) emptyFields.push("Bh");

    if (emptyFields.length > 0) {
      return res.status(400).json({
        success: false,
        message: "The following fields are required:",
        missingFields: emptyFields,
      });
    }

    // Validate geo_location format
    if (
      !hotel_geo_location.coordinates ||
      !Array.isArray(hotel_geo_location.coordinates) ||
      hotel_geo_location.coordinates.length !== 2 ||
      !hotel_geo_location.coordinates.every(
        (coord) => typeof coord === "number"
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid geo-location format. It should be an array of two numbers (longitude and latitude).",
      });
    }

    // Check for duplicate hotel_name
    const existingHotel = await HotelUser.findOne({ hotel_name });
    if (existingHotel) {
      return res.status(409).json({
        success: false,
        message: `A hotel with the name "${hotel_name}" already exists. Please use a different name.`,
      });
    }

    // Check for duplicate Bh
    const existingBh = await HotelUser.findOne({ bh });
    if (existingBh) {
      return res.status(409).json({
        success: false,
        message: `The Bh value "${bh}" is already registered. Please use a unique Bh.`,
      });
    }

    // Check for duplicate hotel_phone
    const existingPhone = await HotelUser.findOne({ hotel_phone });
    if (existingPhone) {
      return res.status(409).json({
        success: false,
        message: `The phone number "${hotel_phone}" is already in use. Please use a different number.`,
      });
    }

    // Generate OTP
    const generateOtp = () =>
      Math.floor(100000 + Math.random() * 900000).toString();
    const GenrateOtp = generateOtp();
    const ExpireTime = new Date().getTime() + 5 * 60 * 1000; // Expire time is 5 minutes

    const message = `Please verify your hotel registration. Your OTP is ${GenrateOtp}, sent to your WhatsApp number ${hotel_phone}.`;

    // Send a WhatsApp message with the OTP
    SendWhatsAppMessage(message, hotel_phone);

    // Create a new hotel user
    const newHotelUser = new HotelUser({
      hotel_name,
      hotel_zone,
      hotel_address,
      hotel_owner,
      hotel_phone,
      amenities,
      area,
      bh,
      BhJsonData,
      hotel_geo_location,
      Documents, // Attach files if any
      otp: GenrateOtp,
      otp_expires: ExpireTime,
    });

    // Save the new hotel user to the database
    await newHotelUser.save();

    // Respond with success
    return res.status(201).json({
      success: true,
      message: "Hotel user registered successfully! OTP sent for verification.",
      data: newHotelUser,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred. Please try again later.",
      error: error.message,
    });
  }
};
exports.verifyOtp = async (req, res) => {
  try {
    console.log("Incoming Request Data:", req.body);
    const { hotel_phone, bh, otp, type = "register" } = req.body;

    if (!hotel_phone || !otp) {
      console.log("Error: Missing phone number or OTP.");
      return res.status(400).json({
        success: false,
        message: "Phone number and OTP are required.",
      });
    }

    let hotelUser;
    console.log("Checking user type:", type);

    if (type === "register") {
      console.log("Finding user by hotel phone number...");
      hotelUser = await HotelUser.findOne({ hotel_phone });
    } else {
      console.log("Finding user by bh...");
      hotelUser = await HotelUser.findOne({ bh: hotel_phone });
    }

    console.log("User Found:", hotelUser);

    if (!hotelUser) {
      console.log("Error: No user found with the given phone number.");
      return res.status(404).json({
        success: false,
        message: "No user found with this phone number.",
      });
    }

    // Uncomment if necessary to check if the contact number is already verified
    /*
        if (hotelUser.contactNumberVerify) {
            console.log("Error: Contact number already verified.");
            return res.status(400).json({
                success: false,
                message: "Contact number already verified.",
            });
        }
        */

    console.log(
      "Comparing OTP:",
      hotelUser.otp,
      "with received OTP:",
      Number(otp)
    );
    if (hotelUser.otp !== Number(otp)) {
      console.log("Error: Invalid OTP.");
      return res.status(400).json({
        success: false,
        message: "Invalid OTP. Please enter the correct OTP.",
      });
    }

    const currentTime = new Date().getTime();
    console.log(
      "Current Time:",
      currentTime,
      "OTP Expires At:",
      hotelUser.otp_expires
    );

    if (currentTime > hotelUser.otp_expires) {
      console.log("Error: OTP has expired.");
      return res.status(400).json({
        success: false,
        message: "OTP has expired. Please request a new OTP.",
      });
    }

    // Mark user as verified
    hotelUser.contactNumberVerify = true;
    hotelUser.otp = null;
    hotelUser.otp_expires = null;

    try {
      const { success, payment_id, member_id } =
        await checkBhAndDoRechargeOnApp({ number: hotelUser.hotel_phone });

      if (success && payment_id && member_id) {
        // ✅ Save recharge data
        hotelUser.RechargeData = {
          rechargePlan: member_id?.title,
          expireData: payment_id?.end_date,
          onHowManyEarning: member_id?.HowManyMoneyEarnThisPlan,
          whichDateRecharge: payment_id?.createdAt,
          approveRecharge: payment_id?.payment_approved,
        };
        hotelUser.isPaid = true;
      }
    } catch (rechargeErr) {
      console.error("Recharge Fetch Failed:", rechargeErr.message);
      // Optional: proceed without saving RechargeData
    }

    console.log("Marking user as verified and saving to database...");
    await hotelUser.save();
    console.log("User verification successful. Sending token...");

    const data = await sendToken(hotelUser, res, 200);
    console.log("Token sent successfully.", data);
  } catch (error) {
    console.error("Error verifying OTP:", error);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred. Please try again later.",
      error: error.message,
    });
  }
};

exports.resendOtp = async (req, res) => {
  try {
    const { hotel_phone } = req.body;

    if (!hotel_phone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required to resend OTP.",
      });
    }

    const hotelUser = await HotelUser.findOne({ hotel_phone });

    if (!hotelUser) {
      return res.status(404).json({
        success: false,
        message: "No user found with this phone number.",
      });
    }

    // Generate a new OTP and set expiry time
    const newOtp = generateOtp();
    const newExpiryTime = new Date().getTime() + 5 * 60 * 1000; // 5 minutes validity

    hotelUser.otp = newOtp;
    hotelUser.otp_expires = newExpiryTime;
    await hotelUser.save();

    // Send the new OTP via WhatsApp
    const message = `Your new OTP for hotel  is ${newOtp}. It will expire in 5 minutes.`;
    SendWhatsAppMessage(message, hotel_phone);

    return res.status(200).json({
      success: true,
      message: "A new OTP has been sent to your registered WhatsApp number.",
    });
  } catch (error) {
    console.error("Error resending OTP:", error);
    return res.status(500).json({
      success: false,
      message: "An unexpected error occurred. Please try again later.",
      error: error.message,
    });
  }
};

exports.find_Hotel_Login = async (req, res) => {
  try {
    const user = req.user.id;

    const foundFreshDetails = await HotelUser.findOne({ _id: user });
    if (!foundFreshDetails) {
      return res.status(404).json({
        success: false,
        message: "No user found with this id.",
      });
    }

    const foundListingOfRooms = await HotelListing.find({
      hotel_user: foundFreshDetails?._id,
    });

    return res.status(200).json({
      success: true,
      message: "Hotel login successful.",
      data: foundFreshDetails,
      listings: foundListingOfRooms,
      listingCount: foundListingOfRooms.length,
    });
  } catch (error) {
    console.log(error);
    res.status(501).json({
      success: false,
      message: "An unexpected error occurred. Please try again later.",
    });
  }
};

exports.LoginHotel = async (req, res) => {
  try {
    const { BH, type, fcmToken, appVersion, androidId, location } = req.body;
    console.log("Body",req.body)
    if (!BH) {
      return res.status(400).json({
        success: false,
        message: "BH ID is required.",
      });
    }

    const generateOtp = (bhId) => {
      if (bhId === "BH424960") return "123456";
      return Math.floor(100000 + Math.random() * 900000).toString();
    };

    let foundHotel = await HotelUser.findOne({ bh: BH });
    if (!foundHotel) {
      try {
        // Fetch hotel details from external API if not found in the database
        const response = await axios.post(
          "https://webapi.olyox.com/api/v1/getProviderDetailsByBhId",
          { BhId: BH }
        );

        if (response.data?.success) {
          return res.status(403).json({
            success: false,
            BhID: response.data.BH_ID,
            message:
              "You are registered on the website but need to complete your profile on the Vendor App!",
            redirect: "complete-profile",
          });
        } else {
          return res.status(404).json({
            success: false,
            message: "Hotel profile not found. Please register first.",
          });
        }
      } catch (error) {
        console.error(
          "Error fetching provider details:",
          error?.response?.data || error
        );
        return res.status(402).json({
          success: false,
          message: "Hotel profile not found. Please register first.",
        });
      }
    }
    /* ============================
       🔐 OTP
    ============================ */
    const otpCode = generateOtp(BH);
    foundHotel.otp = otpCode;
    foundHotel.otp_expires = Date.now() + 5 * 60 * 1000;

    /* ============================
       📱 CONDITIONAL DEVICE UPDATE
    ============================ */
    let shouldSave = false;

    // 🔥 FCM TOKEN
    if (fcmToken && fcmToken !== foundHotel.fcmToken) {
      foundHotel.fcmToken = fcmToken;
      foundHotel.fcmUpdatedAt = new Date();
      shouldSave = true;
    }

    // 📱 ANDROID DEVICE ID
    if (androidId && androidId !== foundHotel.deviceId) {
      foundHotel.deviceId = androidId;
      shouldSave = true;
    }

    // 📦 APP VERSION
    if (appVersion && appVersion !== foundHotel.appversion) {
      foundHotel.appversion = appVersion;
      shouldSave = true;
    }

    // 📍 LOCATION (optional — store only latest)
    if (location?.coords) {
      foundHotel.hotel_geo_location = {
        type: "Point",
        coordinates: [location.longitude, location.latitude],
        accuracy: location.accuracy,
        updatedAt: new Date(),
      };
      shouldSave = true;
    }

    // Save only if anything changed
    if (shouldSave) {
      await foundHotel.save();
    }

    /* ============================
       📩 SEND OTP
    ============================ */
    const message = `Please verify your hotel login. Your OTP is ${otpCode}, sent to your WhatsApp number ${foundHotel.hotel_phone}.`;

       await sendDltMessage(otpCode, foundHotel.hotel_phone);

    return res.status(200).json({
      success: true,
      message: "Hotel login initiated. Please verify your OTP.",
    });
  } catch (error) {
    console.error("Error in hotel login:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong. Please try again later.",
    });
  }
};

exports.find_My_rooms = async (req, res) => {
  try {
    const user = req.user.id;
    const foundListingOfRooms = await HotelListing.find({ hotel_user: user });

    if (!foundListingOfRooms.length) {
      return res.status(404).json({
        success: false,
        message: "No rooms found for this user.",
      });
    }

    return res.status(200).json({
      success: true,
      rooms: foundListingOfRooms,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Internal server error.",
      error: error.message,
    });
  }
};

exports.uploadDocuments = async (req, res) => {
  try {
    const userId = req.user.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized access. Please log in.",
      });
    }

    const findUser = await HotelUser.findById(userId);
    if (!findUser) {
      return res.status(404).json({
        success: false,
        message: "User not found. Please check your account details.",
      });
    }

    if (findUser.DocumentUploaded) {
      return res.status(400).json({
        success: false,
        message: "You have already uploaded your documents.",
      });
    }
    if (findUser.DocumentUploadedVerified) {
      return res.status(400).json({
        success: false,
        message: "Your documents have already been verified.",
      });
    }

    if (!req.files || Object.keys(req.files).length === 0) {
      return res.status(400).json({
        success: false,
        message: "No files uploaded. Please upload the required documents.",
      });
    }

    const documentFields = [
      "aadhar_front",
      "aadhar_Back",
      "panCard",
      "gst",
      "addressProof",
      "ProfilePic",
    ];
    const documents = [];

    // Helper function to upload images to Cloudinary
    const uploadImage = async (file) => {
      if (!file) return null;
      const result = await cloudinary.uploader.upload(file.path, {
        folder: "hotel_listings_documents",
      });
      return { url: result.secure_url, public_id: result.public_id };
    };

    for (const field of documentFields) {
      if (req.files[field]) {
        const uploadedImage = await uploadImage(req.files[field][0]);
        if (uploadedImage) {
          documents.push({
            d_type: field,
            d_url: uploadedImage.url,
            d_public_id: uploadedImage.public_id,
          });
        }
      }
    }

    if (documents.length === 0) {
      return res.status(400).json({
        success: false,
        message: "File upload failed. Please try again.",
      });
    }

    // Update user document fields
    findUser.Documents = documents;
    findUser.DocumentUploaded = true;
    await findUser.save();

    return res.status(200).json({
      success: true,
      message: "Documents uploaded successfully.",
      documents: documents,
    });
  } catch (error) {
    console.error("Upload Error:", error);
    return res.status(500).json({
      success: false,
      message:
        "An error occurred while uploading documents. Please try again later.",
    });
  }
};

exports.updateHotelUserDetail = async (req, res) => {
  try {
    const { hotelId } = req.params;
    const updateData = req.body;

    // Find the hotel by ID
    let hotel = await HotelUser.findById(hotelId);
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: "Hotel not found",
      });
    }

    // Handle file uploads for documents
    const documentFields = [
      "aadhar_front",
      "aadhar_Back",
      "panCard",
      "gst",
      "addressProof",
      "ProfilePic",
    ];
    let documents = [...hotel.Documents];

    const uploadImage = async (file) => {
      if (!file) return null;
      const result = await cloudinary.uploader.upload(file.path, {
        folder: "hotel_listings_documents",
      });
      return { d_url: result.secure_url, d_public_id: result.public_id };
    };

    for (const field of documentFields) {
      if (req.files && req.files[field]) {
        const uploadedImage = await uploadImage(req.files[field][0]);
        if (uploadedImage) {
          // Check if the document type already exists
          const existingDocIndex = documents.findIndex(
            (doc) => doc.d_type === field
          );
          if (existingDocIndex !== -1) {
            // Replace existing document
            documents[existingDocIndex] = {
              d_type: field,
              d_url: uploadedImage.d_url,
              d_public_id: uploadedImage.d_public_id,
            };
          } else {
            // Add new document
            documents.push({
              d_type: field,
              d_url: uploadedImage.d_url,
              d_public_id: uploadedImage.d_public_id,
            });
          }
        }
      }
    }

    // If new documents were uploaded, update them
    if (documents.length > 0) {
      updateData.Documents = documents;
    }

    // Update amenities if provided
    if (updateData.amenities) {
      updateData.amenities = {
        ...hotel.amenities,
        ...updateData.amenities,
      };
    }

    // Update geolocation if provided
    if (
      updateData.hotel_geo_location &&
      updateData.hotel_geo_location.coordinates
    ) {
      updateData.hotel_geo_location = {
        type: "Point",
        coordinates: updateData.hotel_geo_location.coordinates,
      };
    }

    // Update all fields
    const updatedHotel = await HotelUser.findByIdAndUpdate(
      hotelId,
      updateData,
      { new: true }
    );

    return res.status(200).json({
      success: true,
      message: "Hotel details updated successfully",
      data: updatedHotel,
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

exports.toggleHotelStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const userId = req.user.id;

    console.log("Request received to toggle hotel status:", {
      userId,
      requestedStatus: status,
    });

    // Fetch user details
    const foundFreshDetails = await HotelUser.findById(userId);
    if (!foundFreshDetails) {
      console.log("User not found:", userId);
      return res.status(404).json({
        success: false,
        message: "We couldn't find your account. Please try logging in again.",
      });
    }

    console.log("User details found:", {
      id: foundFreshDetails._id,
      contactVerified: foundFreshDetails.contactNumberVerify,
      docsUploaded: foundFreshDetails.DocumentUploaded,
      docsVerified: foundFreshDetails.DocumentUploadedVerified,
      isBlocked: foundFreshDetails.isBlockByAdmin,
      bhId: foundFreshDetails.bh,
    });

    // Check verification and block status
    if (!foundFreshDetails.contactNumberVerify) {
      console.log("Phone not verified for user:", userId);
      return res.status(400).json({
        success: false,
        message:
          "Your phone number is not verified. Please verify it to proceed.",
      });
    }
    if (!foundFreshDetails.DocumentUploaded) {
      console.log("Documents not uploaded for user:", userId);
      return res.status(400).json({
        success: false,
        message:
          "You need to upload the required documents before activating your hotel.",
      });
    }
    if (!foundFreshDetails.DocumentUploadedVerified) {
      console.log("Documents not yet verified for user:", userId);
      return res.status(400).json({
        success: false,
        message:
          "Your documents are still under review. Please wait for verification.",
      });
    }
    if (foundFreshDetails.isBlockByAdmin) {
      console.log("User is blocked by admin:", userId);
      return res.status(403).json({
        success: false,
        message:
          "Your account has been blocked by the admin. Please contact support for assistance.",
      });
    }

    let checkItsValidRechargeOrNot = false;

    try {
      console.log(
        "Fetching provider details for BH ID:",
        foundFreshDetails?.bh
      );
      const response = await axios.post(
        "https://webapi.olyox.com/api/v1/getProviderDetailsByBhId",
        { BhId: foundFreshDetails?.bh }
      );

      console.log("Provider API response received:", response.data);
      // console.log("Provider API response received:",response);

      if (response.data && response.data.data) {
        const providerDetails = response.data.data;

        // Get current date and time in Indian Standard Time (IST)
        const currentDateIST = new Date().toLocaleString("en-US", {
          timeZone: "Asia/Kolkata",
        });
        const currentDateObj = new Date(currentDateIST);

        // Get end date from provider details
        const endDateObj =
          providerDetails.payment_id && providerDetails.payment_id.end_date
            ? new Date(providerDetails.payment_id.end_date)
            : null;

        console.log("Date comparison:", {
          currentDateIST,
          currentDateObj: currentDateObj.toISOString(),
          endDate: endDateObj ? endDateObj.toISOString() : "N/A",
        });

        // Check if either plan_status is true OR payment is approved AND end date is in the future
        if (providerDetails.recharge !== 0) {
          if (
            providerDetails.plan_status &&
            endDateObj &&
            endDateObj > currentDateObj
          ) {
            console.log("Valid subscription found: plan_status is true");
            checkItsValidRechargeOrNot = true;
          } else if (
            providerDetails.payment_id &&
            providerDetails.payment_id.payment_approved
          ) {
            if (endDateObj && endDateObj > currentDateObj) {
              console.log(
                "Valid subscription found: payment approved and end date is in the future"
              );
              checkItsValidRechargeOrNot = true;
            } else {
              console.log("Subscription expired: end date has passed");
              // Set specific message for expired subscription
              return res.status(400).json({
                success: false,
                message:
                  "Your subscription has expired. Please renew to continue using our services.",
              });
            }
          } else {
            console.log(
              "No valid subscription: both plan_status and payment_approved are false/missing"
            );
          }
        } else {
          console.log("No recharge found for user");
        }
      } else {
        console.log("Invalid response format from provider API");
      }
    } catch (error) {
      console.error("Error fetching provider details:", error);
      return res.status(500).json({
        success: false,
        message:
          "We couldn't verify your subscription status. Please try again later or contact support.",
        error: error.message,
      });
    }

    if (!checkItsValidRechargeOrNot) {
      console.log("Invalid recharge status for user:", userId);
      return res.status(400).json({
        success: false,
        message:
          "Your subscription has not been activated. Please recharge to start using our services.",
      });
    }

    // Convert status properly
    const changeStatusToBoolean = status === true || status === "true";
    // console.log("Setting hotel online status to:", changeStatusToBoolean);

    // Update the online status
    foundFreshDetails.isOnline = changeStatusToBoolean;
    await foundFreshDetails.save();

    // console.log("Hotel status successfully updated for user:", userId);

    return res.status(200).json({
      success: true,
      message: changeStatusToBoolean
        ? "Your hotel is now online! Customers can now book rooms."
        : "Your hotel is now offline. You can enable it again anytime.",
    });
  } catch (error) {
    console.error("Error in toggleHotelStatus:", error);

    return res.status(500).json({
      success: false,
      message:
        "Something went wrong on our end. Please try again later or contact support.",
      error: error.message,
    });
  }
};

exports.add_hotel_listing = async (req, res) => {
  try {
    const user = req.user.id;
    const {
      room_type,
      hotel_user,
      has_tag,
      amenities,
      allowed_person,
      cut_price,
      book_price,
      cancellation_policy,
      is_tax_applied,
      tax_fair,
      isPackage,
      package_add_ons,
    } = req.body;

    if (!room_type || !book_price) {
      return res.status(400).json({
        success: false,
        message: "room_type and book_price are required fields.",
      });
    }

    // Convert has_tag string into an array
    let hasTagArray = [];
    if (typeof has_tag === "string" && has_tag.trim() !== "") {
      hasTagArray = has_tag.split(",").map((tag) => tag.trim());
    }

    // Calculate discount percentage
    const discount_percentage =
      cut_price > 0
        ? Math.round(((cut_price - book_price) / cut_price) * 100)
        : 0;

    const images = {};
    const imageFields = [
      "main_image",
      "second_image",
      "third_image",
      "fourth_image",
      "fifth_image",
    ];

    const uploadImage = async (file) => {
      if (!file) return null;
      const result = await cloudinary.uploader.upload(file.path, {
        folder: "hotel_listings",
      });
      return { url: result.secure_url, public_id: result.public_id };
    };

    for (const field of imageFields) {
      if (req.files[field]) {
        images[field] = await uploadImage(req.files[field][0]);
      }
    }

    let packageAddOns = [];

    if (isPackage && package_add_ons) {
      try {
        if (typeof package_add_ons === "string") {
          // Convert comma-separated string to an array
          packageAddOns = package_add_ons.split(",").map((item) => item.trim());
        } else {
          packageAddOns = JSON.parse(package_add_ons);
        }

        if (!Array.isArray(packageAddOns)) {
          return res.status(400).json({
            success: false,
            message: "package_add_ons must be an array.",
          });
        }
      } catch (error) {
        return res.status(400).json({
          success: false,
          message:
            "Invalid format for package_add_ons. It should be a JSON array or a comma-separated string.",
        });
      }
    }

    console.log(packageAddOns);

    const newHotelListing = new HotelListing({
      room_type,
      hotel_user: user?._id,
      has_tag: hasTagArray,
      amenities,
      allowed_person,
      cut_price,
      book_price,
      discount_percentage,
      cancellation_policy,
      is_tax_applied,
      tax_fair,
      isPackage,
      package_add_ons: packageAddOns,
      ...images,
    });

    console.log(newHotelListing);
    await newHotelListing.save();

    return res.status(201).json({
      success: true,
      message: "Hotel listing added successfully",
      data: newHotelListing,
    });
  } catch (error) {
    console.error("Error adding hotel listing:", error);
    return res.status(500).json({
      success: false,
      message: "Something went wrong while adding the hotel listing",
    });
  }
};

exports.deleteHotelRoom = async (req, res) => {
  try {
    const { roomId } = req.query;

    if (!roomId) {
      return res
        .status(400)
        .json({ success: false, message: "Room ID is required" });
    }

    const hotelRoom = await HotelListing.findById(roomId);
    if (!hotelRoom) {
      return res
        .status(404)
        .json({ success: false, message: "Hotel room not found" });
    }

    // Delete images from Cloudinary
    const imageFields = [
      "main_image",
      "second_image",
      "third_image",
      "fourth_image",
      "fifth_image",
    ];
    for (let field of imageFields) {
      if (hotelRoom[field]?.public_id) {
        await cloudinary.uploader.destroy(hotelRoom[field].public_id);
      }
    }

    // Delete the hotel room from the database
    await HotelListing.findByIdAndDelete(roomId);

    return res
      .status(200)
      .json({ success: true, message: "Hotel room deleted successfully" });
  } catch (error) {
    console.error("Error deleting hotel room:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

exports.getHotelsNearByMe = async (req, res) => {
  try {
    const { lat, lng } = req.query;

    let hotel_listing = [];

    // ✅ CASE 1: lat & lng present → nearby hotels
    if (lat && lng) {
      hotel_listing = await HotelUser.find({
        hotel_geo_location: {
          $near: {
            $geometry: {
              type: "Point",
              coordinates: [parseFloat(lng), parseFloat(lat)],
            },
            $maxDistance: 200000, // 2 km
          },
        },
      });
    }

    // ✅ CASE 2: No location OR no nearby hotels → show all
    if (!lat || !lng || hotel_listing.length === 0) {
      hotel_listing = await HotelListing.find()
        .sort({ isRoomAvailable: -1 }) // available rooms first
        .populate("hotel_user").select('-amenities');

      // optional random order
      hotel_listing = hotel_listing.sort(() => Math.random() - 0.5);
    }

    res.status(200).json({
      success: true,
      count: hotel_listing.length,
      data: hotel_listing,
    });
  } catch (error) {
    console.error("Error fetching hotels:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};


exports.getHotelsDetails = async (req, res) => {
  try {
    const { params } = req.params;
    console.log(req.params);

    let hotel_user = await HotelUser.findById(params);

    if (!hotel_user) {
      return res
        .status(404)
        .json({ success: false, message: "Hotel not found." });
    }

    let hotel_listing = await HotelListing.find({ hotel_user: params });

    // If no nearby hotels are found, fetch all hotels and shuffle the data
    if (hotel_listing.length === 0) {
      hotel_listing = await HotelListing.find();
      hotel_listing = hotel_listing.sort(() => Math.random() - 0.5);
    }
    console.log("hotel_listing", hotel_listing);

    res.status(200).json({
      success: true,
      count: hotel_listing.length,
      Hotel_User: hotel_user,
      data: hotel_listing,
    });
  } catch (error) {
    console.error("Error fetching hotels:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};

exports.getSingleHotelDetails = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("id", id);
    const hotelData = await HotelUser.findById(id);
    if (!hotelData) {
      return res
        .status(404)
        .json({ success: false, message: "Hotel not found." });
    }
    res.status(200).json({
      success: true,
      message: "Hotel fetched successfully",
      data: hotelData,
    });
  } catch (error) {
    console.log("Internal server error", error);
  }
};

exports.updateHotelBlock = async (req, res) => {
  try {
    const { id } = req.params;
    const { isBlockByAdmin } = req.body;
    const hotelData = await HotelUser.findById(id);
    if (!hotelData) {
      return res
        .status(404)
        .json({ success: false, message: "Hotel not found." });
    }
    hotelData.isBlockByAdmin = isBlockByAdmin;
    await hotelData.save();
    res.status(200).json({
      success: true,
      message: "Hotel block status updated successfully",
      data: hotelData,
    });
  } catch (error) {
    console.log("Internal server error", error);
    res.status(500).json({
      success: false,
      message: "Something went wrong while updating the hotel block status",
      error: error.message,
    });
  }
};

exports.getHotelsListingDetails = async (req, res) => {
  try {
    // Destructure the hotelId directly from req.params
    const { hotelId } = req.params;

    // Find the hotel by its ID
    let hotel_listing = await HotelListing.findById(hotelId).populate(
      "hotel_user"
    );

    // Check if the hotel was found
    if (!hotel_listing) {
      return res.status(404).json({
        success: false,
        message: "Hotel not found.",
      });
    }

    // Return the hotel data
    res.status(200).json({
      success: true,
      data: hotel_listing,
    });
  } catch (error) {
    console.error("Error fetching hotels:", error);
    res.status(500).json({
      success: false,
      message: "Server error. Please try again later.",
    });
  }
};

exports.toggleRoomStatus = async (req, res) => {
  try {
    const { roomId } = req.query;
    const { isRoomAvailable } = req.body;
    console.log("isRoomAvailable", isRoomAvailable);

    if (!roomId) {
      return res
        .status(400)
        .json({ success: false, message: "Room ID is required" });
    }
    if (isRoomAvailable === undefined) {
      return res
        .status(400)
        .json({ success: false, message: "Status is required" });
    }

    const room = await HotelListing.findById(roomId);
    if (!room) {
      return res
        .status(404)
        .json({ success: false, message: "Room not found" });
    }

    room.isRoomAvailable = isRoomAvailable;
    await room.save();

    return res
      .status(200)
      .json({ success: true, message: "Room status updated successfully" });
  } catch (error) {
    console.error("Error updating room status:", error);
    return res
      .status(500)
      .json({ success: false, message: "Internal server error" });
  }
};

exports.getAllHotel = async (req, res) => {
  try {
    const hotel_listing = await HotelUser.find();
    if (!hotel_listing) {
      return res.status(404).json({
        success: false,
        message: "No hotel found",
      });
    }
    res.status(200).json({
      success: true,
      message: "Hotels fetched successfully",
      data: hotel_listing,
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

exports.verifyDocuments = async (req, res) => {
  try {
    const { id } = req.params;
    const { DocumentUploadedVerified } = req.body;
    const user = await HotelUser.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "No user found",
      });
    }
    user.DocumentUploadedVerified = DocumentUploadedVerified;
    await user.save();
    return res.status(200).json({
      success: true,
      message: "Documents verified successfully",
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

exports.updateHotelDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const { hotel_name, hotel_zone, hotel_owner, hotel_phone, amenities } =
      req.body;

    // Parse the amenities if it's a string (because it's sent as JSON string from frontend)
    let parsedAmenities = amenities;
    if (typeof amenities === "string") {
      parsedAmenities = JSON.parse(amenities); // Parse the stringified JSON
    }

    // Find the hotel document by ID
    const hotel = await HotelUser.findById(id);
    if (!hotel) {
      return res.status(404).json({
        success: false,
        message: "No hotel found",
      });
    }

    // Array of document fields that might have images uploaded
    const documentFields = [
      "aadhar_front",
      "aadhar_Back",
      "panCard",
      "gst",
      "addressProof",
      "ProfilePic",
    ];
    const documents = [];

    // Function to upload the image to Cloudinary
    const uploadImage = async (file) => {
      if (!file) return null;
      const result = await cloudinary.uploader.upload(file.path, {
        folder: "hotel_listings_documents",
      });
      return { url: result.secure_url, public_id: result.public_id };
    };

    // Loop through the document fields and handle image uploads and replacement
    for (const field of documentFields) {
      if (req.files && req.files[field]) {
        const uploadedImage = await uploadImage(req.files[field][0]);

        if (uploadedImage) {
          // Remove old image from Cloudinary if a new one is uploaded
          const existingDocument = hotel.Documents.find(
            (doc) => doc.d_type === field
          );
          if (existingDocument) {
            await cloudinary.uploader.destroy(existingDocument.d_public_id);
          }

          // Add the new document to the list
          documents.push({
            d_type: field,
            d_url: uploadedImage.url,
            d_public_id: uploadedImage.public_id,
          });
        }
      } else {
        // If no new file, keep the existing document if it exists
        const existingDocument = hotel.Documents.find(
          (doc) => doc.d_type === field
        );
        if (existingDocument) {
          documents.push(existingDocument);
        }
      }
    }

    // Update hotel details, including new documents array
    hotel.Documents = documents;
    hotel.hotel_name = hotel_name || hotel.hotel_name;
    hotel.hotel_zone = hotel_zone || hotel.hotel_zone;
    hotel.hotel_owner = hotel_owner || hotel.hotel_owner;
    hotel.hotel_phone = hotel_phone || hotel.hotel_phone;

    // Handle amenities update
    if (parsedAmenities) {
      hotel.amenities = {
        AC: parsedAmenities.AC ?? hotel.amenities.AC,
        freeWifi: parsedAmenities.freeWifi ?? hotel.amenities.freeWifi,
        kitchen: parsedAmenities.kitchen ?? hotel.amenities.kitchen,
        TV: parsedAmenities.TV ?? hotel.amenities.TV,
        powerBackup: parsedAmenities.powerBackup ?? hotel.amenities.powerBackup,
        geyser: parsedAmenities.geyser ?? hotel.amenities.geyser,
        parkingFacility:
          parsedAmenities.parkingFacility ?? hotel.amenities.parkingFacility,
        elevator: parsedAmenities.elevator ?? hotel.amenities.elevator,
        cctvCameras: parsedAmenities.cctvCameras ?? hotel.amenities.cctvCameras,
        diningArea: parsedAmenities.diningArea ?? hotel.amenities.diningArea,
        privateEntrance:
          parsedAmenities.privateEntrance ?? hotel.amenities.privateEntrance,
        reception: parsedAmenities.reception ?? hotel.amenities.reception,
        caretaker: parsedAmenities.caretaker ?? hotel.amenities.caretaker,
        security: parsedAmenities.security ?? hotel.amenities.security,
        checkIn24_7: parsedAmenities.checkIn24_7 ?? hotel.amenities.checkIn24_7,
        dailyHousekeeping:
          parsedAmenities.dailyHousekeeping ??
          hotel.amenities.dailyHousekeeping,
        fireExtinguisher:
          parsedAmenities.fireExtinguisher ?? hotel.amenities.fireExtinguisher,
        firstAidKit: parsedAmenities.firstAidKit ?? hotel.amenities.firstAidKit,
        buzzerDoorBell:
          parsedAmenities.buzzerDoorBell ?? hotel.amenities.buzzerDoorBell,
        attachedBathroom:
          parsedAmenities.attachedBathroom ?? hotel.amenities.attachedBathroom,
      };
    }

    // Save the updated hotel details
    await hotel.save();

    return res.status(200).json({
      success: true,
      message: "Hotel details updated successfully",
      hotel,
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

exports.geHotelListingByHotelUser = async (req, res) => {
  try {
    const { id } = req.params; // Get hotel user ID from request params

    // Find hotel listings by hotel_user ID
    const hotelListings = await HotelListing.find({ hotel_user: id });

    // If no hotel listings found for the given hotel user, return a 404 error
    if (!hotelListings || hotelListings.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No hotel listings found for this hotel user",
      });
    }

    // Return the hotel listings for the specific hotel user
    res.status(200).json({
      success: true,
      data: hotelListings,
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

exports.HotelAnalyticData = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res
        .status(400)
        .json({ success: false, message: "Hotel ID is required" });
    }

    const hotel = await HotelUser.findById(id);
    if (!hotel) {
      return res
        .status(404)
        .json({ success: false, message: "Hotel not found" });
    }

    // 1. Get the hotel listings (rooms)
    const hotelListings = await HotelListing.find({ hotel_user: id }).select(
      "_id isPackage"
    );
    const hotelListingIds = hotelListings.map((listing) => listing._id);
    const totalRooms = hotelListings.length;

    // Count Package Listings
    const packageListings = hotelListings.filter(
      (listing) => listing.isPackage
    );
    const totalPackages = packageListings.length;

    // 2. Booking Statistics
    const bookingStats = await BookingRequestSchema.aggregate([
      { $match: { listing_id: { $in: hotelListingIds } } },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const bookingData = {
      total: bookingStats.reduce((acc, val) => acc + val.count, 0),
      pending: bookingStats.find((stat) => stat._id === "Pending")?.count || 0,
      completed:
        bookingStats.find((stat) => stat._id === "Checkout")?.count || 0,
      rejected:
        bookingStats.find((stat) => stat._id === "Cancelled")?.count || 0,
    };

    // 3. Highest Booking Month with Month Name
    const bookingsByMonth = await BookingRequestSchema.aggregate([
      { $match: { listing_id: { $in: hotelListingIds } } },
      {
        $group: {
          _id: { $month: "$createdAt" },
          count: { $sum: 1 },
        },
      },
      { $sort: { count: -1 } },
      { $limit: 1 },
    ]);

    const mostBookedMonth = bookingsByMonth[0]
      ? moment()
          .month(bookingsByMonth[0]._id - 1)
          .format("MMMM")
      : "No Data";

    const mongooseId = new mongoose.Types.ObjectId(id);

    // 4. Average Rating Calculation
    const avgRatingResult = await HotelUser.aggregate([
      { $match: { _id: mongooseId } },
      { $unwind: "$reviews" },
      { $group: { _id: "$_id", avgRating: { $avg: "$reviews.rating" } } },
    ]);

    const avgRating = avgRatingResult[0]?.avgRating?.toFixed(1) || "No Reviews";

    // 5. Booking Mode Count (Online vs Cash/Pay at Hotel)
    const bookingModes = await BookingRequestSchema.aggregate([
      { $match: { listing_id: { $in: hotelListingIds } } },
      {
        $group: {
          _id: "$paymentMode",
          count: { $sum: 1 },
        },
      },
    ]);

    const modeCounts = {
      online: bookingModes.find((mode) => mode._id === "Online")?.count || 0,
      cashOrPayAtHotel:
        (bookingModes.find((mode) => mode._id === "Offline")?.count || 0) +
        (bookingModes.find((mode) => mode._id === "Pay at Hotel" || "Cash")
          ?.count || 0),
    };

    // 6. Calculate Total Earnings from final_price_according_to_days
    const totalEarningsResult = await BookingRequestSchema.aggregate([
      { $match: { listing_id: { $in: hotelListingIds }, status: "Checkout" } },
      {
        $group: {
          _id: null,
          totalEarnings: { $sum: "$final_price_according_to_days" },
        },
      },
    ]);

    const totalEarnings = totalEarningsResult[0]?.totalEarnings || 0;

    // 7. Calculate **Occupied Rooms** → Check-in but not Checkout
    const occupiedRoomsCount = await BookingRequestSchema.countDocuments({
      listing_id: { $in: hotelListingIds },
      status: "CheckIn",
    });

    // 8. Running Package Bookings (Packages that are active)
    const runningPackages = await BookingRequestSchema.countDocuments({
      listing_id: { $in: packageListings.map((listing) => listing._id) },
      status: "CheckIn",
    });

    // 9. Fetch Provider Subscription Details
    let providerDetails = null,
      planExpire = "N/A",
      lastRecharge = "N/A",
      referralBalance = 0,
      referral = {};

    try {
      const response = await axios.post(
        "https://webapi.olyox.com/api/v1/getProviderDetailsByBhId",
        { BhId: hotel.bh }
      );

      if (response.data?.data) {
        providerDetails = response.data.data;
        planExpire = providerDetails.payment_id?.end_date || "N/A";
        lastRecharge = providerDetails.recharge || "N/A";
        referralBalance = providerDetails.wallet || 0; // Referral Balance instead of Wallet
        referral = {
          parent: providerDetails.parentReferral_id,
          children: providerDetails.Child_referral_ids || [],
        };
      }
    } catch (error) {
      console.error("Error fetching provider details:", error.response?.data);
    }

    // Final Response
    res.status(200).json({
      success: true,
      hotelId: id,
      totalEarnings,
      totalBookings: bookingData.total,
      pendingBookings: bookingData.pending,
      completedBookings: bookingData.completed,
      rejectedBookings: bookingData.rejected,
      highestBookingMonth: mostBookedMonth,
      averageRating: avgRating,
      planExpire,
      lastRecharge,
      referralBalance, // Changed from wallet to referralBalance
      referralDetails: referral,
      modeCounts,
      totalRooms, // Total rooms available in the hotel
      occupiedRooms: occupiedRoomsCount, // Rooms that are currently occupied (checked in but not checked out)
      totalPackages, // Total listings that are packages
      runningPackages, // Number of packages currently active (checked-in bookings)
    });
  } catch (error) {
    console.error("Error in HotelAnalyticData:", error);
    res.status(500).json({
      success: false,
      message: "Internal Server Error",
      error: error.message,
    });
  }
};

exports.deleteHotelVendor = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await HotelUser.findByIdAndDelete(id);
    if (!data) {
      return res
        .status(404)
        .json({ success: false, message: "Hotel not found" });
    }
    res
      .status(200)
      .json({ success: true, message: "Hotel deleted successfully", data });
  } catch (error) {
    console.log("Internal server error", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: error.message,
    });
  }
};
