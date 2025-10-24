const Parcel_Request = require("../models/Parcel_Models/Parcel_Request");
const axios = require("axios");
const Parcel_Boys_Location = require("../models/Parcel_Models/Parcel_Boys_Location");
const Parcel_User_Login_Status = require("../models/Parcel_Models/Parcel_User_Login_Status");
const Parcel_Bike_Register = require("../models/Parcel_Models/Parcel_Bike_Register");
const { driverSocketMap } = require("../server");

exports.request_of_parcel = async (req, res) => {
    try {

        const userData = Array.isArray(req.user.user) ? req.user.user[0] : req.user.user;
        const { customerName, customerPhone, dropoff, pickup } = req.body || {};
        // const { customerName, customerPhone, dropoff,request_of_parcel  } = req.body || {};

        if (!dropoff || !pickup) {
            return res.status(400).json({ message: "Dropoff and Pickup are required" });
        }


        const pickupData = await axios.get(`https://api.srtutorsbureau.com/geocode?address=${encodeURIComponent(pickup)}`);
        const dropOffData = await axios.get(`https://api.srtutorsbureau.com/geocode?address=${encodeURIComponent(dropoff)}`);

        if (!pickupData?.data?.longitude || !pickupData?.data?.latitude || !dropOffData?.data?.longitude || !dropOffData?.data?.latitude) {
            return res.status(400).json({ message: "Invalid geolocation data" });
        }

        const GeoPickUp = {
            type: "Point",
            coordinates: [pickupData.data.longitude, pickupData.data.latitude],
        };

        const GeoDrop = {
            type: "Point",
            coordinates: [dropOffData.data.longitude, dropOffData.data.latitude],
        };

        const io = req.app.get("socketio");
        if (!io) {
            return res.status(500).json({ message: "Socket.io is not connected" });
        }

        const findBoysNearPickup = await Parcel_Boys_Location.find({
            location: {
                $near: {
                    $geometry: GeoPickUp,
                    $maxDistance: 6000,
                },
            },
        }).populate("riderId", "_id");

        if (findBoysNearPickup.length === 0) {
            return res.status(404).json({ message: "No delivery boys found near pickup location" });
        }

        console.log("findBoysNearPickup", findBoysNearPickup)

        const pickupResponse = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
            params: { address: pickup, key: 'AIzaSyBfRHuTByG6CiXtLbyzK_aKNpJfDiB4jUo' },
        });

        if (pickupResponse.data.status !== "OK") {
            return res.status(400).json({ message: "Invalid Pickup location" });
        }
        const pickupDatatwo = pickupResponse.data.results[0].geometry.location;

        // Geocode Dropoff Location
        const dropOffResponse = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
            params: { address: dropoff, key: 'AIzaSyBfRHuTByG6CiXtLbyzK_aKNpJfDiB4jUo' },
        });

        if (dropOffResponse.data.status !== "OK") {
            return res.status(400).json({ message: "Invalid Dropoff location" });
        }
        const dropOffDatatwo = dropOffResponse.data.results[0].geometry.location;

        // Calculate Distance using Google Distance Matrix API
        const distanceResponse = await axios.get("https://maps.googleapis.com/maps/api/distancematrix/json", {
            params: {
                origins: `${pickupDatatwo.lat},${pickupDatatwo.lng}`,
                destinations: `${dropOffDatatwo.lat},${dropOffDatatwo.lng}`,
                key: 'AIzaSyBfRHuTByG6CiXtLbyzK_aKNpJfDiB4jUo',
            },
        });

        if (distanceResponse.data.status !== "OK") {
            return res.status(400).json({ message: "Failed to calculate distance" });
        }

        const distanceInfo = distanceResponse.data.rows[0].elements[0];

        if (distanceInfo.status !== "OK") {
            return res.status(400).json({ message: "Invalid distance calculation" });
        }

        const distanceInKm = distanceInfo.distance.value / 1000; // Convert meters to kilometers
        const price = distanceInKm * 70;

        // Create a new parcel request
        const newParcelRequest = new Parcel_Request({
            customerId: userData._id,
            customerName,
            customerPhone,
            pickupLocation: pickup,
            dropoffLocation: dropoff,

            totalKm: distanceInKm,
            pickupGeo: GeoPickUp,
            droppOffGeo: GeoDrop,
            price: price.toFixed(2),
            status: "pending",
        });

        await newParcelRequest.save();

        const availableBoys = [];
        const today = new Date().toISOString().split("T")[0];

        console.log("findBoysNearPickup", findBoysNearPickup)

        for (const boy of findBoysNearPickup) {
            const checkStatus = await Parcel_User_Login_Status.findOne({
                riderId: boy._id || {},
                date: today,
                status: "online",
            });
            console.log("checkStatus", checkStatus)
            if (!checkStatus) continue; // Skip if checkStatus is null

            const findRiderIsAvailableOrNot = await Parcel_Bike_Register.findOne({
                _id: checkStatus.riderId,
                is_on_order: false
            });
            console.log(findRiderIsAvailableOrNot)
            if (findRiderIsAvailableOrNot) {
                availableBoys.push(boy);
            }
        }


        const availableRidersData = [];
        for (const item of availableBoys) {
            const rider_data = await Parcel_Bike_Register.findById(item._id);
            if (rider_data) {
                availableRidersData.push({
                    rider_data,
                    location: item.location,
                });
            }
        }
        const data = req.app.get('driverSocketMap');

        availableRidersData.forEach((rider) => {
            const riderId = rider?.rider_data?._id?.toString();
            console.log("riderId", riderId)
            const riderSocketId = data.get(riderId); // Get socket ID from Map
            console.log("riderSocketId", riderSocketId)
            if (riderSocketId) {
                io.to(riderSocketId).emit('new_parcel_request', {
                    pickupLocation: pickup,
                    dropoffLocation: dropoff,

                    price: price.toFixed(2),
                    customerId: userData._id,
                    customerName,
                    customerPhone,
                    id: newParcelRequest?._id
                });
            } else {
                console.log(`No active socket found for rider ${rider.riderId}`);
            }
        });

        return res.status(201).json({
            message: "Parcel request created successfully",
            parcelRequest: newParcelRequest,

            availableRiders: availableRidersData,
        });
    } catch (error) {
        console.error("Error in request_of_parcel:", error);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
};



