const Parcel_Request = require("../../models/Parcel_Models/Parcel_Request");
const Rider = require("../../models/Rider.model");

exports.notifyDriverService = async (data, req, res) => {
    try {
        // Validate input
        if (!data) {
            throw new Error("❌ Invalid request: missing parcel ID");
        }

        // Check if socket.io is initialized
        const io = req.app.get("socketio");
        if (!io) {
            throw new Error("❌ Socket.io is not initialized");
        }

        // Get socket maps
        const driverSocketMap = req.app.get("driverSocketMap") || new Map();
        const userSocketMap = req.app.get("userSocketMap") || new Map();

        // Find parcel request
        let parcelRequest;
        try {
            parcelRequest = await Parcel_Request.findById(data).populate('vehicle_id');
        } catch (error) {
            throw new Error(`❌ Invalid parcel ID format: ${error.message}`);
        }

        console.log("Parcel Request:", parcelRequest);

        if (!parcelRequest) {
            throw new Error("❌ Parcel Request not found");
        }

        // Validate pickup location
        const pickup = parcelRequest?.locations?.pickup;
        if (!pickup || !pickup.location) {
            throw new Error("❌ Pickup location not found in request");
        }

        const pickupCoordinates = pickup?.location?.coordinates;
        if (!Array.isArray(pickupCoordinates) || pickupCoordinates.length !== 2 ||
            !Number.isFinite(pickupCoordinates[0]) || !Number.isFinite(pickupCoordinates[1])) {
            throw new Error("❌ Invalid pickup coordinates");
        }

        // Configuration for driver search
        const searchRadii = [2000, 4000, 6000];
        const maxAttempts = 4;
        let attempt = 0;
        let riderNotified = false;
        let notifiedRider = null;
        let customerSocketId = null;

        // Get customer socket ID
        if (!parcelRequest.customerId) {
            throw new Error("❌ Customer ID not found in parcel request");
        }

        const customerId = parcelRequest.customerId.toString();
        if (userSocketMap instanceof Map) {
            customerSocketId = userSocketMap.get(customerId);
            if (!customerSocketId) {
                // Try to find partial match
                for (const [key, value] of userSocketMap.entries()) {
                    if (key.includes(customerId) || customerId.includes(key)) {
                        customerSocketId = value;
                        break;
                    }
                }
            }
        } else if (typeof userSocketMap === 'object') {
            customerSocketId = userSocketMap[customerId];
        }

        // Wait 4 seconds before starting the first attempt
        console.log("Waiting 4 seconds before starting rider search...");
        await new Promise(resolve => setTimeout(resolve, 4000));

        // Search for available drivers with increasing radius
        while (attempt < maxAttempts && !riderNotified) {
            // Ensure we have a valid radius even if attempt exceeds searchRadii length
            const radiusIndex = Math.min(attempt, searchRadii.length - 1);
            let radius = searchRadii[radiusIndex];

            if (!Number.isFinite(radius)) {
                console.warn(`⚠️ Invalid radius at attempt ${attempt}, using default 6000m`);
                radius = 6000; // Default to 6km if invalid
            }

            console.log(`Starting attempt ${attempt + 1}/${maxAttempts} with radius ${radius}m`);

            try {
                let availableCouriers = await Rider.find({
                    isAvailable: true,
                    isPaid: true,
                    category: "parcel",
                    location: {
                        $near: {
                            $geometry: {
                                type: "Point",
                                coordinates: pickupCoordinates,
                            },
                            $maxDistance: radius,
                        },
                    },
                }).lean().exec();
                
                console.log("Available Couriers:", availableCouriers.length);

                availableCouriers = availableCouriers.filter((driver) => 
                    driver.rideVehicleInfo.vehicleName === parcelRequest?.vehicle_id?.title
                );
                
                console.log("Available Couriers after vehicle filter:", availableCouriers.length);

                if (!availableCouriers || availableCouriers.length === 0) {
                    console.log(`No couriers found within ${radius}m radius. Attempt ${attempt + 1}/${maxAttempts}`);
                    attempt++;
                    
                    // Only wait if there are more attempts to go
                    if (attempt < maxAttempts) {
                        console.log("Waiting 20 seconds before next attempt...");
                        await new Promise(resolve => setTimeout(resolve, 20000)); // wait 20s between attempts
                    }
                    continue;
                }

                // Try to notify each driver until one is successfully notified
                for (const driver of availableCouriers) {
                    if (!driver || !driver._id) {
                        console.warn("⚠️ Driver without ID found, skipping");
                        continue;
                    }

                    const driverId = driver._id.toString();
                    let socketId = null;

                    // Get driver socket ID
                    if (driverSocketMap instanceof Map) {
                        socketId = driverSocketMap.get(driverId);
                        if (!socketId) {
                            // Try to find partial match
                            for (const [key, value] of driverSocketMap.entries()) {
                                if ((key && key.includes(driverId)) || (driverId && driverId.includes(key))) {
                                    socketId = value;
                                    break;
                                }
                            }
                        }
                    } else if (typeof driverSocketMap === 'object') {
                        socketId = driverSocketMap[driverId];
                    }

                    if (socketId) {
                        try {
                            io.to(socketId).emit("new_parcel_come", {
                                parcel: parcelRequest._id,
                                pickup,
                                message: "📦 New parcel request available near you!",
                            });

                            riderNotified = true;
                            notifiedRider = driver;
                            console.log(`🔔 Notified driver ${driverId}`);

                            if (customerSocketId) {
                                io.to(customerSocketId).emit("parcel_confirmed", {
                                    parcel: parcelRequest._id,
                                    rider: driver._id,
                                    message: "🎉 A rider has been assigned to your parcel request!"
                                });
                            }
                            
                            // Exit the loop once a rider is notified
                            break;
                        } catch (emitError) {
                            console.error(`Error emitting to socket ${socketId}:`, emitError);
                            // Continue with other drivers if this emit fails
                        }
                    } else {
                        console.log(`⚠️ No active socket connection for driver ${driverId}`);
                    }
                }

                // If a rider was notified, break out of retry loop
                if (riderNotified) break;

                attempt++;
                
                // Only wait if there are more attempts to go
                if (attempt < maxAttempts) {
                    console.log("Waiting 20 seconds before next attempt...");
                    await new Promise(resolve => setTimeout(resolve, 20000)); // wait 20s before next attempt
                }
            } catch (queryError) {
                console.error(`❌ Error in courier search (attempt ${attempt}):`, queryError);
                attempt++;
                
                // Only wait if there are more attempts to go
                if (attempt < maxAttempts) {
                    console.log("Waiting 20 seconds before next attempt...");
                    await new Promise(resolve => setTimeout(resolve, 20000)); // wait 20s before next attempt
                }
            }
        }

        // Notify customer about no available riders only after all attempts are completed
        if (!riderNotified) {
            if (io && customerSocketId) {
                io.to(customerSocketId).emit("parcel_error", {
                    parcel: data,
                    message: "Sorry, we couldn't find a rider at the moment. But your order has been successfully created — we'll assign a rider to you as soon as possible. Thank you for your patience!"
                });
            }
            throw new Error("🚫 No available drivers with active socket connection after all attempts");
        }

        return {
            success: true,
            message: `✅ Driver notified successfully`,
            notifiedDriver: notifiedRider?._id,
            searchRadius: searchRadii[Math.min(attempt, searchRadii.length - 1)] / 1000,
            customerNotified: !!customerSocketId,
            totalAttempts: attempt + 1,
        };

    } catch (error) {
        console.error("❌ Error in notifyDriverService:", error);
        throw new Error(`❌ notifyDriverService failed: ${error.message}`);
    }
};