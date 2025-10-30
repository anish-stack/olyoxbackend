const axios = require('axios');
require('dotenv').config();

const SAVE_RECORD_API = 'https://www.webapi.olyox.com/api/v1/create_sms_record';

exports.sendDltMessage = async (otp, number) => {
  let messageId = null;
  let apiResponse = null;

  try {
    // ================== 1️⃣ Validate Inputs ==================
    if (!otp || !number) {
      console.warn('[DLT] Missing OTP or phone number');
      await saveFailedRecord('Missing OTP or phone number', number);
      return { success: false, error: 'Missing OTP or phone number' };
    }

    const cleanNumber = String(number).trim().replace(/^\+91/, '');
    if (!/^\d{10,12}$/.test(cleanNumber)) {
      console.warn('[DLT] Invalid phone number:', cleanNumber);
      await saveFailedRecord('Invalid phone number', cleanNumber);
      return { success: false, error: 'Invalid phone number' };
    }

    // ================== 2️⃣ Prepare Message ==================
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

    console.log('[DLT] Sending DLT SMS to:', cleanNumber);
    console.log('[DLT] SMS Params:', smsParams);

    // ================== 3️⃣ Retry Mechanism ==================
    let attempt = 0;
    const maxAttempts = 3;
    let lastError = null;

    while (attempt < maxAttempts) {
      try {
        attempt++;
        console.log(`[DLT] Attempt ${attempt}/${maxAttempts} sending SMS...`);

        const response = await axios.get('http://nimbusit.biz/api/SmsApi/SendSingleApi', {
          params: smsParams,
          timeout: 10000,
        });

        apiResponse = response.data;
        console.log('[DLT] NimbusIT Response:', apiResponse);

        if (apiResponse?.Status === 'OK' && apiResponse?.Response?.Message) {
          const match = apiResponse.Response.Message.match(/Message ID:\s*(\d+)/i);
          messageId = match ? match[1] : null;

          console.log('[DLT] SMS Sent Successfully, Message ID:', messageId);
          break; // ✅ Success → stop retrying
        } else {
          throw new Error(`Invalid provider response: ${JSON.stringify(apiResponse)}`);
        }
      } catch (err) {
        lastError = err;
        console.warn(`[DLT] Attempt ${attempt} failed:`, err.message);

        // Wait 2 seconds before retrying
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    }

    // ================== 4️⃣ Save Result to DB ==================
    const payload = {
      messageId,
      messageResponse: apiResponse || { error: lastError?.message || 'Unknown error' },
      number: cleanNumber,
      status: messageId ? 'SUCCESS' : 'FAILED',
      attempts: attempt,
    };

    console.log('[DLT] Saving SMS record to DB:', payload);

    try {
      const saveRes = await axios.post(SAVE_RECORD_API, payload);

      if (saveRes.data.success) {
        console.log('[DLT] SMS record saved successfully with ID:', saveRes.data.data?._id);
      } else {
        console.error('[DLT] Failed to save SMS record:', saveRes.data);
      }
    } catch (saveErr) {
      console.error('[DLT] Could not save SMS record:', saveErr.message);
    }

    // ================== 5️⃣ Final Return ==================
    if (messageId) {
      return { success: true, messageId, attempts: attempt };
    } else {
      return { success: false, error: lastError?.message || 'SMS send failed', attempts: attempt };
    }
  } catch (error) {
    console.error('[DLT] Unhandled Error in sendDltMessage:', error);

    await saveFailedRecord(error.message, number);

    return {
      success: false,
      error: error.message,
    };
  }
};

// ================== 6️⃣ Helper Function: Save Failed Attempts ==================
async function saveFailedRecord(errorMessage, number) {
  try {
    const failedPayload = {
      messageId: null,
      messageResponse: `Error: ${errorMessage}`,
      number: String(number || '').trim(),
      status: 'FAILED',
      attempts: 0,
    };

    console.log('[DLT] Saving failed SMS record:', failedPayload);
    await axios.post(SAVE_RECORD_API, failedPayload);
    console.log('[DLT] Failed attempt saved successfully');
  } catch (saveErr) {
    console.error('[DLT] Failed to save failed record:', saveErr.message);
  }
}
