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
      databaseURL: process.env.FIREBASE_DATABASE_URL
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
// Enhanced debugging function for iOS notifications
const debugIOSNotification = async (token, title, body, eventData = {}) => {
  try {
    console.log("🔍 Starting iOS notification debug...");
    
         initializeFirebase();
   

    // Validate token format (iOS tokens are 64 hex characters)
    if (!token || token.length !== 64) {
      console.warn("⚠️ Invalid iOS token format. Should be 64 hex characters.");
    }

    // Simplified message for testing APNs authentication
    const testMessage = {
      token: token,
      
      notification: {
        title: title || "Test iOS Notification",
        body: body || "Testing APNs authentication",
      },

      // Minimal APNs config for testing
      apns: {
        headers: {
          "apns-priority": "10",
          "apns-push-type": "alert",
        },
        payload: {
          aps: {
            alert: {
              title: title || "Test iOS Notification",
              body: body || "Testing APNs authentication",
            },
            badge: 1,
            sound: "default",
            "content-available": 1,
          }
        },
      },

      // Minimal data payload
      data: {
        test: "true",
        timestamp: Date.now().toString(),
      },
    };

    console.log("📤 Sending test message:", JSON.stringify(testMessage, null, 2));

    const response = await admin.messaging().send(testMessage);
    
    console.log("✅ iOS notification sent successfully!");
    console.log("📊 Response:", response);
    return response;

  } catch (error) {
    console.error("❌ iOS Notification Debug Failed:");
    console.error("Error Code:", error.code);
    console.error("Error Message:", error.message);
    
    // Specific APNs error handling
    if (error.code === 'messaging/third-party-auth-error') {
      console.error("🔐 APNs Authentication Error - Check your APNs credentials in Firebase Console");
      console.error("Solutions:");
      console.error("1. Verify APNs Auth Key (.p8) is uploaded and valid");
      console.error("2. Check Key ID and Team ID are correct");
      console.error("3. Ensure Bundle ID matches exactly");
      console.error("4. Confirm APNs key has Push Notifications enabled");
    }
    
    throw error;
  }
};

// Validate APNs setup function
const validateAPNsSetup = () => {
  console.log("🔧 APNs Setup Checklist:");
  console.log("□ APNs Auth Key (.p8) uploaded to Firebase Console");
  console.log("□ Key ID entered correctly (10-character string)");
  console.log("□ Team ID entered correctly");
  console.log("□ Bundle ID matches iOS app exactly");
  console.log("□ APNs key has 'Apple Push Notifications service (APNs)' enabled");
  console.log("□ iOS app has notification permissions granted");
  console.log("□ Using correct environment (development/production)");
};

// Export the debug function
module.exports = {
  debugIOSNotification,
  validateAPNsSetup,
};