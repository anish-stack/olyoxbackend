const mongoose = require("mongoose");

const CabRiderSchema = new mongoose.Schema(
  {
    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      required: true,
    },
    status: {
      type: String,
      enum: ["online", "offline"],
      default: "offline",
    },
    sessions: [
      {
        onlineTime: Date,  
        offlineTime: Date, 
        duration: Number,  
      }
    ],
    date: {
      type: String, // Store date as YYYY-MM-DD
      required: true,
    }
  },
  { timestamps: true }
);

module.exports = mongoose.model("CabRider", CabRiderSchema);
