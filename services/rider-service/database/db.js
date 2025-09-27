const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_DB_URL, {
      maxPoolSize: 50,   // 🔥 zyada parallel connections allow
      minPoolSize: 10,
      socketTimeoutMS: 45000,
      ssl: true,         // Atlas ke liye zaroori
      retryWrites: true,
      serverSelectionTimeoutMS: 30000,
    });
    console.log("✅ Database Connected Successfully");
  } catch (error) {
    console.error("❌ Failed to Connect to Database", error);
    process.exit(1);
  }
};

module.exports = connectDB;
