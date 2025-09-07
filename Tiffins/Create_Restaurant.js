const Restaurant = require('../models/Tiifins/Resturant_register.model');
const Restaurant_Listing = require('../models/Tiifins/Restaurant.listing.model');
const axios = require('axios');
const uploadFile = require('../utils/aws.uploader');
const { faker } = require('@faker-js/faker');
const { v4: uuidv4 } = require('uuid');
const sendToken = require('../utils/SendToken');
const SendWhatsAppMessage = require('../utils/whatsapp_send');
const bcrypt = require('bcrypt');
const RestaurantPackageModel = require('../models/Tiifins/Restaurant.package.model');
const { uploadSingleImage, deleteImage } = require('../utils/cloudinary');
const generateOtp = require('../utils/Otp.Genreator');
const { checkBhAndDoRechargeOnApp } = require('../PaymentWithWebDb/razarpay');
exports.register_restaurant = async (req, res) => {
    try {
        const {
            restaurant_BHID,
            restaurant_fssai,
            restaurant_category,
            opening_hours,
            restaurant_phone,
            restaurant_contact,
            address, // Use "address" consistently
            geo_location,
            restaurant_owner_name,
            restaurant_name
        } = req.body;
        console.log("req.body", req.body)

        // Validate required fields
        const requiredFields = {
            restaurant_BHID,
            restaurant_fssai,
            restaurant_category,
            opening_hours,
            restaurant_phone,
            address,
            restaurant_name,
        };

        const missingFields = Object.entries(requiredFields)
            .filter(([key, value]) => !value)
            .map(([key]) => key);

        if (missingFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Please fill all required fields. Missing: ${missingFields.join(", ")}.`
            });
        }


        // Process logo file if provided; otherwise, use a default avatar URL
        let logo;
        if (req.file) {
            // Assuming the file path is stored in req.file.path
            logo = req.file.path;
        } else {
            logo = `https://ui-avatars.com/api/?name=${encodeURIComponent(restaurant_name)}`;
        }

        // Validate restaurant_category
        const validCategories = ['Veg', 'Non-Veg', 'Veg-Non-Veg'];
        if (!validCategories.includes(restaurant_category)) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid restaurant category. Choose from 'Veg', 'Non-Veg', or 'Veg-Non-Veg'."
            });
        }

        // Check if the restaurant BHID is already registered
        const existingBh = await Restaurant.findOne({ restaurant_BHID });
        if (existingBh) {
            return res.status(400).json({
                success: false,
                message: "BH number already registered."
            });
        }

        // Check if the phone number is already registered
        let existingRestaurant = await Restaurant.findOne({ restaurant_phone });
        if (existingRestaurant) {
            // If OTP has not been verified yet, update OTP and resend it
            if (!existingRestaurant.isOtpVerify) {
                const otp = generateOtp();

                // Block if resend limit exceeded
                if ((existingRestaurant.howManyTimesHitResend || 0) >= 5) {
                    existingRestaurant.isOtpBlock = true;
                    existingRestaurant.isDocumentUpload = false;
                    existingRestaurant.otpUnblockAfterThisTime = new Date(Date.now() + 30 * 60000); // Block for 30 minutes
                    await existingRestaurant.save();

                    await SendWhatsAppMessage(
                        "Your account is blocked for 30 minutes.",
                        restaurant_phone
                    );
                    return res.status(400).json({
                        success: false,
                        message: "Your account is blocked for 30 minutes."
                    });
                }

                // Update OTP details and resend OTP
                existingRestaurant.otp = otp;
                existingRestaurant.howManyTimesHitResend = (existingRestaurant.howManyTimesHitResend || 0) + 1;
                existingRestaurant.isDocumentUpload = false;
                await existingRestaurant.save();

                await SendWhatsAppMessage(
                    `Your OTP for Tiffin registration is: ${otp}`,
                    restaurant_phone
                );
                return res.status(201).json({
                    success: true,
                    message: "Existing restaurant found. Please verify OTP."
                });
            }

            return res.status(400).json({
                success: false,
                message: "Phone number already registered."
            });
        }

        // For a new restaurant registration, generate an OTP if needed for verification
        const otp = generateOtp();

        // Create the new restaurant record
        const newRestaurant = new Restaurant({
            restaurant_BHID,
            restaurant_fssai,
            restaurant_category,
            openingHours: opening_hours,
            restaurant_phone,
            restaurant_address: address, // Use the address value from req.body
            geo_location, // Assuming geo_location is valid and provided correctly
            restaurant_owner_name,
            restaurant_name,
            restaurant_contact,
            logo,
            otp, // Store OTP for verification
            howManyTimesHitResend: 0, // Initialize the resend counter
            isOtpVerify: false,
            isDocumentUpload: false
        });

        // Save the new restaurant in the database
        const dataSave = await newRestaurant.save();
        console.log(dataSave)
        // Optionally, send the OTP to the restaurant phone
        await SendWhatsAppMessage(
            `Your OTP for Tiffin registration is: ${otp}`,
            restaurant_phone
        );

        return res.status(201).json({
            success: true,
            message: "Restaurant registered successfully.",
            data: newRestaurant
        });
    } catch (error) {
        console.error("Error registering restaurant:", error.message);
        return res.status(500).json({
            success: false,
            message: "An error occurred while registering the restaurant. Please try again later."
        });
    }
};


