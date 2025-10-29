require("dotenv").config(); // ✅ Ensure .env variables are loaded early
const admin = require("firebase-admin");

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
    logger.info("Firebase already initialized");
    return admin;
  }

  // ✅ Required Firebase keys
  const requiredEnvVars = [
    "FIREBASE_PROJECT_ID",
    "FIREBASE_PRIVATE_KEY_ID",
    "FIREBASE_PRIVATE_KEY",
    "FIREBASE_CLIENT_ID",
    "FIREBASE_AUTH_URI",
    "FIREBASE_TOKEN_URI",
    "FIREBASE_AUTH_PROVIDER_CERT_URL",
    "FIREBASE_CERT_URL",
  ];
  //  ❌ 🚫 Missing Firebase environment variables: FIREBASE_CLIENT_EMAIL, FIREBASE_CERT_URL


  const missingVars = requiredEnvVars.filter((key) => !process.env[key]);
  if (missingVars.length > 0) {
    const missingList = missingVars.join(", ");
    logger.error(`🚫 Missing Firebase environment variables: ${missingList}`);
    throw new FirebaseInitializationError(
      `Missing Firebase env vars: ${missingList}`
    );
  }

  const privateKey = "-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCwZFFhSzax3WGG\nUSNeMqdhu/Tua0iesgd6pOMvhxNFFh/naEfrWw//4U3WJNoi3NQJK3C/ZHx/pwb/\nHbUHMXRXRS4+WJcwYeHYrBm9dBmUtHXabbjsR0FvC8PuygAam+94DhAli+uQyuS6\nuvQubZk8kLY9HKHMjaHpBMOheNAjBCLIScL7AZHKaHlSmpkg/2GRGM7mHcGNz9S/\nwaCvzRpfIpLgIQjPIR7mdsuNzn5hBz2qb/FId7UWJONgv/1IUSVGW0SZ22R5VM+U\nj48LatvN32hWIyWhwwXMNW+RH5kNOwEf+SYSpfceMGCo+kQuWPw+brVNKKobI6IO\nsZoYkFWdAgMBAAECggEAAVl/JRXy8O7Dk5mr6tq0C0lpknPg0nozASHJ+O5TTXEK\nggppsYw71zfsqCYhtzn6uRD3FuX58uGhwV4sHZHcOrkptsGKcyQolRjiufyEwvNl\nVqCR4PumrXJxnubCQqwKiMLS92TCMX0qGp/rs5bIlW6Rvr+jOEf3C8j8QEqBDVvi\nsddB8ZJ4jjFOrEVd8pT8woxDzmK6R3g18ljsV6oMIa7ildNHtb4VC8qDnSCBLGSR\nvvRsU44l3Va2vsfYir4fSOcq6gvRUDWlgjRCqhAwY89ieUFFXIhcmeKCuwjyx9iM\n2bnC4eIVW7HjMrEkAEGuL0Zm58JSn8NY3pcjy6kVIQKBgQDWh5gjqnoTwhnNc5it\nYmzOUhEOiPj7ILbsjQ3qpznPT3vX2Io4tMRDqo9RVBRVaCheq6sLaedtqyiA3by2\nWFhkME7tL9GLC7h35RKaCE9gfU1QB7ceKZ9L+J1gqpJAVmNq1cBEoUQwNg6KXhe+\ndfiYyV53vpX2xljQCl0maq6cYQKBgQDSfWcQ8CyNKSIObEpFWMDh/YSVNF1Ta2uE\niEKlYn92mC1IYz3MgY0VIPRHImz5NT7T6drtj8qaOYcvYSqWFWacPrHxILo+CWRH\n437JtNl16HpfXL42eC0sEqKAB/WCW8Y1sTZsdLrBFztEkB82cSsUMiCLK1e2ORZK\nA31dYCIivQKBgDnnRVgzFloo5MAAeHAsBcQ2gGYU8GcP8G+urtfsJP1grcOXrc8a\nc3L0IVTJRee7glHzMeqVviJqtTb7IolxFQKNy2/XnU5Tbonl6Xxry8j2aRy1yGY6\nw8VEqG3D/E+jQZg/c3LSuE3u+UO9m9kLjHrotzfI2D9QT/5vHa9V0iVhAoGBALHK\ncpAADeF96OI93c4NVX6NYLuWa23Wwg5D+ecv93H4v+bwzHY8xyodl7euAFXO/66H\nTQB0ADGcfe8rJ4l1siIvYqXFewqDbEy8f49oTnYlU5fRAmmHwMAFTXTPRDRDyHv5\nn3qkbkpCkTEsevDFThnU7WAf0Ap+1bDWmcGRPcQRAoGBALrWHLixfYiUS04KGhJt\nfwmqDdX4aQX5oMnFrHmtY7nBlTaY/Ixk5cjYHD7XXDr9QevKAmDnN+LKRqsHL2JZ\nJOVZ9sIkIRZ2iLuT+9c0/d5ABHaa499XnC7FVV1Kx+vtin7EIPhbrd0WyGKtyEkU\nQBQHXpKohPyYmJTnJUOAU142\n-----END PRIVATE KEY-----\n"
  try {

    if (privateKey && privateKey.includes("\\n")) {
      console.log("🔧 Fixing escaped newlines (\\n) in private key...");
      privateKey = privateKey.replace(/\\n/g, "\n");
    }

    // 🔐 Validate private key format
    if (!privateKey.includes("BEGIN PRIVATE KEY") || !privateKey.includes("END PRIVATE KEY")) {
      console.error("❌ Invalid PEM key format in privateKey!");
      throw new FirebaseInitializationError("Invalid PEM formatted message in private_key");
    }
    const credentialConfig = {
      type: process.env.FIREBASE_TYPE || "service_account",
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: privateKey,
      client_email: process.env.FIREBASE_CLIENT_EMAIL || "firebase-adminsdk-fbsvc@olyox-6215a.iam.gserviceaccount.com",
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI,
      token_uri: process.env.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url:
        process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
      client_x509_cert_url: process.env.FIREBASE_CERT_URL,
    };

    admin.initializeApp({
      credential: admin.credential.cert(credentialConfig),
      databaseURL: process.env.FIREBASE_DATABASE_URL || "",
    });

    logger.info("✅ Firebase Admin SDK initialized successfully");
    return admin;
  } catch (error) {
    logger.error(`🔥 Firebase Initialization Failed: ${error.message}`);
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
