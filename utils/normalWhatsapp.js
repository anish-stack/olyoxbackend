const axios = require('axios');
require('dotenv').config();

const SendWhatsAppMessageNormal = async (Message, MobileNumber) => {
    try {
        console.log('Starting SendWhatsAppMessage function...');
        console.log(`Input Message: ${Message}`);
        console.log(`Input MobileNumber: ${MobileNumber}`);
     
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

        console.log("MobileNumber",MobileNumber)
        const apiKey = process.env.WHATSAPP_API_KEY;
        if (!apiKey) {
            console.log('Missing WhatsApp API key.');
            return {
                success: false,
                message: 'Missing WhatsApp API key.',
            };
        }

        // URL-encode the message
        const encodedMessage = Message;

        console.log('Sending WhatsApp message...');
        const waResponse = await axios.get('https://api.wtap.sms4power.com/wapp/v2/api/send', {
            params: {
                apikey: apiKey,
                mobile: MobileNumber,
                msg: encodedMessage, // Use the encoded message here
            },
        });

        console.log('WhatsApp API response received:', waResponse.status);
        console.log('Response data:', waResponse.data);

        if (waResponse.status === 200) {
            return {
                success: true,
                message: 'WhatsApp message sent successfully!',
            };
        } else {
            console.log('Failed to send WhatsApp message, API response:', waResponse);
            return {
                success: false,
                message: 'Failed to send WhatsApp message.',
                errorDetails: waResponse.data,  // Capture detailed response for troubleshooting
            };
        }

    } catch (error) {
        console.error('Error sending WhatsApp message:', error);
        return {
            success: false,
            message: 'An error occurred while sending the WhatsApp message.',
            errorDetails: error.response ? error.response.data : error.message, // Log more error details
        };
    }
};

module.exports = SendWhatsAppMessageNormal;
