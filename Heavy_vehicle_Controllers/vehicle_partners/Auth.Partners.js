const Heavy_vehicle_partners = require('../../models/Heavy_vehicle/Heavy_vehicle_partners');
const HeavyVehicleDocuments = require('../../models/Heavy_vehicle/Heavy_vehicle_documents');
const Vehicle = require('../../models/Heavy_vehicle/Vehicle_types.model');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const cron = require('node-cron');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const SendWhatsAppMessage = require('../../utils/whatsapp_send');
const axios = require('axios');
const SendWhatsAppMessageNormal = require('../../utils/normalWhatsapp');
const { checkBhAndDoRechargeOnApp } = require('../../PaymentWithWebDb/razarpay');
// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});


const generateOTP = () => {
    return Math.floor(100000 + Math.random() * 900000);
};


exports.create_heavy_vehicle_partner = async (req, res) => {
    try {
        const {
            Bh_Id,
            name,
            email,
            phone_number,
            vehicle_info = [],
            service_areas = [],
            call_timing

        } = req.body?.formData || req.body || {};
        console.log(req.body?.formData?.service_areas[0])
        let emptyFields = [];
        if (!Bh_Id) emptyFields.push('Bh Id');
        if (!name) emptyFields.push('name');
        if (!email) emptyFields.push('email');
        if (!phone_number) emptyFields.push('Phone Number');
        if (!call_timing) emptyFields.push('Call Timings');

        if (emptyFields.length > 0) {
            return res.status(400).json({
                success: false,
                message: `The following fields are required: ${emptyFields.join(', ')}`
            });
        }

        // Validate email format
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9]{2,}$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid email address!'
            });
        }

        // Validate phone number format
        const phoneRegex = /^[0-9]{10}$/;
        if (!phoneRegex.test(phone_number)) {
            return res.status(400).json({
                success: false,
                message: 'Please enter a valid 10-digit phone number!'
            });
        }

        // Check if partner already exists
        const existingPartner = await Heavy_vehicle_partners.findOne({
            $or: [
                { Bh_Id },
                { email },
                { phone_number }
            ]
        });

        if (existingPartner) {
            return res.status(400).json({
                success: false,
                message: 'Partner already exists with this Email, Phone Number, or Bh_Id.'
            });
        }

        // Validate vehicle IDs if provided
        if (vehicle_info && vehicle_info.length > 0) {
            for (const vehicleId of vehicle_info) {
                const validVehicle = await Vehicle.findById(vehicleId?.id);
                if (!validVehicle) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid Vehicle Type with ID: ${vehicleId?.id}.`
                    });
                }
            }
        }

        // Validate service areas if provided
        if (service_areas && service_areas.length > 0) {
            for (let area of service_areas) {
                if (!area.name || !area.location || !area.location.type || !area.location.coordinates) {
                    return res.status(400).json({
                        success: false,
                        message: 'Service areas must include place_name and location (type and coordinates).'
                    });
                }

                if (area.location.type !== 'Point' || area.location.coordinates.length !== 2) {
                    return res.status(400).json({
                        success: false,
                        message: 'Location must be a GeoJSON Point with 2 coordinates (longitude, latitude).'
                    });
                }
            }
        }

        // Validate call timing


        if (call_timing) {
            const parseTime = (timeString) => {
                const [time, modifier] = timeString.split(' ');
                let [hours, minutes] = time.split(':').map(Number);

                if (modifier === 'PM' && hours !== 12) {
                    hours += 12;
                }
                if (modifier === 'AM' && hours === 12) {
                    hours = 0;
                }

                return new Date(1970, 0, 1, hours, minutes, 0); // Using a fixed date
            };

            const startTime = parseTime(call_timing.start_time);
            const endTime = parseTime(call_timing.end_time);

            if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid time format for call timing.'
                });
            }

            if (startTime >= endTime) {
                return res.status(400).json({
                    success: false,
                    message: 'End time must be greater than start time.'
                });
            }
        }


        const otp = generateOTP();
        const otp_expires = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

        // Create new partner
        const newPartner = new Heavy_vehicle_partners({
            Bh_Id,
            name,
            email,
            phone_number,
            vehicle_info: vehicle_info.map((item) => item?.id),
            service_areas,
            call_timing,
            profile_image: `https://avatar.iran.liara.run/username?username=${name}`,
            otp,
            otp_expires
        });

        await newPartner.save();

        const message = `Hi there! 😊 Welcome to Olyox Heavy Vehicle Partner Portal! 🚛 Here’s your OTP: ${otp}. Please verify it to access your account and manage your heavy vehicle listings. If you have any questions or need assistance, feel free to reach out. Safe journeys and successful business ahead! 🚀`;

        await SendWhatsAppMessage(message, phone_number);


        return res.status(201).json({
            success: true,
            message: 'Heavy vehicle partner created successfully. OTP sent for verification.',
            data: {
                _id: newPartner._id,
                name: newPartner.name,
                email: newPartner.email,
                phone_number: newPartner.phone_number
            }
        });
    } catch (error) {
        console.error('Error creating heavy vehicle partner:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to create heavy vehicle partner',
            error: error.message
        });
    }
};


