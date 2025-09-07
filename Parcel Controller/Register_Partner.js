const Parcel_Bike_Register = require("../models/Parcel_Models/Parcel_Bike_Register");
const Parcel_Request = require("../models/Parcel_Models/Parcel_Request");
const Parcel_User_Login_Status = require("../models/Parcel_Models/Parcel_User_Login_Status");
const { uploadBufferImage } = require("../utils/aws.uploader");
const generateOtp = require("../utils/Otp.Genreator");
const send_token = require("../utils/send_token");
const SendWhatsAppMessage = require("../utils/whatsapp_send");
const cloudinary = require('cloudinary').v2
const sharp = require('sharp');
const fs = require('fs');
cloudinary.config({
    cloud_name: 'dsd8nepa5',
    api_key: '634914486911329',
    api_secret: 'dOXqEsWHQMjHNJH_FU6_iHlUHBE'
})
//still pending due to error of cors in uploading images
exports.register_parcel_partner = async (req, res) => {
    try {
        const { name, phone, address, type,bikeDetails } = req.body;

        // 1. Validate required fields
        if (!name.trim() || !phone.trim() || !address.trim() || !bikeDetails) {
            return res.status(400).json({ success: false, message: "All fields are required." });
        }

        // 2. Validate bike details
        const { make, model, year, licensePlate } = bikeDetails;
        if (!make || !model || !year || !licensePlate) {
            return res.status(400).json({ success: false, message: "Bike details are incomplete." });
        }



        // 4. Check for existing partner by phone
        const existingPartner = await Parcel_Bike_Register.findOne({ phone });
        if (existingPartner) {
            if (!existingPartner.isOtpVerify) {
                const otp = generateOtp();
                if (existingPartner.howManyTimesHitResend >= 5) {
                    existingPartner.isOtpBlock = true;
                    existingPartner.isDocumentUpload=false
                    existingPartner.otpUnblockAfterThisTime = new Date(Date.now() + 30 * 60000); // 30 minutes later
                    await existingPartner.save();
                    await SendWhatsAppMessage(`Your account is blocked for 30 minutes.`, phone);
                    return res.status(400).json({ success: false, message: "Your account is blocked for 30 minutes." });
                }
                existingPartner.otp = otp;
                existingPartner.howManyTimesHitResend += 1;
                existingPartner.isDocumentUpload=false

                await existingPartner.save();
                await SendWhatsAppMessage(`Your OTP for parcel registration is: ${otp}`, phone);
                return res.status(201).json({ success: true, message: "Partner exists. Please verify OTP." });
            }
            return res.status(400).json({ success: false, message: "Phone number already registered." });
        }

        // 5. Check for existing partner by license plate
        const existingPartnerWithVehicle = await Parcel_Bike_Register.findOne({ 'bikeDetails.licensePlate': licensePlate });
        if (existingPartnerWithVehicle) {
            return res.status(400).json({ success: false, message: "License plate already registered." });
        }

        // 6. Create new partner
        const newPartner = new Parcel_Bike_Register({ name, phone, address,type, bikeDetails,isDocumentUpload:false });
        const otp = generateOtp();
        newPartner.otp = otp;
        await newPartner.save();

        await SendWhatsAppMessage(`Your OTP for parcel registration is: ${otp}`, phone);
        res.status(201).json({ success: true, message: "Please verify OTP sent to your phone.", otp });

    } catch (error) {
        console.error(error);
        res.status(500).json({ success: false, message: "An error occurred.", error: error.message });
    }
};
exports.login = async (req, res) => {
    try {
        const { number } = req.body;

        if (!number) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        const partner = await Parcel_Bike_Register.findOne({ phone: number });

        if (!partner) {
            return res.status(400).json({
                success: false,
                message: "Phone number is not registered"
            });
        }

        // Check if the user is blocked for OTP
        if (partner.isOtpBlock) {
            // Check the time when OTP should be unblocked
            const currentTime = new Date();
            const unblockTime = new Date(partner.otpUnblockAfterThisTime);

            // If the unblock time has not passed yet, notify the user
            if (currentTime < unblockTime) {
                return res.status(403).json({
                    success: false,
                    message: `You are blocked from requesting OTP. Please try again after ${unblockTime.toLocaleTimeString()}`
                });
            }

            // If unblock time has passed, unblock the user
            partner.isOtpBlock = false;
            partner.otpUnblockAfterThisTime = null; // Clear unblock time
            partner.howManyTimesHitResend = 0; // Reset resend attempts
            await partner.save();
        }

        // Generate OTP if the user is not blocked
        const otp = await generateOtp();
        partner.otp = otp;
        await partner.save();

        const otpMessage = `Your OTP for parcel registration is: ${otp}`;
        await SendWhatsAppMessage(otpMessage, number);

        res.status(201).json({
            success: true,
            message: "Please verify OTP sent to your phone.",
            otp: otp
        });

    } catch (error) {
        res.status(501).json({
            success: false,
            error: error.message || "Something went wrong"
        });
    }
};

