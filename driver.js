const Parcel_Bike_Register = require("./models/Parcel_Models/Parcel_Bike_Register");
const Parcel_Request = require("./models/Parcel_Models/Parcel_Request");
const SendWhatsAppMessage = require("./utils/whatsapp_send");

exports.update_parcel_request = async (io, data, driverSocketMap, userSocketMap) => {
    try {
        const { order_id, driver_accept, driver_accept_time, driver_id } = data || {};

        const find_parcel = await Parcel_Request.findOne({ _id: order_id }).populate('driverId');
        if (!find_parcel) {
            return { status: false, message: "Parcel not found" };
        }
        console.log("Parcel driverId:", find_parcel.driverId);
        if (find_parcel.driverId || find_parcel.driver_accept) {
            return { status: false, message: "Driver is already assigned" };
        }

        find_parcel.driverId = driver_id;
        find_parcel.driver_accept = driver_accept;
        find_parcel.driver_accept_time = driver_accept_time;

        const findDriver = await Parcel_Bike_Register.findOne({
            _id: driver_id
        })
        if (!findDriver) {
            return { status: false, message: "Driver not found" };
        }
        findDriver.is_on_order = true
        await findDriver.save()
        await find_parcel.save();

        // Remove notification from all riders
        Object.keys(driverSocketMap).forEach((socketId) => {
            io.to(socketId).emit("remove_order_notification", { order_id });
        });

        // Emit message to driver who accepted the ride with full data
        const riderSocketId = driverSocketMap.get(driver_id); // Get socket ID from Map
        if (riderSocketId) {
            io.to(riderSocketId).emit("new_order_accept", { status: true, data: find_parcel });
        }

        const stringUser = find_parcel?.customerId.toString()
        console.log("stringUser", stringUser)
        console.log("userSocketMap", userSocketMap)
        const userOfSocketid = userSocketMap.get(stringUser)
        console.log("userOfSocketid", userOfSocketid)
        if (userOfSocketid) {
            io.to(userOfSocketid).emit("order_accepted_by_rider", { status: true, data: find_parcel })
        }


        return { status: true, message: "Parcel request updated successfully", data: find_parcel };
    } catch (error) {
        return { status: false, message: "An error occurred", error: error.message };
    }
};


exports.mark_reached = async (io, data, driverSocketMap, userSocketMap) => {
    try {
        const { _id } = data || {};

        const find_parcel = await Parcel_Request.findOne({ _id: _id }).populate('driverId');
        if (!find_parcel) {
            return { status: false, message: "Parcel not found" };
        }


        find_parcel.is_driver_reached = true
        find_parcel.is_driver_reached_time = new Date();

        await find_parcel.save();


        const stringUser = find_parcel?.customerId.toString()

        const userOfSocketid = userSocketMap.get(stringUser)
        console.log("userOfSocketid", userOfSocketid)
        if (userOfSocketid) {
            io.to(userOfSocketid).emit("update_on_order", { status: true, data: find_parcel })
        }


        return { status: true, message: "Parcel request updated successfully", data: find_parcel };
    } catch (error) {
        return { status: false, message: "An error occurred", error: error.message };
    }
};


exports.mark_pick = async (io, data, driverSocketMap, userSocketMap) => {
    try {
        const { _id } = data || {};

        const find_parcel = await Parcel_Request.findOne({ _id: _id }).populate('driverId');
        if (!find_parcel) {
            return { status: false, message: "Parcel not found" };
        }


        find_parcel.is_parcel_picked = true


        await find_parcel.save();


        const stringUser = find_parcel?.customerId.toString()

        const userOfSocketid = userSocketMap.get(stringUser)
        console.log("userOfSocketid", userOfSocketid)
        if (userOfSocketid) {
            io.to(userOfSocketid).emit("update_on_order", { status: true, data: find_parcel })
        }


        return { status: true, message: "Parcel request updated successfully", data: find_parcel };
    } catch (error) {
        return { status: false, message: "An error occurred", error: error.message };
    }
};
exports.mark_deliver = async (io, data, driverSocketMap, userSocketMap, moneyWriteAble, mode) => {
    try {
        const { _id } = data || {};

        const find_parcel = await Parcel_Request.findOne({ _id: _id }).populate('driverId');
        if (!find_parcel) {
            return { status: false, message: "Parcel not found" };
        }

        console.log("find_parceldaga", data)

        find_parcel.is_driver_reached_at_deliver_place = true
        find_parcel.is_driver_reached_at_deliver_place_time = new Date()
        find_parcel.is_parcel_delivered = true
        find_parcel.is_parcel_delivered = true
        find_parcel.money_collected = data.writableMoney
        find_parcel.money_collected_mode = data.modeOfMoney
        find_parcel.driverId.is_on_order = false

        find_parcel.status = "delivered"


        await find_parcel.save();
        await find_parcel.driverId.save();


        // console.log("is_driver_reached_at_deliver_place", find_parcel)


        const stringUser = find_parcel?.customerId.toString()

        const userOfSocketid = userSocketMap.get(stringUser)
        console.log("userOfSocketid", userOfSocketid)
        if (userOfSocketid) {
            io.to(userOfSocketid).emit("update_on_order", { status: true, data: find_parcel })
        }


        return { status: true, message: "Parcel request updated successfully", data: find_parcel };
    } catch (error) {
        return { status: false, message: "An error occurred", error: error.message };
    }
};

exports.mark_cancel = async (io, data, driverSocketMap, userSocketMap, moneyWriteAble, mode) => {
    try {
        const { _id } = data || {};

        const find_parcel = await Parcel_Request.findOne({ _id: _id }).populate('driverId');
        if (!find_parcel) {
            return { status: false, message: "Parcel not found" };
        }

        if (find_parcel.is_parcel_delivered) {
            return { status: false, message: "Parcel already delivered" };
        }
        if (find_parcel.status === "cancelled") {

            return { status: false, message: "Parcel already cancelled" };

        }
        find_parcel.driverId.is_on_order = false;

        find_parcel.status = "cancelled";

        await find_parcel.save();
        await find_parcel.driverId.save();

        const DriverMessage = `The Parcel Order from ${find_parcel.pickupLocation} has been cancelled by the customer. Please refresh your app. Thank you.`;
        const UserMessage = `The Parcel Order from ${find_parcel.pickupLocation} has been cancelled by you. Please refresh your app. Thank you.`;

        await SendWhatsAppMessage(DriverMessage, find_parcel?.driverId?.phone);
        await SendWhatsAppMessage(UserMessage, find_parcel?.customerPhone);

        const stringUser = find_parcel?.customerId.toString();
        const userOfSocketId = userSocketMap.get(stringUser);
        if (userOfSocketId) {
            io.to(userOfSocketId).emit("update_on_order", { status: true, data: find_parcel });
        }

        const stringDriver = find_parcel?.driverId?._id.toString();
        const driverOfSocketId = driverSocketMap.get(stringDriver);
        if (driverOfSocketId) {
            io.to(driverOfSocketId).emit("ride_cancel", { status: true, data: find_parcel });
        }

        return { status: true, message: "Parcel request updated successfully", data: find_parcel };
    } catch (error) {
        return { status: false, message: "An error occurred", error: error.message };
    }
};

