const express = require("express");
const http = require("http");
const cors = require("cors");
const { createClient } = require("redis");
const mongoose = require("mongoose");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const axios = require("axios");
require("dotenv").config();
const compression = require("compression");
// Database and Models
const cron = require("node-cron");
const connectDb = require("./database/db");
const { connectwebDb } = require("./PaymentWithWebDb/db");
const TrackEvent = require("./models/Admin/Tracking");
const RiderModel = require("./models/Rider.model");
const { Server } = require("socket.io");
const setupBullBoard = require("./bullboard");
// Routes
const router = require("./routes/routes");
const rides = require("./routes/rides.routes");
const hotelRouter = require("./routes/Hotel.routes");
const users = require("./routes/user_routes/user_routes");
const tiffin = require("./routes/Tiffin/Tiffin.routes");
const parcel = require("./routes/Parcel/Parcel.routes");
const admin = require("./routes/Admin/admin.routes");
const Heavy = require("./routes/Heavy_vehicle/Heavy.routes");
const NewRoutes = require("./routes/New/New.routes");
const cluster = require("cluster");
const os = require("os");

// Number of CPU cores
const numCPUs = os.cpus().length;

const Protect = require("./middleware/Auth");
const NewRideModelModel = require("./src/New-Rides-Controller/NewRideModel.model");
const {
  startNotificationScheduler,
} = require("./queues/ScheduleNotification.quee");
const sendNotification = require("./utils/sendNotification");
const seedHotels = require("./seed/Hotel.seed");

// Initialize Express and Server
const app = express();
app.set("trust proxy", 1);
const server = http.createServer(app);
// seedHotels()
// Socket.IO Configuration
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
  transports: ["websocket", "polling"],
});

// Redis Configuration
const redisOptions = {
  socket: {
    host: process.env.REDIS_HOST || "localhost",
    port: process.env.REDIS_PORT || 6379,
    reconnectStrategy: (retries) => {
      if (retries > 10) {
        console.error(
          `[${new Date().toISOString()}] Redis max retry attempts reached`
        );
        return new Error("Max retry attempts reached");
      }
      const delay = Math.min(retries * 1000, 5000);
      console.log(
        `[${new Date().toISOString()}] Redis reconnecting in ${delay}ms (attempt ${retries})`
      );
      return delay;
    },
  },
  password: process.env.REDIS_PASSWORD || undefined,
};

// Global Redis client
let pubClient;
let subClient;

