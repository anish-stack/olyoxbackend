const amqp = require("amqplib");

let channel = null;
let offlineQueue = []; // pending events

async function connectRabbitMQ() {
  try {
    const conn = await amqp.connect(process.env.RABBITMQ_URL);
    channel = await conn.createChannel();
    await channel.assertExchange("olyox.events", "topic", { durable: true });

    console.log("✅ RabbitMQ connected & channel ready");

    // agar offline queue me events hain to ab publish kar do
    while (offlineQueue.length > 0) {
      const { event, data } = offlineQueue.shift();
      publishEvent(event, data);
    }
  } catch (err) {
    console.error("❌ RabbitMQ connection error:", err);
    setTimeout(connectRabbitMQ, 5000); // retry after 5 sec
  }
}

function publishEvent(event, data) {
  if (!channel) {
    console.warn("⚠️ Channel not ready, queuing event:", event);
    offlineQueue.push({ event, data });
    return;
  }
  channel.publish("olyox.events", event, Buffer.from(JSON.stringify(data)));
  console.log("📤 Event published:", event, data);
}

module.exports = { connectRabbitMQ, publishEvent };
