const Parcel_Request = require("../models/Parcel_Models/Parcel_Request");
const mongoose = require("mongoose");
const axios = require("axios");
const { notifyDriverService } = require("./ParcelSockets/Notify_Parcel");
const RiderModel = require("../models/Rider.model");
const SendWhatsAppMessageNormal = require("../utils/normalWhatsapp");
const { getAllConnectedClients } = require("../socket/socketManager");

exports.NewBooking = async (req, res) => {
  try {
    console.log(req.body)
    // 🛑 Validate required fields
    if (!req.body.pickup || !req.body.dropoff || !req.body.vehicle_id) {
      return res.status(400).json({
        message: "Missing required fields: pickup, dropoff, or vehicle_id"
      });
    }

    // 🔄 Transform request into DB schema format
    const transformedData = {
      customerId: req.body.userId,
      status: "pending",
      locations: {
        pickup: {
          address: req.body.pickup.address,
          location: {
            type: "Point",
            coordinates: [
              req.body.pickup.coordinates.lng,
              req.body.pickup.coordinates.lat
            ]
          }
        },
        dropoff: {
          address: req.body.dropoff.address,
          location: {
            type: "Point",
            coordinates: [
              req.body.dropoff.coordinates.lng,
              req.body.dropoff.coordinates.lat
            ]
          }
        },
        stops: []
      },
      // Receiver info
      apartment: req.body.receiver?.apartment || "",
      name: req.body.receiver?.name || "",
      phone: req.body.receiver?.phone || "",
      useMyNumber: req.body.receiver?.useMyNumber || false,
      savedAs: req.body.receiver?.savedAs || null,

      // Vehicle info
      vehicle_id: new mongoose.Types.ObjectId(req.body.vehicle_id),

      // Fare info
      fares: {
        baseFare: req.body.fares?.baseFare || 0,
        netFare: req.body.fares?.netFare || 0,
        couponApplied: req.body.fares?.couponApplied || false,
        discount: req.body.fares?.discount || 0,
        payableAmount: req.body.fares?.payableAmount || 0
      },

      // Ride info
      ride_id: req.body.ride_id || `RIDE-${Date.now()}`,
      km_of_ride: parseFloat(req.body.km_of_ride) || 0,

      // Flags
      is_rider_assigned: req.body.is_rider_assigned || false,
      is_booking_completed: req.body.is_booking_completed || false,
      is_booking_cancelled: req.body.is_booking_cancelled || false,
      is_pickup_complete: req.body.is_pickup_complete || false,
      is_dropoff_complete: req.body.is_dropoff_complete || false
    };

    // ⏩ Process stops
    if (req.body.stops && Array.isArray(req.body.stops)) {
      transformedData.locations.stops = req.body.stops.map((stop) => ({
        address: stop.address,
        location: {
          type: "Point",
          coordinates: [stop.coordinates.lng, stop.coordinates.lat]
        }
      }));
    }

    // 🔢 Generate OTP
    transformedData.otp = Math.floor(1000 + Math.random() * 9000);

    console.log("book-parcel",transformedData)
    // 💾 Save booking
    const newBooking = new Parcel_Request(transformedData);
    // await newBooking.save();

    // 🔔 Notify via Socket
    // const io = req.app.get("socketio");
    // const clients = getAllConnectedClients();

    // console.log("📡 All connected clients:", clients);

    // const customerId = newBooking.customerId.toString();
    // console.log("🆔 CustomerId:", customerId);

    // // 🎯 Find customer in connected clients
    // const customerClient = clients.users.find(
    //   (u) => u.userId.toString() === customerId
    // );

    // if (io && customerClient) {
    //   console.log("✅ Customer socket mil gaya:", customerClient);

    //   io.to(customerClient.socketId).emit("your_parcel_is_confirm", {
    //     success: true,
    //     message: "New parcel request created",
    //     parcel: newBooking._id
    //   });
    // } else {
    //   console.warn("⚠️ Customer abhi connected nahi hai, socket send skip kar diya.");
    // }

    // // 🚖 Notify driver service
    // console.log("🚖 Notifying drivers about new parcel request...");
    // try {
    //   const data = await notifyDriverService(newBooking._id, req, res);
    //   console.log("✅ notifyDriverService success:", data);

    //   if (!data.success) {
    //     console.warn("⚠️ notifyDriverService warning:", data.message);
    //   }
    // } catch (error) {
    //   console.error("❌ Error notifyDriverService:", error.message);
    // }

    // ✅ Response
    return res.status(201).json({
      success: true,
      message: "Booking created successfully",
      booking_id: newBooking._id,
      ride_id: newBooking.ride_id,
      otp: newBooking.otp
    });
  } catch (error) {
    console.error("❌ Booking creation failed:", error);
    res.status(500).json({
      success: false,
      message: "Booking Failed",
      error: error.message
    });
  }
};

