const mongoose = require('mongoose');
const cron = require("node-cron");
const RideBooking = require("../src/New-Rides-Controller/NewRideModel.model");
const User = require("../models/normal_user/User.model");

const connectDb = async () => {
  try {
    await mongoose.connect(process.env.MONGO_DB_URL, {
      serverSelectionTimeoutMS: 30000,
    });
    console.log("Database is Connected Successfully");

    // RUN EVERY 10 SECONDS
    cron.schedule("*/10 * * * * *", async () => {
      try {
        const now = new Date();

        /*
         ****************************************************
         * 1️⃣ NORMAL INSTANT RIDES (cancel after 2 min)
         * Condition: isLater = false AND isIntercity = false
         ****************************************************
        */
        const instantRides = await RideBooking.find({
          isIntercityRides: false,
          isLater: false,
          ride_status: { $in: ["pending", "searching"] },
          requested_at: { $lte: new Date(now.getTime() - 2 * 60 * 1000) }, // 2 min
        })
          .populate("user", "_id")
          .lean();

        for (const ride of instantRides) {
          await RideBooking.updateOne(
            { _id: ride._id },
            {
              $set: {
                ride_status: "cancelled",
                cancelled_at: new Date(),
                cancellation_reason: "Auto-cancelled (Normal instant ride - 2 minutes)",
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

          console.log(`🚫 Cancelled Instant Ride ${ride._id}`);
        }

        /*
         ****************************************************
         * 2️⃣ NORMAL LATER RIDES (cancel only at pickupTime + 5 min)
         * Condition: isLater = true AND isIntercity = false
         ****************************************************
        */
        const laterRides = await RideBooking.find({
          isIntercityRides: false,
          isLater: true,
          ride_status: { $in: ["pending", "searching"] },
          driver: null,
        })
          .populate("user", "_id")
          .lean();

        for (const ride of laterRides) {
          if (!ride.laterPickupTime) continue;

          const pickupTime = new Date(ride.laterPickupTime);
          const cancelTime = new Date(pickupTime.getTime() + 5 * 60 * 1000); // +5 min

          // ❌ Do NOT cancel before pickupTime + 5 minutes
          if (now < cancelTime) {
            console.log(`⏳ Skip Later Ride ${ride._id}, waiting until ${cancelTime}`);
            continue;
          }

          await RideBooking.updateOne(
            { _id: ride._id },
            {
              $set: {
                ride_status: "cancelled",
                cancelled_at: new Date(),
                cancellation_reason:
                  "Auto-cancelled (Later ride - pickup time passed + 5 min)",
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

          console.log(`🚫 Cancelled Later Ride ${ride._id}`);
        }

        /*
         ****************************************************
         * 3️⃣ INTERCITY RIDES (cancel only at IntercityPickupTime + 5 min)
         ****************************************************
        */
        const intercityRides = await RideBooking.find({
          isIntercityRides: true,
          ride_status: { $in: ["pending", "searching"] },
          driver: null,
        })
          .populate("user", "_id")
          .lean();

        for (const ride of intercityRides) {
          if (!ride.IntercityPickupTime) continue;

          const pickupTime = new Date(ride.IntercityPickupTime);
          const cancelTime = new Date(pickupTime.getTime() + 5 * 60 * 1000); // +5 min

          // ❌ Do NOT cancel before pickupTime + 5 minutes
          if (now < cancelTime) {
            console.log(
              `⏳ Skip Intercity Ride ${ride._id}, waiting until ${cancelTime}`
            );
            continue;
          }

          await RideBooking.updateOne(
            { _id: ride._id },
            {
              $set: {
                ride_status: "cancelled",
                cancelled_at: new Date(),
                cancellation_reason:
                  "Auto-cancelled (Intercity ride - pickup time passed + 5 min)",
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

          console.log(`🚫 Cancelled Intercity Ride ${ride._id}`);
        }

      } catch (error) {
        console.error("❌ Error in ride cleanup cron:", error.message);
      }
    });
  } catch (error) {
    console.error("❌ Failed to Connect to Database", error);
    process.exit(1);
  }
};

module.exports = connectDb;