exports.verifyOTP = async (req, res) => {
    try {
        const { phone_number, otp, Bh_Id } = req.body;

        if (!otp) {
            return res.status(400).json({
                success: false,
                message: 'Phone number and OTP are required.'
            });
        }

        // Find partner by phone number
        let partner = await Heavy_vehicle_partners.findOne({ phone_number });


        if (!partner) {
            partner = await Heavy_vehicle_partners.findOne({ Bh_Id });

            if (!partner) {
                return res.status(404).json({
                    success: false,
                    message: 'Partner not found with this phone number or Bh_Id.'
                });
            }
        }


        // Check if OTP is valid
        if (partner.otp !== parseInt(otp)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP.'
            });
        }

        // Check if OTP is expired
        if (new Date() > partner.otp_expires) {
            return res.status(400).json({
                success: false,
                message: 'OTP has expired. Please request a new OTP.'
            });
        }

        // Clear OTP after successful verification
        partner.otp = undefined;
        partner.otp_expires = undefined;
        partner.status = "Active"


        // ✅ Try fetching recharge details
        try {
            const { success, payment_id, member_id } =
                await checkBhAndDoRechargeOnApp({ number: partner.phone_number });

            if (success && payment_id && member_id) {
                // ✅ Save recharge data
                partner.RechargeData = {
                    rechargePlan: member_id?.title,
                    expireData: payment_id?.end_date,
                    onHowManyEarning: member_id?.HowManyMoneyEarnThisPlan,
                    whichDateRecharge: payment_id?.createdAt,
                    approveRecharge: payment_id?.payment_approved,
                };
                partner.isPaid = true;
            }
        } catch (rechargeErr) {
            console.error("Recharge Fetch Failed:", rechargeErr.message);
            // Optional: proceed without saving RechargeData
        }

        await partner.save();


        const token = jwt.sign({ id: partner }, process.env.HEAVY_PARTNER_SECRET, {
            expiresIn: process.env.JWT_EXPIRES_TIME
        })
        const message = `✅ Your OTP for Olyox Heavy Vehicle Partner Portal has been verified successfully. Welcome to Olyox! 🚛 Your BH ID ${partner?.Bh_Id} and details are now active and ready to use. Happy partnering! 🎉`;

        await SendWhatsAppMessage(message, partner?.phone_number);

        return res.status(200).json({
            success: true,
            message: 'OTP verified successfully.',
            data: {
                _id: partner._id,
                name: partner.name
            },
            token: token
        });
    } catch (error) {
        console.error('Error verifying OTP:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to verify OTP',
            error: error.message
        });
    }
};


exports.resendOTP = async (req, res) => {
    try {
        const { phone_number, Bh_Id } = req.body;

        // if (!phone_number || !Bh_Id) {
        //     return res.status(400).json({
        //         success: false,
        //         message: 'Phone number is required.'
        //     });
        // }

        // Find partner by phone number
        let partner = await Heavy_vehicle_partners.findOne({ phone_number });

        if (!partner) {
            partner = await Heavy_vehicle_partners.findOne({ Bh_Id });
            if (!partner) {
                return res.status(404).json({
                    success: false,
                    message: 'Partner not found with this Bh Id.'
                });
            }

        }

        // Generate new OTP
        const otp = generateOTP();
        const otp_expires = new Date(Date.now() + 10 * 60 * 1000); // OTP valid for 10 minutes

        // Update partner with new OTP
        partner.otp = otp;
        partner.otp_expires = otp_expires;
        await partner.save();
        const message = `🔄 Olyox Heavy Vehicle Partner Portal OTP Resend: Your new OTP is ${otp}. Please verify it promptly to continue. 🚛 If you need assistance, feel free to reach out. Stay connected with Olyox! 🎉`;

        await SendWhatsAppMessage(message, partner?.phone_number);



        return res.status(200).json({
            success: true,
            message: 'OTP sent successfully.',

            dev_otp: otp
        });
    } catch (error) {
        console.error('Error resending OTP:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to resend OTP',
            error: error.message
        });
    }
};


