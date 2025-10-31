const mongoose = require('mongoose');

const Schema = mongoose.Schema;

const RidesSuggestionSchema = new Schema({
  // Basic vehicle information
  name: {
    type: String,
    required: true,
    trim: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['bike', 'auto', 'mini', 'sedan', 'suv', 'luxury', 'xl']
  },
  vehicleType: {
    type: String,
    required: true,
    enum: ['Bike', 'Auto', 'Mini', 'Sedan', 'SUV', 'Luxury', 'XL']
  },
  description: {
    type: String,
    required: true,
    maxlength: 500
  },
  
  // Display information
  time: {
    type: String,
    required: true,
    default: '5-10 mins'
  },
  priceRange: {
    type: String,
    required: true,
    default: '₹₹'
  },
  status: {
    type: Boolean,
    default: false,
    index: true
  },
  icons_image: {
    url: {
      type: String,
      required: true
    },
    public_id: {
      type: String
    }
  },

  // Vehicle specifications
  avgMileage: {
    type: Number,
    required: true,
    min: 5,
    max: 50,
    default: 15 // km/l
  },
  seatingCapacity: {
    type: Number,
    required: true,
    min: 1,
    max: 10,
    default: 4
  },
  luggageCapacity: {
    type: String,
    default: '2 bags'
  },

  // Base pricing structure
  baseFare: {
    type: Number,
    required: true,
    min: 0,
    default: 50
  },
  baseKM: {
    type: Number,
    required: true,
    min: 0,
    default: 2 // Base kilometers included in base fare
  },
  minFare: {
    type: Number,
    required: true,
    min: 0,
    default: 50 // Minimum fare to be charged
  },

  // Distance-based pricing
  perKM: {
    type: Number,
    required: true,
    min: 0,
    default: 10 // Price per kilometer after base KM
  },

  // Time-based pricing
  perMin: {
    type: Number,
    required: true,
    min: 0,
    default: 1 // Price per minute
  },
  waitingChargePerMin: {
    type: Number,
    required: true,
    min: 0,
    default: 1 // Waiting charge per minute
  },

  // Surcharges and additional charges
  nightPercent: {
    type: Number,
    required: true,
    min: 0,
    max: 100,
    default: 20 // Night surcharge percentage (e.g., 20 means 20%)
  },
  rainSurcharge: {
    type: Number,
    min: 0,
    default: 0 // Fixed rain surcharge amount
  },
  fuelSurchargePerKM: {
    type: Number,
    required: true,
    min: 0,
    default: 2 // Fuel surcharge per km (will be calculated based on mileage)
  },

  // Toll and parking
  tollExtra: {
    type: Boolean,
    required: true,
    default: true // Whether toll is charged extra
  },
  parkingCharges: {
    type: Boolean,
    default: false // Whether parking charges apply
  },

  // Service area restrictions
  maxDistanceKm: {
    type: Number,
    min: 0,
    default: 500 // Maximum distance this vehicle can travel
  },
  minDistanceKm: {
    type: Number,
    min: 0,
    default: 0 // Minimum distance for this vehicle type
  },

  // Availability settings
  availableForIntercity: {
    type: Boolean,
    default: true
  },
  availableForRental: {
    type: Boolean,
    default: false
  },
  availableForScheduled: {
    type: Boolean,
    default: true
  },

  // Dynamic pricing settings (Uber/Ola style)
  surgePricing: {
    enabled: {
      type: Boolean,
      default: true
    },
    maxSurgeMultiplier: {
      type: Number,
      min: 1,
      max: 5,
      default: 3 // Maximum surge multiplier (e.g., 3x)
    },
    peakHourMultiplier: {
      type: Number,
      min: 1,
      max: 3,
      default: 1.3 // Peak hour multiplier
    }
  },

  // Cancellation policy
  cancellationCharges: {
    beforeAcceptance: {
      type: Number,
      default: 0
    },
    afterAcceptance: {
      type: Number,
      default: 30
    },
    afterArrival: {
      type: Number,
      default: 50
    }
  },

  // Priority and sorting
  priority: {
    type: Number,
    default: 0,
    min: 0,
    max: 10 // Higher priority shows first
  },

  // Analytics and tracking
  totalRides: {
    type: Number,
    default: 0
  },
  averageRating: {
    type: Number,
    min: 0,
    max: 5,
    default: 0
  },
  totalRevenue: {
    type: Number,
    default: 0
  },

  // Metadata
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'Admin'
  },
  lastModifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Admin'
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
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