exports.my_parcel = async (req, res) => {
    try {
        const userData = Array.isArray(req.user.user) ? req.user.user[0] : req.user.user;
        console.log("sss", userData)
        if (!userData) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // Find parcels related to the user
        const find = await Parcel_Request.find({
            customerId: userData
        })
            .populate({
                path: 'driverId',
                select: 'name phone bikeDetails' // Adjust fields based on what you need
            })
            .sort({ createdAt: -1 });

        // Return the response
        return res.status(200).json({
            status: true,
            message: "Parcels fetched successfully",
            data: find
        });

    } catch (error) {
        console.error("Error fetching parcels:", error);
        return res.status(500).json({
            status: false,
            message: "An error occurred while fetching parcels",
            error: error.message
        });
    }
};


exports.my_parcel_driver = async (req, res) => {
    try {
        const userData = req.user?.userId;

        if (!userData) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // Find parcels related to the driver
        const parcels = await Parcel_Request.find({ driverId: userData })
            .populate({
                path: 'customerId',
                select: 'email name number' // Adjust fields based on requirements
            })
            .sort({ createdAt: -1 });

        // Calculate today's orders
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayOrders = parcels.filter(parcel =>
            new Date(parcel.createdAt).setHours(0, 0, 0, 0) === today.getTime()
        ).length;

        // Total Orders
        const totalOrders = parcels.length;

        // Total Delivered Earnings (Assuming each delivered parcel has a `price` field)
        const totalDeliveredEarnings = parcels.reduce((total, parcel) => {
            return parcel.status === "delivered" ? total + (parcel.price || 0) : total;
        }, 0);

        return res.status(200).json({
            status: true,
            message: "Parcels fetched successfully",
            data: parcels,
            summary: {
                todayOrders,
                totalOrders,
                rating: 4.3,
                totalDeliveredEarnings
            }
        });

    } catch (error) {
        console.error("Error fetching parcels:", error);
        return res.status(500).json({
            status: false,
            message: "An error occurred while fetching parcels",
            error: error.message
        });
    }
};