exports.updateProfile = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid partner ID.'
            });
        }

        // Find partner
        const partner = await Heavy_vehicle_partners.findById(id);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found.'
            });
        }

        // Extract fields to update
        const {
            name,
            email,
            phone_number,
            vehicle_info,
            service_areas,
            call_timing,
            status,
            is_blocked,
            profile_shows_at_position,
            is_working
        } = req.body;

        const file = req.file

        const updateData = {};


        if (name) updateData.name = name;

        // Check for email uniqueness if being updated
        if (email && email !== partner.email) {
            const emailExists = await Heavy_vehicle_partners.findOne({
                email,
                _id: { $ne: id }
            });

            if (emailExists) {
                return res.status(400).json({
                    success: false,
                    message: 'Email is already in use by another partner.'
                });
            }

            // Validate email format
            const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9]{2,}$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter a valid email address!'
                });
            }

            updateData.email = email;
        }

        // Check for phone number uniqueness if being updated
        if (phone_number && phone_number !== partner.phone_number) {
            const phoneExists = await Heavy_vehicle_partners.findOne({
                phone_number,
                _id: { $ne: id }
            });

            if (phoneExists) {
                return res.status(400).json({
                    success: false,
                    message: 'Phone number is already in use by another partner.'
                });
            }

            // Validate phone number format
            const phoneRegex = /^[0-9]{10}$/;
            if (!phoneRegex.test(phone_number)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter a valid 10-digit phone number!'
                });
            }

            updateData.phone_number = phone_number;
        }

        // Handle other fields
        if (status) {
            if (!['Active', 'Inactive', 'Suspended'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Status must be one of: Active, Inactive, Suspended'
                });
            }
            updateData.status = status;
        }

        if (is_blocked !== undefined) updateData.is_blocked = is_blocked;
        if (is_working !== undefined) updateData.is_working = is_working;

        if (profile_shows_at_position) {
            if (profile_shows_at_position < 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Profile position must be greater than or equal to 1.'
                });
            }
            updateData.profile_shows_at_position = profile_shows_at_position;
        }

        if (vehicle_info && vehicle_info.length > 0) {
            for (const vehicleId of vehicle_info) {
                const validVehicle = await Vehicle.findById(vehicleId?._id);
                if (!validVehicle) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid Vehicle Type with ID: ${vehicleId?.id}.`
                    });
                }
            }
            updateData.vehicle_info = vehicle_info;
        }

        // Handle service areas update if provided
        if (service_areas && Array.isArray(service_areas)) {
            // Validate all service areas
            for (const area of service_areas) {
                if (!area.place_name || !area.location || !area.location.type || !area.location.coordinates) {
                    return res.status(400).json({
                        success: false,
                        message: 'Service areas must include place_name and location (type and coordinates).'
                    });
                }

                if (area.location.type !== 'Point' || area.location.coordinates.length !== 2) {
                    return res.status(400).json({
                        success: false,
                        message: 'Location must be a GeoJSON Point with 2 coordinates (longitude, latitude).'
                    });
                }
            }

            updateData.service_areas = service_areas;
        }

        // Handle call timing update if provided
        if (call_timing) {
            const parseTime = (timeString) => {
                const [time, modifier] = timeString.split(' ');
                let [hours, minutes] = time.split(':').map(Number);

                if (modifier === 'PM' && hours !== 12) {
                    hours += 12;
                }
                if (modifier === 'AM' && hours === 12) {
                    hours = 0;
                }

                return new Date(1970, 0, 1, hours, minutes, 0); // Using a fixed date
            };

            const startTime = parseTime(call_timing.start_time);
            const endTime = parseTime(call_timing.end_time);

            if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid time format for call timing.'
                });
            }

            if (startTime >= endTime) {
                return res.status(400).json({
                    success: false,
                    message: 'End time must be greater than start time.'
                });
            }
        }

        if (req.file) {
            const result = await cloudinary.uploader.upload(req.file.path, {
                folder: 'heavy_vehicle_partners/profile'
            });

            console.log(result)
            // Delete the local file after uploading
            fs.unlinkSync(req.file.path);

            updateData.profile_image = result.secure_url
        }

        // Upload the file to Cloudinary


        // Update partner profile
        const updatedPartner = await Heavy_vehicle_partners.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        );

        return res.status(200).json({
            success: true,
            message: 'Partner profile updated successfully',
            data: updatedPartner
        });
    } catch (error) {
        console.error('Error updating partner profile:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update partner profile',
            error: error.message
        });
    }
};

exports.updateHTVehicalByAdmin = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid partner ID.'
            });
        }

        // Find partner
        const partner = await Heavy_vehicle_partners.findById(id);

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found.'
            });
        }

        // Extract fields to update
        const {
            name,
            email,
            phone_number,
            call_timing,
            status,
            is_blocked,
            profile_shows_at_position,
            is_working
        } = req.body;

        // Create update object
        const updateData = {};

        // Update basic fields if provided
        if (name) updateData.name = name;

        // Check for email uniqueness if being updated
        if (email && email !== partner.email) {
            const emailExists = await Heavy_vehicle_partners.findOne({
                email,
                _id: { $ne: id }
            });

            if (emailExists) {
                return res.status(400).json({
                    success: false,
                    message: 'Email is already in use by another partner.'
                });
            }

            // Validate email format
            const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z0-9]{2,}$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter a valid email address!'
                });
            }

            updateData.email = email;
        }

        // Check for phone number uniqueness if being updated
        if (phone_number && phone_number !== partner.phone_number) {
            const phoneExists = await Heavy_vehicle_partners.findOne({
                phone_number,
                _id: { $ne: id }
            });

            if (phoneExists) {
                return res.status(400).json({
                    success: false,
                    message: 'Phone number is already in use by another partner.'
                });
            }

            // Validate phone number format
            const phoneRegex = /^[0-9]{10}$/;
            if (!phoneRegex.test(phone_number)) {
                return res.status(400).json({
                    success: false,
                    message: 'Please enter a valid 10-digit phone number!'
                });
            }

            updateData.phone_number = phone_number;
        }

        // Handle other fields
        if (status) {
            if (!['Active', 'Inactive', 'Suspended'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Status must be one of: Active, Inactive, Suspended'
                });
            }
            updateData.status = status;
        }

        if (is_blocked !== undefined) updateData.is_blocked = is_blocked;
        if (is_working !== undefined) updateData.is_working = is_working;

        if (profile_shows_at_position) {
            if (profile_shows_at_position < 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Profile position must be greater than or equal to 1.'
                });
            }
            updateData.profile_shows_at_position = profile_shows_at_position;
        }
        // Handle call timing update if provided
        if (call_timing) {
            const parseTime = (timeString) => {
                const [time, modifier] = timeString.split(' ');
                let [hours, minutes] = time.split(':').map(Number);

                if (modifier === 'PM' && hours !== 12) {
                    hours += 12;
                }
                if (modifier === 'AM' && hours === 12) {
                    hours = 0;
                }

                return new Date(1970, 0, 1, hours, minutes, 0); // Using a fixed date
            };

            const startTime = parseTime(call_timing.start_time);
            const endTime = parseTime(call_timing.end_time);

            if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid time format for call timing.'
                });
            }

            if (startTime >= endTime) {
                return res.status(400).json({
                    success: false,
                    message: 'End time must be greater than start time.'
                });
            }
        }


        // Update partner profile
        const updatedPartner = await Heavy_vehicle_partners.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        );

        return res.status(200).json({
            success: true,
            message: 'Partner profile updated successfully',
            data: updatedPartner
        });

    } catch (error) {
        console.log("Internal server error", error);
        res.status(500).json({
            success: false,
            message: "Internal Server Error",
            error: error.message
        })
    }
}

exports.updateServiceAreaOnly = async (req, res) => {
    try {
        const { id } = req.params;
        const { service_areas } = req.body;
        // console.log("service_areas", service_areas)

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid partner ID.'
            });
        }

        // Find the partner by ID
        const partner = await Heavy_vehicle_partners.findById(id);
        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found.'
            });
        }

        // Validate and update service areas if provided
        if (service_areas && Array.isArray(service_areas) && service_areas.length > 0) {
            for (let area of service_areas) {
                if (!area.name || !area.location || !area.location.type || !area.location.coordinates) {
                    return res.status(400).json({
                        success: false,
                        message: 'Each service area must include a name and a location object (type and coordinates).'
                    });
                }

                if (area.location.type !== 'Point' || area.location.coordinates.length !== 2) {
                    return res.status(400).json({
                        success: false,
                        message: 'Location must be a GeoJSON Point with 2 coordinates (longitude, latitude).'
                    });
                }
            }

            // Update or add service areas
            partner.service_areas = service_areas;
        }

        // Update profile image based on the name
        if (partner.name && !partner.profile_image) {
            partner.profile_image = `https://avatar.iran.liara.run/username?username=${name}`;
        }

        // Save the updated partner
        await partner.save();

        res.status(200).json({
            success: true,
            message: 'Partner service areas and profile image updated successfully.',
            data: partner
        });

    } catch (error) {
        console.error('Error updating service areas:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while updating service areas.',
            error: error.message
        });
    }
};



