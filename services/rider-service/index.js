const express = require("express");
const pino = require("pino");
const dotenv = require("dotenv");
const riderRoutes = require("./routes/riderRoutes.js");
const connectDB = require("./database/db.js");
const { connectRabbitMQ } = require("./RabbitMQ/mq.js");

dotenv.config();
const log = pino();
const app = express();

app.use(express.json());

// Health check
app.get("/health", (req, res) => res.send("Rider Service OK"));

// Rider routes
app.use("/riders", riderRoutes);

const PORT = process.env.PORT || 3001;

const startServer = async () => {
  try {
    await connectDB();
    await connectRabbitMQ();

    app.listen(PORT, () => log.info(`🚀 Rider service running on ${PORT}`));
  } catch (err) {
    log.error("❌ Failed to start Rider Service:", err);
    process.exit(1);
  }
};

startServer();