exports.resendOtp = async (req, res) => {
    try {
        const { number } = req.body;

        if (!number) {
            return res.status(400).json({
                success: false,
                message: "Phone number is required"
            });
        }

        const partner = await Parcel_Bike_Register.findOne({ phone: number });

        if (!partner) {
            return res.status(400).json({
                success: false,
                message: "Phone number is not registered"
            });
        }

        // Check if OTP is blocked
        if (partner.isOtpBlock) {
            // Check if the unblock time has passed
            const currentTime = new Date();
            if (currentTime < partner.otpUnblockAfterThisTime) {
                const timeRemaining = (partner.otpUnblockAfterThisTime - currentTime) / 1000;
                return res.status(400).json({
                    success: false,
                    message: `OTP resend is blocked. Try again in ${Math.ceil(timeRemaining)} seconds.`
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
                message: "OTP resend limit reached. Please try again later."
            });
        }


        const otp = await generateOtp();
        partner.otp = otp;
        partner.howManyTimesHitResend += 1;
        await partner.save();

        const otpMessage = `Your OTP for parcel registration is: ${otp}`;
        const data = await SendWhatsAppMessage(otpMessage, number);
        console.log(data)
        res.status(200).json({
            success: true,
            message: "OTP resent successfully. Please check your phone.",
            otp: otp
        });

    } catch (error) {
        res.status(501).json({
            success: false,
            error: error.message || "Something went wrong"
        });
    }
};

exports.verifyOtp = async (req, res) => {
    try {
        const { number, otp } = req.body;

        if (!number || !otp) {
            return res.status(400).json({
                success: false,
                message: "Phone number and OTP are required"
            });
        }

        const partner = await Parcel_Bike_Register.findOne({ phone: number });

        if (!partner) {
            return res.status(400).json({
                success: false,
                message: "Phone number is not registered"
            });
        }

        // Check if OTP is valid
        if (partner.otp !== otp) {
            return res.status(400).json({
                success: false,
                message: "Invalid OTP"
            });
        }

        // OTP is verified, so clear the OTP and reset fields
        partner.otp = null; // Clear the OTP
        partner.isOtpVerify = true; // Clear the OTP
        partner.howManyTimesHitResend = 0; // Reset resend attempts
        partner.isOtpBlock = false; // Unblock OTP if it was previously blocked
        partner.otpUnblockAfterThisTime = null; // Clear the OTP unblock time

        await partner.save();

        await send_token(partner, { type: partner?.type }, res, req)

    } catch (error) {
        res.status(501).json({
            success: false,
            error: error.message || "Something went wrong"
        });
    }
};

exports.uploadDocuments = async (req, res) => {
    try {
        const userId = req.user.userId;
        const findRider = await Parcel_Bike_Register.findById(userId);

        if (!findRider) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        if (findRider.isDocumentUpload && findRider.DocumentVerify === true) {
            return res.status(400).json({ success: false, message: "Documents already uploaded and verified, please login." });
        }

        const uploadedDocs = {};

        for (const file of req.files) {
            const uploadResponse = await cloudinary.uploader.upload(file.path, { folder: "parcel_documents" });

            if (file.originalname.includes('dl')) uploadedDocs.license = uploadResponse.secure_url;
            if (file.originalname.includes('rc')) uploadedDocs.rc = uploadResponse.secure_url;
            if (file.originalname.includes('pan')) uploadedDocs.pan = uploadResponse.secure_url;
            if (file.originalname.includes('aadhar')) uploadedDocs.aadhar = uploadResponse.secure_url;

            // Delete local file after upload
            fs.unlinkSync(file.path);
        }
        console.log(uploadedDocs)

        findRider.documents = uploadedDocs;
        findRider.isDocumentUpload = true;
        await findRider.save();

        res.status(201).json({ success: true, message: "Documents uploaded successfully", data: uploadedDocs });
    } catch (error) {
        console.error("Error uploading documents:", error);
        res.status(500).json({ success: false, message: "Documents upload failed", error: error.message });
    }
};

exports.details = async (req, res) => {
    try {
      
        // Retrieve userId from the request object, assuming it's populated by middleware
        const userId = req.user?.userId;

        // Check if userId exists
        if (!userId) {
            return res.status(400).json({ message: "User ID is required" });
        }

        // Find the partner
        const partner = await Parcel_Bike_Register.findOne({ _id: userId });

        // If partner not found, return error
        if (!partner) {
            return res.status(404).json({ message: "Partner not found" });
        }

        // Fetch the latest order for this partner
        const latestOrder = await Parcel_Request.findOne({
            driverId: partner._id
        })
            .sort({ createdAt: -1 })  // Sort by latest order first
            .limit(1);  // Only fetch one latest order

        // Return response
        return res.status(200).json({ success: true, partner, latestOrder });

    } catch (error) {
        console.error("Error fetching partner details:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};


exports.manage_offline_online = async (req, res) => {
    try {
        const userId = req.user.userId;  // ✅ Get userId from request

        // ✅ Check if the user exists
        const partner = await Parcel_Bike_Register.findOne({ _id: userId });

        if (!partner) {
            return res.status(404).json({ message: 'Partner not found' });
        }
        if (!partner.isActive) {
            return res.status(400).json({ message: 'Your Account is terminated due to suspicious work' });
        }
        if (!partner.DocumentVerify) {
            return res.status(400).json({ message: 'Your Document verification is still pending' });
        }

        const { status } = req.body;
        console.log(status)
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format

        if (!["online", "offline"].includes(status)) {
            return res.status(400).json({ error: "Invalid status" });
        }



        // ✅ Fetch or Create RiderStatus for today
        let riderStatus = await Parcel_User_Login_Status.findOne({ riderId: userId, date: today });

        if (!riderStatus) {
            riderStatus = new Parcel_User_Login_Status({
                riderId: userId,
                status,
                date: today,
                sessions: [],
            });
        }

        if (status === "online") {
            // ✅ Going online: Start a new session
            riderStatus.sessions.push({ onlineTime: new Date() });
        } else if (status === "offline") {
            // ✅ Going offline: Update last session
            const lastSession = riderStatus.sessions[riderStatus.sessions.length - 1];
            if (lastSession && !lastSession.offlineTime) {
                lastSession.offlineTime = new Date();
                lastSession.duration = Math.round(
                    (new Date(lastSession.offlineTime) - new Date(lastSession.onlineTime)) / 60000
                );
            }
        }
        riderStatus.status = status
        await riderStatus.save();
        return res.json({ message: "Status updated successfully", riderStatus });

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: "Internal Server Error" });
    }
};

exports.partner_work_status = async (req, res) => {
    try {
        const userId = req.user.userId;  // ✅ Get userId from request (from the token)
        const partner = await Parcel_Bike_Register.findOne({ _id: userId });
        const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format

        if (!partner) {
            return res.status(404).json({ message: 'Partner not found' });
        }

        // Fetch the status of the partner for today from the 'Parcel_User_Login_Status' collection
        const checkStatus = await Parcel_User_Login_Status.findOne({
            riderId: userId,
            date: today
        });

    
        if (!checkStatus) {
            return res.status(404).json({ message: 'No status found for today' });
        }

        // Get the last session from the status (Online/Offline sessions)
        const lastSession = checkStatus.sessions[checkStatus.sessions.length - 1];

        if (!lastSession) {
            return res.status(404).json({ message: 'No session data found' });
        }

        // Calculate the duration of online time if the partner is currently online
        const currentStatus = lastSession.offlineTime ? 'offline' : 'online';
        const onlineDuration = lastSession.offlineTime
            ? Math.round((new Date(lastSession.offlineTime) - new Date(lastSession.onlineTime)) / 60000) // In minutes
            : null;

        res.json({
            message: "Partner status fetched successfully",
            status: currentStatus,
            onlineDuration: onlineDuration, // If online, duration is null
            date: today,
            lastSession: lastSession
        });
    } catch (error) {
        console.error("Error in fetching partner status: ", error);
        res.status(500).json({ message: 'An error occurred while fetching partner status' });
    }
};


exports.getAllParcelUser = async (req, res) => {
    try {
        const allParcelUser = await Parcel_Bike_Register.find()
        if (!allParcelUser) {
            return res.status(400).json({
                success: false,
                message: 'No parcel user found',
            })
        }
        res.status(200).json({
            success: true,
            message: 'All parcel user fetched successfully',
            data: allParcelUser
        })
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        })
    }
}

