const mongoose = require('mongoose');

const BonusSchema = new mongoose.Schema({
  requiredHours: {
    type: Number,
    required: true,
  },

  bonusCouponCode: {
    type: String,
    default: null,
  },

  bonusType: {
    type: String,
    enum: ['percentage', 'fixed'],
    default: 'fixed',
  },

  bonusValue: {
    type: Number,
    required: true,
  },

  bonusStatus: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active',
  },

  anyRequiredField: [{
    type: String,
  }],
  any_required_field: [{
    type: String,
  }],

  createdAt: {
    type: Date,
    default: Date.now,
  },
});

module.exports = mongoose.model('Bonus', BonusSchema);