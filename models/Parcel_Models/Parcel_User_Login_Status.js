const mongoose = require("mongoose");

const RiderStatusSchema = new mongoose.Schema(
  {
    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ParcelBikeRegister",
      required: true,
    },
    status: {
      type: String,
      enum: ["online", "offline"],
      default: "offline",
    },
    sessions: [
      {
        onlineTime: Date,  // When the rider goes online
        offlineTime: Date, // When the rider goes offline
        duration: Number,  // Duration in minutes
      }
    ],
    date: {
      type: String, // Store date as YYYY-MM-DD
      required: true,
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("RiderStatus", RiderStatusSchema);
