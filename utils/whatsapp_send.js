const axios = require('axios');
require('dotenv').config();
const SendWhatsAppMessage = async (Message, MobileNumber, otp, isVendor = false) => {
    try {
    

        if (!Message || !MobileNumber) {
            console.log('Validation failed: Missing message or mobile number.');
            return {
                success: false,
                message: 'Message and mobile number are required.',
            };
        }

        const isValidNumber = /^(?:\+91|91)?[6-9]\d{9}$/.test(MobileNumber);
        if (!isValidNumber) {
            console.log(`Validation failed: Invalid mobile number - ${MobileNumber}`);
            return {
                success: false,
                message: `Invalid mobile number: ${MobileNumber}`,
            };
        }

        const apiKey = process.env.WHATSAPP_API_KEY;
        if (!apiKey) {
            console.log('Missing WhatsApp API key.');
            return {
                success: false,
                message: 'Missing WhatsApp API key.',
            };
        }

        // ❌ Skip WhatsApp message if isVendor or otp exists
        if (isVendor && otp) {
            console.log('Skipping WhatsApp message because isVendor is true or OTP is present.');

            // ✅ Send backup SMS if OTP is provided
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

                console.log('Sending backup SMS:', smsParams);
                const smsResponse = await axios.get('http://nimbusit.biz/api/SmsApi/SendSingleApi', { params: smsParams });
                console.log('SMS API response received:', smsResponse.status);
            }

            return {
                success: true,
                message: 'Skipped WhatsApp message (isVendor or OTP present).',
            };
        }

        // ✅ Send WhatsApp message
        console.log('Sending WhatsApp message...');
        const waResponse = await axios.get('https://api.wtap.sms4power.com/wapp/v2/api/send', {
            params: {
                apikey: apiKey,
                mobile: MobileNumber,
                msg: Message,
            },
        });
        console.log('WhatsApp API response received:', waResponse.status);

        if (waResponse.status === 200) {
            return {
                success: true,
                message: 'WhatsApp message sent successfully!',
            };
        } else {
            return {
                success: false,
                message: 'Failed to send WhatsApp message.',
            };
        }

    } catch (error) {
        console.error('Error sending WhatsApp message:', error.message || error);
        return {
            success: false,
            message: 'An error occurred while sending the WhatsApp message.',
        };
    }
};

module.exports = SendWhatsAppMessage;