// Redis Connection Function
async function connectRedis() {
  try {
    pubClient = createClient(redisOptions);

    pubClient.on("error", (err) => {
      console.error(
        `[${new Date().toISOString()}] Redis client error:`,
        err.message
      );
    });

    pubClient.on("connect", () => {
      console.log(`[${new Date().toISOString()}] Redis client connecting...`);
    });

    pubClient.on("ready", () => {
      console.log(`[${new Date().toISOString()}] Redis client ready`);
    });

    pubClient.on("end", () => {
      console.log(
        `[${new Date().toISOString()}] Redis client connection ended`
      );
    });

    pubClient.on("reconnecting", () => {
      console.log(`[${new Date().toISOString()}] Redis client reconnecting...`);
    });

    await pubClient.connect();
    console.log(`[${new Date().toISOString()}] Redis connected successfully`);

    // Make Redis client available to the app
    app.set("pubClient", pubClient);

    return pubClient;
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Redis connection failed:`,
      error.message
    );
    throw error;
  }
}

// Setup Socket.IO with Redis Adapter
async function setupSocketAdapter() {
  try {
    if (pubClient && pubClient.isOpen) {
      // Create a duplicate client for subscriptions
      subClient = pubClient.duplicate();
      await subClient.connect();

      const { createAdapter } = require("@socket.io/redis-adapter");
      io.adapter(createAdapter(pubClient, subClient));

      console.log(
        `[${new Date().toISOString()}] Socket.IO Redis adapter connected`
      );
    }
  } catch (error) {
    console.warn(
      `[${new Date().toISOString()}] Socket.IO Redis adapter setup failed:`,
      error.message
    );
    console.log(
      `[${new Date().toISOString()}] Running Socket.IO without Redis adapter`
    );
  }
}
const rideChatMap = new Map();
// Socket.IO Connection Handler
io.on("connection", (socket) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ✅ Socket connected: ${socket.id}`);

  // ==================== PING-PONG HANDLER ====================
  socket.on("ping", (data) => {
    const now = Date.now();
    console.log(
      `[${new Date().toISOString()}] 🏓 Ping received from ${socket.id}`
    );

    // Send pong back with the original timestamp
    socket.emit("pong", {
      timestamp: data.timestamp,
      serverTime: now,
    });
  });

  // Register user/driver with socket
  socket.on("register", async (data) => {
    try {
      const { userId, userType, name } = data;
      // console.log("Sokcet data",data)

      if (!userId || !userType) {
        socket.emit("error", { message: "userId and userType are required" });
        return;
      }

      // Store user data in socket
      socket.userId = userId;
      socket.userType = userType;
      socket.name = name || "Unknown";

      // Join user-specific room
      socket.join(`${userType}:${userId}`);

      // Store socket mapping in Redis
      if (pubClient && pubClient.isOpen) {
        await pubClient.setEx(
          `socket:${userType}:${userId}`,
          3600,
          JSON.stringify({
            socketId: socket.id,
            userId,
            userType,
            name,
            connectedAt: new Date().toISOString(),
          })
        );
      }

      console.log(
        `[${new Date().toISOString()}] User registered: ${userType}:${userId} (${name})`
      );
      socket.emit("registered", { success: true, socketId: socket.id });
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Registration error:`,
        error.message
      );
      socket.emit("error", { message: "Registration failed" });
    }
  });

  // Handle location updates via socket
  socket.on("location_update", async (data) => {
    try {
      const { latitude, longitude, accuracy, speed, timestamp } = data;

      if (!socket.userId) {
        socket.emit("error", { message: "Please register first" });
        return;
      }

      const locationData = {
        userId: socket.userId,
        userType: socket.userType,
        latitude,
        longitude,
        accuracy,
        speed,
        timestamp: timestamp || Date.now(),
      };

      // Cache in Redis
      if (pubClient && pubClient.isOpen) {
        await pubClient.setEx(
          `location:${socket.userType}:${socket.userId}`,
          30,
          JSON.stringify(locationData)
        );
      }

      console.log(
        `[${new Date().toISOString()}] Location update from ${
          socket.userType
        }:${socket.userId}`
      );
      socket.emit("location_ack", { success: true });
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Location update error:`,
        error.message
      );
      socket.emit("error", { message: "Location update failed" });
    }
  });

  socket.on("join_ride_chat", (data) => {
    const { ride_id } = data;
    if (!ride_id) {
      socket.emit("error", { message: "ride_id is required to join chat" });
      return;
    }

    socket.ride_id = ride_id;
    socket.join(`ride_chat:${ride_id}`);
    console.log(
      `[${new Date().toISOString()}] 🗨️ ${socket.userType}:${
        socket.userId
      } joined chat for ride ${ride_id}`
    );

    // Add socket to rideChatMap
    if (!rideChatMap.has(ride_id)) rideChatMap.set(ride_id, new Set());
    rideChatMap.get(ride_id).add(socket.id);

    socket.emit("chat_joined", { ride_id, success: true });
  });

  socket.on("chat_message", async (incomingData) => {
    try {
      console.log("⚡ Received incoming chat message:", incomingData);

      const data = incomingData?.data || incomingData;
      const { ride_id, message, who, timestamp } = data;

      if (!ride_id || !message || !who) {
        console.warn("⚠️ Missing required fields:", { ride_id, message, who });
        socket.emit("error", {
          message: "ride_id, message, and who are required",
        });
        return;
      }
      console.log(
        `📝 Processing message for ride_id: ${ride_id}, from: ${who}`
      );

      const ride = await NewRideModelModel.findById(ride_id);
      if (!ride) {
        console.warn(`❌ Ride not found for ride_id: ${ride_id}`);
        socket.emit("error", { message: "Ride not found" });
        return;
      }
      console.log("✅ Ride found:", ride_id);

      const toUserId = who === "driver" ? ride.user : ride.driver;
      if (!toUserId) {
        console.warn("❌ Recipient not found for this ride:", ride_id);
        socket.emit("error", { message: "Recipient not found for this ride" });
        return;
      }
      console.log("👤 Message recipient userId:", toUserId);

      const chatData = {
        from: socket.userId,
        fromType: who,
        to: toUserId,
        message,
        ride_id,
        seen: false,
        createdAt: timestamp ? new Date(timestamp) : new Date(),
        updatedAt: new Date(),
      };
      console.log("💬 Chat data prepared:", chatData);

      const chatRoom = `ride_chat:${ride_id}`;

      // Emit to all sockets in the room
      io.to(chatRoom).emit("chat_message", chatData);
      console.log(`📢 Message broadcasted to room: ${chatRoom}`);

      // Emit to the specific recipient if connected in this ride
      const socketsInRoom = rideChatMap.get(ride_id) || new Set();
      for (let socketId of socketsInRoom) {
        const s = io.sockets.sockets.get(socketId);
        if (s && s.userId === toUserId) {
          s.emit("chat_message", chatData);
          console.log(
            `📩 Message sent directly to user ${toUserId} (socketId: ${socketId})`
          );
        }
      }

      // Save chat to ride
      ride.chat = ride.chat || [];
      ride.chat.push(chatData);
      await ride.save();
      console.log("💾 Chat saved to ride successfully");

      console.log(
        `[${new Date().toISOString()}] ✅ ${who.toUpperCase()} sent message in ride ${ride_id}: "${message}"`
      );
    } catch (err) {
      console.error("❌ Error handling chat_message:", err);
      socket.emit("error", { message: "Failed to send chat message" });
    }
  });

  // Backend socket handler
  socket.on("get_all_messages", async (data) => {
    try {
      const { ride_id } = data;
      console.log(ride_id);
      if (!ride_id) {
        socket.emit("error", {
          message: "ride_id is required to fetch messages",
        });
        return;
      }

      // Fetch ride by ID
      const ride = await NewRideModelModel.findById(ride_id).lean();
      if (!ride) {
        socket.emit("error", { message: "Ride not found" });
        return;
      }

      let messages = Array.isArray(ride.chat) ? ride.chat : [];
      messages.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
      // Optionally mark messages as seen for this user
      await NewRideModelModel.findByIdAndUpdate(
        ride_id,
        {
          $set: {
            "chat.$[elem].seen": true,
          },
        },
        {
          arrayFilters: [{ "elem.to": socket.userId, "elem.seen": false }],
          new: true,
        }
      );

      socket.emit("all_messages", { messages });
    } catch (err) {
      console.error("❌ Error fetching all messages:", err);
      socket.emit("error", { message: "Failed to fetch messages" });
    }
  });

  // Handle custom events
  socket.on("message", (data) => {
    console.log(
      `[${new Date().toISOString()}] Message from ${socket.id}:`,
      data
    );
    socket.emit("message_ack", {
      received: true,
      timestamp: new Date().toISOString(),
    });
  });

  // Handle reconnection
  socket.on("reconnect", async (attemptNumber) => {
    console.log(
      `[${new Date().toISOString()}] Socket ${
        socket.id
      } reconnected after ${attemptNumber} attempts`
    );

    if (socket.userId && socket.userType) {
      // Re-register user in Redis
      if (pubClient && pubClient.isOpen) {
        await pubClient.setEx(
          `socket:${socket.userType}:${socket.userId}`,
          3600,
          JSON.stringify({
            socketId: socket.id,
            userId: socket.userId,
            userType: socket.userType,
            name: socket.name,
            reconnectedAt: new Date().toISOString(),
          })
        );
      }
    }
  });

  // Handle disconnection
  socket.on("disconnect", async (reason) => {
    console.log(
      `[${new Date().toISOString()}] ❌ Socket disconnected: ${
        socket.id
      }, Reason: ${reason}`
    );

    // Clean up Redis data
    if (socket.userId && socket.userType && pubClient && pubClient.isOpen) {
      try {
        await pubClient.del(`socket:${socket.userType}:${socket.userId}`);
        console.log(
          `[${new Date().toISOString()}] Cleaned up Redis data for ${
            socket.userType
          }:${socket.userId}`
        );
      } catch (error) {
        console.error(
          `[${new Date().toISOString()}] Error cleaning up Redis:`,
          error.message
        );
      }
    }
  });

  // Handle errors
  socket.on("error", (error) => {
    console.error(
      `[${new Date().toISOString()}] Socket error for ${socket.id}:`,
      error.message
    );
  });
});