exports.getParcelDetails = async (req, res) => {
    try {
        const { id } = req.params;
        console.log("Parcel ID:", id);
        if (!id) {
            return res.status(400).json({ message: "Parcel ID is required" });
        }
        const parcelDetails = await Parcel_Request.findById(id).populate("customerId", "name number email").populate("rider_id")
        if (!parcelDetails) {
            return res.status(404).json({ message: "Parcel not found" });
        }
        res.status(200).json({ success: true, parcelDetails });

    } catch (error) {
        console.error("Error fetching parcel details:", error);
        res.status(500).json({ success: false, message: "Error fetching parcel details", error: error.message });

    }
}

exports.acceptParcelByRider = async (req, res) => {
    try {
        console.log("📥 Request received at acceptParcelByRider");
        console.log("📤 Request body:", req.body);
        console.log("🔍 Request params:", req.params);
        console.log("🔐 Request headers:", req.headers);

        const { riderId } = req.body;
        const { parcelId } = req.params;

        console.log("🧍‍♂️ Rider ID from body:", riderId);
        console.log("📦 Parcel ID from params:", parcelId);

        // Extract rider ID from auth token if not in body
        let extractedRiderId = riderId;
        if (!extractedRiderId && req.user && req.user.id) {
            extractedRiderId = req.user.id;
            console.log("🔐 Extracted rider ID from auth token:", extractedRiderId);
        }

        if (!parcelId) {
            console.warn("❌ Missing parcelId");
            return res.status(400).json({ success: false, message: "Parcel ID is required" });
        }

        if (!extractedRiderId) {
            console.warn("❌ Missing riderId");
            return res.status(400).json({ success: false, message: "Rider ID is required" });
        }

        console.log("🔍 Looking for parcel with ID:", parcelId);
        const parcel = await Parcel_Request.findById(parcelId);

        if (!parcel) {
            console.warn(`❌ Parcel not found for ID: ${parcelId}`);
            return res.status(404).json({ success: false, message: "Parcel not found" });
        }
        console.log("✅ Parcel found:", parcel._id);

        if (parcel.is_rider_assigned) {
            console.warn(`⚠️ Parcel ${parcelId} is already assigned`);
            return res.status(400).json({ success: false, message: "Parcel is already assigned to a rider" });
        }
        console.log("✅ Parcel is available for assignment");

        console.log("🔍 Looking for rider with ID:", extractedRiderId);
        const rider = await RiderModel.findById(extractedRiderId);

        if (!rider) {
            console.warn(`❌ Rider not found for ID: ${extractedRiderId}`);
            return res.status(404).json({ success: false, message: "Rider not found" });
        }
        console.log("✅ Rider found:", rider._id);

        console.log("📝 Updating parcel status...");
        parcel.is_rider_assigned = true;
        parcel.rider_id = extractedRiderId;
        parcel.driver_accept = true;
        parcel.driver_accept_time = new Date();
        parcel.status = "accepted";

        console.log("💾 Saving parcel changes...");
        await parcel.save();
        console.log(`✅ Parcel ${parcelId} accepted by rider ${extractedRiderId}`);

        const io = req.app.get("socketio");
        const driverSocketMap = req.app.get("driverSocketMap") || new Map();
        const userSocketMap = req.app.get("userSocketMap") || new Map();

        // Notify Rider
        console.log("🔍 Looking for rider socket...");
        const riderSocketId = driverSocketMap instanceof Map
            ? driverSocketMap.get(extractedRiderId) || [...driverSocketMap.entries()].find(([key]) => key.includes(extractedRiderId))?.[1]
            : driverSocketMap[extractedRiderId];

        console.log("📡 Rider Socket ID:", riderSocketId);
        if (io && riderSocketId) {
            console.log("📢 Emitting 'parcel_accepted' to rider...");
            io.to(riderSocketId).emit("parcel_accepted", {
                success: true,
                message: "Parcel accepted",
                parcel: parcel._id,
            });
            console.log("✅ Event emitted to rider");
        } else {
            console.log("⚠️ Unable to emit to rider - socket not found");
        }

        // Notify Customer
        console.log("🔍 Looking for customer socket...");
        const customerId = parcel.customerId.toString();
        const customerSocketId = userSocketMap instanceof Map
            ? userSocketMap.get(customerId) || [...userSocketMap.entries()].find(([key]) => key.includes(customerId))?.[1]
            : userSocketMap[customerId];

        console.log("📡 Customer Socket ID:", customerSocketId);
        if (io && customerSocketId) {
            console.log("📢 Emitting 'parcel_accepted' to customer...");
            io.to(customerSocketId).emit("parcel_accepted", {
                success: true,
                message: "Parcel accepted by rider",
                parcel: parcel._id,
            });
            console.log("✅ Event emitted to customer");
        } else {
            console.log("⚠️ Unable to emit to customer - socket not found");
        }
        rider.isAvailable = false;
        await rider.save();
        console.log("📤 Sending success response...");
        return res.status(200).json({
            success: true,
            message: "Parcel accepted successfully",
            parcel,
        });

    } catch (error) {
        console.error("❌ Error in acceptParcelByRider:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while accepting parcel",
            error: error.message,
        });
    }
};