exports.uploadDocuments = async (req, res) => {
    try {
        const { id } = req.params;
        const { documentType } = req.body;


        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid vehicle partner ID.'
            });
        }

        if (!documentType) {
            return res.status(400).json({
                success: false,
                message: 'Document type is required.'
            });
        }

        const validDocumentTypes = [
            'Registration', 'Insurance', 'Permit',
            'Pollution Certificate', 'License', 'Aadhar'
        ];
        if (!validDocumentTypes.includes(documentType)) {
            return res.status(422).json({
                success: false,
                message: `Invalid document type. Must be one of: ${validDocumentTypes.join(', ')}`
            });
        }

        // Check if the vehicle partner exists
        const vehiclePartner = await Heavy_vehicle_partners.findById(id);
        if (!vehiclePartner) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle partner not found.'
            });
        }

        // Check if the file was uploaded
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Document file is required.'
            });
        }

        // Upload the file to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
            folder: 'heavy_vehicle_partners/documents'
        });

        // Delete the local file after uploading
        fs.unlinkSync(req.file.path);

        // Create a new document record
        const newDocument = new HeavyVehicleDocuments({
            vehicle_partner_Id: id,
            documentType,
            documentFile: result.secure_url,
            documentFile_public_id: result.public_id,
            document_status: 'Pending',
            uploadedAt: new Date()
        });

        // Save the new document and associate it with the vehicle partner
        await newDocument.save();
        vehiclePartner.documents.push(newDocument._id);
        await vehiclePartner.save();

        return res.status(201).json({
            success: true,
            message: 'Document uploaded successfully',
            data: newDocument
        });

    } catch (error) {
        console.error('Error uploading document:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to upload document',
            error: 'An unexpected error occurred while uploading the document.'
        });
    }
};