// Make Socket.IO available to the app
app.set("io", io);

// Database Connection Functions
async function connectDatabases() {
  try {
    await connectDb();
    console.log(`[${new Date().toISOString()}] Main database connected`);

    await connectwebDb();
    console.log(`[${new Date().toISOString()}] Web database connected`);
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Database connection failed:`,
      error.message
    );
    throw error;
  }
}

// Multer for File Uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware
app.use(cors({ origin: "*", credentials: true }));
setupBullBoard(app);
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300000,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later.",
  keyGenerator: (req) => req.ip || req.headers["x-forwarded-for"] || "unknown",
});

app.use(limiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Middleware to check Redis connection
app.use((req, res, next) => {
  if (!pubClient || !pubClient.isOpen) {
    console.warn(
      `[${new Date().toISOString()}] Redis client not available for request: ${
        req.path
      }`
    );
  }
  next();
});
// ia am ams
// Long Polling Updates Endpoint
app.get("/updates/:userId/:userType", async (req, res) => {
  const { userId, userType } = req.params;
  const validTypes = ["user", "driver", "tiffin_partner"];

  if (!validTypes.includes(userType)) {
    return res
      .status(400)
      .json({ success: false, message: "Invalid user type" });
  }

  if (!pubClient || !pubClient.isOpen) {
    return res
      .status(503)
      .json({ success: false, message: "Redis service unavailable" });
  }

  const timeoutMs = 30000;
  const startTime = Date.now();
  const key = `${userType}:${userId}:updates`;

  try {
    // Register client as active
    await pubClient.set(`active:${userType}:${userId}`, "1", { EX: 3600 });

    while (Date.now() - startTime < timeoutMs) {
      const updates = await pubClient.lPop(key);
      if (updates) {
        const data = JSON.parse(updates);
        return res.json({ success: true, updates: data });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    res.json({ success: true, updates: null });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Polling error for ${userType}:${userId}:`,
      err.message
    );
    res.status(500).json({ success: false, message: "Polling failed" });
  }
});

app.get("/run-migration", async (req, res) => {
  try {
    // Step 1: Clean up invalid position values
    await RiderModel.updateMany(
      {
        $or: [
          { position: { $exists: false } },
          { position: null },
          { position: { $type: ["null", "undefined"] } },
        ],
      },
      { $unset: { position: "" } }
    );
    console.log("Cleared invalid position values");

    // Step 2: Find riders without a position
    const riders = await RiderModel.find({
      position: { $exists: false },
    }).exec();
    console.log(`Found ${riders.length} riders without a position`);

    // Step 3: Find the rider with the highest valid position
    const lastRider = await RiderModel.findOne({
      position: { $exists: true, $ne: null, $type: "number" },
    })
      .sort({ position: -1 })
      .exec();

    let currentPosition =
      lastRider && Number.isFinite(lastRider.position) ? lastRider.position : 0;
    console.log(`Starting position: ${currentPosition}`);

    // Step 4: Assign positions to riders
    for (const rider of riders) {
      currentPosition += 1;
      rider.position = currentPosition;
      try {
        await rider.save();
        console.log(
          `Assigned position ${currentPosition} to rider ${rider._id}`
        );
      } catch (err) {
        console.error(`Failed to save rider ${rider._id}:`, err);
      }
    }

    res.send("Migration completed successfully.");
  } catch (error) {
    console.error("Migration failed:", error);
    res.status(500).send(`Migration failed: ${error.message}`);
  }
});

app.post("/track", Protect, async (req, res) => {
  try {
    const userId = req.user?.user._id || req.user._id; // from Protect middleware

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // 📦 Extract fields from body
    const {
      event, // e.g. SCREEN_VIEW / ACTION
      screen, // e.g. "RideBooking"
      action, // e.g. "book_ride"
      params, // extra data
      device, // android / ios
      timestamp, // optional, else we use now
    } = req.body;

    // ✅ Basic validation
    if (!event || !screen || !action) {
      return res.status(400).json({
        error: "Missing required fields: event, screen, action",
      });
    }

    // 📌 Prepare new event object
    const trackEvent = new TrackEvent({
      userId,
      event,
      screen,
      action,
      params: params || {},
      device: device || "unknown",
      ip: req.ip,
      timestamp: timestamp ? new Date(timestamp) : new Date(),
    });

    // 💾 Save to DB
    await trackEvent.save();
    return res.json({ success: true, eventId: trackEvent._id });
  } catch (err) {
    console.error("❌ Track Event Error:", err);
    return res.status(500).json({ error: "Server error: " + err.message });
  }
});

app.get("/track/user/:id", async (req, res) => {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "No ID provided",
      });
    }

    const findTrack = await TrackEvent.find({ userId: id })
      .select("-userId")
      .sort({ createdAt: -1 });

    if (!findTrack || findTrack.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No track events found for this user",
      });
    }

    res.status(200).json({
      success: true,
      count: findTrack.length,
      data: findTrack,
    });
  } catch (error) {
    console.error("Error fetching track events:", error);
    res.status(500).json({
      success: false,
      message: "Server error",
      error: error.message,
    });
  }
});

