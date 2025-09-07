const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const restaurantSchema = new mongoose.Schema({
    restaurant_name: {
        type: String,
        required: true,
        trim: true
    },
    restaurant_address: {
        street: String,
        city: String,
        state: String,
        zip: String
    },
    geo_location: {
        type: {
            type: String,
            enum: ['Point'],
            required: true
        },
        coordinates: {
            type: [Number],
            required: true
        }
    },
    restaurant_phone: {
        type: String,
        required: true
    },
    openingHours: {
        type: String,
        required: true
    },
    rating: {
        type: Number,
        default: 0
    },
    restaurant_contact: {
        type: Number,
        default: 0
    },
    logo: {
        url: {
            type: String,
            default: null
        },
        public_id: {
            type: String,
            default: null
        }
    },
    restaurant_category: {
        type: String,
        default: 'Veg',
        enum: ['Veg', 'Non-Veg', 'Veg-Non-Veg']
    },
    restaurant_fssai: {
        type: String,
        // required: true
    },
    restaurant_fssai_image: {
        url: {
            type: String
        },
        public_id: {
            type: String
        }
    },
    restaurant_pan_image: {
        url: {
            type: String
        },
        public_id: {
            type: String
        }
    },
    restaurant_adhar_front_image: {
        url: {
            type: String
        },
        public_id: {
            type: String
        }
    },
    restaurant_adhar_back_image: {
        url: {
            type: String
        },
        public_id: {
            type: String
        }
    },
    status: {
        type: Boolean,
        default: false
    },
    restaurant_BHID: {
        type: String,
        required: true
    },
    restaurant_in_top_list: {
        type: Boolean,
        default: false
    },
    otp: {
        type: String
    },
    isWorking: {
        type: Boolean,
        default: false
    },
    bank_details: {
        account_holder_name: {
            type: String,
            // required: true
        },
        account_number: {
            type: String,
            // required: true
        },
        ifsc_code: {
            type: String,
            // required: true
        },
        bank_name: {
            type: String,
            // required: true
        }
    },
    wallet: {
        type: Number,
        default: 0
    },
    referral_earning: {
        type: Number,
        default: 0
    },
    Password: {
        type: String
    },
    newPassword: {
        type: String
    },
    isOtpBlock: {
        type: Boolean,
        default: false
    },
    isDocumentUpload: {
        type: Boolean,
        default: false
    },
    otpUnblockAfterThisTime: {
        type: Date,
        default: null
    },
    howManyTimesHitResend: {
        type: Number,
        default: 0
    },
    isOtpVerify: {
        type: Boolean,
        default: false
    },
    documentVerify: {
        type: Boolean,
        default: false
    },
    priceForTwoPerson: {
        type: Number,
        default: 200
    },
    minDeliveryTime: {
        type: String,
        default: '40 mins'
    },
    minPrice: {
        type: Number,
        default: 200
    },
    IsProfileComplete: {
        type: Boolean,
        default: false
    },
    JsonData: {
        type: Object
    },
    is_restaurant_in_has_valid_recharge :{
        type: Boolean,
        default: false
    },
    RechargeData: {
        rechargePlan: String,
        expireData: Date,
        approveRecharge: Boolean,
         onHowManyEarning: String,
         whichDateRecharge:Date,
    },
    isPaid:{
        type:Boolean,
    },
    lastNotificationSent: {
        type: Date,
        default: null,
      },
      
}, {
    timestamps: true
});

restaurantSchema.index({ geo_location: '2dsphere' });

restaurantSchema.pre('save', async function (next) {
    if (!this.isModified('Password')) return next();
    try {
        const salt = await bcrypt.genSalt(10);
        this.Password = await bcrypt.hash(this.Password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

restaurantSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.Password);
}

const Restaurant = mongoose.model('Restaurant', restaurantSchema);

module.exports = Restaurant;