exports.updateResturant = async (req, res) => {
    try {
        // console.log("updateResturant",req.body)
        const { id } = req.params;
        const { restaurant_name, restaurant_phone, openingHours, restaurant_contact, restaurant_category, restaurant_fssai, priceForTwoPerson, minDeliveryTime, minPrice } = req.body;
        const resturant = await Restaurant.findById(id);
        if (!resturant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found"
            });
        }
        // Update restaurant document
        resturant.restaurant_name = restaurant_name;
        resturant.restaurant_phone = restaurant_phone;
        resturant.openingHours = openingHours;
        resturant.restaurant_contact = restaurant_contact;
        resturant.restaurant_category = restaurant_category;
        resturant.restaurant_fssai = restaurant_fssai;
        resturant.priceForTwoPerson = priceForTwoPerson;
        resturant.minDeliveryTime = minDeliveryTime;
        resturant.minPrice = minPrice;

        if (req.files) {
            const { restaurant_fssai_image, restaurant_pan_image, restaurant_adhar_front_image, restaurant_adhar_back_image } = req.files;
            if (restaurant_fssai_image) {
                if (resturant?.restaurant_fssai_image?.public_id) {
                    await deleteImage(resturant?.restaurant_fssai_image?.public_id);
                }
                const imgUrl = await uploadSingleImage(restaurant_fssai_image[0].buffer);
                const { image, public_id } = imgUrl;
                resturant.restaurant_fssai_image = { url: image, public_id };
            }
            if (restaurant_pan_image) {
                if (resturant?.restaurant_pan_image?.public_id) {
                    await deleteImage(resturant?.restaurant_pan_image?.public_id);
                }
                const imgUrl = await uploadSingleImage(restaurant_pan_image[0].buffer);
                const { image, public_id } = imgUrl;
                resturant.restaurant_pan_image = { url: image, public_id };
            }
            if (restaurant_adhar_front_image) {
                if (resturant?.restaurant_adhar_front_image?.public_id) {
                    await deleteImage(resturant?.restaurant_adhar_front_image?.public_id);
                }
                const imgUrl = await uploadSingleImage(restaurant_adhar_front_image[0].buffer);
                const { image, public_id } = imgUrl;
                resturant.restaurant_adhar_front_image = { url: image, public_id };
            }
            if (restaurant_adhar_back_image) {
                if (resturant?.restaurant_adhar_back_image?.public_id) {
                    await deleteImage(resturant?.restaurant_adhar_back_image?.public_id);
                }
                const imgUrl = await uploadSingleImage(restaurant_adhar_back_image[0].buffer);
                const { image, public_id } = imgUrl;
                resturant.restaurant_adhar_back_image = { url: image, public_id };
            }

        }


        if (req.files) {
            resturant.isDocumentUpload = true;
        }
        await resturant.save();
        return res.status(200).json({
            success: true,
            message: "Restaurant updated successfully"
        });
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}

