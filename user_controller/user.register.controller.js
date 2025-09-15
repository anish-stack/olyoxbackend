const User = require("../models/normal_user/User.model");
const OrderSchema = require("../models/Tiifins/Restuarnt.Order.model");
const RideRequestSchema = require("../models/ride.request.model");
const HotelBookings = require("../models/Hotel.booking_request");
const ParcelBooks = require("../models/Parcel_Models/Parcel_Request");
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const SendWhatsAppMessage = require("../utils/whatsapp_send");
const { uploadSingleImage, deleteImage } = require("../utils/cloudinary");
const generateOtp = require("../utils/Otp.Genreator");
const SendWhatsAppMessageUser = require("../utils/forUserWhatsapp");
const NewRideModelModel = require("../src/New-Rides-Controller/NewRideModel.model");


exports.createUser = async (req, res) => {
    try {
        const { number, email, name, referral ,platform } = req.body;
        let otp = generateOtp(); // Default OTP
        const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000);

        // Predefined test number with fixed OTP
        if (number == 7217619794) {
            otp = 123456;
        }

        let user = await User.findOne({ number });

        if (user) {
            // Update existing user
            user.otp = otp;
            user.otpExpiresAt = otpExpiresAt;
            user.tryLogin = true;
            user.isOtpVerify = user.isOtpVerify || false;
            user.platform=platform || 'android'
            // Save applied referral code if provided
            if (referral && !user.appliedReferralCode) {
                user.appliedReferralCode = referral;
            }

            await user.save();

            const message = user.isOtpVerify
                ? `Hi there! Your OTP is: ${otp}. Please verify it.`
                : `Hi there!

Welcome to Olyox – your all-in-one app for rides, food delivery, heavy vehicles, hotels, and more!

Here’s your OTP: ${otp}

Please verify it to kickstart your Olyox journey. We’re thrilled to have you onboard!

If you have any questions, feel free to reach out.`;

            await SendWhatsAppMessageUser(message, number, otp);

            return res.status(200).json({
                message: "OTP sent successfully",
                status: 200,
            });
        }

        // Create new user
        const newUser = new User({
            number,
            email,
            name,
            otp,
            platform:platform || 'android',
            otpExpiresAt,
        });

        // Save applied referral code if provided
        if (referral) {
            newUser.appliedReferralCode = referral;
        }

        await newUser.save();

        const newUserMessage = `Hi there!

Welcome to Olyox – your all-in-one app for rides, food delivery, heavy vehicles, hotels, and more!

Here’s your OTP: ${otp}

Please verify it to kickstart your Olyox journey. We’re thrilled to have you onboard!

If you have any questions, feel free to reach out.`;

        await SendWhatsAppMessage(newUserMessage, number, otp);

        return res.status(201).json({
            message: "User created successfully. OTP sent.",
            user: newUser,
            status: 201,
        });
    } catch (error) {
        console.error("Error in createUser:", error);
        return res.status(500).json({
            message: "An error occurred",
            error: error.message,
            status: 500,
        });
    }
};



exports.verify_user = async (req, res) => {
    try {
        const { number, otp } = req.body;

        const user = await User.findOne({ number });
        if (!user) {
            return res.status(404).json({
                message: "Oops! We couldn't find a user with this number. Please check the number and try again.",
                status: 404,
            });
        }

        console.log("JWT_SECRET_KEY", "dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih")
        if (user.isOtpVerify) {
            if (user.tryLogin === true) {
                if (otp === user.otp) {
                    const token = jwt.sign(
                        { user },
                        'dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih',
                        { expiresIn: '30d' }
                    );
                    console.log("token login", token)
                    console.log("token user", user)
                    user.tryLogin = false;
                    user.otp = null;
                    user.otpExpiresAt = null;
                    await user.save();
                    return res.status(200).json({
                        status: 200,
                        token,
                        User: user,
                        tryLogin: user.tryLogin
                    });
                }

            }
        }

        if (!user.otpExpiresAt || new Date() > user.otpExpiresAt) {
            return res.status(400).json({
                message: "The OTP has expired. Please request a new OTP to continue.",
                status: 400,
            });
        }

        if (otp === user.otp) {
            const token = jwt.sign(
                { user },
                "dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih",
                { expiresIn: '30d' }
            );
            user.isOtpVerify = true;
            user.otp = null;
            user.otpExpiresAt = null;
            await user.save();

            return res.status(200).json({
                message: "Congratulations! Your OTP has been verified successfully. Welcome to Olyox, your ultimate companion for rides, food, and more.",
                status: 200,
                user: user,
                token
            });
        } else {
            return res.status(400).json({
                message: "The OTP you entered is incorrect. Please double-check and try again. If you're having trouble, request a new OTP.",
                status: 400,
            });
        }
    } catch (error) {
        console.error("Error verifying user:", error);
        return res.status(500).json({
            message: "Something went wrong on our end. Please try again later or contact support for assistance.",
            status: 500,
        });
    }
};

