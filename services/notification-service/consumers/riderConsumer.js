// riderConsumer.js
import { consumeEvent } from "../mq.js";
import { SendWhatsAppMessage } from "../utils/whatsapp_send.js";
import { sendDltMessage } from "../utils/DltMessageSend.js";

export async function riderCreatedConsumer() {
  await consumeEvent("rider.created", async (data) => {
    const { name, phone, role, otp } = data;
    const msg = `Hi ${name},\nWelcome to Olyox!\nYour OTP for ${role} is ${otp}.`;
    await Promise.all([SendWhatsAppMessage(msg, phone), sendDltMessage(otp, phone)]);
  });
}

export async function riderOtpResentConsumer() {
  await consumeEvent("rider.otp.resent", async (data) => {
    const { name, phone, role, otp } = data;
    const msg = `Hi ${name},\nYour new OTP for ${role} is ${otp}.`;
    await Promise.all([SendWhatsAppMessage(msg, phone), sendDltMessage(otp, phone)]);
  });
}

export async function riderOtpBlockedConsumer() {
  await consumeEvent("rider.otp.blocked", async (data) => {
    const { name, phone } = data;
    const msg = `Hi ${name},\nYour account is blocked for 30 minutes due to too many OTP attempts.`;
    await SendWhatsAppMessage(msg, phone);
  });
}