exports.updateLogo = async (req, res) => {
    try {
        const { id } = req.params;
        const restaurant = await Restaurant.findById(id);

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found"
            });
        }

        if (req.file) {
            // Handle file upload and update the logo
            try {
                if (restaurant?.logo && restaurant?.logo?.public_id) {
                    // Delete old logo image if it exists
                    await deleteImage(restaurant.logo.public_id);
                }
                // Assuming you have a function to handle image upload
                const imgUrl = await uploadSingleImage(req.file.buffer);
                const { image, public_id } = imgUrl;

                restaurant.logo = { url: image, public_id };
            } catch (error) {
                console.error("Image upload failed:", error.message);
            }
        }

        await restaurant.save();
        return res.status(200).json({
            success: true,
            message: "Logo updated successfully",
            logo: restaurant.logo // Return the updated logo
        });

    } catch (error) {
        console.log("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};

exports.updateIsWorking = async (req, res) => {
    try {
        const { id } = req.params;
        const { isWorking } = req.body;

        // Find the restaurant by ID
        const restaurant = await Restaurant.findById(id);

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found. Please check the provided ID."
            });
        }

        // Check if documents are uploaded
        if (!restaurant.isDocumentUpload) {
            return res.status(400).json({
                success: false,
                message: "Your documents have not been uploaded. Please upload them to proceed."
            });
        }

        // Check if document verification is completed
        if (!restaurant.documentVerify) {
            return res.status(400).json({
                success: false,
                message: "Your documents are still being verified. Please wait for the verification to complete."
            });
        }

        let isPaid = false;

        try {
            // Check plan details from external API
            const response = await axios.post('https://webapi.olyox.com/api/v1/getProviderDetailsByBhId', {
                BhId: restaurant.restaurant_BHID
            });

            const data = response.data.data;

            if (data.plan_status && data.recharge > 0 && data) {
                if (data?.payment_id?.payment_approved) {
                    isPaid = true;
                } else {
                    return res.status(400).json({
                        success: false,
                        message: "Your payment is not approved. Please Wait for approval "
                    });
                }
                isPaid = data.plan_status;
            } else {
                return res.status(400).json({
                    success: false,
                    message: "Your account is not recharged. Please recharge first to go online."
                });
            }

        } catch (error) {
            console.error("Error while checking plan details:", error);
            return res.status(500).json({
                success: false,
                message: "Failed to verify your plan details. Please try again later."
            });
        }

        // Update isWorking status
        restaurant.isWorking = isWorking;
        await restaurant.save();

        return res.status(200).json({
            success: true,
            message: `Restaurant status updated successfully. Your restaurant is now ${isWorking ? "Online" : "Offline"}.`
        });

    } catch (error) {
        console.error("Internal server error:", error);
        return res.status(500).json({
            success: false,
            message: "Something went wrong. Please try again later.",
            error: error.message
        });
    }
};


exports.updateTiffinDocumentVerify = async (req, res) => {
    try {
        const { id } = req.params;
        const { documentVerify } = req.body;
        const restaurant = await Restaurant.findById(id);

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found"
            })
        }

        restaurant.documentVerify = documentVerify;
        await restaurant.save();
        return res.status(200).json({
            success: true,
            message: "Document Verification updated successfully"
        })
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}

