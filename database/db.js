const mongoose = require('mongoose');
const cron = require("node-cron");
const RideBooking = require("../src/New-Rides-Controller/NewRideModel.model");
const User = require("../models/normal_user/User.model");

const connectDb = async () => {
  try {
    await mongoose.connect(process.env.MONGO_DB_URL, {
      serverSelectionTimeoutMS: 30000
    });
    console.log('Database is Connected Successfully');

    cron.schedule("*/10 * * * * *", async () => {
      try {
        const currentTime = new Date();

        // 1️⃣ NORMAL RIDES: AUTO CANCEL AFTER 2 MINUTES
        const normalRides = await RideBooking.find(
          {
            ride_status: { $in: ["pending", "searching"] },
            requested_at: { $lte: new Date(currentTime.getTime() - 2 * 60 * 1000) },
            isIntercityRides: { $ne: true },
          },
          { _id: 1, user: 1, driver: 1, requested_at: 1 }
        )
          .populate("user", "_id")
          .lean();

        for (const ride of normalRides) {
          await RideBooking.updateOne(
            { _id: ride._id },
            {
              $set: {
                ride_status: "cancelled",
                cancelled_at: new Date(),
                cancellation_reason: "Auto-cancelled due to inactivity (normal ride, 2 minutes)",
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

          console.log(`🚫 Auto-cancelled normal ride ${ride._id} (2 minutes)`);
        }

        // 2️⃣ INTERCITY RIDES AUTO CANCEL (ONLY AFTER PICKUP TIME)
        const intercityRides = await RideBooking.find(
          {
            isIntercityRides: true,
            ride_status: { $in: ["pending", "searching"] },
            driver: null
          },
          { _id: 1, user: 1, driver: 1, IntercityPickupTime: 1 }
        )
          .populate("user", "_id")
          .lean();

        for (const ride of intercityRides) {
          if (ride.IntercityPickupTime) {
            const pickup = new Date(ride.IntercityPickupTime);

            // ⛔ DO NOT CANCEL BEFORE PICKUP TIME
            if (currentTime < pickup) {
              console.log(
                `⏳ Skip: Intercity ride ${ride._id} pickup ${pickup} has not arrived yet`
              );
              continue;
            }
          }

          await RideBooking.updateOne(
            { _id: ride._id },
            {
              $set: {
                ride_status: "cancelled",
                cancelled_at: new Date(),
                cancellation_reason: "Auto-cancelled (pickup time passed, no driver)",
                cancelled_by: "system",
              },
            }
          );

          if (ride.user?._id) {
            await User.updateOne(
              { _id: ride.user._id },
              { $set: { IntercityRide: null } }
            );
          }

          console.log(`🚫 Auto-cancelled intercity ride ${ride._id}`);
        }

      } catch (error) {
        console.error("❌ Error in ride cleanup cron job:", error.message);
      }
    });

  } catch (error) {
    console.error("❌ Failed to Connect to Database", error);
    process.exit(1);
  }
};

module.exports = connectDb;