app.post("/directions", async (req, res) => {
  try {
    const data = req.body || {};

    if (
      !data?.pickup?.latitude ||
      !data?.pickup?.longitude ||
      !data?.dropoff?.latitude ||
      !data?.dropoff?.longitude
    ) {
      return res
        .status(400)
        .json({ error: "Invalid pickup or dropoff location data" });
    }

    // Create a unique cache key based on coordinates
    const cacheKey = `directions:${data.pickup.latitude},${data.pickup.longitude}:${data.dropoff.latitude},${data.dropoff.longitude}`;

    const startTime = Date.now();

    // Try fetching from Redis cache
    const cachedData = await pubClient.get(cacheKey);
    if (cachedData) {
      const timeTakenMs = Date.now() - startTime;
      const result = JSON.parse(cachedData);

      console.log(
        `[${new Date().toISOString()}] Successfully fetched directions from cache for key: ${cacheKey} (took ${timeTakenMs} ms)`
      );

      return res.json({
        ...result,
        source: "cache",
        timeTakenMs,
      });
    }

    // If no cache, call Google Maps API
    const googleMapsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${data?.pickup?.latitude},${data?.pickup?.longitude}&destination=${data?.dropoff?.latitude},${data?.dropoff?.longitude}&key=${process.env.GOOGLE_MAP_KEY}`;
    const apiStartTime = Date.now();
    const response = await axios.get(googleMapsUrl);
    const apiTimeTakenMs = Date.now() - apiStartTime;

    if (
      response.data.routes &&
      response.data.routes[0] &&
      response.data.routes[0].legs
    ) {
      const leg = response.data.routes[0].legs[0];
      const polyline = response.data.routes[0].overview_polyline.points;

      const result = {
        distance: leg.distance.text,
        duration: leg.duration.text,
        polyline,
      };

      // Save to Redis cache with expiration (e.g., 1 hour = 3600 seconds)
      await pubClient.setEx(cacheKey, 3600, JSON.stringify(result));

      console.log(
        `[${new Date().toISOString()}] Successfully fetched directions from Google API for key: ${cacheKey} (took ${apiTimeTakenMs} ms)`
      );
      console.log("Passing API result to client:", result);

      return res.json({
        ...result,
        source: "google-api",
        timeTakenMs: apiTimeTakenMs,
      });
    } else {
      return res.status(404).json({ error: "No route found" });
    }
  } catch (error) {
    console.error("Error fetching directions:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// List Available Riders
app.get("/rider", async (req, res) => {
  try {
    const riders = await RiderModel.find({ isAvailable: true });
    res.json({ success: true, riders });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] List riders error:`,
      err.message
    );
    res.status(500).json({ success: false, error: "Failed to list riders" });
  }
});

const rideCache = new Map();

// Throttle Map: key = rideId, value = timestamp of last request
const rideThrottle = new Map();

// TTL & throttle window in milliseconds
const CACHE_TTL = 30 * 1000; // 30 seconds
const THROTTLE_WINDOW = 1000; // 1 second per ride per requester

app.get("/rider/:tempRide", async (req, res) => {
  const { tempRide } = req.params;
  const requesterIp = req.ip; // use IP to throttle per user
  const throttleKey = `${tempRide}_${requesterIp}`;

  if (!mongoose.Types.ObjectId.isValid(tempRide)) {
    return res.status(400).json({ error: "Invalid ride ID" });
  }

  const now = Date.now();

  // Throttle check
  const lastRequest = rideThrottle.get(throttleKey);
  if (lastRequest && now - lastRequest < THROTTLE_WINDOW) {
    return res
      .status(429)
      .json({ error: "Too many requests. Try again shortly." });
  }
  rideThrottle.set(throttleKey, now);

  // Cache check
  const cached = rideCache.get(tempRide);
  if (cached && cached.expiresAt > now) {
    return res
      .status(200)
      .json({ success: true, data: cached.data, cached: true });
  }

  try {
    let ride = await NewRideModelModel.findById(tempRide)
      .select("-__v -updatedAt -notified_riders")
      .populate("user", "name email number")
      .populate("driver", "-documents -preferences -updateLogs -RechargeData")
      .lean()
      .exec();

    if (!ride) {
      console.log(
        `ℹ️ Ride not found by _id, checking intercityRideModel for ${tempRide}...`
      );
      ride = await NewRideModelModel.findOne({ intercityRideModel: tempRide })
        .select("-__v -updatedAt -notified_riders")
        .populate("user", "name email number")
        .populate(
          "driver",
          "-documents -preferences -updateLogs -RechargeData -activityLog"
        )
        .lean();
    }

    if (!ride) {
      return res.status(404).json({ error: "Ride not found" });
    }

    // Store in cache with TTL
    rideCache.set(tempRide, { data: ride, expiresAt: now + CACHE_TTL });

    return res.status(200).json({ success: true, data: ride, cached: false });
  } catch (error) {
    console.error(
      `[ERROR] ${new Date().toISOString()} Internal server error:`,
      error
    );
    return res.status(500).json({ error: "Internal server error" });
  }
});

