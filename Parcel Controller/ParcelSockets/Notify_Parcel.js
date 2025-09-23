const Parcel_Request = require("../../models/Parcel_Models/Parcel_Request");
const Rider = require("../../models/Rider.model");
const { getAllConnectedParcelDrivers, getAllConnectedUsers, getIO } = require("../../socket/socketManager");

exports.notifyDriverService = async (parcelId) => {
    try {
        console.log("🚀 notifyDriverService called with parcelId:", parcelId);

        if (!parcelId) throw new Error("❌ Invalid request: missing parcel ID");

        // Get connected sockets
        const connectedDrivers = getAllConnectedParcelDrivers();
        const connectedUsers = getAllConnectedUsers();
        console.log("🟢 Connected Parcel Drivers:", JSON.stringify(connectedDrivers, null, 2));
        console.log("🟢 Connected Users:", JSON.stringify(connectedUsers, null, 2));

        // Fetch parcel request
        const parcelRequest = await Parcel_Request.findById(parcelId).populate("vehicle_id");
        // console.log("📦 Parcel request fetched:", parcelRequest);

        if (!parcelRequest) throw new Error("❌ Parcel Request not found");

        const pickup = parcelRequest?.locations?.pickup;
        if (!pickup?.location?.coordinates) throw new Error("❌ Invalid pickup location");
        const pickupCoordinates = pickup.location.coordinates;
        console.log("📍 Pickup coordinates:", pickupCoordinates);

        // Rider search config
        const searchRadii = [2000, 4000, 6000];
        const maxAttempts = 4;
        let attempt = 0;
        let riderNotified = false;
        let notifiedDriver = null;

        // Customer socket
        const customerId = parcelRequest.customerId?.toString();
        const customerSocket = connectedUsers.users.find(u => u.userId === customerId)?.socketId;
        console.log("🧑 Customer ID:", customerId, "Customer socketId:", customerSocket);

        console.log("⏳ Waiting 4 seconds before searching drivers...");
        await new Promise(resolve => setTimeout(resolve, 4000));

        const io = getIO();

        while (attempt < maxAttempts && !riderNotified) {
            const radiusIndex = Math.min(attempt, searchRadii.length - 1);
            const radius = searchRadii[radiusIndex];
            console.log(`🔍 Attempt ${attempt + 1}/${maxAttempts} with radius ${radius} meters`);

            let availableDrivers = await Rider.find({
                isAvailable: true,
                isPaid: true,
                category: "parcel",
                location: {
                    $near: {
                        $geometry: { type: "Point", coordinates: pickupCoordinates },
                        $maxDistance: radius
                    }
                }
            }).lean();
            console.log(`🔎 Drivers found in radius ${radius}m:`, availableDrivers.map(d => d._id));

            // Filter by vehicle type
            availableDrivers = availableDrivers.filter(d =>
                d.rideVehicleInfo?.vehicleType === parcelRequest.vehicle_id?.info
            );
            console.log(`🚗 Drivers matching vehicle "${parcelRequest.vehicle_id?.title}":`, availableDrivers.map(d => d._id));

            // Filter only connected drivers
            availableDrivers = availableDrivers.filter(d =>
                connectedDrivers.parcelDrivers.some(cd => cd.parcelDriverId === d._id.toString())
            );
            console.log("✅ Connected drivers after filters:", availableDrivers.map(d => d._id));

            if (!availableDrivers.length) {
                console.log("⚠️ No drivers available for this attempt.");
                attempt++;
                if (attempt < maxAttempts) {
                    console.log("⏳ Waiting 20s before next attempt...");
                    await new Promise(resolve => setTimeout(resolve, 20000));
                }
                continue;
            }

            for (const driver of availableDrivers) {
                const connectedDriver = connectedDrivers.parcelDrivers.find(cd => cd.parcelDriverId === driver._id.toString());
                if (!connectedDriver) {
                    console.log(`⚠️ Driver ${driver._id} not connected`);
                    continue;
                }

                console.log(`📨 Notifying driver ${driver._id} at socket ${connectedDriver.socketId}...`);
                try {
                    // Notify driver
                    io.to(connectedDriver.socketId).emit("new_parcel_come", {
                        parcel: parcelRequest._id,
                        pickup,
                        message: "📦 New parcel request available near you!"
                    });

                    riderNotified = true;
                    notifiedDriver = driver;
                    console.log(`🔔 Driver notified successfully: ${driver._id}`);

                    // Notify customer
                    if (customerSocket) {
                        console.log(`📨 Notifying customer ${customerId} at socket ${customerSocket}...`);
                        io.to(customerSocket).emit("parcel_confirmed", {
                            parcel: parcelRequest._id,
                            rider: driver._id,
                            message: "🎉 A rider has been assigned to your parcel request!"
                        });
                        console.log("✅ Customer notified successfully");
                    }

                    break; // Stop notifying once one driver is notified
                } catch (err) {
                    console.error(`❌ Emit failed for driver ${driver._id}:`, err);
                }
            }

            if (!riderNotified) {
                console.log("⚠️ No driver notified in this attempt");
                attempt++;
                if (attempt < maxAttempts) {
                    console.log("⏳ Waiting 20s before next attempt...");
                    await new Promise(resolve => setTimeout(resolve, 20000));
                }
            }
        }

        if (!riderNotified && customerSocket) {
            console.log("❌ No drivers found after all attempts, notifying customer...");
            io.to(customerSocket).emit("parcel_error", {
                parcel: parcelId,
                message: "Sorry, no rider found right now. Your order is created — a rider will be assigned soon!"
            });
            throw new Error("🚫 No available drivers with active socket connection");
        }

        console.log("✅ notifyDriverService finished successfully");
        return {
            success: true,
            message: "✅ Driver notified successfully",
            notifiedDriver: notifiedDriver?._id,
            totalAttempts: attempt
        };
    } catch (error) {
        console.error("❌ Error in notifyDriverService:", error);
        throw new Error(`❌ notifyDriverService failed: ${error.message}`);
    }
};