exports.updateParcelStatus = async (req, res) => {
    try {
        const { parcelId, status } = req.body;

        if (!parcelId || !status) {
            return res.status(400).json({ message: "Parcel ID and status are required" });
        }

        const parcel = await Parcel_Request.findById(parcelId).populate("rider_id");
        if (!parcel) {
            return res.status(404).json({ message: "Parcel not found" });
        }

        const io = req.app.get("socketio");
        const userSocketMap = req.app.get("userSocketMap") || new Map();
        const customerId = parcel.customerId?.toString();
        const customerSocketId = customerId
            ? userSocketMap.get(customerId) || [...userSocketMap.entries()].find(([key]) => key.includes(customerId))?.[1]
            : null;

        switch (status) {
            case "Reached at Pickup Location":
                parcel.is_driver_reached = true;
                parcel.is_driver_reached_time = new Date();
                break;

            case "in_transit":
                parcel.is_pickup_complete = true;
                parcel.is_parcel_picked = true;
                parcel.otp = Math.floor(1000 + Math.random() * 9000);
                break;

            case "Reached at drop Location":
                parcel.is_driver_reached_at_deliver_place = true;
                parcel.is_driver_reached_at_deliver_place_time = new Date();

                if (customerSocketId) {
                    io.to(customerSocketId).emit("parcel_rider_reached", {
                        success: true,
                        message: "Parcel reached at drop location",
                        parcel: parcel._id,
                    });
                }
                break;

            case "delivered":
                parcel.is_parcel_delivered = true;
                parcel.is_dropoff_complete = true;
                parcel.is_parcel_delivered_time = new Date();
                parcel.is_booking_completed = true;
                parcel.money_collected = parcel.fares?.payableAmount || 0;

                const rider = parcel.rider_id;

                // Log current order earning
                const currentEarning = Number(parcel.fares?.payableAmount || 0);
                console.log("🛍️ Current Order Earning:", currentEarning);

                // Get recharge date from rider
                const rechargeDate = new Date(rider?.RechargeData?.whichDateRecharge) || new Date(rider?.createdAt);
                console.log("📅 Recharge Date:", rechargeDate);

                // Fetch all previously delivered parcels after recharge date
                const deliveredParcels = await Parcel_Request.find({
                    rider_id: rider._id,
                    is_parcel_delivered: true,
                    createdAt: { $gte: new Date() }
                });

                // Calculate past earnings after recharge
                const pastEarnings = deliveredParcels.reduce(
                    (acc, cur) => acc + Number(cur.fares?.payableAmount || 0),
                    0
                );
                console.log("💰 Past Earnings After Recharge:", pastEarnings);

                // Calculate total earnings (past + current)
                const totalEarnings = pastEarnings + currentEarning;
                console.log("🧾 Total Earnings (Current + Past):", totalEarnings);

                // Earnings limit from current plan
                const earningLimit = Number(rider?.RechargeData?.onHowManyEarning || 0);
                const remainingEarnings = earningLimit - totalEarnings;

                console.log("🎯 Earning Limit:", earningLimit);
                console.log("📉 Remaining Earnings Until Limit:", remainingEarnings);

                const number = rider?.phone;

                if (totalEarnings >= earningLimit) {
                    const message = `🎉 You’ve crossed your earning limit according to your current plan. Thank you for using Olyox! Please recharge now to continue earning more.`;
                    console.log("⚠️ Earning limit reached. Sending recharge message.");
                    await SendWhatsAppMessageNormal(message, number);

                    rider.isAvailable = false;
                    rider.RechargeData = {
                        expireData: new Date(Date.now() - 5 * 60 * 1000), // expired 5 min ago
                        rechargePlan: '',
                        onHowManyEarning: '',
                        approveRecharge: false,
                    };
                    rider.isPaid = false;
                } else if (remainingEarnings < 300) {
                    console.log("🔔 Low earnings reminder. Sending warning.");
                    const reminderMessage = `🛎️ Reminder: You have ₹${remainingEarnings} earning potential left on your plan. Recharge soon to avoid interruptions in your earnings. – Team Olyox`;
                    await SendWhatsAppMessageNormal(reminderMessage, number);

                    rider.isAvailable = true;
                }

                await rider.save();
                break;


            default:
                return res.status(400).json({ message: "Invalid status value" });
        }

        parcel.status = status;
        await parcel.save();

        return res.status(200).json({
            message: "Parcel status updated successfully",
            updatedStatus: status,
            currentEarning: Number(parcel.fares?.payableAmount || 0),
        });
    } catch (error) {
        console.error("Error updating parcel status:", error);
        return res.status(500).json({ message: "Internal server error" });
    }
};





