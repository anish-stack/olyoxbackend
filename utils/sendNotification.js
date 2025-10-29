require("dotenv").config(); // ✅ Ensure .env variables are loaded early
const admin = require("firebase-admin");
const serviceAccount = require('./service.json');
// ──────────────────────────────
// Custom Error Classes
// ──────────────────────────────
class FirebaseInitializationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FirebaseInitializationError";
  }
}

class NotificationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "NotificationError";
    this.code = code;
  }
}

// ──────────────────────────────
// Logger Utility
// ──────────────────────────────
const logger = {
  info: (msg) => console.log(`ℹ️ ${msg}`),
  warn: (msg) => console.warn(`⚠️ ${msg}`),
  error: (msg) => console.error(`❌ ${msg}`),
  debug: (msg) => console.debug(`🐛 ${msg}`),
};

// ──────────────────────────────
// Firebase Initialization
// ──────────────────────────────
const initializeFirebase = () => {
  if (admin.apps.length > 0) {
    console.log("✅ Firebase already initialized");
    return admin;
  }

  console.log("🚀 Starting Firebase initialization...");

  try {
    // 🔍 Check if serviceAccount object is available
    if (!serviceAccount) {
      console.error("❌ No serviceAccount JSON found. Please ensure the file is loaded correctly.");
      throw new FirebaseInitializationError("Missing serviceAccount configuration file.");
    }

    // 🧩 Show key details for verification
    console.log("📄 Service Account Loaded:");
    console.log("  ├─ Project ID:", serviceAccount.project_id || "❌ Missing");
    console.log("  ├─ Client Email:", serviceAccount.client_email || "❌ Missing");
    console.log("  ├─ Private Key Present:", !!serviceAccount.private_key);

    // ⚙️ Fix escaped newlines if needed
    if (serviceAccount.private_key && serviceAccount.private_key.includes("\\n")) {
      console.log("🔧 Fixing escaped newlines (\\n) in private key...");
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, "\n");
    }

    // 🔐 Validate private key format
    if (!serviceAccount.private_key.includes("BEGIN PRIVATE KEY") || !serviceAccount.private_key.includes("END PRIVATE KEY")) {
      console.error("❌ Invalid PEM key format in serviceAccount.private_key!");
      throw new FirebaseInitializationError("Invalid PEM formatted message in private_key");
    }

    // 🚀 Initialize Firebase with the fixed serviceAccount
    console.log("🔥 Initializing Firebase Admin SDK with serviceAccount...");
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      databaseURL: process.env.FIREBASE_DATABASE_URL || "",
    });

    console.log("✅ Firebase Admin SDK initialized successfully");
    console.log("📡 Realtime Database URL:", process.env.FIREBASE_DATABASE_URL || "⚠️ Not provided");
    console.log("──────────────────────────────────────────────");

    return admin;
  } catch (error) {
    console.error("❌ 🔥 Firebase Initialization Failed:");
    console.error("   → Error Name:", error.name);
    console.error("   → Error Message:", error.message);
    console.error("   → Stack Trace:\n", error.stack);
    console.log("──────────────────────────────────────────────");
    throw new FirebaseInitializationError(error.message);
  }
};

// ──────────────────────────────
// Send Notification
// ──────────────────────────────
const sendNotification = async (token, title, body, eventData = null, channel) => {
  console.log("✅ Notification Channel:", channel);
  initializeFirebase();

  try {
    if (!token) {
      logger.error("❌ No FCM token provided");
      throw new NotificationError("No FCM token provided", "INVALID_TOKEN");
    }

    const message = {
      token,
      notification: {
        title: title || "New Ride",
        body: body || "You have a new notification",
      },
      android: {
        priority: "high",
        notification: {
          channelId: channel || "ride_channel",
          clickAction: "ACCEPT_RIDE_ACTION",
          imageUrl:
            "https://olyox.in/wp-content/uploads/2025/04/cropped-cropped-logo-CWkwXYQ_-removebg-preview.png",
        },
      },
    };

    // Add custom data payload if present
    if (eventData && Object.keys(eventData).length > 0) {
      const rideDetails = eventData.rideDetails || {};
      const pickup = rideDetails.pickup || {};
      const drop = rideDetails.drop || {};
      const pricing = rideDetails.pricing || {};

      message.data = {
        event: String(eventData.event || "DEFAULT_EVENT"),
        distance: String(rideDetails.distance || ""),
        distance_from_pickup_km: String(rideDetails.distance_from_pickup_km || ""),
        vehicleType: String(rideDetails.vehicleType || ""),
        rideId: String(rideDetails.rideId || ""),
        isRental: String(rideDetails.isRental || false),
        rentalHours: String(rideDetails.rentalHours || 0),
        rental_km_limit: String(rideDetails.rental_km_limit || 0),
        pickup: String(pickup.formatted_address || ""),
        drop: String(drop.formatted_address || ""),
        price: String(pricing.total_fare || ""),
      };
    }

    const response = await admin.messaging().send(message);
    logger.info("✅ Notification sent successfully");
    return response;
  } catch (error) {
    logger.error(`❌ Notification Error: ${error.message}`);
    if (error instanceof NotificationError) return null;
    return null;
  }
};

// ──────────────────────────────
// Test Hook (optional)
// ──────────────────────────────
if (require.main === module) {
  const testToken = process.env.TEST_FCM_TOKEN;
  if (testToken) {
    sendNotification(testToken, "Test Notification", "This is a test message")
      .then(() => logger.info("Test notification completed"))
      .catch(logger.error);
  } else {
    logger.warn("⚠️ TEST_FCM_TOKEN not found in .env file");
  }
}

module.exports = {
  initializeFirebase,
  sendNotification,
};
