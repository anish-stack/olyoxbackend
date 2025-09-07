const cron = require('node-cron');
const moment = require('moment');
const Riders = require('../models/Rider.model');
const Restaurant = require('../models/Tiifins/Resturant_register.model');
const HeavyVehiclePartners = require('../models/Heavy_vehicle/Heavy_vehicle_partners');
const SendWhatsAppMessage = require('../utils/whatsapp_send');

const startExpiryCheckJob = () => {
  cron.schedule('*/10 * * * * *', async () => {
    const now = moment();
    const today = moment().startOf('day');
    const hour = now.hour();

    console.log('🔄 [CRON] Running -', now.format('YYYY-MM-DD HH:mm:ss'));

    try {
      // ========== Riders ==========
      const riders = await Riders.find({ isPaid: true });

      for (const rider of riders) {
        const name = rider.name || 'Rider';
        const expireDate = moment(rider?.RechargeData?.expireData).startOf('day');
        const lastSent = moment(rider?.lastNotificationSent).startOf('day');
        const contact = rider?.number || rider?.phone || rider?.contact || 'N/A';
        const category = rider?.category || 'General';

        if (expireDate.isSameOrBefore(today)) {
          if (!lastSent.isSame(today)) {
            rider.isPaid = false;
            rider.isAvailable = false;
            rider.lastNotificationSent = now;
            await rider.save();

            if (hour >= 5 && hour < 24) {
              const message = `👋 Hello ${name},\n\nYour ${category.toUpperCase()} partner plan has expired today.\nPlease recharge to continue using our services.\n\nThanks,\nTeam`;
              console.log(`📱 WhatsApp to Rider: ${contact}`);
              await SendWhatsAppMessage(message, contact);
            } else {
              console.log(`🌙 Skipped Rider ${name} (quiet hours).`);
            }
          } else {
            console.log(`📭 Rider ${name} already notified today.`);
          }
        }
      }

      // ========== Restaurants ==========
      const restaurants = await Restaurant.find({ is_restaurant_in_has_valid_recharge: true });

      for (const rest of restaurants) {
        const name = rest.name || 'Restaurant';
        const expireDate = moment(rest?.RechargeData?.expireData).startOf('day');
        const lastSent = moment(rest?.lastNotificationSent).startOf('day');
        const contact = rest?.number || rest?.phone || rest?.contact || 'N/A';

        if (expireDate.isSameOrBefore(today)) {
          if (!lastSent.isSame(today)) {
            rest.is_restaurant_in_has_valid_recharge = false;
            rest.lastNotificationSent = now;
            await rest.save();

            if (hour >= 5 && hour < 24) {
              const message = `🍽️ Hello ${name},\n\nYour restaurant subscription expired today.\nPlease recharge to keep receiving orders.\n\nThanks,\nTeam`;
              console.log(`📱 WhatsApp to Restaurant: ${contact}`);
              await SendWhatsAppMessage(message, contact);
            } else {
              console.log(`🌙 Skipped Restaurant ${name} (quiet hours).`);
            }
          } else {
            console.log(`📭 Restaurant ${name} already notified today.`);
          }
        }
      }

      // ========== Heavy Vehicle Partners ==========
      const hvPartners = await HeavyVehiclePartners.find({ isPaid: true });

      for (const partner of hvPartners) {
        const name = partner.name || 'Heavy Partner';
        const expireDate = moment(partner?.RechargeData?.expireData).startOf('day');
        const lastSent = moment(partner?.lastNotificationSent).startOf('day');
        const contact = partner?.number || partner?.phone || partner?.contact || 'N/A';

        if (expireDate.isSameOrBefore(today)) {
          if (!lastSent.isSame(today)) {
            partner.isPaid = false;
            partner.RechargeData =null
            partner.isAvailable = false;
            partner.lastNotificationSent = now;
            await partner.save();

            if (hour >= 5 && hour < 24) {
              const message = `🚛 Hello ${name},\n\nYour Heavy Vehicle membership expired today.\nPlease recharge to continue.\n\nThanks,\nTeam`;
              console.log(`📱 WhatsApp to HV Partner: ${contact}`);
              await SendWhatsAppMessage(message, contact);
            } else {
              console.log(`🌙 Skipped HV ${name} (quiet hours).`);
            }
          } else {
            console.log(`📭 HV Partner ${name} already notified today.`);
          }
        }
      }

    } catch (error) {
      console.error('❌ [ERROR] Cron failed:', error.message);
    }

    console.log('-----------------------------');
  });
};

module.exports = startExpiryCheckJob;