exports.cancelOrder = async (req, res) => {
    try {
        const { parcelId } = req.params;

        // Validate input
        if (!parcelId) {
            return res.status(400).json({ message: "Parcel ID is required" });
        }

        // Fetch parcel with rider info
        const parcel = await Parcel_Request.findById(parcelId).populate("rider_id");

        if (!parcel) {
            return res.status(404).json({ message: "Parcel not found" });
        }

        if (parcel.status === 'delivered') {
            return res.status(402).json({
                success: false,
                message: 'This Order is already has been delivered'
            })
        }
        // Update parcel status
        parcel.status = "cancelled";
        parcel.is_booking_cancelled = true;
        parcel.is_booking_cancelled_time = new Date();
        parcel.is_parcel_cancel_by_user = true;
        parcel.is_parcel_cancel_by_user_time = new Date();

        await parcel.save();

        // Notify the driver via socket if assigned
        const io = req.app.get("socketio");
        const driverSocketMap = req.app.get("driverSocketMap") || new Map();

        if (parcel.rider_id && parcel.rider_id._id) {
            const driverId = parcel.rider_id._id.toString();
            const driverSocketId = driverSocketMap.get(driverId);

            if (driverSocketId) {
                io.to(driverSocketId).emit("parcel_cancelled_by_user", {
                    success: true,
                    message: "The customer has cancelled the parcel.",
                    parcelId: parcel._id,
                });
            } else {
                console.warn(`Socket not found for driver ID: ${driverId}`);
            }
        }

        return res.status(200).json({
            success: true,
            message: "Parcel cancelled successfully",
            parcel,
        });

    } catch (error) {
        console.error("Error cancelling parcel:", error);
        return res.status(500).json({
            success: false,
            message: "An error occurred while cancelling the parcel",
        });
    }
};

exports.getAllMyParcelByCustomerId = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({ message: "Oops! We couldn't process your request. User ID is missing." });
        }

        const parcels = await Parcel_Request.find({ customerId: userId }) // Find all parcels for the user
            .populate("vehicle_id") // Replace vehicle_id with the referenced vehicle document
            .sort({ createdAt: -1 }); // Sort results by newest first

        if (!parcels || parcels.length === 0) {
            return res.status(404).json({ message: "No parcel requests found for your account yet." });
        }

        // Successful response
        return res.status(200).json({
            success: true,
            message: "Parcels fetched successfully.",
            parcels
        });

    } catch (error) {
        console.error("Error fetching parcels:", error);
        return res.status(500).json({
            success: false,
            message: "Something went wrong while fetching your parcels. Please try again later.",
            error: error.message
        });
    }
};
exports.getMyNearParcel = async (req, res) => {
    try {
        const { lat, lng, radius } = req.query;

        const findNearByParcelOrder = await Parcel_Request.find({
            $and: [
                {
                    'locations.pickup.location': {
                        $near: {
                            $geometry: {
                                type: 'Point',
                                coordinates: [parseFloat(lng), parseFloat(lat)]
                            },
                            $maxDistance: radius || 5000
                        }
                    }
                },
                {
                    $or: [
                        { driver_accept: false },
                        { status: 'pending' }
                    ]
                },
                {
                    rider_id: { $exists: false }, // Only select documents where rider_id is not set
                },
                {
                    status: { $ne: 'cancelled' } // Exclude parcels with status 'cancelled'
                }
            ]
        });

        res.status(200).json({ data: findNearByParcelOrder });
    } catch (error) {
        res.status(500).json({ message: 'Internal Server Error', error });
    }
};