exports.getSingleParcelUser = async (req, res) => {
    try {
        const { id } = req.params;
        const parcelUser = await Parcel_Bike_Register.findOne({ _id: id });
        if (!parcelUser) {
            return res.status(404).json({ success: false, message: "Parcel user not found" });
        }
        res.status(200).json({ success: true, message: "Parcel user fetched successfully", data: parcelUser });
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        })
    }
}

exports.updateParcelIsBlockStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { isBlockByAdmin } = req.body;
        const parcelUser = await Parcel_Bike_Register.findOne({ _id: id });
        if (!parcelUser) {
            return res.status(404).json({ success: false, message: "Parcel user not found" });
        }
        parcelUser.isBlockByAdmin = isBlockByAdmin;
        await parcelUser.save();
        res.status(200).json({ success: true, message: "Parcel user updated successfully" });
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        })
    }
}

exports.ParcelDocumentVerify = async (req, res) => {
    try {
        const { id } = req.params;
        const { DocumentVerify } = req.body;
        const parcelUser = await Parcel_Bike_Register.findOne({ _id: id });
        if (!parcelUser) {
            return res.status(404).json({ success: false, message: "Parcel user not found" });
        }
        parcelUser.DocumentVerify = DocumentVerify;
        await parcelUser.save();
        res.status(200).json({ success: true, message: "Parcel user updated successfully" });
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        })
    }
}

