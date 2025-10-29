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

  const privateKey = "-----BEGIN PRIVATE KEY-----\nMIIEuwIBADANBgkqhkiG9w0BAQEFAASCBKUwggShAgEAAoIBAQC+Oql0e46R29KK\nuwGJgF8+geOHJvkZWYdYG+z8M908oXoFrSrBSAfalXDe9zznRVS1mzvrLMU+mCCZ\nboUYsOx+q6TWHSUqpAyWxKmugHQWaGUAPNB9BRLPHC/OL7vzzwU3dBLpDWbgOgHL\nMRfwussePLpVFQ9Zc8D3AtzVyhOen0nhNy+r9axhWv7MMUXcJfYJFg3yACEBld/e\nkTa+MsBaSPOrnIQ8Ao72a+YTyL8rQ2lvg6/91f7pa8LuSSTVCEiAeLiv/yWL2jT9\nQxOLDxfeW0HZCIOAHYKdgkRCsb9LEEAcstnl6Cvlmky3zPm5zvLDEZpebn37lPn2\nbGYWVQHFAgMBAAECgf808Z64DKthbQzsD6Ad5NydSQlKVE5//6rrmtoaV1T7yvVr\nHwcHRETrUSxY4fbRZzpsUQgcLBm5kh2AloH0nUk0+BCohvQRKhdW3uVa6+VjVyrF\nJifgo8jYW7/yYtasxLFu/Z9FvbUkMwDMzJ0dIt/lSoGRrIrZGp5aITHVTqinPLKA\nHKGJhNi96bRmMwg1rwkg89wFJraKRPdhvK2jVKy89knxCwNL0EVc4vumVthqE3OV\niV8hwlaiLQf/9f+BTIKmvvKA9IRG2rtqlv/0nC/10HtL2oMcCxt/vrKxSNTGzx+q\nuvhOOE/K0l49OFgtIX4d8T06BCrvl2zm2q+BFskCgYEA9jPZrZk57xxOc3J97WrV\nsXvcRu71nW2iV7toro8QI3Rf5c+nfxSHKANKM7vDXTvk8PV3wqwp5X+ZKU5tWCVU\nviRmimYNVC50wUVWyuvP5fdWKdaQ+ZM9X/hQ2QC9ngioNOBfuLovYBBGkjQaaoQv\nBafk0qO1NSAbdWjMNTPdGW0CgYEAxcyXa/rXGqYGct/iTRecoqSfUlaKIBVcmnUQ\n9jgVz9m912mV+EInn828v6/KHafKvfbyCXUh4E+423aRQK6iaxmUEnHRaFXGbkEY\nmU0cjF9g7H8EWnNpr4R9D9yDw59R8ivITtoyiVG0Ka2ZG7VDsrpl4vfI7zReK6ar\njemQ6rkCgYEAsNml71E1kFCg+cSwOC6ZuZfjLwDPZXovNx3joCAb05vwlr+G7X3t\naAyU7HxfZUV0urFYiXnpznTNrCIt4TdPnBXBooCT6nhEXeBU7AZfnC0Cs6LxGJVv\nbNSOHpKtoitNyE2z9JmpFjQavUK4BvNUY5eqgrQdoj+h+cCBj2Xl2DECgYBQuEp/\nJXHNDT4KeTVIEr+4XAgsuOZLa4xL+ERAxuiX1xszIoKyOoUjIPnLHDkWWxhQ58sk\ncumtObuNzFhAlkPwAxM7Z7l2o7KD4grg3OgunOnX+YnUQ884co/6/hnDpmvxsU5g\nZ4lCItasP40BErsa4BieRFJ609suYykVk+Cw+QKBgESucGLE/tj3qDS4IXFxBfD+\nes5IxfGcnVbi8aHpAIBngG7lLeVNlEkLlcZyAGSs/5XyVRxeRDbMO9f1Rpw0LcFx\n/4wE25lJumar6YBeJP7ZLq7AzXz39+LXs474XHWCjATTO4RngN6r1WDWtX7mNBVX\nn1BXVTgumgGxmXwml9fq\n-----END PRIVATE KEY-----\n"
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
    if (error.message.includes("invalid_grant")) {
      console.error("⚠️ HINT: Check server time (NTP sync) and service account validity.");
      console.log("🕒 Current Server Time:", new Date().toISOString());
    }

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