app.post("/autocomplete", async (req, res) => {
  const { input } = req.body;

  if (!input || input.trim().length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "Input text is required" });
  }

  const cacheKey = `autocomplete:${input.trim().toLowerCase()}`;
  const apiKey = "AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8"; // fallback for testing only

  try {
    // 🔹 Try Redis cache first
    if (pubClient && pubClient.isOpen) {
      const cached = await pubClient.get(cacheKey);
      if (cached) {
        return res.status(200).json({
          success: true,
          data: JSON.parse(cached),
          message: "Fetched from cache",
        });
      }
    }

    // 🔹 Call Google Places Autocomplete API
    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/place/autocomplete/json",
      {
        params: {
          input: input,
          key: apiKey,
          components: "country:in", // restrict to India (optional)
          sessiontoken: Date.now(), // helps Google optimize billing
        },
      }
    );

    if (
      response.data.status !== "OK" &&
      response.data.status !== "ZERO_RESULTS"
    ) {
      return res.status(400).json({
        success: false,
        message: response.data.error_message || "Failed to fetch suggestions",
      });
    }

    const suggestions = response.data.predictions.map((p) => ({
      description: p.description,
      place_id: p.place_id,
      main_text: p.structured_formatting.main_text,
      secondary_text: p.structured_formatting.secondary_text,
    }));

    // 🔹 Cache the response for 15 minutes
    if (pubClient && pubClient.isOpen) {
      await pubClient.setEx(cacheKey, 900, JSON.stringify(suggestions));
    }

    res.status(200).json({
      success: true,
      data: suggestions,
      message: "Autocomplete results fetched successfully",
    });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Autocomplete error:`,
      err.message
    );
    res.status(500).json({
      success: false,
      message: "Failed to fetch autocomplete results",
    });
  }
});

app.get("/rider-light/:tempRide", async (req, res) => {
  const { tempRide } = req.params;

  if (!mongoose.Types.ObjectId.isValid(tempRide)) {
    console.warn("[STEP 2] Invalid ride ID");
    return res.status(400).json({ error: "Invalid ride ID" });
  }

  try {
    console.log("[STEP 3] Fetching lightweight ride data from MongoDB...");

    const ride = await NewRideModelModel.findById(tempRide)
      .select("ride_status payment_status pickup_location")
      .populate({
        path: "driver",
        select: "location", // Only select driver's location field
      })
      .lean()
      .exec();

    if (!ride) {
      console.warn("[STEP 4] Ride not found in MongoDB");
      return res.status(404).json({ error: "Ride not found" });
    }

    // Return only the essential fields in a clean structure
    return res.status(200).json({
      success: true,
      data: {
        rideId: tempRide || ride?._id,
        payment_status: ride.payment_status,
        ride_status: ride.ride_status,
        pickup: ride.pickup_location,
        driver_location: ride.driver?.location,
        updated_at: ride.updatedAt, // Optional: for client-side timestamp tracking
      },
    });
  } catch (error) {
    console.error(
      `[ERROR] ${new Date().toISOString()} Internal server error:`,
      error
    );
    return res.status(500).json({ error: "Internal server error" });
  }
});

const GEO_UPDATE_TTL = 30; // seconds
const GEO_BATCH_KEY = "rider:location:batch";
const DB_FLUSH_INTERVAL = 30 * 1000; // 30s
const MAX_DISTANCE_THRESHOLD = 50; // meters

function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371e3; // meters
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 🔁 Async batch flush to DB
const flushLocationsToDB = async () => {
  try {
    if (!pubClient) {
      console.error("❌ Redis client not initialized!");
      return;
    }

    if (!pubClient.isOpen) await pubClient.connect();

    const ridersData = await pubClient.zRangeWithScores(GEO_BATCH_KEY, 0, -1);
    if (!ridersData || ridersData.length === 0) return;

    const updatePromises = ridersData.map(async ({ value: riderId }) => {
      try {
        const locStr = await pubClient.get(`rider:location:${riderId}`);
        if (!locStr) return;

        const loc = JSON.parse(locStr);

        await RiderModel.findOneAndUpdate(
          { _id: riderId },
          {
            location: {
              type: "Point",
              coordinates: [loc.longitude, loc.latitude],
            },
            lastUpdated: new Date(loc.timestamp),
          },
          { upsert: true, new: true }
        );

        await pubClient.zRem(GEO_BATCH_KEY, riderId);
      } catch (err) {
        console.error(`❌ DB update failed for rider ${riderId}:`, err.message);
      }
    });

    await Promise.all(updatePromises);
  } catch (err) {
    console.error("❌ Redis batch fetch error:", err.message);
  }
};

setInterval(flushLocationsToDB, DB_FLUSH_INTERVAL);

// In-memory cache to throttle database writes
const locationUpdateCache = new Map();
const UPDATE_INTERVAL = 5000; // Update DB every 5 seconds per rider
const MIN_DISTANCE_METERS = 100; // Minimum distance to trigger update

// Helper function to calculate distance between two coordinates (Haversine formula)
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
};

// Cleanup old cache entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [riderId, data] of locationUpdateCache.entries()) {
    if (now - data.lastUpdate > 600000) {
      // 10 minutes
      locationUpdateCache.delete(riderId);
    }
  }
}, 600000);

app.post("/webhook/cab-receive-location", Protect, async (req, res) => {
  try {
    const riderId = req.user?.userId;
    if (!riderId) {
      console.log("⛔ No Rider ID in token");
      return res.status(401).json({
        success: false,
        message: "Unauthorized - No rider ID",
      });
    }

    const { latitude, longitude, accuracy, speed, timestamp, platform } =
      req.body;

    // Validate coordinates
    if (
      !latitude ||
      !longitude ||
      latitude < -90 ||
      latitude > 90 ||
      longitude < -180 ||
      longitude > 180
    ) {
      return res.status(400).json({
        success: false,
        message: "Invalid coordinates",
      });
    }

    const now = timestamp || Date.now();
    const cacheKey = riderId.toString();
    const cachedData = locationUpdateCache.get(cacheKey);

    // Calculate distance from last cached location
    let distanceMoved = 0;
    if (cachedData && cachedData.location) {
      const [oldLon, oldLat] = cachedData.location.coordinates;
      distanceMoved = calculateDistance(oldLat, oldLon, latitude, longitude);
    }

    // Determine if DB update should happen
    const timePassed = cachedData
      ? now - cachedData.lastUpdate >= UPDATE_INTERVAL
      : true;
    const distanceThreshold = distanceMoved >= MIN_DISTANCE_METERS;
    const shouldUpdateDB = !cachedData || (timePassed && distanceThreshold);

    // Always respond quickly to the client
    const newLocation = {
      type: "Point",
      coordinates: [longitude, latitude],
    };

    // Store in cache immediately
    locationUpdateCache.set(cacheKey, {
      location: newLocation,
      lastUpdate: now,
      accuracy,
      speed,
      platform,
    });

    // console.log(`📍 [${riderId.slice(-6)}] Distance: ${distanceMoved.toFixed(1)}m | ${shouldUpdateDB ? '💾 DB Update' : `⏭️ Skipped (${distanceMoved < MIN_DISTANCE_METERS ? 'distance' : 'time'})`}`);

    // Update database only if throttle interval has passed AND distance > 100m
    if (shouldUpdateDB) {
      RiderModel.findByIdAndUpdate(
        riderId,
        {
          location: newLocation,
          lastUpdated: now,
        },
        { new: false } // Don't return updated document to save processing
      )
        .then(() => {
          // console.log(`✅ [${riderId.slice(-6)}] DB updated (${distanceMoved.toFixed(1)}m moved)`);
        })
        .catch((err) => {
          console.error(`❌ DB Update failed for ${riderId}:`, err.message);
        });
    }

    // Quick response to client
    return res.status(200).json({
      success: true,
      message: "Location received",
      cached: !shouldUpdateDB,
      distanceMoved: Math.round(distanceMoved),
      nextDbUpdate: shouldUpdateDB
        ? 0
        : UPDATE_INTERVAL - (now - cachedData.lastUpdate),
    });
  } catch (err) {
    console.error("❌ Error in location webhook:", err);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

// Optional: Periodic bulk update from cache to DB (backup mechanism)
setInterval(async () => {
  if (locationUpdateCache.size === 0) return;

  console.log(`🔄 Bulk sync: ${locationUpdateCache.size} riders`);

  const bulkOps = [];
  const now = Date.now();

  for (const [riderId, data] of locationUpdateCache.entries()) {
    // Only sync if not updated in last 2 seconds (avoid duplicate writes)
    if (now - data.lastUpdate > 2000) {
      bulkOps.push({
        updateOne: {
          filter: { _id: riderId },
          update: {
            location: data.location,
            lastUpdated: data.lastUpdate,
          },
        },
      });
    }
  }

  if (bulkOps.length > 0) {
    try {
      await RiderModel.bulkWrite(bulkOps, { ordered: false });
      console.log(`✅ Bulk synced ${bulkOps.length} locations`);
    } catch (err) {
      console.error("❌ Bulk sync error:", err.message);
    }
  }
}, 30000); // Run every 30 seconds

app.get("/admin/active-drivers-20min", async (req, res) => {
  try {
    const apiStart = Date.now(); // ⏳ start time

    const { vehicleType } = req.query;

    // Time window: last 20 minutes
    const TWENTY_MIN = 50 * 60 * 1000;
    const twentyMinAgo = Date.now() - TWENTY_MIN;

    // 🔍 Base filter — only CAB category riders
    const filter = {
      category: "cab", // ⛔ Only CAB included
      lastUpdated: { $gte: twentyMinAgo },
    };

    // 🎯 If vehicleType provided, apply filter
    if (vehicleType) {
      filter["rideVehicleInfo.vehicleType"] = vehicleType.trim().toUpperCase();
    }

    // 📊 Count active CAB drivers
    const count = await RiderModel.countDocuments(filter);

    const apiEnd = Date.now();
    const apiExecutionTime = apiEnd - apiStart;

    return res.status(200).json({
      success: true,
      message: "Active CAB drivers fetched successfully.",
      activeDrivers: count,
      vehicleType: vehicleType || "ALL",
      category: "CAB",
      checkedFrom: new Date(twentyMinAgo),
      apiExecutionTime: apiExecutionTime + " ms",
    });
  } catch (err) {
    console.error("❌ Error checking active drivers:", err);

    return res.status(500).json({
      success: false,
      message: "Internal server error while checking active drivers.",
    });
  }
});

app.post("/webhook/receive-location", Protect, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const userId = req.user.userId;

    const data = await Parcel_boy_Location.findOneAndUpdate(
      { _id: userId },
      {
        location: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
        lastUpdated: new Date(),
      },
      { upsert: true, new: true }
    );
    // console.log("data", data)

    res.status(200).json({ message: "Location updated successfully" });
  } catch (error) {
    console.error("Error updating location:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Root Endpoint
app.get("/", (req, res) => {
  console.log("https://pzl22gdb-3200.inc1.devtunnels.ms/");
  res.status(200).json({
    message: "Welcome to the API",
    timestamp: new Date().toISOString(),
    version: "1.0.0",
  });
});

// Health Check
app.get("/health", async (req, res) => {
  const health = {
    status: "UP",
    timestamp: new Date().toISOString(),
    services: {
      redis: {
        connected: pubClient && pubClient.isOpen,
        status: pubClient && pubClient.isOpen ? "UP" : "DOWN",
      },
      mongodb: {
        connected: mongoose.connection.readyState === 1,
        status: mongoose.connection.readyState === 1 ? "UP" : "DOWN",
      },
      socketio: {
        connected: io.engine.clientsCount > 0,
        clientCount: io.engine.clientsCount,
        status: "UP",
      },
    },
  };

  // Test Redis connection
  if (pubClient && pubClient.isOpen) {
    try {
      await pubClient.ping();
      health.services.redis.ping = "SUCCESS";
    } catch (error) {
      health.services.redis.ping = "FAILED";
      health.services.redis.error = error.message;
    }
  }

  const allServicesUp = Object.values(health.services).every(
    (service) => service.status === "UP"
  );
  const statusCode = allServicesUp ? 200 : 503;

  res.status(statusCode).json(health);
});

app.post("/Fetch-Current-Location", async (req, res) => {
  const { lat, lng } = req.body;

  if (!lat || !lng) {
    return res
      .status(400)
      .json({ success: false, message: "Latitude and longitude required" });
  }

  const cacheKey = `geocode:${lat},${lng}`;

  try {
    // Try to get from cache if Redis is available
    let cachedData = null;
    if (pubClient && pubClient.isOpen) {
      try {
        cachedData = await pubClient.get(cacheKey);
        if (cachedData) {
          return res.status(200).json({
            success: true,
            data: JSON.parse(cachedData),
            message: "Location fetched from cache",
          });
        }
      } catch (cacheError) {
        console.warn(
          `[${new Date().toISOString()}] Cache read error:`,
          cacheError.message
        );
      }
    }

    const response = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8`
    );
    console.log("response", response.data);

    if (!response.data.results?.[0]) {
      return res
        .status(404)
        .json({ success: false, message: "No address found" });
    }

    const addressComponents = response.data.results[0].address_components;
    const addressDetails = {
      completeAddress: response.data.results[0].formatted_address,
      city: addressComponents.find((c) => c.types.includes("locality"))
        ?.long_name,
      area: addressComponents.find((c) =>
        c.types.includes("sublocality_level_1")
      )?.long_name,
      district: addressComponents.find((c) =>
        c.types.includes("administrative_area_level_3")
      )?.long_name,
      postalCode: addressComponents.find((c) => c.types.includes("postal_code"))
        ?.long_name,
      landmark: null,
      lat: response.data.results[0].geometry.location.lat,
      lng: response.data.results[0].geometry.location.lng,
    };

    const result = { location: { lat, lng }, address: addressDetails };

    // Cache the result if Redis is available
    if (pubClient && pubClient.isOpen) {
      try {
        await pubClient.setEx(cacheKey, 3600, JSON.stringify(result));
      } catch (cacheError) {
        console.warn(
          `[${new Date().toISOString()}] Cache write error:`,
          cacheError.message
        );
      }
    }

    res
      .status(200)
      .json({ success: true, data: result, message: "Location fetched" });
  } catch (err) {
    console.error(
      `[${new Date().toISOString()}] Location fetch error:`,
      err.message
    );
    res
      .status(500)
      .json({ success: false, message: "Failed to fetch location" });
  }
});

