const mongoose = require('mongoose');

const riderSessionTrackingSchema = new mongoose.Schema(
  {
    work_date: {
      type: Date,
      required: false,
      default: () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
      },
    },
    riderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Rider',
      required: false,
      index: true,
    },
    startTime: {
      type: Date,
      required: true,
      default: Date.now,
    },
    endTime: {
      type: Date,
      default: null,
    },
    duration: {
      type: Number, // in seconds
      default: 0,
    },
    status: {
      type: String,
      enum: ['online', 'offline', 'inactive', 'on-ride'],
      default: 'online',
    },
  },
  {
    timestamps: true,
  }
);


riderSessionTrackingSchema.pre('save', function (next) {
  if (this.endTime && this.startTime) {
    const diffInSeconds = Math.floor((this.endTime - this.startTime) / 1000);
    this.duration = diffInSeconds;
  }
  next();
});


riderSessionTrackingSchema.index({ riderId: 1, work_date: 1 });
riderSessionTrackingSchema.index({ riderId: 1, startTime: 1 });
riderSessionTrackingSchema.index({ work_date: 1, status: 1 });


riderSessionTrackingSchema.virtual('formattedDuration').get(function () {
  const hrs = Math.floor(this.duration / 3600);
  const mins = Math.floor((this.duration % 3600) / 60);
  const secs = this.duration % 60;
  return `${hrs}h ${mins}m ${secs}s`;
});

module.exports = mongoose.model('RiderSessionTracking', riderSessionTrackingSchema);
