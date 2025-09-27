import "dotenv/config.js";
import pino from "pino";
import { connectMQ } from "./mq.js";
import { riderCreatedConsumer, riderOtpResentConsumer } from "./consumers/riderConsumer.js";

const log = pino({ name: "notification-service" });

const start = async () => {
  await connectMQ();
  await riderCreatedConsumer();
  await riderOtpResentConsumer();
  log.info("🚀 Notification Service started & consuming events...");
};

start();