const ANDROID_STORE =
  "https://play.google.com/store/apps/details?id=com.happy_coding.olyox&hl=en_IN";
const IOS_STORE =
  "https://apps.apple.com/in/app/olyox-book-cab-hotel-food/id6744582670";

const ridesTest = {
  "64a83f42": {
    id: "64a83f42",
    pickup: "Sector 99A",
    drop: "Sector 29",
    fare: 119.18,
  },
};

// Endpoint to share ride
app.get("/share-ride-to-loveone/:rideId", (req, res) => {
  const { rideId } = req.params;
  const ride = ridesTest[rideId];

  if (!ride) return res.status(404).send("Ride not found");

  // Deep link to open app ride page
  const deepLink = `https://www.appv2.olyox.com/share-ride-to-loveone/${rideId}`;

  const userAgent = req.headers["user-agent"] || "";

  // Redirect logic
  if (/android/i.test(userAgent)) {
    // Android: open app if installed, otherwise Play Store
    res.send(`
      <script>
        window.location = "${deepLink}";
        setTimeout(() => { window.location = "${ANDROID_STORE}"; }, 2000);
      </script>
    `);
  } else if (/iphone|ipad|ipod/i.test(userAgent)) {
    // iOS: open app if installed, otherwise App Store
    res.send(`
      <script>
        window.location = "${deepLink}";
        setTimeout(() => { window.location = "${IOS_STORE}"; }, 2000);
      </script>
    `);
  } else {
    // Fallback web page
    res.send(`
      <h2>Ride from ${ride.pickup} to ${ride.drop}</h2>
      <p>Fare: ₹${ride.fare}</p>
      <p>Download the app to see full ride details:</p>
      <ul>
        <li><a href="${IOS_STORE}">iOS</a></li>
        <li><a href="${ANDROID_STORE}">Android</a></li>
      </ul>
    `);
  }
});

