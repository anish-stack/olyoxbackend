const axios = require('axios');
require('dotenv').config();

const SendWhatsAppMessageUser = async (Message, MobileNumber, otp, isVendor = true) => {
    try {
        console.log('Starting SendWhatsAppMessage function...');
        console.log(`Message: ${Message}`);
        console.log(`MobileNumber: ${MobileNumber}`);
        console.log(`OTP: ${otp}`);
        console.log(`isVendor: ${isVendor}`);

        if (!Message || !MobileNumber) {
            return {
                success: false,
                message: 'Message and mobile number are required.',
            };
        }

        const isValidNumber = /^(?:\+91|91)?[6-9]\d{9}$/.test(MobileNumber);
        if (!isValidNumber) {
            return {
                success: false,
                message: `Invalid mobile number: ${MobileNumber}`,
            };
        }

        const apiKey = process.env.WHATSAPP_API_KEY;
        if (!apiKey) {
            return {
                success: false,
                message: 'Missing WhatsApp API key.',
            };
        }

        // ✅ Send SMS with OTP
        if (otp) {
            const smsMessage = `Dear Customer, your OTP for verification is ${otp}. Please do not share this OTP with anyone.\n\n- OLYOX Pvt. Ltd.`;
            const smsParams = {
                UserID: process.env.SMS_USER_ID,
                Password: process.env.SMS_PASSWORD,
                SenderID: process.env.SMS_SENDER_ID,
                Phno: MobileNumber,
                Msg: smsMessage,
                EntityID: process.env.SMS_ENTITY_ID,
                TemplateID: process.env.SMS_TEMPLATE_ID,
            };

            try {
                const smsResponse = await axios.get('http://nimbusit.biz/api/SmsApi/SendSingleApi', { params: smsParams });
                console.log('✅ SMS sent:', smsResponse.status);
            } catch (smsError) {
                console.error('❌ SMS send failed:', smsError.message || smsError);
            }
        }

        // ✅ WhatsApp message (include OTP if provided)
        const whatsappMessage = otp
            ? `${Message}\n\nYour OTP is: *${otp}*\n\n- OLYOX Pvt. Ltd.`
            : Message;

        try {
            const waResponse = await axios.get('https://api.wtap.sms4power.com/wapp/v2/api/send', {
                params: {
                    apikey: apiKey,
                    mobile: MobileNumber,
                    msg: whatsappMessage,
                },
            });
            console.log('✅ WhatsApp message sent:', waResponse.status);

            return {
                success: waResponse.status === 200,
                message: waResponse.status === 200
                    ? 'WhatsApp message sent successfully!'
                    : 'Failed to send WhatsApp message.',
            };
        } catch (waError) {
            console.error('❌ WhatsApp send failed:', waError.message || waError);
            return {
                success: false,
                message: 'Failed to send WhatsApp message.',
            };
        }

    } catch (error) {
        console.error('Unexpected error:', error.message || error);
        return {
            success: false,
            message: 'An error occurred while sending the message.',
        };
    }
};

module.exports = SendWhatsAppMessageUser;