exports.getMyProfile = async (req, res) => {
    try {

        const partnerId = req.user.id;

        const partner = await Heavy_vehicle_partners.findById(partnerId)
            .populate('vehicle_info', 'name vehicleType isAvailable')
            .populate('documents');

        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner profile not found.'
            });
        }

        return res.status(200).json({
            success: true,
            data: partner
        });
    } catch (error) {
        console.error('Error fetching partner profile:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch partner profile',
            error: error.message
        });
    }
};


exports.getAllProfiles = async (req, res) => {
    try {
        const {
            status,
            is_blocked,
            is_working,
            search,
            vehicleType,
            sort,
            page = 1,
            limit = 10
        } = req.query;

        // Build filter object
        const filter = {};

        // Apply status filter if provided
        if (status) {
            if (!['Active', 'Inactive', 'Suspended'].includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid status value. Must be Active, Inactive, or Suspended.'
                });
            }
            filter.status = status;
        }

        // Apply blocked filter if provided
        if (is_blocked !== undefined) {
            filter.is_blocked = is_blocked === 'true';
        }

        // Apply working filter if provided
        if (is_working !== undefined) {
            filter.is_working = is_working === 'true';
        }

        // Apply search filter (on name, email, phone, or Bh_Id)
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { phone_number: { $regex: search, $options: 'i' } },
                { Bh_Id: { $regex: search, $options: 'i' } }
            ];
        }

        // Apply vehicle type filter if provided
        if (vehicleType && mongoose.Types.ObjectId.isValid(vehicleType)) {
            filter.vehicle_info = { $in: [vehicleType] };
        }

        // Set up pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const parsedLimit = parseInt(limit);

        // Set up sorting
        let sortOption = { createdAt: -1 }; // Default sort by creation date (newest first)
        if (sort) {
            switch (sort) {
                case 'name-asc':
                    sortOption = { name: 1 };
                    break;
                case 'name-desc':
                    sortOption = { name: -1 };
                    break;
                case 'position-asc':
                    sortOption = { profile_shows_at_position: 1 };
                    break;
                case 'position-desc':
                    sortOption = { profile_shows_at_position: -1 };
                    break;
                case 'oldest':
                    sortOption = { createdAt: 1 };
                    break;
                // Default is already set to newest
            }
        }

        // Get partners with pagination
        const partners = await Heavy_vehicle_partners.find(filter)
            .populate('vehicle_info', 'name vehicleType')
            .select('-otp -otp_expires') // Exclude sensitive fields
            .sort(sortOption)
            .skip(skip)
            .limit(parsedLimit);

        // Get total count for pagination
        const totalPartners = await Heavy_vehicle_partners.countDocuments(filter);

        return res.status(200).json({
            success: true,
            count: partners.length,
            totalPages: Math.ceil(totalPartners / parsedLimit),
            currentPage: parseInt(page),
            data: partners
        });
    } catch (error) {
        console.error('Error fetching partners:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch partners',
            error: error.message
        });
    }
};