exports.get_All_tiffin_id = async (req, res) => {
    try {
        const all_tiffin_id = await Restaurant.find();
        res.status(200).json({ success: true, data: all_tiffin_id });
    } catch (error) {
        console.error("Error getting all tiffin IDs:", error.message);
    }
}
exports.register_restaurant_fake = async (req, res) => {
    try {
        // Generate fake data using Faker.js
        const fakeData = {
            restaurant_BHID: uuidv4(),
            restaurant_fssai: faker.finance.creditCardNumber(),
            restaurant_category: 'Veg',
            openingHours: `${Math.floor(Math.random() * (11 - 6 + 1)) + 6} AM - ${Math.floor(Math.random() * (11 - 6 + 1)) + 6} PM`,
            restaurant_phone: faker.phone.number(),
            restaurant_address: {
                street: faker.location.streetAddress(),
                city: faker.location.city(),
                state: faker.location.state(),
                zip: faker.location.zipCode()
            },
            geo_location: null, // To be updated later
            restaurant_name: faker.company.name()
        };

        const {
            restaurant_BHID,
            restaurant_fssai,
            restaurant_category,
            openingHours,
            restaurant_phone,
            restaurant_address,
            geo_location,
            restaurant_name
        } = fakeData;

        let logo = `https://ui-avatars.com/api/?name=${encodeURIComponent(restaurant_name)}`;

        const validCategories = ['Veg', 'Non-Veg', 'Veg-Non-Veg'];
        if (!validCategories.includes(restaurant_category)) {
            return res.status(400).json({ success: false, message: "Invalid restaurant category. Choose from 'Veg', 'Non-Veg', or 'Veg-Non-Veg'." });
        }

        // Validate restaurant_fssai (14-digit numeric code)
        // const fssaiRegex = /^[0-9]{14}$/;
        // if (!fssaiRegex.test(restaurant_fssai)) {
        //     return res.status(400).json({ success: false, message: "Invalid FSSAI number. It must be a 14-digit numeric code." });
        // }

        // Validate restaurant_BHID with Olyox API
        // try {
        //     const { data } = await axios.post('https://webapi.olyox.com/api/v1/check-bh-id', {
        //         bh: restaurant_BHID
        //     });
        //     if (!data.data.success) {
        //         return res.status(403).json({
        //             success: false,
        //             message: "Invalid BH ID. Please register at Olyox.com before proceeding."
        //         });
        //     }
        // } catch (error) {
        //     console.error("Olyox API Error:", error.message);
        //     return res.status(500).json({
        //         success: false,
        //         message: "Failed to validate BH ID. Please try again later."
        //     });
        // }

        // Geo-location handling
        let updatedGeoLocation = geo_location;
        if (!geo_location || !geo_location.coordinates) {
            try {
                const address = `${restaurant_address.street}, ${restaurant_address.city}, ${restaurant_address.state}, ${restaurant_address.zip}`;
                const mapsApiKey = process.env.GOOGLE_MAP_KEY;
                const mapsApiUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${mapsApiKey}`;

                const { data } = await axios.get(mapsApiUrl);

                if (data.status === "OK" && data.results.length > 0) {
                    const location = data.results[0].geometry.location;
                    updatedGeoLocation = {
                        type: "Point",
                        coordinates: [location.lng, location.lat]
                    };
                } else {
                    console.warn("Google Maps API Warning: Unable to determine geo-location for the provided address.");

                    updatedGeoLocation = {
                        type: "Point",
                        coordinates: [0.0, 0.0]
                    };
                }
            } catch (error) {
                console.error("Google Maps API Error:", error.message);

                updatedGeoLocation = {
                    type: "Point",
                    coordinates: [0.0, 0.0]
                };
            }
        }

        // Try to upload image
        try {
            const mimeType = 'image/png';
            const buffer = Buffer.from(logo, 'base64');
            const bucket_name = 'my-image-bucketapphotel';
            const key = `logos/${restaurant_BHID}.png`;

            const data = await uploadFile.uploadBufferImage(buffer, mimeType, bucket_name, key);
            console.log("Uploaded image data:", data);
        } catch (error) {
            console.error("Image Upload Error:", error.message);
        }

        // Create a new restaurant document
        const newRestaurant = new Restaurant({
            restaurant_BHID,
            restaurant_fssai,
            restaurant_category,
            openingHours,
            restaurant_phone,
            restaurant_address,
            geo_location: updatedGeoLocation,
            restaurant_name
        });

        // Save to database
        await newRestaurant.save();

        return res.status(201).json({
            success: true,
            message: "Restaurant registered successfully with fake data.",
            data: newRestaurant
        });

    } catch (error) {
        console.error("Error registering restaurant:", error.message);
        return res.status(500).json({
            success: false,
            message: "An error occurred while registering the restaurant. Please try again later."
        });
    }
};


exports.add_food_listing = async (req, res) => {
    try {
        // const restaurant_id = req.user.id
        // console.log("req", req.body)

        const { food_name, description, food_price, food_category, food_availability, what_includes, imageUrl, restaurant_id } = req.body;
        const emptyField = [];
        if (!food_name) emptyField.push('Food Name')
        if (!description) emptyField.push('Description')
        if (!food_price) emptyField.push('Food Price')
        if (!food_category) emptyField.push('Food Category')
        if (!food_availability) emptyField.push('Food Availability')
        if (!what_includes) emptyField.push('What includes')
        if (!restaurant_id) emptyField.push('resturant id')
        if (emptyField.length > 0) {
            return res.status(400).json({
                success: false,
                message: `Please fill in the following field(s): ${emptyField.join(", ")}`
            });
        }

        // Construct the food listing object
        const newFoodListing = {
            restaurant_id,
            food_name: food_name,
            description: description,
            food_price: food_price,
            food_category: food_category,
            food_availability: food_availability,
            what_includes: what_includes,
        };

        if (req.file) {
            console.log("file upload", req.file);
            try {
                const imgUrl = await uploadSingleImage(req.file.buffer);
                console.log("imgurl", imgUrl);
                const { image, public_id } = imgUrl;
                newFoodListing.images = { url: image, public_id };
            } catch (error) {
                console.error("Image upload failed:", error.message);
            }
        }



        console.log("Food Listing to be Saved:", newFoodListing);
        await Restaurant_Listing.create(newFoodListing)

        return res.status(201).json({
            success: true,
            message: "Food listing added successfully.",
            data: newFoodListing,
        });
    } catch (error) {
        console.error("Error adding food listing:", error.message);
        return res.status(500).json({
            success: false,
            message: "An error occurred while adding the food listing.",
        });
    }
};

exports.update_available_status = async (req, res) => {
    try {
        const { id } = req.params;
        const { food_availability } = req.body;
        const updatedFoodListing = await Restaurant_Listing.findById(id);
        if (!updatedFoodListing) {
            return res.status(400).json({
                success: false,
                message: 'Food listing not found',
            })
        }
        updatedFoodListing.food_availability = food_availability;
        await updatedFoodListing.save();
        res.status(200).json({
            success: true,
            message: "Food listing updated successfully.",
            data: updatedFoodListing
        })
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            message: error.message
        })
    }
}

exports.get_all_listing = async (req, res) => {
    try {
        const listings = await Restaurant_Listing.find();
        if (!listings) {
            return res.status(400).json({
                success: false,
                message: 'No listing found',
                error: 'No listing found'
            })
        }
        return res.status(200).json({
            success: true,
            message: "Listings retrieved successfully.",
            data: listings
        });
    } catch (error) {
        console.log("Internal server error")
        res.status(500).json({
            success: false,
            message: 'Internal server error in creating custom tiffine',
            error: error.message
        })
    }
}

exports.delete_food_listing = async (req, res) => {
    try {
        const { id } = req.params;
        const listing = await Restaurant_Listing.findByIdAndDelete(id);
        if (!listing) {
            return res.status(404).json({
                success: false,
                message: "Listing not found",
                error: "Listing not found"
            })
        }
        return res.status(200).json({
            success: true,
            message: "Listing deleted successfully",
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

exports.login = async (req, res) => {
    try {
        const { restaurant_BHID, typeOfMessage } = req.body;

        if (!restaurant_BHID) {
            return res.status(400).json({
                success: false,
                message: "Restaurant BHID is required to login",
                error: "Missing restaurant_BHID"
            });
        }

        let restaurant = await Restaurant.findOne({ restaurant_BHID });

        // Check if restaurant exists
        if (!restaurant) {
            try {
                const response = await axios.post("https://webapi.olyox.com/api/v1/getProviderDetailsByBhId", {
                    BhId: restaurant_BHID
                });

                if (response.data?.success) {
                    return res.status(403).json({
                        success: false,
                        BhID: response.data.BH_ID,
                        message: "You are registered on the website but need to complete your profile on the Vendor App!",
                        redirect: "complete-profile"
                    });
                }
            } catch (error) {
                console.error("API Error:", error?.response?.data || error.message);
                return res.status(404).json({
                    success: false,
                    message: "Profile not found on website or app. Please register first!",
                });
            }
        }

        // Generate a 4-digit OTP
        const otp = Math.floor(1000 + Math.random() * 9000);
        const otpExpiry = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // Store in ISO format

        // Update restaurant with OTP
        restaurant.otp = otp;
        restaurant.otpExpiry = otpExpiry;
        await restaurant.save();

        // Send OTP via WhatsApp
        const message = `Your OTP for login is: ${otp}. It is valid for 2 minutes. Please do not share it.`;
        if (typeOfMessage === 'text') {
            await SendWhatsAppMessage(message, restaurant.restaurant_phone, otp, true);
        } else {
            await SendWhatsAppMessage(message, restaurant.restaurant_phone);

        }

        return res.status(200).json({
            success: true,
            message: "OTP sent successfully to the registered phone number.",
        });

    } catch (error) {
        console.error("Error logging in restaurant:", error.message);
        return res.status(500).json({
            success: false,
            message: "An error occurred while logging in the restaurant.",
            error: error.message
        });
    }
};
exports.resend_otp = async (req, res) => {
    try {
        const { restaurant_BHID, type = "login" } = req.body;

        if (!restaurant_BHID) {
            return res.status(400).json({
                success: false,
                message: "Restaurant BHID is required to resend OTP",
                error: "Restaurant BHID is required"
            });
        }

        const restaurant = await Restaurant.findOne({ restaurant_BHID });

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found",
                error: "Restaurant not found"
            });
        }

        // Check if OTP resend is blocked
        if (restaurant.isOtpBlock) {
            const currentTime = new Date();
            if (currentTime < restaurant.otpUnblockAfterThisTime) {
                const timeRemaining = Math.ceil((restaurant.otpUnblockAfterThisTime - currentTime) / 1000);
                return res.status(400).json({
                    success: false,
                    message: `OTP resend is blocked. Try again in ${timeRemaining} seconds.`
                });
            } else {
                // Unblock after the set time has passed
                restaurant.isOtpBlock = false;
                restaurant.howManyTimesHitResend = 0;
                restaurant.otpUnblockAfterThisTime = null;
                await restaurant.save();
            }
        }

        // Check if resend limit is reached
        if (restaurant.howManyTimesHitResend >= 5) {
            restaurant.isOtpBlock = true;
            restaurant.otpUnblockAfterThisTime = new Date(Date.now() + 30 * 60 * 1000); // Block for 30 minutes
            await restaurant.save();
            return res.status(400).json({
                success: false,
                message: "OTP resend limit reached. Please try again later."
            });
        }

        const otp = generateOtp()
        const otpExpiry = new Date(Date.now() + 2 * 60 * 1000);

        restaurant.otp = otp;
        restaurant.otpExpiry = otpExpiry;
        restaurant.howManyTimesHitResend = (restaurant.howManyTimesHitResend || 0) + 1;
        await restaurant.save();

        // Determine the context of the OTP (login vs. verification)
        const action = type === "verify" ? "verification" : "login";
        const message = `Your new OTP for ${action} is: ${otp}. It is valid for 2 minutes. Please do not share it.`;

        // Send the new OTP via WhatsApp
        await SendWhatsAppMessage(message, restaurant.restaurant_phone);

        return res.status(200).json({
            success: true,
            message: "New OTP sent successfully to registered phone number"
        });
    } catch (error) {
        console.error("Error resending OTP:", error.message);
        return res.status(500).json({
            success: false,
            message: "An error occurred while resending the OTP.",
            error: error.message
        });
    }
};


// Verify OTP
exports.verify_otp = async (req, res) => {
    try {
        const { otp, restaurant_BHID } = req.body;

        console.log("OTP Verification Requested For:", restaurant_BHID);

        // Step 1: Check required fields
        if (!otp || !restaurant_BHID) {
            console.log("Missing OTP or Restaurant BHID");
            return res.status(400).json({
                success: false,
                message: "OTP and Restaurant BHID are required",
                error: "OTP and Restaurant BHID are required"
            });
        }

        // Step 2: Find restaurant by BHID
        const restaurant = await Restaurant.findOne({ restaurant_BHID });
        if (!restaurant) {
            console.log("Restaurant not found for BHID:", restaurant_BHID);
            return res.status(404).json({
                success: false,
                message: "Restaurant not found",
                error: "Restaurant not found"
            });
        }

        // Step 3: Validate OTP match
        if (restaurant.otp !== otp) {
            console.log("Invalid OTP for restaurant:", restaurant_BHID);
            return res.status(400).json({
                success: false,
                message: "Invalid OTP",
                error: "Invalid OTP"
            });
        }

        // Step 4: Check OTP expiry
        if (new Date() > restaurant.otpExpiry) {
            console.log("OTP expired for restaurant:", restaurant_BHID);
            return res.status(400).json({
                success: false,
                message: "OTP has expired",
                error: "OTP has expired"
            });
        }

        console.log("OTP Validated Successfully");

        // Step 5: Clear OTP-related fields and verify
        restaurant.otp = null;
        restaurant.otpExpiry = null;
        restaurant.isOtpVerify = true;
        restaurant.howManyTimesHitResend = 0;
        restaurant.isOtpBlock = false;
        restaurant.otpUnblockAfterThisTime = null;

        // Step 6: Try fetching recharge info
        try {
            const { success, payment_id, member_id } =
                await checkBhAndDoRechargeOnApp({ number: restaurant.restaurant_phone });

            console.log("Recharge API Response:", { success, payment_id, member_id });

            if (success && payment_id && member_id) {
                restaurant.RechargeData = {
                    rechargePlan: member_id?.title,
                    expireData: payment_id?.end_date,
                    onHowManyEarning: member_id?.HowManyMoneyEarnThisPlan,
                    whichDateRecharge: payment_id?.createdAt,
                    approveRecharge: payment_id?.payment_approved,
                };
                restaurant.is_restaurant_in_has_valid_recharge = true;
                restaurant.isPaid = true;

                console.log("Recharge details saved in restaurant profile");
            } else {
                console.log("No valid recharge data found.");
            }

        } catch (rechargeErr) {
            console.error("Recharge Fetch Failed:", rechargeErr.message);
        }

        // Step 7: Save restaurant info
        await restaurant.save();
        console.log("Restaurant saved after OTP verification");

        // Step 8: Send token to client
        await sendToken(restaurant, res, 200);
        console.log("Token sent successfully");

    } catch (error) {
        console.error("Error verifying OTP:", error.message);
        return res.status(500).json({
            success: false,
            message: "An error occurred while verifying the OTP.",
            error: error.message
        });
    }
};


exports.passwordChange = async (req, res) => {
    try {
        const { id } = req.params;
        const { Password, newPassword } = req.body;

        // Find restaurant by ID
        const restaurant = await Restaurant.findById(id);
        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found",
            });
        }

        // Compare provided old password with stored hashed password
        const isMatch = await restaurant.comparePassword(Password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: "Incorrect old password",
            });
        }

        restaurant.Password = newPassword;

        await restaurant.save();

        return res.status(200).json({
            success: true,
            message: "Password changed successfully",
        });
    } catch (error) {
        console.error("Internal server error:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message,
        });
    }
};

exports.getSingleTiffinProfile = async (req, res) => {
    try {
        // console.log("Decoded JWT User:", req.user.id); // Debugging

        const user_id = req.user.id._id;
        // console.log("Extracted user_id:", user_id); // Debugging

        if (!user_id) {
            return res.status(400).json({
                success: false,
                message: "User ID missing in token",
            });
        }

        const tiffinProfile = await Restaurant.findById(user_id);
        // console.log("DB Query Result:", tiffinProfile); // Debugging

        if (!tiffinProfile) {
            return res.status(404).json({
                success: false,
                message: "Tiffin profile not found",
                error: "Tiffin profile not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Tiffin profile retrieved successfully.",
            data: tiffinProfile
        });

    } catch (error) {
        console.error("Error getting tiffin profile:", error.message);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};


exports.updateTiffinProfile = async (req, res) => {
    try {
        const { restaurant_BHID } = req.body;
        if (!restaurant_BHID) {
            return res.status(400).json({
                success: false,
                message: "Restaurant BHID is required to update tiffin profile",
                error: "Restaurant BHID is required to update tiffin profile"
            })
        }
        const restaurant = await Restaurant.findOne({ restaurant_BHID });
        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found",
                error: "Restaurant not found"
            })
        }
        const updatedTiffinProfile = await TiffinProfile.findOneAndUpdate({ restaurant_id: restaurant._id }, req.body, { new: true });
        if (!updatedTiffinProfile) {
            return res.status(404).json({
                success: false,
                message: "Tiffin profile not found",
                error: "Tiffin profile not found"
            })
        }
    } catch (error) {
        console.log("Error updating tiffin profile:", error.message);
    }
}

exports.getFoodListingById = async (req, res) => {
    try {
        const user_id = req.user.id._id;
        const allFood = await Restaurant_Listing.find({ restaurant_id: user_id });
        if (!allFood) {
            return res.status(404).json({
                success: false,
                message: "Food listing not found",
                error: "Food listing not found"
            })
        }
        res.status(200).json({
            success: true,
            message: "Food listing retrieved successfully.",
            data: allFood
        });
    } catch (error) {
        console.log("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}

exports.getCustomTiffinListingById = async (req, res) => {
    try {
        const user_id = req.user.id._id;
        const allFood = await RestaurantPackageModel.find({ restaurant_id: user_id });
        if (!allFood) {
            return res.status(404).json({
                success: false,
                message: "Food listing not found",
                error: "Food listing not found"
            })
        }
        res.status(200).json({
            success: true,
            message: "Food listing retrieved successfully.",
            data: allFood
        });
    } catch (error) {
        console.log("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}

exports.getAllPackageListing = async (req, res) => {
    try {
        const { id } = req.params;
        const allFood = await RestaurantPackageModel.find({ restaurant_id: id });
        if (!allFood) {
            return res.status(404).json({
                success: false,
                message: "Food listing not found",
                error: "Food listing not found"
            })
        }
        res.status(200).json({
            success: true,
            message: "Food listing retrieved successfully.",
            data: allFood
        });
    } catch (error) {
        console.log("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}

exports.getAllFoodListing = async (req, res) => {
    try {
        const { id } = req.params;
        const allFood = await Restaurant_Listing.find({ restaurant_id: id });
        if (!allFood) {
            return res.status(404).json({
                success: false,
                message: "Food listing not found",
                error: "Food listing not found"
            })
        }
        res.status(200).json({
            success: true,
            message: "Food listing retrieved successfully.",
            data: allFood
        });
    } catch (error) {
        console.log("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}