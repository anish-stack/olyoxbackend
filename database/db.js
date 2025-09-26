const mongoose = require('mongoose');
const cron = require("node-cron");
const RideBooking = require("../src/New-Rides-Controller/NewRideModel.model");
const User = require("../models/normal_user/User.model");
const connectDb = async () => {
    try {
        await mongoose.connect(process.env.MONGO_DB_URL,{
            serverSelectionTimeoutMS: 30000
        });
        console.log('Database is Connected Successfully');
        cron.schedule("*/10 * * * * *", async () => {
  try {
    const currentTime = new Date();
    const oneMinuteAgo = new Date(currentTime.getTime() - 1 * 60 * 1000);

    // Find only required rides, return lean objects
    const allRides = await RideBooking.find(
      {
        ride_status: { $in: ["pending", "searching"] },
        requested_at: { $lte: oneMinuteAgo },
      },
      { _id: 1, user: 1, driver: 1, requested_at: 1 } // project only required fields
    )
      .populate("user", "_id") // only _id
      .populate("driver", "_id") // only _id
      .lean();

    if (!allRides.length) {
      return;
    }

    for (const ride of allRides) {
      // Update ride in one go
      await RideBooking.updateOne(
        { _id: ride._id },
        {
          $set: {
            ride_status: "cancelled",
            cancelled_at: new Date(),
            cancellation_reason: "Auto-cancelled due to inactivity",
            cancelled_by: "system",
          },
        }
      );

      if (ride.user?._id) {
        await User.updateOne(
          { _id: ride.user._id },
          { $set: { currentRide: null } }
        );
      }

      console.log(`🚫 Auto-cancelled ride ${ride._id}`);
    }
  } catch (error) {
    console.error("❌ Error in ride cleanup cron job:", error.message);
  }
});

    } catch (error) {
        console.error('Failed to Connect to Database', error);
        process.exit(1);
    }
};

module.exports = connectDb;