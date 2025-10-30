const axios = require('axios');
require('dotenv').config();

const SAVE_RECORD_API = 'https://www.webapi.olyox.com/api/v1/create_sms_record';

exports.sendDltMessage = async (otp, number) => {
  let messageId = null;
  let apiResponse = null;

  try {
    // === 1. Input Validation ===
    if (!otp || !number) {
      console.warn('OTP or phone number missing');
      return { success: false, error: 'Missing OTP or phone number' };
    }

    const cleanNumber = String(number).trim();
    if (!/^\d{10,12}$/.test(cleanNumber.replace(/^\+91/, ''))) {
      console.warn('Invalid phone number:', cleanNumber);
      return { success: false, error: 'Invalid phone number' };
    }

    // === 2. Build SMS Message ===
    const smsMessage = `Dear Customer, your OTP for verification is ${otp}. Please do not share this OTP with anyone.\n\n- OLYOX Pvt. Ltd.`;

    const smsParams = {
      UserID: process.env.SMS_USER_ID,
      Password: process.env.SMS_PASSWORD,
      SenderID: process.env.SMS_SENDER_ID,
      Phno: cleanNumber,
      Msg: smsMessage,
      EntityID: process.env.SMS_ENTITY_ID,
      TemplateID: process.env.SMS_TEMPLATE_ID,
    };

    console.log('Sending DLT SMS to:', cleanNumber);

    // === 3. Call NimbusIT SMS API ===
    const response = await axios.get('http://nimbusit.biz/api/SmsApi/SendSingleApi', {
      params: smsParams,
      timeout: 10000,
    });

    apiResponse = response.data;
    console.log('NimbusIT SMS Response:', apiResponse);

    // === 4. Extract Message ID ===
    if (apiResponse?.Status === 'OK' && apiResponse?.Response?.Message) {
      const match = apiResponse.Response.Message.match(/Message ID:\s*(\d+)/i);
      messageId = match ? match[1] : null;
      console.log('SMS sent. Message ID:', messageId);
    } else {
      console.warn('SMS failed at provider:', apiResponse);
    }

    // === 5. Save to Main DB via API ===
    const payload = {
      messageId,
      messageResponse: apiResponse,
      number: cleanNumber,
    };

    console.log('Saving SMS record to main DB:', payload);
    const saveRes = await axios.post(SAVE_RECORD_API, payload);

    if (saveRes.data.success) {
      console.log('SMS record saved in main DB:', saveRes.data.data._id);
    } else {
      console.error('Failed to save in main DB:', saveRes.data);
    }

    return {
      success: true,
      messageId,
      recordId: saveRes.data.data?._id,
    };
  } catch (error) {
    console.error('Failed to send/save SMS:', {
      message: error.message,
      stack: error.stack,
      config: error.config?.data,
    });

    // === 6. Save Failed Attempt ===
    try {
      const failedPayload = {
        messageId: null,
        messageResponse: `Error: ${error.message}`,
        number: String(number).trim(),
      };

      console.log('Saving failed SMS attempt:', failedPayload);
      await axios.post(SAVE_RECORD_API, failedPayload);
      console.log('Failed attempt recorded in main DB');
    } catch (saveErr) {
      console.error('Could not save failed attempt:', saveErr.message);
    }

    return {
      success: false,
      error: error.message,
    };
  }
};