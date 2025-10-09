const mongoose = require('mongoose');
const IntercityRide = require('../../models/v3 models/IntercityRides');
const SendWhatsAppMessageNormal = require('../../utils/normalWhatsapp');
const User = require('../../models/normal_user/User.model');
const driver = require('../../models/Rider.model');
const cron = require('node-cron')

// ===== PASSENGER BOOKING FUNCTIONS =====

exports.bookIntercityRide = async (req, res) => {
    try {
        const {
            tripType,
            rideCategory,
            pickup,
            dropoff,
            vehicle,
            userName,
            passengerId,
            goingDateTime,
            returnDateTime,
            numberOfDays,
            distance,
            duration,
            pricing,
            coupon
        } = req.body;

        console.log('Booking intercity ride with data:', req.body);

        // Input validation
        if (!passengerId || !pickup || !dropoff || !vehicle || !goingDateTime || !pricing) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: passengerId, pickup, dropoff, vehicle, goingDateTime, and pricing are required'
            });
        }

        // Validate ObjectId format
        if (!mongoose.Types.ObjectId.isValid(passengerId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid passenger ID format'
            });
        }

        // Validate trip type
        if (!['one-way', 'round-trip'].includes(tripType)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid trip type. Must be either "one-way" or "round-trip"'
            });
        }

        // Validate ride category
        if (!['leave-now', 'scheduled'].includes(rideCategory)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ride category. Must be either "leave-now" or "scheduled"'
            });
        }

        // Date and time validation
        const now = new Date();
        const departureTime = new Date(goingDateTime);

        // Check if departure time is valid
        if (isNaN(departureTime.getTime())) {
            return res.status(400).json({
                success: false,
                message: 'Invalid departure date and time format'
            });
        }

        // For scheduled rides, ensure departure time is in the future
        if (rideCategory === 'scheduled') {
            const minimumAdvanceTime = new Date(now.getTime() + (30 * 60000)); // 30 minutes from now

            if (departureTime <= now) {
                return res.status(400).json({
                    success: false,
                    message: 'Scheduled ride departure time cannot be in the past'
                });
            }

            if (departureTime < minimumAdvanceTime) {
                return res.status(400).json({
                    success: false,
                    message: 'Scheduled rides must be booked at least 30 minutes in advance'
                });
            }

            // Check if departure time is too far in the future (e.g., 30 days)
            const maxAdvanceTime = new Date(now.getTime() + (30 * 24 * 60 * 60000)); // 30 days from now
            if (departureTime > maxAdvanceTime) {
                return res.status(400).json({
                    success: false,
                    message: 'Scheduled rides cannot be booked more than 30 days in advance'
                });
            }
        }

        // For leave-now rides, allow some flexibility but not past times
        if (rideCategory === 'leave-now') {
            const maxPastTime = new Date(now.getTime() - (15 * 60000)); // 15 minutes ago
            if (departureTime < maxPastTime) {
                return res.status(400).json({
                    success: false,
                    message: 'Departure time cannot be more than 15 minutes in the past'
                });
            }
        }

        // Validate return date for round trips
        let returnTime = null;
        if (tripType === 'round-trip') {
            if (!returnDateTime) {
                return res.status(400).json({
                    success: false,
                    message: 'Return date and time is required for round-trip bookings'
                });
            }

            returnTime = new Date(returnDateTime);

            if (isNaN(returnTime.getTime())) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid return date and time format'
                });
            }

            // Return time should be after departure time
            const minimumReturnTime = new Date(departureTime.getTime() + (60 * 60000)); // At least 1 hour after departure
            if (returnTime <= departureTime) {
                return res.status(400).json({
                    success: false,
                    message: 'Return time must be after departure time'
                });
            }

            if (returnTime < minimumReturnTime) {
                return res.status(400).json({
                    success: false,
                    message: 'Return time must be at least 1 hour after departure time'
                });
            }
        }

        // Validate coordinates
        if (!pickup.latitude || !pickup.longitude || !dropoff.latitude || !dropoff.longitude) {
            return res.status(400).json({
                success: false,
                message: 'Pickup and dropoff coordinates are required'
            });
        }

        if (Math.abs(pickup.latitude) > 90 || Math.abs(pickup.longitude) > 180 ||
            Math.abs(dropoff.latitude) > 90 || Math.abs(dropoff.longitude) > 180) {
            return res.status(400).json({
                success: false,
                message: 'Invalid coordinates provided'
            });
        }

        // Cross-validate distance using schema method
        const calculatedDistance = IntercityRide.calculateDistance(
            pickup.latitude, pickup.longitude,
            dropoff.latitude, dropoff.longitude
        );

        // Validate distance and duration
        if (!distance || distance <= 0 || !duration || duration <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid distance or duration values'
            });
        }

        // Log distance variance
        const distanceVariance = Math.abs(calculatedDistance - distance) / distance;
        if (distanceVariance > 0.1) {
            console.warn(`Distance variance detected: provided=${distance}km, calculated=${calculatedDistance.toFixed(2)}km`);
        }

        // Calculate estimated time using schema method
        const calculatedEstimateTime = IntercityRide.estimateTime(calculatedDistance);

        // Validate minimum intercity distance (e.g., at least 25 km)
        if (calculatedDistance < 25) {
            return res.status(400).json({
                success: false,
                message: 'Minimum distance for intercity rides is 25 km'
            });
        }

        // Validate pricing
        if (!pricing.basePrice || pricing.basePrice <= 0 || !pricing.finalPrice || pricing.finalPrice <= 0) {
            return res.status(400).json({
                success: false,
                message: 'Invalid pricing information'
            });
        }

        // Validate user exists
        const user = await User.findById(passengerId);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        if (!user.number) {
            return res.status(400).json({
                success: false,
                message: 'User mobile number is required for booking confirmation'
            });
        }

        // Check for duplicate booking
        const timeBuffer = 30 * 60000; // 30 minutes buffer
        const existingBooking = await IntercityRide.findOne({
            passengerId: passengerId,
            'route.origin.location.coordinates': [pickup.longitude, pickup.latitude],
            'route.destination.location.coordinates': [dropoff.longitude, dropoff.latitude],
            'vehicle.type': vehicle.name.toUpperCase(),
            'schedule.departureTime': {
                $gte: new Date(departureTime.getTime() - timeBuffer),
                $lte: new Date(departureTime.getTime() + timeBuffer)
            },
            status: { $in: ['scheduled', 'driver_assigned', 'ride_in_progress'] }
        });

        if (existingBooking) {
            return res.status(409).json({
                success: false,
                message: 'You already have a similar booking for this time slot. Please check your existing bookings.',
                existingBookingId: existingBooking._id.toString().slice(-8).toUpperCase()
            });
        }

        // Update username if provided
        if (userName && userName.trim() && user.name !== userName.trim()) {
            user.name = userName.trim();
            await user.save();
        }

        // Calculate arrival time
        const arrivalTime = new Date(departureTime.getTime() + (duration * 60000));

        // Validate vehicle type
 // Validate vehicle type
const validVehicleTypes = ['SEDAN', 'MINI', 'SUV', 'HATCHBACK', 'SUV/XL', 'XL'];

if (!vehicle.name) {
  return res.status(400).json({
    success: false,
    message: "Vehicle name is required.",
  });
}

// Trim whitespace and convert to uppercase
const vehicleName = vehicle.name.trim().toUpperCase();

