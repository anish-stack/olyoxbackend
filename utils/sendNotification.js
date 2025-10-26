const admin = require("firebase-admin");
const { FIREBASE_CREDENTIALS_BASE64 } = require("./Key");

// Custom error classes for more specific error handling
class FirebaseInitializationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FirebaseInitializationError';
  }
}

class NotificationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'NotificationError';
    this.code = code;
  }
}

// Logging utility
const logger = {
  info: (message) => console.log(`ℹ️ ${message}`),
  warn: (message) => console.warn(`⚠️ ${message}`),
  error: (message) => console.error(`❌ ${message}`),
  debug: (message) => console.debug(`🐛 ${message}`)
};

const initializeFirebase = () => {
  if (admin.apps && admin.apps.length > 0) {
    logger.info('Firebase already initialized');
    return admin;
  }

  try {
    const credentialConfig = {
      type: process.env.FIREBASE_TYPE,
      project_id: process.env.FIREBASE_PROJECT_ID,
      private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
      private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.FIREBASE_CLIENT_EMAIL,
      client_id: process.env.FIREBASE_CLIENT_ID,
      auth_uri: process.env.FIREBASE_AUTH_URI,
      token_uri: process.env.FIREBASE_TOKEN_URI,
      auth_provider_x509_cert_url: process.env.FIREBASE_AUTH_PROVIDER_CERT_URL,
      client_x509_cert_url: process.env.FIREBASE_CERT_URL
    };

    admin.initializeApp({
      credential: admin.credential.cert(credentialConfig),
      databaseURL: process.env.FIREBASE_DATABASE_URL  // <-- here
    });

    logger.info('Firebase Admin SDK initialized successfully');
    return admin;
  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.error('Service account file could not be read');
    } else if (error.code === 'app/invalid-credential') {
      logger.error('Invalid Firebase credentials. Check service account.');
    } else {
      logger.error(`Unexpected Firebase Init Error: ${error.message}`);
    }
    logger.error('Firebase initialization failed');
    throw error;
  }
};

const sendNotification = async (token, title, body, eventData = null, channel) => {
      console.log("✅ channel",channel);

  try {
    // Validate input
    if (!token) {
      console.error("❌ No FCM token provided");
      throw new NotificationError("No FCM token provided", "INVALID_TOKEN");
    }

    // Ensure Firebase is initialized
    try {
      initializeFirebase();
    } catch (initError) {
      console.error("❌ Firebase init failed:", initError.message);
      throw new NotificationError("Failed to initialize Firebase", "INIT_FAILED");
    }

    // Build base message
    const message = {
      token,
      notification: {
        title: title || "New Ride by server",
        body: body || "New ride request",
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

    // Add data payload if eventData exists
    if (eventData && Object.keys(eventData).length > 0) {
      // Safely extract rideDetails with null checks
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

    // Send notification
    const response = await admin.messaging().send(message);
    console.log("✅ Notification sent successfully");

    return response;
  } catch (error) {
    console.error("❌ Error sending notification:", error.message);

    // Handle specific error codes
    switch (error.code) {
      case "messaging/invalid-argument":
        console.warn("⚠️ Invalid FCM message argument");
        break;
      case "messaging/invalid-recipient":
        console.warn("⚠️ Invalid FCM token");
        break;
      case "app/invalid-credential":
        console.error("❌ Firebase credential error");
        break;
      case "INIT_FAILED":
        console.error("❌ Firebase initialization failed");
        break;
      case "INVALID_TOKEN":
        console.warn("⚠️ No FCM token provided");
        break;
      default:
        console.error("❌ Notification send failed:", error.message);
    }

    if (error instanceof NotificationError) {
      return null;
    }

    return null;
  }
};


// Test hook for direct module execution
if (require.main === module) {
  const testToken = process.env.TEST_FCM_TOKEN;
  if (testToken) {
    sendNotification(testToken, "Test Notification", "This is a test notification")
      .then(() => logger.info("Test notification completed"))
      .catch(logger.error);
  }
}

module.exports = {
  initializeFirebase,
  sendNotification,
};