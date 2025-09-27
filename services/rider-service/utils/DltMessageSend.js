const axios = require('axios');
require('dotenv').config();

exports.sendDltMessage = async (otp, number) => {
  try {
    if (!otp || !number) {
      console.warn('OTP or phone number not provided for DLT SMS.');
      return;
    }

    const smsMessage = `Dear Customer, your OTP for verification is ${otp}. Please do not share this OTP with anyone.\n\n- OLYOX Pvt. Ltd.`;

    const smsParams = {
      UserID: process.env.SMS_USER_ID,
      Password: process.env.SMS_PASSWORD,
      SenderID: process.env.SMS_SENDER_ID,
      Phno: number,
      Msg: smsMessage,
      EntityID: process.env.SMS_ENTITY_ID,
      TemplateID: process.env.SMS_TEMPLATE_ID,
    };

    console.log('Sending DLT SMS to:', number);
    const response = await axios.get('http://nimbusit.biz/api/SmsApi/SendSingleApi', { params: smsParams });

    if (response.status === 200) {
      console.log('SMS sent successfully:', response.data);
    } else {
      console.warn('SMS API responded with status:', response.status, 'Response:', response.data);
    }
  } catch (error) {
    console.error('Failed to send DLT SMS:', {
      message: error.message,
      stack: error.stack,
    });
  }
};
