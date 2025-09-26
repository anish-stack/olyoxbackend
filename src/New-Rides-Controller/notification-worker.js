// notification-worker.js
const { parentPort } = require('worker_threads');
const { sendNotification } = require('../../utils/sendNotification');

// Batch size for notifications
const BATCH_SIZE = 50;
const BATCH_DELAY = 100; // ms between batches

// Rate limiting
const rateLimiter = {
  tokens: 100,
  maxTokens: 100,
  refillRate: 10, // tokens per second
  lastRefill: Date.now(),
  
  consume(count = 1) {
    this.refill();
    if (this.tokens >= count) {
      this.tokens -= count;
      return true;
    }
    return false;
  },
  
  refill() {
    const now = Date.now();
    const timePassed = (now - this.lastRefill) / 1000;
    const tokensToAdd = Math.floor(timePassed * this.refillRate);
    
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }
};

// Queue for managing notifications
const notificationQueue = [];
let isProcessingQueue = false;

const processQueue = async () => {
  if (isProcessingQueue || notificationQueue.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  
  try {
    const batch = notificationQueue.splice(0, BATCH_SIZE);
    
    // Process batch in parallel with limited concurrency
    const promises = batch.map(async (notification) => {
      if (!rateLimiter.consume()) {
        // If rate limited, put back in queue
        notificationQueue.unshift(notification);
        return;
      }
      
      try {
        await sendSingleNotification(notification);
      } catch (error) {
        console.error('Notification send error:', error.message);
        // Could implement retry logic here
      }
    });
    
    await Promise.allSettled(promises);
    
    // Small delay between batches to prevent overwhelming
    if (notificationQueue.length > 0) {
      setTimeout(processQueue, BATCH_DELAY);
    }
    
  } catch (error) {
    console.error('Queue processing error:', error.message);
  } finally {
    isProcessingQueue = false;
  }
};

const sendSingleNotification = async ({ token, title, body, data, tag }) => {
  try {
    await sendNotification.sendNotification(token, title, body, data, tag);
  } catch (error) {
    // Log specific FCM errors for monitoring
    if (error.code === 'messaging/registration-token-not-registered') {
      console.log('Token expired:', token);
    } else {
      console.error('FCM Error:', error.message);
    }
    throw error;
  }
};

const handleUserNotification = async ({ token, title, body, data }) => {
  notificationQueue.push({
    token,
    title,
    body,
    data,
    priority: 'high' // User notifications are high priority
  });
  processQueue();
};

const handleBatchNotification = async ({ tokens, title, body, data }) => {
  // Add all tokens to queue
  tokens.forEach(token => {
    notificationQueue.push({
      token,
      title,
      body,
      data,
      tag: 'another_driver_accept',
      priority: 'normal'
    });
  });
  
  processQueue();
};

// Listen for messages from main thread
parentPort.on('message', async (message) => {
  try {
    switch (message.type) {
      case 'USER_NOTIFICATION':
        await handleUserNotification(message);
        break;
        
      case 'BATCH_NOTIFICATION':
        await handleBatchNotification(message);
        break;
        
      case 'HEALTH_CHECK':
        parentPort.postMessage({ 
          type: 'HEALTH_RESPONSE', 
          queueLength: notificationQueue.length,
          tokens: rateLimiter.tokens,
          timestamp: Date.now()
        });
        break;
        
      default:
        console.log('Unknown message type:', message.type);
    }
  } catch (error) {
    console.error('Worker message handling error:', error.message);
    parentPort.postMessage({ 
      type: 'ERROR', 
      message: error.message,
      originalMessage: message 
    });
  }
});

// Periodic queue processing (failsafe)
setInterval(() => {
  if (notificationQueue.length > 0) {
    processQueue();
  }
}, 5000);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Notification worker shutting down...');
  // Could implement graceful queue draining here
  process.exit(0);
});

console.log('Notification worker started');