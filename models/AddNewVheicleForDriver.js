const mongoose = require("mongoose");

const vehicleSchema = new mongoose.Schema(
  {
    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Rider",
      required: true,
    },

    vehicleDetails: {
      name: {
        type: String,
        required: true,
        trim: true, // Ex: Toyota, Honda
      },
      type: {
        type: String,
        // enum: [
        //   // MINI
        //   "MINI", "Mini", "mini",

        //   // SEDAN
        //   "SEDAN", "Sedan", "sedan",

        //   // SUV
        //   "SUV", "Suv", "suv",

        //   // XL
        //   "XL", "Xl", "xl",

        //   "SUV/XL",
        //   "Can carry Upto 750 Kg",

        //   // BIKE
        //   "BIKE", "Bike", "bike",

        //   // AUTO
        //   "AUTO", "Auto", "auto"
        // ],
        required: true,
      },
      numberPlate: {
        type: String,
        required: true,
        // unique: true,
        uppercase: true,
        trim: true, // Ex: DL01AB1234
      }
    },

    documents: {
      rc: {
        url: { type: String },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        note: { type: String, trim: true },
      },
      pollution: {
        url: { type: String },
        expiryDate: { type: Date },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        note: { type: String },
      },
      aadharFront: {
        url: { type: String },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        note: { type: String },
      },
      aadharBack: {
        url: { type: String },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        note: { type: String },
      },
      permit: {
        url: { type: String },
        expiryDate: { type: Date },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        note: { type: String },
      },
      licence: {
        url: { type: String },
        expiryDate: { type: Date },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        note: { type: String },
      },
      insurance: {
        url: { type: String },
        expiryDate: { type: Date },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
        note: { type: String },
      },
      panCard: {
        url: { type: String },
        status: { type: String, enum: ["pending", "approved", "rejected"], default: "pending" },
      },
    },

    vehicleApprovedForRunning: {
      status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: "pending",
      },
      date: {
        type: Date,

      },
      // approvedBy: {
      //   type: mongoose.Schema.Types.ObjectId,
      //   ref: "Admin",
      // },
    },

    // Tracking fields
    isActive: {
      type: Boolean,
      default: false,
    },
    isDefault: {
      type: Boolean,
      default: false,
    },
    remarks: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("VehicleAdds", vehicleSchema);