if (!validVehicleTypes.includes(vehicleName)) {
  return res.status(400).json({
    success: false,
    message: `Invalid vehicle type. Must be one of: ${validVehicleTypes.join(', ')}`,
  });
}


        // Create ride object
        const newRide = new IntercityRide({
            passengerId,
            tripType,
            rideCategory,
            route: {
                origin: {
                    city: pickup.description.split(',').slice(-2).join(',').trim() || "Unknown City",
                    location: {
                        type: 'Point',
                        coordinates: [pickup.longitude, pickup.latitude]
                    },
                    address: pickup.description
                },
                destination: {
                    city: dropoff.description.split(',').slice(-2).join(',').trim() || "Unknown City",
                    location: {
                        type: 'Point',
                        coordinates: [dropoff.longitude, dropoff.latitude]
                    },
                    address: dropoff.description
                },
                distance: calculatedDistance, // Use calculated distance
                estimatedDuration: duration
            },
            schedule: {
                departureTime,
                arrivalTime,
                returnDateTime: tripType === "round-trip" ? returnTime : null,
                numberOfDays: numberOfDays || 1
            },
            pricing: {
                basePrice: pricing.basePrice,
                totalPrice: pricing.finalPrice,
                additionalCharges: pricing.additionalCharges || 0,
                currency: pricing.currency || 'INR'
            },
            vehicle: {
                type: vehicle.name.toUpperCase(),
                capacity: ["SEDAN", "MINI"].includes(vehicle.name.toUpperCase()) ? 4 : 6
            },
            coupon: coupon || null,
            status: 'scheduled'
        });

        // Add initial status to timeline
        newRide.statusTimeline.push({
            status: 'scheduled',
            timestamp: new Date(),
            notes: 'Ride booked successfully'
        });

        const savedRide = await newRide.save();

        // Generate OTP for ride verification
        await savedRide.generateOTP();
        console.log(`OTP generated for ride ${savedRide._id}: ${savedRide.otp.code}`);

        // Enhanced WhatsApp message
        const formatDateTime = (date) => {
            return new Intl.DateTimeFormat('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            }).format(date);
        };

        const formatTime = (date) => {
            return new Intl.DateTimeFormat('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            }).format(date);
        };

        const getPickupCity = (description) => {
            const parts = description.split(',');
            return parts.length >= 2 ? parts[parts.length - 2].trim() : 'your location';
        };

        const getDropoffCity = (description) => {
            const parts = description.split(',');
            return parts.length >= 2 ? parts[parts.length - 2].trim() : 'destination';
        };

        let message = `🎉 Hi ${user.name || 'Rider'}!\n\n`;
        message += `✅ Your intercity ${tripType} ride has been *confirmed*!\n\n`;

        message += `🚗 *Vehicle:* ${vehicle.name}\n`;
        message += `📍 *From:* ${getPickupCity(pickup.description)}\n`;
        message += `📍 *To:* ${getDropoffCity(dropoff.description)}\n`;
        message += `🛣️ *Distance:* ${calculatedDistance.toFixed(1)} km (~${Math.floor(calculatedEstimateTime / 60)}h ${calculatedEstimateTime % 60}m)\n\n`;

        message += `📅 *Departure:* ${formatDateTime(departureTime)}\n`;
        message += `🕐 *Est. Arrival:* ${formatTime(arrivalTime)}\n`;

        if (tripType === "round-trip" && returnTime) {
            message += `🔄 *Return:* ${formatDateTime(returnTime)}\n`;
        }

        message += `\n💰 *Total Fare:* ₹${pricing.finalPrice}\n`;

        if (coupon) {
            message += `🎫 *Coupon Applied:* ${coupon}\n`;
        }

        message += `\n📋 *Booking ID:* ${savedRide._id.toString().slice(-8).toUpperCase()}\n`;
        message += `🔐 *Ride OTP:* ${savedRide.otp.code}\n`;
        message += `⏰ *OTP Valid Until:* ${formatTime(savedRide.otp.expiresAt)}\n\n`;

        // Category-specific instructions
        if (rideCategory === 'leave-now') {
            message += `⏰ *Immediate Booking* - A driver will be assigned within *10 minutes*. Please be ready at your pickup point!\n\n`;
        } else if (rideCategory === 'scheduled') {
            const timeUntilDeparture = Math.round((departureTime - now) / (60 * 60000));
            if (timeUntilDeparture > 24) {
                message += `📅 *Scheduled Ride* - Driver details will be shared *24 hours* before departure.\n\n`;
            } else if (timeUntilDeparture > 2) {
                message += `📅 *Scheduled Ride* - Driver details will be shared *2 hours* before departure.\n\n`;
            } else {
                message += `📅 *Scheduled Ride* - Driver details will be shared *shortly*.\n\n`;
            }
        }

        message += `⚠️ *Important Reminders:*\n`;
        message += `• Be ready 5-10 minutes before pickup\n`;
        message += `• Share the OTP (${savedRide.otp.code}) with your driver\n`;
        message += `• Carry a valid ID for verification\n`;
        message += `• OTP expires in 10 minutes - new OTP will be generated if needed\n`;
        message += `• Contact support for any changes or issues\n\n`;

        message += `📞 For assistance: Contact Olyox Support\n`;
        message += `🙏 Thank you for choosing Olyox!\n\n`;
        message += `Safe travels! 🛣️✨`;


        if (user) {
            user.IntercityRide = newRide._id;
            await user.save();
            console.log("Passenger updated");
        }


        // Send WhatsApp notification
        await SendWhatsAppMessageNormal(message, user.number);

        return res.status(201).json({
            success: true,
            ride: savedRide,
            message: 'Ride booked successfully and user notified via WhatsApp.',
            bookingId: savedRide._id.toString().slice(-8).toUpperCase(),
            otp: savedRide.otp.code,
            otpExpiresAt: savedRide.otp.expiresAt,
            departureTime: formatDateTime(departureTime),
            estimatedArrival: formatTime(arrivalTime)
        });

    } catch (error) {
        console.error('Error booking intercity ride:', error);

        // Enhanced error handling
        let errorMessage = 'Something went wrong while booking the ride.';
        let statusCode = 500;

        if (error.name === 'ValidationError') {
            errorMessage = `Validation failed: ${Object.values(error.errors).map(err => err.message).join(', ')}`;
            statusCode = 400;
        } else if (error.name === 'CastError') {
            errorMessage = 'Invalid data format provided';
            statusCode = 400;
        } else if (error.code === 11000) {
            errorMessage = 'Duplicate booking detected. Please try again.';
            statusCode = 409;
        } else if (error.name === 'MongoNetworkError') {
            errorMessage = 'Database connection error. Please try again later.';
            statusCode = 503;
        } else if (error.message.includes('timeout')) {
            errorMessage = 'Request timeout. Please try again.';
            statusCode = 408;
        } else if (error.message.includes('WhatsApp')) {
            // If WhatsApp fails but ride is saved, still return success
            console.warn('WhatsApp notification failed:', error.message);
            errorMessage = 'Ride booked successfully but notification failed. You will receive updates shortly.';
            statusCode = 201;
        }

        return res.status(statusCode).json({
            success: statusCode === 201, // True only if it's a WhatsApp failure
            message: errorMessage,
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Get user's bookings
exports.getMyBookings = async (req, res) => {
    try {
        const { passengerId } = req.params;
        const { status, page = 1, limit = 10, upcoming = false } = req.query;

        // Validate passenger ID
        if (!mongoose.Types.ObjectId.isValid(passengerId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid passenger ID format'
            });
        }

        let query = { passengerId };

        // Filter by status if provided
        if (status) {
            query.status = status;
        }

        // Filter upcoming rides
        if (upcoming === 'true') {
            query['schedule.departureTime'] = { $gte: new Date() };
        }

        const skip = (page - 1) * limit;

        const bookings = await IntercityRide.find(query)
            .populate('driverId', 'name phone email rating vehicle')
            .sort({ 'schedule.departureTime': -1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const totalBookings = await IntercityRide.countDocuments(query);

        return res.status(200).json({
            success: true,
            bookings,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalBookings / limit),
                totalBookings,
                hasNext: skip + bookings.length < totalBookings,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('Error fetching user bookings:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch bookings',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


exports.cancelRide = async (req, res) => {
    try {
        const { rideId, cancelledBy, reason } = req.body;

        // Basic validation
        if (!rideId || !cancelledBy) {
            return res.status(400).json({
                success: false,
                message: "Ride ID and cancelledBy fields are required.",
            });
        }

        // Validate rideId format
        if (!mongoose.Types.ObjectId.isValid(rideId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride ID format.",
            });
        }

        // Fetch ride details
        const ride = await IntercityRide.findById(rideId)
            .populate("passengerId")
            .populate("driverId", "name phone");

        if (!ride) {
            return res.status(404).json({ success: false, message: "Ride not found." });
        }

        // Check cancellable statuses
        const cancellableStatuses = ["scheduled", "driver_assigned"];
        if (!cancellableStatuses.includes(ride.status)) {
            return res.status(400).json({
                success: false,
                message: `Ride cannot be cancelled while in status: ${ride.status}.`,
            });
        }

        // Update ride status
        ride.status = "cancelled";
        ride.cancellation = {
            by: cancelledBy, // "driver" or "user"
            reason: reason || "No reason provided",
            at: new Date(),
        };

        if (ride.passengerId) {
            ride.passengerId.IntercityRide = null
            await ride.passengerId.save()
        }
        await ride.save();

        // Prepare WhatsApp messages
        if (cancelledBy === "driver" && ride.passengerId?.phone) {
            const msg = `🚖 Hello ${ride.passengerId.name || "Passenger"},\n\nWe’re sorry! Your intercity ride has been cancelled by the driver.\n\n❌ Reason: ${reason || "No reason given"}\n\n👉 Please open the app to book another ride at your convenience.\n\nThank you for choosing us 🙏`;
            await SendWhatsAppMessageNormal(ride.passengerId.phone, msg);
        } else if (cancelledBy === "user" && ride.driverId?.phone) {
            const msg = `👋 Hello ${ride.driverId.name || "Driver"},\n\nThe passenger has cancelled the intercity ride.\n\n❌ Reason: ${reason || "No reason given"}\n\n👉 Please check your upcoming rides in the app.\n\nThanks for your support 🚖`;
            await SendWhatsAppMessageNormal(ride.driverId.phone, msg);
        }

        return res.status(200).json({
            success: true,
            message: "Ride has been cancelled successfully.",
            ride,
        });
    } catch (error) {
        console.error("Cancel ride error:", error);
        return res.status(500).json({
            success: false,
            message: "Something went wrong while cancelling the ride. Please try again later.",
            error: error.message,
        });
    }
};

// Get booking details by ID
exports.getBookingDetailsById = async (req, res) => {
    try {
        const { rideId } = req.params;
        const { passengerId } = req.query;

        // Validate ride ID
        if (!mongoose.Types.ObjectId.isValid(rideId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ride ID format'
            });
        }

        const ride = await IntercityRide.findById(rideId)
            .populate('passengerId')
            .populate('driverId');

        if (!ride) {
            return res.status(404).json({
                success: false,
                message: 'Ride not found'
            });
        }

        // If passengerId is provided, verify ownership
        if (passengerId && ride.passengerId._id.toString() !== passengerId) {
            return res.status(403).json({
                success: false,
                message: 'Unauthorized: You can only view your own bookings'
            });
        }

        return res.status(200).json({
            success: true,
            ride,
            canBeCancelled: ride.canBeCancelled(),
            bookingId: ride._id.toString().slice(-8).toUpperCase()
        });

    } catch (error) {
        console.error('Error fetching ride details:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch ride details',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


exports.getBookingDetails = async (req, res) => {
    try {
        const { rideId } = req.params;

        // Validate ride ID
        if (!mongoose.Types.ObjectId.isValid(rideId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ride ID format'
            });
        }

        const ride = await IntercityRide.findById(rideId)
            .populate('passengerId').populate('driverId')
        if (!ride) {
            return res.status(404).json({
                success: false,
                message: 'Ride not found'
            });
        }


        return res.status(200).json({
            success: true,
            data: ride
        });

    } catch (error) {
        console.error('Error fetching ride details:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch ride details',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Update ride status (Admin/Driver function)
exports.updateRideStatus = async (req, res) => {
    try {
        const { rideId } = req.params;
        const { status, notes, driverId } = req.body;

        // Validate ride ID
        if (!mongoose.Types.ObjectId.isValid(rideId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ride ID format'
            });
        }

        const validStatuses = ['scheduled', 'driver_assigned', 'ride_in_progress', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
            });
        }

        const ride = await IntercityRide.findById(rideId);
        if (!ride) {
            return res.status(404).json({
                success: false,
                message: 'Ride not found'
            });
        }

        // Assign driver if provided and status is driver_assigned
        if (status === 'driver_assigned' && driverId) {
            if (!mongoose.Types.ObjectId.isValid(driverId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid driver ID format'
                });
            }
            ride.driverId = driverId;
        }

        // Update status using schema method
        await ride.updateStatus(status, notes);

        // Send status update notification to passenger
        const user = await User.findById(ride.passengerId);
        if (user && user.number) {
            let statusMessage = '';
            const bookingId = ride._id.toString().slice(-8).toUpperCase();

            switch (status) {
                case 'driver_assigned':
                    const driver = await User.findById(driverId);
                    statusMessage = `🚗 Driver Assigned!\n\n`;
                    statusMessage += `Hi ${user.name},\n\n`;
                    statusMessage += `Your driver has been assigned for booking #${bookingId}\n\n`;
                    if (driver) {
                        statusMessage += `👨‍💼 *Driver:* ${driver.name}\n`;
                        statusMessage += `📞 *Contact:* ${driver.phone}\n`;
                    }
                    statusMessage += `🔐 *Your OTP:* ${ride.otp.code}\n\n`;
                    statusMessage += `The driver will contact you shortly. Safe travels! 🛣️`;
                    break;

                case 'ride_in_progress':
                    statusMessage = `🚗 Ride Started!\n\n`;
                    statusMessage += `Hi ${user.name},\n\n`;
                    statusMessage += `Your ride #${bookingId} has started. Have a safe journey! 🛣️✨`;
                    break;

                case 'completed':
                    statusMessage = `✅ Ride Completed!\n\n`;
                    statusMessage += `Hi ${user.name},\n\n`;
                    statusMessage += `Your ride #${bookingId} has been completed successfully.\n\n`;
                    statusMessage += `Thank you for choosing Olyox! Please rate your experience. 🌟`;
                    break;
            }

            if (statusMessage) {
                await SendWhatsAppMessageNormal(statusMessage, user.number);
            }
        }

        return res.status(200).json({
            success: true,
            message: 'Ride status updated successfully',
            ride: await IntercityRide.findById(rideId).populate('driverId passengerId')
        });

    } catch (error) {
        console.error('Error updating ride status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update ride status',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// ===== DRIVER FUNCTIONS =====

// Verify OTP (Driver function)
exports.verifyRideOTPIntercity = async (req, res) => {
    try {
        const { otp, driverId, rideId } = req.body;
        console.log("➡️ OTP Verification Request:", req.body);

        // Validate inputs
        if (!mongoose.Types.ObjectId.isValid(rideId)) {
            return res.status(400).json({ success: false, message: "Invalid ride ID format" });
        }
        if (!otp || otp.length !== 6) {
            return res.status(400).json({ success: false, message: "Valid 6-digit OTP is required" });
        }

        const ride = await IntercityRide.findById(rideId).populate("passengerId", "name number");
        if (!ride) {
            return res.status(404).json({ success: false, message: "Ride not found" });
        }

        // Verify driver is assigned
        if (driverId && ride.driverId?._id && ride.driverId?._id.toString() !== driverId?._id) {
            return res.status(403).json({ success: false, message: "Unauthorized: You are not assigned to this ride" });
        }

        // OTP validation (🚫 no expiry check, only code + used check)
        const alreadyUsed = ride.otp?.verifiedAt;

        if (ride.otp?.code !== otp || alreadyUsed) {
            return res.status(400).json({ success: false, message: "Invalid or already used OTP" });
        }

        // ✅ Update ride
        const now = new Date();
        ride.otp.verifiedAt = now;
        ride.status = "otp_verify";
        await ride.save();

        // Notify passenger (safe block)
        if (ride.passengerId && ride.passengerId.number) {
            try {
                const startMessage = `🚗 Ride Started!\n\nHi ${ride.passengerId.name},\n\nYour ride has started. Have a safe journey! 🛣️✨`;
                console.log("📤 Sending ride start WhatsApp to:", ride.passengerId.number);
                await SendWhatsAppMessageNormal(startMessage, ride.passengerId.number);
                console.log("✅ WhatsApp sent");
            } catch (msgErr) {
                console.error("❌ Failed to send WhatsApp notification:", msgErr.message || msgErr);
            }
        }

        return res.status(200).json({
            success: true,
            message: "OTP verified successfully. Ride started!",
            ride,
            otpVerifiedAt: ride.otp.verifiedAt,
        });
    } catch (error) {
        console.error("❌ Error verifying OTP:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to verify OTP",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};

// Get assigned rides for driver
exports.getDriverRides = async (req, res) => {
    try {
        const { driverId } = req.params;
        const { status, date, page = 1, limit = 10 } = req.query;

        // Validate driver ID
        if (!mongoose.Types.ObjectId.isValid(driverId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid driver ID format'
            });
        }

        let query = { driverId };

        // Filter by status
        if (status) {
            query.status = status;
        }

        // Filter by specific date
        if (date) {
            const startOfDay = new Date(date);
            startOfDay.setHours(0, 0, 0, 0);
            const endOfDay = new Date(date);
            endOfDay.setHours(23, 59, 59, 999);

            query['schedule.departureTime'] = {
                $gte: startOfDay,
                $lte: endOfDay
            };
        }

        const skip = (page - 1) * limit;

        const rides = await IntercityRide.find(query)
            .populate('passengerId', 'name phone email')
            .sort({ 'schedule.departureTime': 1 })
            .skip(skip)
            .limit(parseInt(limit))
            .lean();

        const totalRides = await IntercityRide.countDocuments(query);

        return res.status(200).json({
            success: true,
            rides,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalRides / limit),
                totalRides,
                hasNext: skip + rides.length < totalRides,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('Error fetching driver rides:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch driver rides',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Complete ride (Driver function)
exports.completeRide = async (req, res) => {
    try {
        const { driverId, notes, rideId } = req.body;
        console.log("➡️ Complete Ride Request:", req.body);

        // ✅ Validate ride ID
        if (!mongoose.Types.ObjectId.isValid(rideId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride ID format",
            });
        }

        const ride = await IntercityRide.findById(rideId).populate(
            "passengerId"
        );

        if (!ride) {
            return res.status(404).json({
                success: false,
                message: "Ride not found",
            });
        }

        // ✅ Check if already completed
        if (ride.status === "completed") {
            return res.status(400).json({
                success: false,
                message: "Ride is already completed",
            });
        }

        // ✅ Verify driver assignment
        if (ride.driverId && ride.driverId.toString() !== driverId) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized: You are not assigned to this ride",
            });
        }

        // ✅ Ensure ride is in progress before completion
        if (ride.status !== "ride_in_progress") {
            return res.status(400).json({
                success: false,
                message: "Ride must be in progress to be completed",
            });
        }

        // ✅ Update ride status
        await ride.updateStatus("completed", notes || "Ride completed successfully");

        // 📩 Notify passenger
        if (ride.passengerId && ride.passengerId.number) {
            try {
                const bookingId = ride._id.toString().slice(-8).toUpperCase();
                const completionMessage =
                    `✅ *Ride Completed!*\n\n` +
                    `Hi ${ride.passengerId.name},\n\n` +
                    `Your intercity ride has been successfully completed.\n\n` +
                    `📋 *Booking ID:* ${bookingId}\n` +
                    `📍 *Route:* ${ride.route.origin.city} → ${ride.route.destination.city}\n\n` +
                    `⭐ Please rate your driver and complete the payment.\n\n` +
                    `🙏 Thank you for choosing *Olyox*! We hope to see you again soon.`;

                console.log("📤 Sending ride completion WhatsApp to:", ride.passengerId.number);
                await SendWhatsAppMessageNormal(completionMessage, ride.passengerId.number);
                console.log("✅ Ride completion notification sent");
            } catch (msgErr) {
                console.error("❌ Failed to send WhatsApp notification:", msgErr.message || msgErr);
            }
        }
        if (ride.passengerId) {
            await ride.passengerId.save()
        }

        return res.status(200).json({
            success: true,
            message: "Ride completed successfully",
            ride,
        });
    } catch (error) {
        console.error("❌ Error completing ride:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to complete ride",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};



exports.startRide = async (req, res) => {
    try {
        const { driverId, notes, rideId } = req.body;
        console.log("➡️ Start Ride Request:", req.body);

        // Validate ride ID
        if (!mongoose.Types.ObjectId.isValid(rideId)) {
            return res.status(400).json({
                success: false,
                message: "Invalid ride ID format",
            });
        }

        const ride = await IntercityRide.findById(rideId).populate("passengerId", "name number");
        if (!ride) {
            return res.status(404).json({
                success: false,
                message: "Ride not found",
            });
        }

        // Verify driver assignment
        if (ride.driverId && ride.driverId.toString() !== driverId) {
            return res.status(403).json({
                success: false,
                message: "Unauthorized: You are not assigned to this ride",
            });
        }

        // Check ride status
        if (ride.status !== "otp_verify") {
            return res.status(400).json({
                success: false,
                message: "Ride must be verified by OTP before starting",
            });
        }

        // ✅ Update ride status
        await ride.updateStatus("ride_in_progress", notes || "Ride started successfully");

        // 📩 Notify passenger
        if (ride.passengerId && ride.passengerId.number) {
            try {
                const bookingId = ride._id.toString().slice(-8).toUpperCase();
                const startMessage =
                    `🚖 *Your Intercity Ride Has Started!*\n\n` +
                    `👤 Passenger: *${ride.passengerId.name}*\n` +
                    `📋 Booking ID: *${bookingId}*\n` +
                    `📍 Route: *${ride.route.origin.city} → ${ride.route.destination.city}*\n\n` +
                    `🛣️ Sit back, relax, and enjoy your journey!\n\n` +
                    `🙏 Thank you for riding with *Olyox*!`;

                console.log("📤 Sending ride start WhatsApp to:", ride.passengerId.number);
                await SendWhatsAppMessageNormal(startMessage, ride.passengerId.number);
                console.log("✅ WhatsApp ride start notification sent");
            } catch (msgErr) {
                console.error("❌ WhatsApp notification failed:", msgErr.message || msgErr);
            }
        }

        return res.status(200).json({
            success: true,
            message: "Ride started successfully",
            ride,
        });
    } catch (error) {
        console.error("❌ Error starting ride:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to start ride",
            error: process.env.NODE_ENV === "development" ? error.message : undefined,
        });
    }
};


// Get available rides for drivers to accept
exports.getAvailableRides = async (req, res) => {
    try {
        const { riderId } = req.query;
        const now = new Date();

        const invalidStatusesAt = [
            'driver_assigned',
            'driver_reached',
            'otp_verify',
            'ride_in_progress',
            'completed',
            'cancelled',
            'delayed',
        ];

        // Fetch rides (include all statuses for now, filter manually later)
        const rides = await IntercityRide.find();

        if (!rides.length) {
            return res.status(404).json({ success: false, message: "No rides available" });
        }

        let matchedRides = [];

        for (const ride of rides) {
            const originLat = ride.route.origin.location.coordinates[1];
            const originLng = ride.route.origin.location.coordinates[0];
            const vehicleType = ride.vehicle.type;
            const rejectedByDrivers = ride.rejectedByDrivers || [];

            // ✅ Case 1: If this ride is already assigned to the same driver → always include
            if (ride.driverId && ride.driverId.toString() === riderId) {
                matchedRides.push(ride);
                continue; // skip further checks
            }

            // ✅ Case 2: If ride is in invalid status (not available for new drivers) → skip
            if (invalidStatusesAt.includes(ride.status)) {
                continue;
            }

            // Fetch drivers who turned on OlyoxIntercity
            const drivers = await driver.find({
                'preferences.OlyoxIntercity.enabled': true,
                _id: { $nin: rejectedByDrivers },
            });

            // After recharge check
            const driversAfterRecharge = drivers.filter(d => {
                const expireDate = d?.RechargeData?.expireData;
                return expireDate && new Date(expireDate) >= now;
            });

            // After distance & vehicle check
            let validDrivers = [];
            for (const d of driversAfterRecharge) {
                const driverLat = d.location?.coordinates[1];
                const driverLng = d.location?.coordinates[0];
                if (!driverLat || !driverLng) continue;

                const distance = calculateDistance(originLat, originLng, driverLat, driverLng);
                if (distance > 5) continue;

                // Vehicle matching
                const driverVehicle = d.rideVehicleInfo?.vehicleType;
                let vehicleOk = false;

                if (driverVehicle === vehicleType) {
                    vehicleOk = true;
                } else if (
                    vehicleType === 'SEDAN' &&
                    ['SUV', 'XL', 'SUV/XL', 'MINI'].includes(driverVehicle) &&
                    (d.preferences?.OlyoxAcceptSedanRides || d.preferences?.OlyoxIntercity)
                ) {
                    vehicleOk = true;
                } else if (
                    vehicleType === 'MINI' &&
                    ['SEDAN', 'SUV', 'XL', 'SUV/XL'].includes(driverVehicle) &&
                    (d.preferences?.OlyoxAcceptMiniRides || d.preferences?.OlyoxIntercity)
                ) {
                    vehicleOk = true;
                }

                if (!vehicleOk) continue;

                validDrivers.push(d);
            }

            // ✅ If riderId is in valid drivers → push this ride
            if (validDrivers.some(d => d._id.toString() === riderId)) {
                matchedRides.push(ride);
            }
        }

        if (!matchedRides.length) {
            return res.status(404).json({ success: false, message: "No valid rides for this rider" });
        }

        return res.status(200).json({
            success: true,
            rides: matchedRides
        });

    } catch (error) {
        console.error('Error in getAvailableRides:', error);
        res.status(500).json({ success: false, message: "Internal server error" });
    }
};



// Accept ride (Driver function)
exports.acceptRide = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { rideId } = req.params;
        const { driverId } = req.body;

        console.log("➡️ Accept Ride Request:", { rideId, driverId });

        // Validate IDs
        if (!mongoose.Types.ObjectId.isValid(rideId) || !mongoose.Types.ObjectId.isValid(driverId)) {
            console.warn("❌ Invalid IDs:", { rideId, driverId });
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'Invalid ride ID or driver ID format'
            });
        }

        console.log("🔍 Fetching ride:", rideId);
        const ride = await IntercityRide.findById(rideId)
            .populate('passengerId', 'name number')
            .session(session);

        if (!ride) {
            console.warn("❌ Ride not found:", rideId);
            await session.abortTransaction();
            session.endSession();
            return res.status(404).json({
                success: false,
                message: 'Ride not found'
            });
        }

        console.log("✅ Ride found:", ride._id, "Status:", ride.status);

        // Check if ride is still available
        if (ride.status !== 'scheduled' || ride.driverId) {
            console.warn("❌ Ride no longer available:", { status: ride.status, driverId: ride.driverId });
            await session.abortTransaction();
            session.endSession();
            return res.status(400).json({
                success: false,
                message: 'Ride is no longer available'
            });
        }

        // Assign driver and update status
        console.log("🚖 Assigning driver:", driverId);
        ride.driverId = driverId;
        ride.status = "driver_assigned"; // safer than custom updateStatus inside session

        if (ride.passengerId) {
            ride.passengerId.IntercityRide = ride._id
            await ride.passengerId.save()
            console.log("Passengenr updated")
        }
        await ride.save({ session });

        console.log("✅ Driver assigned successfully in transaction");

        // Get driver details
        const driverDetails = await driver.findById(driverId).session(session);
        console.log("👨‍💼 Driver details fetched:", driverDetails ? driverDetails.name : "Not found");

        // Commit transaction now, so ride assignment is guaranteed before notification
        await session.commitTransaction();
        session.endSession();
        console.log("🔒 Transaction committed successfully");

        // Send notification to passenger (outside transaction)
        if (ride.passengerId && ride.passengerId.number && driverDetails) {
            console.log("📲 Preparing WhatsApp message for passenger:", ride.passengerId.number);

            const formatDateTime = (date) => {
                return new Intl.DateTimeFormat('en-IN', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                }).format(date);
            };

            let assignmentMessage = `🚗 Driver Assigned!\n\n`;
            assignmentMessage += `Hi ${ride.passengerId.name},\n\n`;
            assignmentMessage += `Great news! A driver has been assigned for your intercity ride.\n\n`;
            assignmentMessage += `📋 *Booking ID:* ${ride._id.toString().slice(-8).toUpperCase()}\n`;
            assignmentMessage += `👨‍💼 *Driver:* ${driverDetails.name}\n`;
            assignmentMessage += `📞 *Driver Contact:* ${driverDetails.phone}\n`;
            assignmentMessage += `🚗 *Vehicle:* ${ride.vehicle.type}\n`;
            assignmentMessage += `📅 *Departure:* ${formatDateTime(ride.schedule.departureTime)}\n\n`;
            assignmentMessage += `🔐 *Your OTP:* ${ride.otp.code}\n`;
            assignmentMessage += `⚠️ Share this OTP with your driver to start the ride.\n\n`;
            assignmentMessage += `📞 The driver will contact you shortly.\n`;
            assignmentMessage += `🙏 Thank you for choosing Olyox!`;

            try {
                console.log("📤 Sending WhatsApp message...");
                await SendWhatsAppMessageNormal(assignmentMessage, ride.passengerId.number);
                console.log("✅ WhatsApp message sent successfully");
            } catch (msgErr) {
                console.error("❌ Failed to send WhatsApp message:", msgErr.message || msgErr);
            }
        } else {
            console.warn("⚠️ Skipping WhatsApp notification (missing passenger or driver details)");
        }

        return res.status(200).json({
            success: true,
            message: 'Ride accepted successfully',
            ride: ride
        });

    } catch (error) {
        console.error('❌ Error in acceptRide:', error);

        // Rollback transaction if error occurs
        await session.abortTransaction();
        session.endSession();

        return res.status(500).json({
            success: false,
            message: 'Failed to accept ride',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


exports.RejectRide = async (req, res) => {
    try {
        const { rideId } = req.params;
        const { driverId } = req.body;

        // ✅ Validate IDs
        if (!mongoose.Types.ObjectId.isValid(rideId) || !mongoose.Types.ObjectId.isValid(driverId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ride ID or driver ID format',
            });
        }

        // ✅ Find ride
        const ride = await IntercityRide.findById(rideId);
        if (!ride) {
            return res.status(404).json({
                success: false,
                message: 'Ride not found',
            });
        }


        // ✅ Prevent duplicate rejection
        if (!ride.rejectedByDrivers.includes(driverId)) {
            ride.rejectedByDrivers.push(driverId);
            await ride.save();
        }

        return res.status(200).json({
            success: true,
            message: 'Ride rejected successfully',
            ride,
        });
    } catch (error) {
        console.error('Error rejecting ride:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to reject ride',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined,
        });
    }
};


// ===== ADMIN/GENERAL FUNCTIONS =====

exports.IntercityRideAll = async (req, res) => {
  const startTime = Date.now(); // Start time tracking
  console.log("Start time", startTime);
  try {
    const {
      originCity,
      destinationCity,
      departureDate,
      status,
      passengerId,
      driverId,
      searchTerm, // Add searchTerm to query parameters
      page = 1,
      limit = 10
    } = req.query;

    let query = {};

    // Optimized filtering
    if (originCity) {
      query['route.origin.city'] = { $regex: new RegExp(`^${originCity}`, 'i') }; // Prefix regex for index usage
    }

    if (destinationCity) {
      query['route.destination.city'] = { $regex: new RegExp(`^${destinationCity}`, 'i') };
    }

    if (departureDate) {
      const startOfDay = new Date(departureDate);
      startOfDay.setHours(0, 0, 0, 0);
      const endOfDay = new Date(departureDate);
      endOfDay.setHours(23, 59, 59, 999);

      query['schedule.departureTime'] = {
        $gte: startOfDay,
        $lte: endOfDay
      };
    }

    if (status) query.status = status;
    if (passengerId) query.passengerId = passengerId;
    if (driverId) query.driverId = driverId;

    // Add search term filtering
    if (searchTerm) {
      query.$or = [
        { 'passengerId.name': { $regex: new RegExp(searchTerm, 'i') } },
        { 'passengerId.number': { $regex: new RegExp(searchTerm, 'i') } },
        { rideId: { $regex: new RegExp(searchTerm, 'i') } },
        { 'route.origin.address': { $regex: new RegExp(searchTerm, 'i') } },
        { 'route.destination.address': { $regex: new RegExp(searchTerm, 'i') } }
      ];
    }

    const skip = (page - 1) * limit;

    // Run count + query in parallel to reduce response time
    const [rides, totalRides] = await Promise.all([
      IntercityRide.find(query)
        .populate('driverId', 'name phone email rating vehicle')
        .populate('passengerId', 'name number email createdAt platform')
        .select('-messageSendToDriver')
        .sort({ 'schedule.departureTime': -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      IntercityRide.countDocuments(query)
    ]);

    const endTime = Date.now(); // End time
    const executionTime = endTime - startTime; // ms

    return res.status(200).json({
      success: true,
      rides,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalRides / limit),
        totalRides,
        hasNext: skip + rides.length < totalRides,
        hasPrev: page > 1
      },
      executionTime: `${executionTime} ms` // ⏱ show time taken
    });
  } catch (error) {
    console.error('Error getting rides:', error);
    const endTime = Date.now();
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch rides',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
      executionTime: `${endTime - startTime} ms`
    });
  }
};


exports.paymentCollect = async (req, res) => {
    try {
        const { rideId } = req.body;

        if (!rideId) {
            return res.status(400).json({ success: false, message: "rideId is required" });
        }




        const ride = await IntercityRide.findById(rideId);
        if (!ride) {
            return res.status(404).json({ success: false, message: "Ride not found" });
        }


        ride.payment.status = "completed" || ride.payment.status;


        ride.payment.paidAt = new Date();


        await ride.save();

        return res.status(200).json({
            success: true,
            message: "Payment updated successfully",
            payment: ride.payment,
        });

    } catch (error) {
        console.error("Error in paymentCollect:", error);
        return res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};


// Get ride statistics
exports.getRideStats = async (req, res) => {
    try {
        const { startDate, endDate, passengerId, driverId } = req.query;

        let matchQuery = {};

        // Date range filter
        if (startDate || endDate) {
            matchQuery['schedule.departureTime'] = {};
            if (startDate) {
                matchQuery['schedule.departureTime'].$gte = new Date(startDate);
            }
            if (endDate) {
                matchQuery['schedule.departureTime'].$lte = new Date(endDate);
            }
        }

        // User-specific stats
        if (passengerId) {
            matchQuery.passengerId = new mongoose.Types.ObjectId(passengerId);
        }

        if (driverId) {
            matchQuery.driverId = new mongoose.Types.ObjectId(driverId);
        }

        const stats = await IntercityRide.aggregate([
            { $match: matchQuery },
            {
                $group: {
                    _id: null,
                    totalRides: { $sum: 1 },
                    completedRides: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] }
                    },
                    cancelledRides: {
                        $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] }
                    },
                    totalRevenue: {
                        $sum: { $cond: [{ $eq: ['$status', 'completed'] }, '$pricing.totalPrice', 0] }
                    },
                    totalDistance: { $sum: '$route.distance' },
                    avgRating: { $avg: '$rating.passenger' }
                }
            }
        ]);

        const result = stats[0] || {
            totalRides: 0,
            completedRides: 0,
            cancelledRides: 0,
            totalRevenue: 0,
            totalDistance: 0,
            avgRating: 0
        };

        // Calculate completion rate
        result.completionRate = result.totalRides > 0
            ? ((result.completedRides / result.totalRides) * 100).toFixed(2)
            : 0;

        return res.status(200).json({
            success: true,
            stats: result
        });

    } catch (error) {
        console.error('Error fetching ride stats:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch ride statistics',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

// Regenerate OTP (Emergency function)
exports.regenerateOTP = async (req, res) => {
    try {
        const { rideId } = req.params;
        const { requestedBy } = req.body; // 'passenger' or 'driver'

        // Validate ride ID
        if (!mongoose.Types.ObjectId.isValid(rideId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid ride ID format'
            });
        }

        const ride = await IntercityRide.findById(rideId).populate('passengerId', 'name phone');
        if (!ride) {
            return res.status(404).json({
                success: false,
                message: 'Ride not found'
            });
        }

        // Check if ride is eligible for OTP regeneration
        if (!['scheduled', 'driver_assigned'].includes(ride.status)) {
            return res.status(400).json({
                success: false,
                message: 'OTP can only be regenerated for scheduled or driver assigned rides'
            });
        }

        // Generate new OTP
        await ride.generateOTP();

        // Send new OTP to passenger
        if (ride.passengerId && ride.passengerId.phone) {
            const formatTime = (date) => {
                return new Intl.DateTimeFormat('en-IN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: true
                }).format(date);
            };

            let otpMessage = `🔐 New OTP Generated\n\n`;
            otpMessage += `Hi ${ride.passengerId.name},\n\n`;
            otpMessage += `A new OTP has been generated for your ride.\n\n`;
            otpMessage += `📋 *Booking ID:* ${ride._id.toString().slice(-8).toUpperCase()}\n`;
            otpMessage += `🔐 *New OTP:* ${ride.otp.code}\n`;
            otpMessage += `⏰ *Valid Until:* ${formatTime(ride.otp.expiresAt)}\n\n`;
            otpMessage += `⚠️ Share this OTP with your driver to start the ride.\n`;
            otpMessage += `🙏 Thank you for choosing Olyox!`;

            await SendWhatsAppMessageNormal(otpMessage, ride.passengerId.phone);
        }

        return res.status(200).json({
            success: true,
            message: 'New OTP generated successfully',
            otp: ride.otp.code,
            expiresAt: ride.otp.expiresAt
        });

    } catch (error) {
        console.error('Error regenerating OTP:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to regenerate OTP',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};


exports.getRidesForDriverByLocation = async (req, res) => {
    try {
        const { driverId, lat, lng } = req.body
        if (!driverId || !lat || !lng) {
            return res.status(404).json({
                success: false,
                message: "Please Refresh The app"
            })
        }

        const checkDriver = await driver.findById(driverId)

        if (!checkDriver) {

        }

        if (!checkDriver.preferences?.OlyoxIntercity) {
            return res.status(403).json({
                success: false,
                message: "Intercity Rides Not avaibale For You at This Time"

            })
        }



    } catch (error) {

    }
}



// Haversine formula to calculate distance in KM
function calculateDistance(lat1, lon1, lat2, lon2) {
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 6371; // Earth radius in KM
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

const invalidStatuses = [
    'driver_assigned',
    'driver_reached',
    'otp_verify',
    'ride_in_progress',
    'completed',
    'cancelled',
    'delayed',
];


exports.rateYourInterCity = async (req, res) => {
    try {
        const { reviewerId, rating, comment, rideId } = req.body;

        // ✅ Validate input
        if (!rideId || !reviewerId || !rating) {
            return res.status(400).json({
                success: false,
                message: "rideId, reviewerId and rating are required"
            });
        }

        if (typeof rating !== "number" || rating < 1 || rating > 5) {
            return res.status(400).json({
                success: false,
                message: "Rating must be a number between 1 and 5"
            });
        }
        const points = rating > 3 ? 5 : 2;

        // ✅ Find ride with driver populated
        const ride = await IntercityRide.findById(rideId).populate("driverId");
        if (!ride) {
            return res.status(404).json({ success: false, message: "Ride not found" });
        }

        // ✅ Allow rating only after payment completion
        if (!ride.payment || ride.payment.status !== "completed") {
            return res.status(400).json({
                success: false,
                message: "You can only rate after payment is completed"
            });
        }

        // ✅ Prevent duplicate reviews
        const alreadyReviewed = ride.reviews?.some(
            r => r.reviewerId.toString() === reviewerId.toString()
        );
        if (alreadyReviewed) {
            if (ride.passengerId) {
                await User.updateOne(
                    { _id: ride.passengerId },
                    { $set: { IntercityRide: null } }
                );
            }
            if (ride.driverId) {
                await driver.updateOne(
                    { _id: ride.driverId._id },
                    {
                        $inc: {
                            TotalRides: 1,
                            points: points,
                            IntercityRideComplete: 1
                        }
                    }
                );
            }
            return res.status(200).json({
                success: true,
                message: "You have already reviewed this ride"
            });
        }

        // ✅ Ensure reviews array exists
        if (!Array.isArray(ride.reviews)) {
            ride.reviews = [];
        }

        // ✅ Add new review
        ride.reviews.push({
            reviewerId,
            rating,
            comment: comment || "",
            createdAt: new Date(),
        });

        // ✅ Update passenger reference if needed
        if (ride.passengerId) {
            await User.updateOne(
                { _id: ride.passengerId },
                { $set: { IntercityRide: null } }
            );
        }

        if (ride.driverId) {
            await driver.updateOne(
                { _id: ride.driverId._id },
                {
                    $inc: {
                        TotalRides: 1,
                        points: points,
                        IntercityRideComplete: 1
                    }
                }
            );
        }


        // ✅ Save ride with new review
        await ride.save();

        res.status(200).json({
            success: true,
            message: "Review submitted successfully",
            ride,
        });
    } catch (error) {
        console.error("Error rating ride:", error);
        res.status(500).json({
            success: false,
            message: "Server error while submitting review",
            error: error.message,
        });
    }
};

cron.schedule("*/9 * * * *", async () => {
    try {
        const now = new Date();
        const invalidStatuses = [
            "driver_assigned",
            "driver_reached",
            "otp_verify",
            "ride_in_progress",
            "completed",
            "cancelled",
            "delayed",
        ];

        const rides = await IntercityRide.find({
            status: { $nin: invalidStatuses },
        });

        if (!rides.length) {
            // console.log("✅ No rides to cancel. All clean.");
            return;
        }

        for (const ride of rides) {
            // ✅ Origin safe check
            const origin = getLatLngSafe(ride.route?.origin);
            if (!origin) {
                console.log(`⚠️ Skipping ride ${ride._id} - Invalid origin coords`);
                continue;
            }

            const vehicleType = ride.vehicle?.type;
            const rejectedByDrivers = ride.rejectedByDrivers || [];
            const messageLog = ride.messageSendToDriver || [];

            // Eligible drivers
            const drivers = await driver
                .find({
                    "preferences.OlyoxIntercity.enabled": true,
                    _id: { $nin: rejectedByDrivers },
                })
                .select("-activityLog");

            // Active recharge filter
            const driversAfterRecharge = drivers.filter((d) => {
                const expireDate = d?.RechargeData?.expireData;
                return expireDate && new Date(expireDate) >= now;
            });

            let validDrivers = [];

            for (const d of driversAfterRecharge) {
                // ✅ Driver safe check
                const driver = getLatLngSafe(d);
                if (!driver) {
                    // console.log(`⚠️ Skipping driver ${d._id} - Invalid driver coords`);
                    continue;
                }

                // Distance filter
                const distance = calculateDistance(origin.lat, origin.lng, driver.lat, driver.lng);
                if (distance > 5) continue;

                // Vehicle compatibility check
                const driverVehicle = d.rideVehicleInfo?.vehicleType;
                let vehicleOk = false;

                if (driverVehicle === vehicleType) {
                    vehicleOk = true;
                } else if (
                    vehicleType === "SEDAN" &&
                    ["SUV", "XL", "SUV/XL", "MINI"].includes(driverVehicle) &&
                    (d.preferences?.OlyoxAcceptSedanRides || d.preferences?.OlyoxIntercity)
                ) {
                    vehicleOk = true;
                } else if (
                    vehicleType === "MINI" &&
                    ["SEDAN", "SUV", "XL", "SUV/XL"].includes(driverVehicle) &&
                    (d.preferences?.OlyoxAcceptMiniRides || d.preferences?.OlyoxIntercity)
                ) {
                    vehicleOk = true;
                }

                if (!vehicleOk) continue;

                // ✅ Duplicate message prevention
                const lastMessage = messageLog.find(
                    (m) => m.driver_id.toString() === d._id.toString()
                );
                if (lastMessage) {
                    const diffMinutes = (now - new Date(lastMessage.at_time)) / (1000 * 60);
                    if (diffMinutes < 5) {
                        console.log(
                            `⏳ Skipping message to ${d.name} (sent ${diffMinutes.toFixed(1)} min ago)`
                        );
                        continue;
                    }
                }

                // ✅ Prepare WhatsApp message
                const msg = `🚖 *New Intercity Ride Available* 🚖\n\n📍 *Pickup*: ${ride.route.origin.address}\n📍 *Drop*: ${ride.route.destination.address}\n\n📏 *Distance*: ${ride.route.distance} km\n💰 *Price*: ₹${ride.pricing.totalPrice}\n🕒 *Departure*: ${new Date(
                    ride.schedule.departureTime
                ).toLocaleString()}\n\n👉 Open *Olyox Driver App* for more details.\n*Please check the Reservation rides section to accept this ride.*`;

                try {
                    await SendWhatsAppMessageNormal(msg, d.phone);
                    // console.log(`✅ Message sent to ${d.name} (${d.phone})`);

                    // Log in ride.messageSendToDriver
                    ride.messageSendToDriver.push({
                        driver_id: d._id,
                        at_time: new Date(),
                    });

                    await ride.save();
                } catch (error) {
                    console.error(`❌ Failed to send message to ${d.name}`, error);
                }

                validDrivers.push(d);
            }

            if (validDrivers.length > 0) {
                // console.log(`🚀 Ride ${ride._id} matched with ${validDrivers.length} drivers`);
            }
        }
    } catch (error) {
        console.error("❌ Error in intercity ride cron:", error);
    }
});

// 🔧 Helper
function getLatLngSafe(obj) {
    const coords = obj?.location?.coordinates;
    if (!coords || coords.length < 2) return null;
    return { lat: coords[1], lng: coords[0] };
}


exports.getDriversForRide = async (req, res) => {
  try {
    const { rideId } = req.query;
    const now = new Date();

    console.log("🟢 getDriversForRide rideId:", rideId);

    if (!rideId || !mongoose.Types.ObjectId.isValid(rideId)) {
      return res.status(400).json({ success: false, message: "Invalid or missing rideId" });
    }

    // 1. Fetch ride
    const ride = await IntercityRide.findById(rideId);
    if (!ride) {
      return res.status(404).json({ success: false, message: "Ride not found" });
    }

    const originLat = ride.route.origin.location.coordinates[1];
    const originLng = ride.route.origin.location.coordinates[0];
    const vehicleType = ride.vehicle.type;
    const rejectedByDrivers = ride.rejectedByDrivers || [];

    console.log("📍 Ride Origin:", { originLat, originLng, vehicleType });

    // 2. Fetch drivers within 20km using aggregation
    let riders = await driver.aggregate([
      {
        $geoNear: {
          near: { type: "Point", coordinates: [originLng, originLat] },
          distanceField: "distance",
          maxDistance: 10000, // 20 km
          spherical: true,
        },
      },
      {
        $match: {
          _id: { $nin: rejectedByDrivers },
          "RechargeData.approveRecharge": true,
          "RechargeData.expireData": { $gte: now },
          "preferences.OlyoxIntercity.enabled": true,
        },
      },
      {
        $project: {
          _id: 1,
          name: 1,
          number: 1,
          rideVehicleInfo: 1,
          isAvailable: 1,
          location: 1,
          RechargeData: 1,
          distance: 1,
        },
      },
    ]);

    console.log(`🔹 Total drivers nearby: ${riders.length}`);

    // 3. Apply vehicle & preference logic
    const stats = {
      totalNearby: riders.length,
      actualMatch: 0,
      preferenceMatch: 0,
      excluded: 0,
      byVehicleType: {},
    };

    const eligibleDrivers = riders.filter((rider) => {
      const driverType = rider?.rideVehicleInfo?.vehicleType?.trim();
      const prefs = rider.preferences || {};

      let decision = false;
      let matchType = null;

      const vType = vehicleType?.toUpperCase();
      const dType = driverType?.toUpperCase();

      // Special case: Bike
      if (vType === "BIKE" && dType === "BIKE") {
        decision = true;
        matchType = "actualMatch";
      } else if (vType === "MINI") {
        decision = (
          dType === "MINI" ||
          (dType === "SEDAN" && prefs.OlyoxAcceptMiniRides?.enabled) ||
          ((dType === "SUV" || dType === "XL" || dType === "SUV/XL") &&
            prefs.OlyoxAcceptMiniRides?.enabled)
        );
        matchType = dType === "MINI" ? "actualMatch" : "preferenceMatch";
      } else if (vType === "SEDAN") {
        decision = (
          dType === "SEDAN" ||
          ((dType === "SUV" || dType === "XL" || dType === "SUV/XL") &&
            prefs.OlyoxAcceptSedanRides?.enabled)
        );
        matchType = dType === "SEDAN" ? "actualMatch" : "preferenceMatch";
      } else if (vType === "SUV" || vType === "SUV/XL" || vType === "XL") {
        decision = ["SUV", "XL", "SUV/XL", "SEDAN", "MINI"].includes(dType);
        matchType = "actualMatch";
      }

      // Update stats
      if (decision) {
        if (matchType === "actualMatch") stats.actualMatch++;
        else if (matchType === "preferenceMatch") stats.preferenceMatch++;
        stats.byVehicleType[dType] = (stats.byVehicleType[dType] || 0) + 1;
      } else {
        stats.excluded++;
        stats.byVehicleType[dType] = (stats.byVehicleType[dType] || 0) + 1;
      }

      return decision;
    });



    if (!eligibleDrivers.length) {
      return res.status(404).json({ success: false, message: "No eligible drivers found" });
    }

    return res.status(200).json({
      success: true,
      rideId: ride._id,
      stats,
      drivers: eligibleDrivers,
    });
  } catch (error) {
    console.error("🔥 Error in getDriversForRide:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};