exports.getPartnerById = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid partner ID.'
            });
        }

        const partner = await Heavy_vehicle_partners.findById(id)
            .populate('vehicle_info', 'name vehicleType isAvailable')
            .populate({
                path: 'documents',
                model: 'HeavyVehicleDocuments',
                select: 'documentType documentFile document_status reject_reason uploadedAt'
            });


        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found.'
            });
        }

        return res.status(200).json({
            success: true,
            data: partner
        });
    } catch (error) {
        console.error('Error fetching partner:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch partner',
            error: error.message
        });
    }
};

exports.delete_account = async (req, res) => {
    try {
        const { id } = req.params;

        // Validate the partner ID
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid partner ID.'
            });
        }

        // Find the partner by ID
        const partner = await Heavy_vehicle_partners.findById(id);
        if (!partner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found.'
            });
        }

        // Delete the partner
        const message = `🙏 Thank you for being a part of the Olyox Heavy Vehicle Partner Portal! 🚛 Your journey with us has been truly valued. If you ever wish to join again or need any assistance, feel free to reach out. Wishing you safe and successful ventures ahead! 🌟`;
        await SendWhatsAppMessage(message, partner?.phone_number);
        await partner.deleteOne();

        return res.status(200).json({
            success: true,
            message: 'Partner account deleted successfully.'
        });

    } catch (error) {
        console.error("Error in delete_account:", error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred while deleting the partner account.',
            error: error.message
        });
    }
};

