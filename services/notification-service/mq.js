import amqp from "amqplib";

let channel;

export async function connectMQ() {
  const conn = await amqp.connect(process.env.RABBITMQ_URL);
  channel = await conn.createChannel();
  await channel.assertExchange("olyox.events", "topic", { durable: true });
  console.log("✅ Notification Service connected to RabbitMQ");
  return channel;
}

export async function consumeEvent(routingKey, handler) {
  if (!channel) throw new Error("Channel not initialized");
  const { queue } = await channel.assertQueue("", { exclusive: true });
  await channel.bindQueue(queue, "olyox.events", routingKey);

  channel.consume(queue, async (msg) => {
    if (msg !== null) {
      try {
        const data = JSON.parse(msg.content.toString());
        console.log(`📥 Event received [${routingKey}]`, data);
        await handler(data);
        channel.ack(msg);
      } catch (err) {
        console.error("❌ Consumer error:", err);
        channel.nack(msg, false, false); // dead-letter if fails
      }
    }
  });
}
