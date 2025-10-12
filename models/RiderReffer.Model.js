const mongoose = require('mongoose');

const RiderRefferSchema = new mongoose.Schema({
    riderBH: {
        type: String,
        required: true,
        unique: true
    },
    referCount: {
        type: Number,
        default: 0
    },
    lastResetDate: {
        type: Date,
        default: () => {
            const now = new Date();
            // Set to start of current day (12 AM)
            return new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }
    }
}, { timestamps: true });

// Method to increment refer count with reset check
RiderRefferSchema.methods.incrementReferCount = async function() {
    const now = new Date();
    const currentDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Check if we need to reset the count (new day)
    if (this.lastResetDate < currentDayStart) {
        this.referCount = 0;
        this.lastResetDate = currentDayStart;
    }
    
    this.referCount += 1;
    await this.save();
    return this.referCount;
};

// Static method to get count for a specific rider within current day
RiderRefferSchema.statics.getDailyReferCount = async function(riderBH) {
    const now = new Date();
    const currentDayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    let riderRefer = await this.findOne({ riderBH });
    
    if (!riderRefer) {
        riderRefer = new this({
            riderBH,
            referCount: 0,
            lastResetDate: currentDayStart
        });
    }
    
    // Reset count if it's a new day
    if (riderRefer.lastResetDate < currentDayStart) {
        riderRefer.referCount = 0;
        riderRefer.lastResetDate = currentDayStart;
        await riderRefer.save();
    }
    
    return riderRefer.referCount;
};

module.exports = mongoose.model('RiderReffer', RiderRefferSchema);