exports.addFcm = async (req, res) => {
    try {
        console.log("Request Body:", req.body); // Log the incoming request body for debugging

        const { fcm, id, platform } = req.body;

        // Find the user by ID
        const user = await User.findById(id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Check if FCM token is already present and needs to be updated
        if (user.fcmToken) {
            console.log(`FCM token already exists. Old Token: ${user.fcmToken}`);
            if (user.fcmToken !== fcm) {
                console.log(`Updating FCM token. New Token: ${fcm}`);
            } else {
                console.log("FCM token is already up to date.");
            }
        } else {
            console.log("FCM token does not exist, adding new one.");
        }

        // Update or add the new FCM token
        user.fcmToken = fcm;
        user.platform = platform
        await user.save();

        return res.status(200).json({ message: "FCM token added/updated successfully", user });
    } catch (error) {
        console.error("Error adding FCM token:", error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
};



exports.resendOtp = async (req, res) => {
    try {
        const { number } = req.body;

        // Check if the user exists
        const user = await User.findOne({ number });
        if (!user) {
            return res.status(404).json({
                message: "User not found. Please register first.",
                status: 404,
            });
        }

        // Set predefined OTP for specific number
        let otp = number == 7217619794
            ? "123456"
            : crypto.randomInt(100000, 999999).toString();

        const otpExpiresAt = new Date(Date.now() + 5 * 60 * 1000); // OTP valid for 5 minutes

        // Update the user's OTP and expiration time
        user.otp = otp;
        user.otpExpiresAt = otpExpiresAt;
        await user.save();

        // Send the OTP
        const message = `Hello User, 

Your new OTP for the Olyox app is ${otp}. This OTP is valid for 5 minutes. Please verify your OTP to access the amazing features of Olyox.

Thank you for choosing Olyox!`;

        await SendWhatsAppMessage(message, number);

        return res.status(200).json({
            message: "OTP resent successfully.",
            status: 200,
        });
    } catch (error) {
        console.error("Error in resendOtp:", error);
        return res.status(500).json({
            message: "An error occurred while resending the OTP.",
            error: error.message,
            status: 500,
        });
    }
};


exports.fine_me = async (req, res) => {
    try {
        // Check if userData is an array or an object
        const userData = Array.isArray(req.user.user) ? req.user.user[0] : req.user.user;

        // console.log("User found in:", req.user);

        // Validate that userData exists before proceeding
        if (!userData || !userData._id) {
            return res.status(400).json({
                message: "Invalid user data.",
                status: 400,
            });
        }

        // Fetch user from the database
        const user = await User.findById({ _id: userData._id }).populate('IntercityRide');
        if (!user) {
            return res.status(404).json({
                message: "User not found. Please register first.",
                status: 404,
            });
        }

        res.status(200).json({
            message: "User found successfully.",
            status: 200,
            user: user,
        });

    } catch (error) {
        console.error("Error finding user:", error.message);

        res.status(501).json({
            status: 501,
            error: error.message,
        });
    }
};



exports.login = async (req, res) => {
    try {
        const { email, isGoogle } = req.body;
        // console.log(email)
        // Find user by email
        const user = await User.find({ email: email[0]?.emailAddress });
        if (!user) {
            return res.status(404).json({
                message: "User not found. Please register first.",
                status: 404,
            });
        }
        // console.log(user)

        // Handle Google login
        if (isGoogle) {
            if (user.isGoogle === false) {
                return res.status(400).json({
                    message: "This account is not registered with Google. Please login using email or password.",
                    status: 400,
                });
            }

            const token = jwt.sign(
                { user },
                "dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih",
                { expiresIn: '30d' }
            );

            return res.status(200).json({
                message: "Logged in successfully with Google.",
                status: 200,
                user,
                token,
            });
        }

        // Standard email login
        const token = jwt.sign(
            { user },
            "dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih",
            { expiresIn: '30d' }
        );

        return res.status(200).json({
            message: "Logged in successfully.",
            status: 200,
            user,
            token,
        });
    } catch (error) {
        console.error("Error in login:", error);
        return res.status(500).json({
            message: "An error occurred during login.",
            error: error.message,
            status: 500,
        });
    }
};



exports.findAllOrders = async (req, res) => {
    try {
        const userData = Array.isArray(req.user.user) ? req.user.user[0] : req.user.user;
        if (!userData?._id) {
            return res.status(400).json({
                success: false,
                message: "User ID not found",
            });
        }

        // Fetch and sort all orders by latest (-1)
        const OrderFood = await OrderSchema.find({ user: userData._id })
            .populate({ path: "items.foodItem_id" })  // Correct way to populate nested field inside an array
            .sort({ createdAt: -1 });

        const RideData = await NewRideModelModel.find({ user: userData._id }).populate('driver').sort({ createdAt: -1 });
        const Parcel = await ParcelBooks.find({ customerId: userData._id }).sort({ createdAt: -1 });
        const Hotel = await HotelBookings.find({ guest_id: userData._id }).populate('HotelUserId').sort({ createdAt: -1 });

        // Count each type of order
        const orderCounts = {
            foodOrders: OrderFood.length,
            rideRequests: RideData.length,
            parcels: Parcel.length,
            hotelBookings: Hotel.length,
        };

        return res.status(200).json({
            success: true,
            message: "Orders fetched successfully",
            data: {
                orderCounts,
                OrderFood,
                RideData,
                Parcel,
                Hotel,
            },
        });

    } catch (error) {
        console.error("Error fetching orders:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
};


exports.getAllUser = async (req, res) => {
    try {
        const allUser = await User.find();
        if (!allUser) {
            return res.status(400).json({
                success: false,
                message: 'No user found',
            })
        }
        return res.status(200).json({
            success: true,
            message: 'All user fetched successfully',
            data: allUser
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
exports.updateProfileDetails = async (req, res) => {
    try {
        const file = req.file || {};
        const { name, email } = req.body || {};

        const userData = Array.isArray(req.user.user) ? req.user.user[0] : req.user.user;

        console.log("User Data:", userData);

        if (!userData?._id) {
            return res.status(400).json({
                success: false,
                message: "User ID not found",
            });
        }
        console.log(" req.file  Data:", req.file);
        console.log(" req.body  Data:", req.body);

        // Find the user in the database
        const user = await User.findById(userData?._id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found. Please register first.",
            });
        }

        // Update user details
        if (name) user.name = name;
        if (email) user.email = email;

        // Handle profile image update
        if (file && file.path) {
            try {
                const uploadImage = await uploadSingleImage(file.path, 'user-images');
                const { image, public_id } = uploadImage;
                console.log("uploadImage", uploadImage)
                if (user.profileImage.publicId && public_id !== user.profileImage.publicId) {
                    await deleteImage(user.profileImage.publicId);
                }

                user.profileImage = { publicId: public_id, image: image };
            } catch (uploadError) {
                return res.status(500).json({
                    success: false,
                    message: "Error uploading image",
                    error: uploadError.message,
                });
            }
        }

        // Save updated user details
        await user.save();

        return res.status(200).json({
            success: true,
            message: "Profile updated successfully",
            user,
        });

    } catch (error) {
        console.error("Error updating profile:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
};


exports.updateBlockStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { isBlock } = req.body;
        const user = await User.findById(id);
        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'User not found',
            })
        }
        user.isBlock = isBlock;
        await user.save();
        return res.status(200).json({
            success: true,
            message: 'User block status updated successfully',
            data: user
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

exports.deleteMyAccount = async (req, res) => {
    try {
        const { id } = req.params;

        const user = await User.findById(id);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'The requested user account was not found.',
            });
        }

        await User.findByIdAndDelete(id);

        return res.status(200).json({
            success: true,
            message: 'Your account has been successfully deleted. We’re sorry to see you go!',
            data: null
        });

    } catch (error) {
        console.error("Error deleting account:", error);
        return res.status(500).json({
            success: false,
            message: 'Something went wrong while deleting the account. Please try again later.',
            error: error.message
        });
    }
};



exports.logout = async (req, res) => {
    try {
        res.clearCookie("token");
        return res.status(200).json({ message: "Logout successful" });
    } catch (error) {
        console.error("Logout error:", error);
        return res.status(500).json({ message: "Internal Server Error" });
    }
};