exports.DocumentVerify = async (req, res) => {
    try {
        let { id } = req.params || {};
        const { reject_reason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid document ID format.',
            });
        }

        const checkPartner = await Heavy_vehicle_partners.findById(id);
        if (!checkPartner) {
            return res.status(404).json({
                success: false,
                message: 'Partner not found.',
            });
        }

        if (!checkPartner.documents || checkPartner.documents.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No documents uploaded for verification.',
            });
        }

        if (reject_reason) {
            for (const document of checkPartner.documents) {
                if (document.document_status === 'Pending') {
                    document.document_status = 'Rejected';
                    document.reject_reason = reject_reason;
                    await document.save();
                }
            }

            const rejectionMessage = `🚫 Olyox Heavy Vehicle Partner Portal:
  
  Your document has been rejected after careful review.  
  Reason: *${reject_reason}*  
  
  Please re-upload valid documents for further verification.  
  Feel free to contact support for any help.  
  — Team Olyox`;

            await SendWhatsAppMessage(rejectionMessage, checkPartner?.phone_number);

            return res.status(200).json({
                success: true,
                message: 'Documents rejected with the provided reason.',
            });
        }

        // Approval flow
        let approvedDocumentTypes = [];

        for (const document of checkPartner.documents) {
            if (document.document_status === 'Pending') {
                document.document_status = 'Approved';
                await document.save();
                approvedDocumentTypes.push(document.documentType || "Document");
            }
        }

        // Grant 1-month free membership
        const currentDate = new Date();
        const oneMonthLater = new Date();
        oneMonthLater.setMonth(currentDate.getMonth() + 1);

        checkPartner.isFreeMember = true;
        checkPartner.freeTierEndData = oneMonthLater;
        checkPartner.isPaid = true;
        checkPartner.RechargeData = {
            rechargePlan: 'Free Tier',
            expireData: oneMonthLater,
            onHowManyEarning: 40000,
            approveRecharge: true,
        };

        await checkPartner.save();

        const approvalMessage = `✅ Olyox Heavy Vehicle Partner Portal:
  
  Your document(s) [${approvedDocumentTypes.join(", ")}] have been successfully verified! 🚛  
  You’ve been granted *1 Month Free Tier Membership* as a verified partner.  
  
  📝 Plan: Free Tier  
  📆 Valid Until: ${checkPartner.RechargeData.expireData.toDateString()}  
  🔐 Recharge Status: Approved  
  
  Thank you for choosing Olyox! Let’s drive forward together. 💼  
  — Team Olyox`;

        await SendWhatsAppMessage(approvalMessage, checkPartner?.phone_number);

        return res.status(200).json({
            success: true,
            message: 'Documents verified and 1-month free membership granted.',
        });

    } catch (error) {
        console.error("Error in DocumentVerify:", error);
        return res.status(500).json({
            success: false,
            message: 'An error occurred during document verification.',
            error: error.message,
        });
    }
};



exports.login = async (req, res) => {
    try {
        const { Bh_Id, msgType } = req.body;
        console.log("Login request body:", req.body);

        if (!Bh_Id) {
            return res.status(400).json({
                success: false,
                message: "BHID is required to login",
                error: "Missing Bh_Id"
            });
        }


        let partner = await Heavy_vehicle_partners.findOne({ Bh_Id });

        // Step 2: Check external website (always do this)
        let websitePartner = null;
        try {
            const response = await axios.post("https://webapi.olyox.com/api/v1/getProviderDetailsByBhId", {
                BhId: Bh_Id
            });

            if (response.data?.success && response.data?.data) {
                websitePartner = response.data.data;
            }
        } catch (error) {
            console.error("Error checking provider on website:", error?.response?.data || error.message);
            return res.status(403).json({
                success: false,
                error: error?.response?.data.message
            })
        }

        // Step 3: Respond based on availability
        if (!partner && websitePartner) {
            return res.status(403).json({
                success: false,
                BhID: Bh_Id,
                information: {
                    name: websitePartner.name,
                    phone_number: websitePartner.number,
                    email: websitePartner.email
                },
                message: "You are registered on the website but need to complete your profile on the Vendor App!",
                redirect: "complete-profile"
            });
        }

        if (!partner && !websitePartner) {
            return res.status(404).json({
                success: false,
                message: "Profile not found on website or app. Please register first!",
            });
        }

        // Step 4: Generate and store OTP
        const otp = Math.floor(100000 + Math.random() * 900000);
        const otpExpiry = new Date(Date.now() + 2 * 60 * 1000).toISOString();

        partner.otp = otp;
        partner.otp_expires = otpExpiry;
        await partner.save();

        const message = `Your OTP for login As A Heavy Duty Partner is: ${otp}. It is valid for 2 minutes. Please do not share it.`;

        // Step 5: Send OTP
        if (msgType === 'text') {
            await SendWhatsAppMessage(message, partner.phone_number, otp, true);
        } else {
            await SendWhatsAppMessage(message, partner.phone_number);
        }

        return res.status(200).json({
            success: true,
            message: "OTP sent successfully to the registered phone number.",
        });

    } catch (error) {
        console.error("Error logging in Heavy Duty Partner:", error.message);
        return res.status(500).json({
            success: false,
            message: "An error occurred while logging in the Heavy Duty Partner.",
            error: error.message
        });
    }
};