exports.single_my_parcel = async (req, res) => {
    try {
        const userData = Array.isArray(req.user.user) ? req.user.user[0] : req.user.user;
        const { id } = req.query
        console.log("ssssssss", userData)
        console.log("sss", id)
        if (!userData) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // Find parcels related to the user
        const find = await Parcel_Request.find({
            customerId: userData,
            _id: id
        })
            .populate({
                path: 'driverId',
                select: 'name phone bikeDetails' // Adjust fields based on what you need
            })
            .sort({ createdAt: -1 });

        // Return the response
        return res.status(200).json({
            status: true,
            message: "Parcels fetched successfully",
            data: find
        });

    } catch (error) {
        console.error("Error fetching parcels:", error);
        return res.status(500).json({
            status: false,
            message: "An error occurred while fetching parcels",
            error: error.message
        });
    }
};
exports.single_my_parcels = async (req, res) => {
    try {
        const { id } = req.query

        const find = await Parcel_Request.findOne({

            _id: id
        })
            .populate('driverId')
            .sort({ createdAt: -1 });

        return res.status(200).json({
            status: true,
            message: "Parcels fetched successfully",
            data: find
        });

    } catch (error) {
        console.error("Error fetching parcels:", error);
        return res.status(500).json({
            status: false,
            message: "An error occurred while fetching parcels",
            error: error.message
        });
    }
};


exports.get_all_parcel = async (req, res) => {
    try {
        const allParcelOrder = await Parcel_Request.find().populate('vehicle_id').populate('customerId').populate('rider_id','-documents')
            .sort({ createdAt: -1 });
        if (!allParcelOrder) {
            return res.status(400).json({
                success: false,
                message: "Parcel order not found"
            })
        }
        return res.status(200).json({
            success: true,
            message: "Parcel order founded",
            data: allParcelOrder
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

exports.get_parcel_by_id = async (req, res) => {
    try {
        const {id} = req.params;
        const parcelOrder = await Parcel_Request.findById(id).populate('vehicle_id').populate('customerId').populate('rider_id');
        if (!parcelOrder) {
            return res.status(400).json({
                success: false,
                message: "Parcel order not found"
            })
        }
        return res.status(200).json({
            success: true,
            message: "Parcel order founded",
            data: parcelOrder
        })
    } catch (error) {
        console.log('Internal server error',error)
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        })
    }
}

exports.update_parcel_order_status = async (req,res) => {
    try {
        const {id} = req.params;
        const {status} = req.body;
        const parcelOrder = await Parcel_Request.findByIdAndUpdate(id,{status});
        if (!parcelOrder) {
            return res.status(400).json({
                success: false,
                message: "Parcel order not found"
            })
        }
        return res.status(200).json({
            success: true,
            message: "Parcel order status updated",
            data: parcelOrder
        })
    } catch (error) {
        console.log('Internal server error',error)
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        })
    }
}

exports.delete_parcel_order = async (req,res) => {
    try {
        const {id} = req.params;
        const parcelOrder = await Parcel_Request.findByIdAndDelete(id);
        if (!parcelOrder) {
            return res.status(400).json({
                success: false,
                message: "Parcel order not found"
            })
        }
        return res.status(200).json({
            success: true,
            message: "Parcel order deleted",
            data: parcelOrder
        })
    } catch (error) {
        console.log('Internal server error',error)
        res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: error.message
        })
    }
}