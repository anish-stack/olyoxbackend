const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const RidesSuggestionSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    type: {
        type: String,
        required: true
    },
    description: {
        type: String,
        required: true
    },
    time: {
        type: String,
        required: true
    },
    priceRange: {
        type: String,
        required: true
    },
    status: {
        type: Boolean,
        default: false

    },
    icons_image: {
        url: {
            type: String,
        },
        public_id: {
            type: String,
        }
    },
    vehicleType: { type: String }, // e.g., "Bike", "Auto", etc.
    avgMileage: { type: Number, required: true }, // in km/l
    baseFare: { type: Number, required: true },
    baseKM: { type: Number, required: true },
    perKM: { type: Number, required: true },
    perMin: { type: Number, required: true },
    nightPercent: { type: Number, required: true }, // store as number, e.g., 15 for 15%
    minFare: { type: Number, required: true },
    tollExtra: { type: Boolean, required: true },
    waitingChargePerMin: { type: Number, required: true },
    fuelSurchargePerKM: { type: Number, required: true }
});


// Indexes for better query performance
RidesSuggestionSchema.index({ status: 1, priority: -1 });
RidesSuggestionSchema.index({ type: 1, status: 1 });
RidesSuggestionSchema.index({ availableForIntercity: 1, status: 1 });

// Virtual for formatted price range
RidesSuggestionSchema.virtual('estimatedPriceRange').get(function() {
  const minPrice = this.minFare;
  const avgPrice = this.baseFare + (10 * this.perKM) + (20 * this.perMin);
  return `₹${minPrice} - ₹${Math.round(avgPrice)}`;
});

// Pre-save middleware to update timestamps
RidesSuggestionSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

// Static method to get active vehicles by type
RidesSuggestionSchema.statics.getActiveVehiclesByType = function(vehicleType) {
  return this.find({
    status: true,
    type: vehicleType
  }).sort({ priority: -1 });
};

// Static method to get vehicles for intercity
RidesSuggestionSchema.statics.getIntercityVehicles = function() {
  return this.find({
    status: true,
    availableForIntercity: true,
    name: { $not: { $regex: /^(bike|auto)$/i } }
  }).sort({ priority: -1 });
};

// Instance method to calculate estimated price
RidesSuggestionSchema.methods.calculateEstimatedPrice = function(distanceKm, durationMin) {
  const chargeableDistance = Math.max(0, distanceKm - this.baseKM);
  const distanceCost = chargeableDistance * this.perKM;
  const timeCost = durationMin * this.perMin;
  const totalPrice = this.baseFare + distanceCost + timeCost;
  return Math.max(totalPrice, this.minFare);
};

// Instance method to check if vehicle is available for route
RidesSuggestionSchema.methods.isAvailableForRoute = function(distanceKm, isIntercity = false) {
  if (!this.status) return false;
  if (isIntercity && !this.availableForIntercity) return false;
  if (distanceKm < this.minDistanceKm || distanceKm > this.maxDistanceKm) return false;
  return true;
};

module.exports = mongoose.model('RidesSuggestion', RidesSuggestionSchema);