exports.getAllHeavyVehicles = async (req, res) => {
    try {
        const allHeavy = await Heavy_vehicle_partners.find().populate('vehicle_info', 'name vehicleType isAvailable').populate('documents');
        if (!allHeavy) {
            return res.status(404).json({
                success: false,
                message: 'No heavy vehicles found.'
            });
        }
        return res.status(200).json({
            success: true,
            data: allHeavy
        })
    } catch (error) {
        console.log("Internal server error", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
}
exports.getAllHeavyVehicles = async (req, res) => {
    try {
        const allHeavy = await Heavy_vehicle_partners.find().populate('vehicle_info', 'name vehicleType isAvailable').populate('documents');
        if (!allHeavy) {
            return res.status(404).json({
                success: false,
                message: 'No heavy vehicles found.'
            });
        }
        return res.status(200).json({
            success: true,
            data: allHeavy
        })
    } catch (error) {
        console.log("Internal server error", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
}

exports.updateIsBlockedHeavyVehicle = async (req, res) => {
    try {
        const { id } = req.params;
        const { is_blocked } = req.body;
        const vehicle = await Heavy_vehicle_partners.findById(id);
        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found.'
            });
        }
        vehicle.is_blocked = is_blocked;
        await vehicle.save();
        return res.status(200).json({
            success: true,
            data: vehicle
        });
    } catch (error) {
        console.log("Internal server error", error)
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}
exports.verifyDocumentOfHeavyTransport = async (req, res) => {
    try {
        console.log("Received request to verify documents for heavy transport.");

        const { id } = req.params;
        const { isAlldocumentsVerified } = req.body;

        console.log(`Vehicle ID: ${id}`);
        console.log(`Documents verified status: ${isAlldocumentsVerified}`);

        const vehicle = await Heavy_vehicle_partners.findById(id);
        if (!vehicle) {
            console.log('Vehicle not found.');
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found.'
            });
        }

        console.log('Vehicle found:', vehicle);

        const currentDate = new Date();
        console.log('Current date:', currentDate);

        // Set 1 month later instead of 1 year
        const oneMonthLater = new Date();
        oneMonthLater.setMonth(currentDate.getMonth() + 1);
        console.log('One month later:', oneMonthLater);

        vehicle.isAlldocumentsVerified = isAlldocumentsVerified;
        vehicle.isFreeMember = true;
        vehicle.freeTierEndData = oneMonthLater;
        vehicle.isPaid = true;
        vehicle.RechargeData = {
            rechargePlan: 'Free Tier',
            expireData: oneMonthLater,
            onHowManyEarning: 40000,
            approveRecharge: true,
        };

        console.log('Vehicle updated with new recharge data:', vehicle);

        const approvedDocumentTypes = ['RC Book', 'Insurance', 'Permit'];
        console.log('Approved document types:', approvedDocumentTypes);

        const approvalMessage = `✅ Olyox Heavy Vehicle Partner Portal:

Your document(s) [${approvedDocumentTypes.join(", ")}] have been successfully verified! 🚛  
You’ve been granted *1 Month Free Tier Membership* as a verified partner.  

📝 Plan: Free Tier  
📆 Valid Until: ${vehicle.RechargeData.expireData.toDateString()}  
🔐 Recharge Status: Approved  

Thank you for choosing Olyox! Let’s drive forward together. 💼  
— Team Olyox`;

        console.log('Sending WhatsApp message:', approvalMessage);

        await SendWhatsAppMessageNormal(approvalMessage, vehicle?.phone_number);
        console.log('WhatsApp message sent successfully.');

        await vehicle.save();
        console.log('Vehicle data saved successfully.');

        return res.status(200).json({
            success: true,
            data: vehicle
        });

    } catch (error) {
        console.log("Internal server error:", error);
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};


exports.deleteHeavyVendor = async (req, res) => {
    try {
        const { id } = req.params;
        const vehicle = await Heavy_vehicle_partners.findByIdAndDelete(id);
        if (!vehicle) {
            return res.status(404).json({
                success: false,
                message: 'Vehicle not found.'
            });
        }
        return res.status(200).json({
            success: true,
            message: 'Heavy Transport Vendor deleted successfully.',
            data: vehicle
        });
    } catch (error) {
        console.log("Internal servere error", error)
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}



// Shuffle Position Of Partner At Every Night
// cron.schedule('0 0 * * *', async () => {
//     try {
//         const AllPartners = await Heavy_vehicle_partners.find()
//     } catch (error) {
//         console.error("Cron job failed:", error);
//     }
// });