exports.updateParcelDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, phone, address, type, bikeDetails } = req.body;
        // console.log("data", req.body);

        const parcelUser = await Parcel_Bike_Register.findById(id);
        if (!parcelUser) {
            return res.status(404).json({ success: false, message: "Parcel user not found" });
        }

        // Update user fields
        if (name) parcelUser.name = name;
        if (phone) parcelUser.phone = phone;
        if (address) parcelUser.address = address;
        if (type) parcelUser.type = type;

        // Update bike details properly
        if (bikeDetails) {
            parcelUser.bikeDetails = {
                ...parcelUser.bikeDetails,
                ...bikeDetails
            };
        }

        // Handle file uploads
        if (req.files && req.files.length > 0) {
            const uploadedDocs = { ...parcelUser.documents };

            for (const file of req.files) {
                const uploadResponse = await cloudinary.uploader.upload(file.path, { folder: "parcel_documents" });
                // console.log("uploadResponse", uploadResponse);

                uploadedDocs[file.fieldname] = uploadResponse.secure_url;
                fs.unlinkSync(file.path); // Remove local file
            }

            parcelUser.documents = { ...parcelUser.documents, ...uploadedDocs };
            parcelUser.isDocumentUpload = true;

            // Ensure mongoose detects document changes
            parcelUser.markModified("documents");
        }

        await parcelUser.save();
        res.status(200).json({ success: true, message: "Parcel user updated successfully", data: parcelUser });
    } catch (error) {
        console.error("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};