app.get("/geocode", async (req, res) => {
  const { address } = req.query;

  if (!address || address.trim().length === 0) {
    return res
      .status(400)
      .json({ success: false, message: "Address is required" });
  }

  const cacheKey = `geocode:${address.trim().toLowerCase()}`;
  const apiKey = "AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8"; // fallback for testing only

  try {
    // 🔹 Try cache first
    if (pubClient && pubClient.isOpen) {
      const cached = await pubClient.get(cacheKey);
      if (cached) {
        return res.status(200).json({
          success: true,
          data: JSON.parse(cached),
          message: "Fetched from cache",
        });
      }
    }

    // 🔹 Call Google Geocoding API
    const response = await axios.get(
      "https://maps.googleapis.com/maps/api/geocode/json",
      {
        params: {
          address: address,
          key: apiKey,
        },
      }
    );

    if (response.data.status !== "OK" || !response.data.results.length) {
      return res.status(400).json({
        success: false,
        message: response.data.error_message || "Failed to fetch coordinates",
      });
    }

    const result = response.data.results[0];
    const locationData = {
      formattedAddress: result.formatted_address,
      placeId: result.place_id,
      types: result.types,
      location: result.geometry.location, // { lat, lng }
    };

    // 🔹 Cache result for 30 mins
    if (pubClient && pubClient.isOpen) {
      await pubClient.setEx(cacheKey, 1800, JSON.stringify(locationData));
    }

    res.status(200).json({
      success: true,
      data: locationData,
      message: "Geocode fetched successfully",
    });
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Geocode error:`, err.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch geocode data",
    });
  }
});

app.get("/send-notifications", async (req, res) => {
  try {
    // Get all riders with AppVersion and isAvailable
    const allRiders = await RiderModel.find({
      isAvailable: true,
      AppVersion: "1.0.5",
    });

    let validRiders = [];
    let invalidRiders = [];
    let noTokenRiders = [];

    console.log(`📌 Total Riders Found: ${allRiders.length}`);

    for (const rider of allRiders) {
      // CASE 1: No token found
      if (!rider.fcmToken || rider.fcmToken.trim() === "") {
        console.log(`⚠️ NO TOKEN → Rider: ${rider._id}`);

        noTokenRiders.push({
          _id: rider._id,
          phone: rider.phone,
          fcmToken: null,
        });

        await RiderModel.updateOne(
          { _id: rider._id },
          { $set: { isFcmTokenExpired: true } }
        );

        continue;
      }

      // CASE 2: Test notification for valid/invalid
      try {
        await sendNotification.sendNotification(
          rider.fcmToken,
          "Olyox is Best",
          "Your Olyox Token is working ✔",
          {},
          "app-notification"
        );

        console.log(`✅ VALID TOKEN → Rider: ${rider._id}`);

        validRiders.push({
          _id: rider._id,
          phone: rider.phone,
          fcmToken: rider.fcmToken,
        });

        await RiderModel.updateOne(
          { _id: rider._id },
          { $set: { isFcmTokenExpired: false } }
        );
      } catch (error) {
        console.log(`❌ INVALID TOKEN → Rider: ${rider._id} → ${error.code}`);

        invalidRiders.push({
          _id: rider._id,
          phone: rider.phone,
          fcmToken: rider.fcmToken,
          error: error.code,
        });

        await RiderModel.updateOne(
          { _id: rider._id },
          { $set: { isFcmTokenExpired: true } }
        );
      }
    }

    // Final summary logs
    console.log(`\n📊 SUMMARY`);
    console.log(`----------------------------------------`);
    console.log(`Total Riders: ${allRiders.length}`);
    console.log(`Valid Tokens: ${validRiders.length}`);
    console.log(`Invalid Tokens: ${invalidRiders.length}`);
    console.log(`No Token: ${noTokenRiders.length}`);
    console.log(`----------------------------------------`);

    // Return API response
    res.json({
      status: true,
      message: "Notification checking completed",
      summary: {
        totalRiders: allRiders.length,
        validTokens: validRiders.length,
        invalidTokens: invalidRiders.length,
        noToken: noTokenRiders.length,
      },
      validRiders,
      invalidRiders,
      noTokenRiders,
    });
  } catch (error) {
    console.log("Server Error:", error.message);
    res.status(500).json({ status: false, error: error.message });
  }
});

app.get("/driver-details-name-number", async (req, res) => {
  try {
    const allRiders = await RiderModel.find({
      isAvailable: true,
      AppVersion: "1.0.5",
      fcmToken: null,
    }).select("_id name phone fcmToken");

    res.json({
      status: true,
      count: allRiders.length,
      drivers: allRiders,
    });
  } catch (error) {
    console.log("Error fetching drivers:", error.message);
    res.status(500).json({
      status: false,
      message: "Something went wrong",
      error: error.message,
    });
  }
});

app.get("/driver-check-and-notify", async (req, res) => {
  try {
    const { number } = req.query;

    if (!number) {
      return res.status(400).json({
        status: false,
        message: "Phone number is required",
      });
    }

    // Find rider with token + version
    const rider = await RiderModel.findOne({
      phone: number,
      AppVersion: "1.0.5",
    }).select("_id name phone fcmToken");

    if (!rider) {
      return res.status(404).json({
        status: false,
        message: "Rider not found",
      });
    }

    // Check token availability
    if (!rider.fcmToken || rider.fcmToken.trim() === "") {
      return res.json({
        status: true,
        rider,
        notification: "Token missing — please update token",
        tokenAvailable: false,
      });
    }

    // Send notification automatically
    await sendNotification.sendNotification(
      rider.fcmToken,
      "Olyox – Token Working",
      "Your notification token is active! 🚀",
      {},
      "app-notification"
    );

    res.json({
      status: true,
      rider,
      notification: "Notification sent successfully",
      tokenAvailable: true,
    });
  } catch (error) {
    console.log("Error:", error.message);
    res.status(500).json({
      status: false,
      message: "Something went wrong",
      error: error.message,
    });
  }
});

// API Routes
app.use("/api/v1/rider", router);
app.use("/api/v1/rides", rides);
app.use("/api/v1/hotels", hotelRouter);
app.use("/api/v1/user", users);
app.use("/api/v1/tiffin", tiffin);
app.use("/api/v1/parcel", parcel);
app.use("/api/v1/heavy", Heavy);
app.use("/api/v1/admin", admin);
app.use("/api/v1/new", NewRoutes);

// Middleware to bypass /api/v1/coupons/validate
app.use("/api/v1/coupons/validate", (req, res, next) => {
  const { code } = req.query;

  if (code && code.toLowerCase().includes("jaipur")) {
    console.log(`🎟️ Jaipur coupon detected: ${code} - bypassing logic`);
    return res.status(200).json({
      success: true,
      discount: 99,
      coupon:{
      code: code,
      isActive: true,
      discount: 99,
    },
    message: "Jaipur special coupon applied successfully",
    couponData: null, // optional placeholder
    });
  }

  // If not Jaipur, continue to normal route handlers
  next();
});

app.use(
  compression({
    threshold: 0, // compress everything, even small responses
  })
);
// 404 Handler
app.use("*", (req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
    path: req.originalUrl,
  });
});

// Error Handler
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Server error:`, err.message);
  console.error("Stack:", err.stack);

  res.status(err.status || 500).json({
    success: false,
    message:
      process.env.NODE_ENV === "production"
        ? "Something went wrong!"
        : err.message,
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
});

// cron.schedule('*/4 * * * * *', async () => {
//   await startNotificationScheduler();
// });

// Graceful Shutdown with Force Disconnect
process.on("SIGTERM", async () => {
  console.log(
    `[${new Date().toISOString()}] SIGTERM received, shutting down gracefully`
  );

  // 1. Stop accepting new connections
  server.close(async () => {
    console.log(`[${new Date().toISOString()}] HTTP server closed`);
  });

  // 2. Force disconnect all Socket.IO clients
  console.log(
    `[${new Date().toISOString()}] Disconnecting all Socket.IO clients...`
  );
  const sockets = await io.fetchSockets();
  console.log(
    `[${new Date().toISOString()}] Found ${sockets.length} active sockets`
  );

  for (const socket of sockets) {
    console.log(
      `[${new Date().toISOString()}] Disconnecting socket: ${socket.id}`
    );
    socket.disconnect(true); // Force disconnect
  }

  // 3. Close Socket.IO server
  io.close(() => {
    console.log(`[${new Date().toISOString()}] Socket.IO server closed`);
  });

  // 4. Close Redis connections
  if (pubClient) {
    try {
      await pubClient.quit();
      console.log(
        `[${new Date().toISOString()}] Redis pubClient connection closed`
      );
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error closing Redis pubClient:`,
        error.message
      );
    }
  }

  if (subClient) {
    try {
      await subClient.quit();
      console.log(
        `[${new Date().toISOString()}] Redis subClient connection closed`
      );
    } catch (error) {
      console.error(
        `[${new Date().toISOString()}] Error closing Redis subClient:`,
        error.message
      );
    }
  }

  // 5. Close MongoDB connection
  try {
    await mongoose.connection.close();
    console.log(`[${new Date().toISOString()}] MongoDB connection closed`);
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] Error closing MongoDB:`,
      error.message
    );
  }

  console.log(`[${new Date().toISOString()}] ✅ Graceful shutdown complete`);
  process.exit(0);
});

process.on("SIGINT", async () => {
  console.log(
    `[${new Date().toISOString()}] SIGINT received, shutting down gracefully`
  );
  process.emit("SIGTERM");
});

// Optional: Add shutdown timeout to force exit if graceful shutdown hangs
const SHUTDOWN_TIMEOUT = 10000; // 10 seconds

process.on("SIGTERM", () => {
  setTimeout(() => {
    console.error(
      `[${new Date().toISOString()}] ⚠️ Graceful shutdown timeout, forcing exit`
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT);
});

// Unhandled Promise Rejection
process.on("unhandledRejection", (reason, promise) => {
  console.error(
    `[${new Date().toISOString()}] Unhandled Promise Rejection:`,
    reason
  );
  console.error("Promise:", promise);
  // Don't exit the process, just log the error
});

// Uncaught Exception
process.on("uncaughtException", (error) => {
  console.error(
    `[${new Date().toISOString()}] Uncaught Exception:`,
    error.message
  );
  console.error("Stack:", error.stack);
  process.exit(1);
});

async function startServer() {
  const PORT = process.env.PORT || 3100;

  try {
    console.log(
      `[${new Date().toISOString()}] Worker ${process.pid} starting...`
    );

    // await startNotificationScheduler()
    // Connect to Redis first
    await connectRedis();

    // Setup Socket.IO with Redis adapter
    await setupSocketAdapter();

    // Connect to databases
    await connectDatabases();

    // Start the server
    server.listen(PORT, () => {
      console.log(
        `[${new Date().toISOString()}] 🚀 Server running on port ${PORT} (Worker ${
          process.pid
        })`
      );
      console.log(`[${new Date().toISOString()}] 🔌 Socket.IO server ready`);
      console.log(
        `Bull Board available at http://localhost:${PORT}/admin/queues`
      );
      console.log(
        `[${new Date().toISOString()}] 🌍 Environment: ${
          process.env.NODE_ENV || "development"
        }`
      );
      console.log(
        `[${new Date().toISOString()}] ✅ All services connected successfully`
      );
    });
  } catch (error) {
    console.error(
      `[${new Date().toISOString()}] ❌ Failed to start server (Worker ${
        process.pid
      }):`,
      error.message
    );
    process.exit(1);
  }
}

startServer();
