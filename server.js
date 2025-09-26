const express = require('express');
const http = require('http');
const cors = require('cors');
const { createClient } = require('redis');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const axios = require('axios');
require('dotenv').config();
const compression = require("compression");
const cluster = require('cluster')
const os = require('os')
const PORT = process.env.PORT || 3100;
const numCPUs = os.cpus().length;


console.log("numCPUs",numCPUs)
// Import Socket.IO manager
const { initSocket, getIO, getStats, sendNotificationToUser, broadcastToUserType, sendToRide } = require('./socket/socketManager');

const connectDb = require('./database/db');
const { connectwebDb } = require('./PaymentWithWebDb/db');
const RiderModel = require('./models/Rider.model');
const userModel = require('./models/normal_user/User.model');

const TrackEvent = require('./models/Admin/Tracking');
const Settings = require('./models/Admin/Settings');
const NewRideModel = require('./src/New-Rides-Controller/NewRideModel.model');
const setupBullBoard = require('./bullboard');

// Routes
const router = require('./routes/routes');
const rides = require('./routes/rides.routes');
const hotelRouter = require('./routes/Hotel.routes');
const users = require('./routes/user_routes/user_routes');
const tiffin = require('./routes/Tiffin/Tiffin.routes');
const parcel = require('./routes/Parcel/Parcel.routes');
const admin = require('./routes/Admin/admin.routes');
const Heavy = require('./routes/Heavy_vehicle/Heavy.routes');
const NewRoutes = require('./routes/New/New.routes');
const sendNotification = require('./utils/sendNotification');

const Protect = require('./middleware/Auth');
const SentLog = require('./models/log/sendLogs.model');

// Initialize Express and Server
const app = express();
app.set('trust proxy', 1);
const server = http.createServer(app);

// Redis Configuration
const redisOptions = {
    socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        reconnectStrategy: (retries) => {
            if (retries > 10) {
                console.error(`[${new Date().toISOString()}] Redis max retry attempts reached`);
                return new Error('Max retry attempts reached');
            }
            const delay = Math.min(retries * 1000, 5000);
            console.log(`[${new Date().toISOString()}] Redis reconnecting in ${delay}ms (attempt ${retries})`);
            return delay;
        }
    },
    password: process.env.REDIS_PASSWORD || undefined
};

// Global Redis client
let pubClient;

// Redis Connection Function
async function connectRedis() {
    try {
        pubClient = createClient(redisOptions);

        pubClient.on('error', (err) => {
            console.error(`[${new Date().toISOString()}] Redis client error:`, err.message);
        });

        pubClient.on('connect', () => {
            console.log(`[${new Date().toISOString()}] Redis client connecting...`);
        });

        pubClient.on('ready', () => {
            console.log(`[${new Date().toISOString()}] Redis client ready`);
        });

        pubClient.on('end', () => {
            console.log(`[${new Date().toISOString()}] Redis client connection ended`);
        });

        pubClient.on('reconnecting', () => {
            console.log(`[${new Date().toISOString()}] Redis client reconnecting...`);
        });

        await pubClient.connect();
        console.log(`[${new Date().toISOString()}] Redis connected successfully`);

        // Make Redis client available to the app
        app.set('pubClient', pubClient);

        return pubClient;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Redis connection failed:`, error.message);
        throw error;
    }
}

// Database Connection Functions
async function connectDatabases() {
    try {
        await connectDb();
        console.log(`[${new Date().toISOString()}] Main database connected`);

        await connectwebDb();
        console.log(`[${new Date().toISOString()}] Web database connected`);
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Database connection failed:`, error.message);
        throw error;
    }
}

// Socket.IO initialization
async function initializeSocket() {
    try {
        const io = await initSocket(server, pubClient);

        // Make Socket.IO available globally in the app
        app.set('io', io);
        app.set('getIO', getIO);
        app.set('sendNotificationToUser', sendNotificationToUser);
        app.set('broadcastToUserType', broadcastToUserType);
        app.set('sendToRide', sendToRide);

        console.log(`[${new Date().toISOString()}] Socket.IO initialized successfully`);
        return io;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Socket.IO initialization failed:`, error.message);
        throw error;
    }
}


// Enhanced Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(compression({
    threshold: 0, // compress everything, even small responses
}));

setupBullBoard(app);

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300000,
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests from this IP, please try again later.',
    keyGenerator: (req) => req.ip || req.headers['x-forwarded-for'] || 'unknown'
});

app.use(limiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Enhanced middleware to check Redis connection and make Socket.IO available
app.use((req, res, next) => {
    if (!pubClient || !pubClient.isOpen) {
        console.warn(`[${new Date().toISOString()}] Redis client not available for request: ${req.path}`);
    }

    // Make Socket.IO functions available in all routes
    req.io = app.get('io');
    req.getIO = app.get('getIO');
    req.sendNotificationToUser = app.get('sendNotificationToUser');
    req.broadcastToUserType = app.get('broadcastToUserType');
    req.sendToRide = app.get('sendToRide');

    next();
});

// Enhanced Long Polling Updates Endpoint with Socket.IO integration
app.get('/updates/:userId/:userType', async (req, res) => {
    const { userId, userType } = req.params;
    const validTypes = ['user', 'driver', 'tiffin_partner'];

    if (!validTypes.includes(userType)) {
        return res.status(400).json({ success: false, message: 'Invalid user type' });
    }

    if (!pubClient || !pubClient.isOpen) {
        return res.status(503).json({ success: false, message: 'Redis service unavailable' });
    }

    const timeoutMs = 30000;
    const startTime = Date.now();
    const key = `${userType}:${userId}:updates`;

    try {
        // Register client as active
        await pubClient.set(`active:${userType}:${userId}`, '1', { EX: 3600 });

        // Check if user is connected via Socket.IO
        const socketStats = getStats();
        const isConnectedViaSocket = userType === 'driver'
            ? socketStats.connectedDrivers > 0
            : socketStats.connectedUsers > 0;

        while (Date.now() - startTime < timeoutMs) {
            const updates = await pubClient.lPop(key);
            if (updates) {
                const data = JSON.parse(updates);

                // Also send via Socket.IO if connected
                if (isConnectedViaSocket && req.sendNotificationToUser) {
                    req.sendNotificationToUser(userId, userType, {
                        type: 'long_polling_update',
                        data: data
                    });
                }

                return res.json({
                    success: true,
                    updates: data,
                    socketConnected: isConnectedViaSocket
                });
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        res.json({
            success: true,
            updates: null,
            socketConnected: isConnectedViaSocket
        });
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Polling error for ${userType}:${userId}:`, err.message);
        res.status(500).json({ success: false, message: 'Polling failed' });
    }
});

// Enhanced directions endpoint with real-time updates
app.post('/directions', async (req, res) => {
    try {
        const data = req.body || {};

        if (!data?.pickup?.latitude || !data?.pickup?.longitude || !data?.dropoff?.latitude || !data?.dropoff?.longitude) {
            return res.status(400).json({ error: 'Invalid pickup or dropoff location data' });
        }

        // Create a unique cache key based on coordinates
        const cacheKey = `directions:${data.pickup.latitude},${data.pickup.longitude}:${data.dropoff.latitude},${data.dropoff.longitude}`;
        const startTime = Date.now();

        // Try fetching from Redis cache
        const cachedData = await pubClient.get(cacheKey);
        if (cachedData) {
            const timeTakenMs = Date.now() - startTime;
            const result = JSON.parse(cachedData);

            console.log(`[${new Date().toISOString()}] Successfully fetched directions from cache for key: ${cacheKey} (took ${timeTakenMs} ms)`);

            // Broadcast to Socket.IO if ride ID is provided
            if (data.rideId && req.sendToRide) {
                req.sendToRide(data.rideId, 'directions_updated', {
                    ...result,
                    source: 'cache'
                });
            }

            return res.json({
                ...result,
                source: 'cache',
                timeTakenMs
            });
        }

        // If no cache, call Google Maps API
        const googleMapsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${data?.pickup?.latitude},${data?.pickup?.longitude}&destination=${data?.dropoff?.latitude},${data?.dropoff?.longitude}&key=AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8`;
        const apiStartTime = Date.now();
        const response = await axios.get(googleMapsUrl);
        const apiTimeTakenMs = Date.now() - apiStartTime;

        if (response.data.routes && response.data.routes[0] && response.data.routes[0].legs) {
            const leg = response.data.routes[0].legs[0];
            const polyline = response.data.routes[0].overview_polyline.points;

            const result = {
                distance: leg.distance.text,
                duration: leg.duration.text,
                polyline,
            };

            // Save to Redis cache with expiration (e.g., 1 hour = 3600 seconds)
            await pubClient.setEx(cacheKey, 3600, JSON.stringify(result));

            console.log(`[${new Date().toISOString()}] Successfully fetched directions from Google API for key: ${cacheKey} (took ${apiTimeTakenMs} ms)`);

            // Broadcast to Socket.IO if ride ID is provided
            if (data.rideId && req.sendToRide) {
                req.sendToRide(data.rideId, 'directions_updated', {
                    ...result,
                    source: 'google-api'
                });
            }

            return res.json({
                ...result,
                source: 'google-api',
                timeTakenMs: apiTimeTakenMs
            });
        } else {
            return res.status(404).json({ error: 'No route found' });
        }

    } catch (error) {
        console.error('Error fetching directions:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Enhanced rider listing with real-time updates
app.get('/rider', async (req, res) => {
    try {
        console.log("Fetching available riders...");
        const riders = await RiderModel.find({ isAvailable: true });

        // Get Socket.IO connection stats
        const socketStats = getStats();

        // Enhance rider data with online status
        const enhancedRiders = await Promise.all(riders.map(async (rider) => {
            const onlineStatus = await pubClient.get(`user_online_driver_${rider._id}`);
            return {
                ...rider.toObject(),
                isOnline: !!onlineStatus,
                lastSeen: onlineStatus ? JSON.parse(onlineStatus).timestamp : null
            };
        }));

        res.json({
            success: true,
            riders: enhancedRiders,
            socketStats: {
                connectedDrivers: socketStats.connectedDrivers,
                totalConnections: socketStats.totalSockets
            }
        });
    } catch (err) {
        console.error(`[${new Date().toISOString()}] List riders error:`, err.message);
        res.status(500).json({ success: false, error: 'Failed to list riders' });
    }
});



// 🎯 POST /track
app.post("/track", Protect, async (req, res) => {
    try {
        const userId = req.user?.user._id || req.user._id;  // from Protect middleware

        if (!userId) {
            return res.status(400).json({ error: "User ID is required" });
        }

        // 📦 Extract fields from body
        const {

            event,      // e.g. SCREEN_VIEW / ACTION
            screen,     // e.g. "RideBooking"
            action,     // e.g. "book_ride"
            params,     // extra data
            device,     // android / ios
            timestamp,  // optional, else we use now
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
// Enhanced ride tracking endpoint
app.get('/rider/:tempRide', async (req, res) => {
    const { tempRide } = req.params;
    console.log(`[STEP 1] Received tempRide param: ${tempRide}`);

    if (!tempRide || !mongoose.Types.ObjectId.isValid(tempRide)) {
        console.warn("[STEP 2] Invalid ride ID");
        return res.status(400).json({ error: 'Invalid ride ID' });
    }

    try {
        console.log("[STEP 3] Fetching ride from MongoDB...");
        const ride = await NewRideModel.findById(tempRide).populate('user').populate('driver');

        if (!ride) {
            console.warn("[STEP 4] Ride not found in MongoDB");
            return res.status(404).json({ error: 'Ride not found' });
        }

        // Get real-time driver location if available
        let driverLocation = null;
        if (ride.driver) {
            const locationData = await pubClient.get(`location_driver_${ride.driver._id}`);
            if (locationData) {
                driverLocation = JSON.parse(locationData);
            }
        }

        // Check Socket.IO connection status
        const socketStats = getStats();
        const isDriverOnline = ride.driver ?
            await pubClient.get(`user_online_driver_${ride.driver._id}`) : null;

        return res.status(200).json({
            success: true,
            data: {
                ...ride.toObject(),
                realTimeDriverLocation: driverLocation,
                driverOnlineStatus: !!isDriverOnline,
                socketStats: {
                    activeRides: socketStats.activeRides,
                    connectedDrivers: socketStats.connectedDrivers
                }
            }
        });

    } catch (error) {
        console.error(`[ERROR] ${new Date().toISOString()} Internal server error:`, error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

// Enhanced location update endpoint with real-time broadcasting
app.post('/webhook/cab-receive-location', async (req, res, next) => {
    // console.log('--- Incoming request to /webhook/cab-receive-location ---');
    // console.log('Request Body:', req.body);

    if (!req.body.riderId) {
        // console.log('No riderId provided in request body, applying Protect middleware...');
        return Protect(req, res, next);
    }

    // console.log('riderId found, skipping Protect middleware');
    next();

}, async (req, res) => {
    try {
        // console.log('--- Entering location update handler ---');

        const { latitude, longitude, riderId, heading, speed } = req.body;
        // console.log('Received Data:', { latitude, longitude, riderId, heading, speed });

        let userId;
        if (riderId) {
            userId = riderId;
            // console.log('Using riderId from request body:', userId);
        } else {
            userId = req.user?.userId;
        }

        if (!userId) {
            // console.warn('No userId available for updating location');
            return res.status(400).json({ error: 'User ID is required' });
        }

        const updatePayload = {
            location: {
                type: 'Point',
                coordinates: [longitude, latitude]
            },
            lastUpdated: new Date()
        };

        // console.log('Updating rider location with payload:', updatePayload);

        const data = await RiderModel.findOneAndUpdate(
            { _id: userId },
            updatePayload,
            { upsert: true, new: true }
        );

        // console.log('Rider location updated:', data?.name);

        // Broadcast real-time location update via Socket.IO
        if (req.getIO) {
            const io = req.getIO();
            const locationUpdate = {
                userId,
                userType: 'driver',
                latitude,
                longitude,
                heading: heading || null,
                speed: speed || null,
                timestamp: new Date().toISOString()
            };

            // Emit to all users tracking this driver
            io.to(`tracking_driver_${userId}`).emit('driver_location', locationUpdate);

            // Emit to admin dashboard
            io.to('admins').emit('driver_location_updated', locationUpdate);
        }

        // Store in Redis for quick access
        const locationData = {
            userId,
            userType: 'driver',
            latitude,
            longitude,
            heading: heading || null,
            speed: speed || null,
            timestamp: new Date().toISOString()
        };

        await pubClient.setEx(
            `location_driver_${userId}`,
            300,
            JSON.stringify(locationData)
        );

        res.status(200).json({
            message: 'Location updated successfully',
            realTimeBroadcast: !!req.getIO
        });

    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Enhanced parcel boy location update
app.post('/webhook/receive-location', Protect, async (req, res) => {
    try {
        console.log("User hits", req.user);
        const { latitude, longitude, heading, speed } = req.body;
        const userId = req.user.userId;

        const data = await Parcel_boy_Location.findOneAndUpdate(
            { _id: userId },
            {
                location: {
                    type: 'Point',
                    coordinates: [longitude, latitude]
                },
                lastUpdated: new Date()
            },
            { upsert: true, new: true }
        );

        // Broadcast via Socket.IO
        if (req.getIO) {
            const locationUpdate = {
                userId,
                userType: 'parcel_boy',
                latitude,
                longitude,
                heading: heading || null,
                speed: speed || null,
                timestamp: new Date().toISOString()
            };

            const io = req.getIO();
            io.to(`tracking_parcel_boy_${userId}`).emit('parcel_boy_location', locationUpdate);
            io.to('admins').emit('parcel_boy_location_updated', locationUpdate);
        }

        res.status(200).json({ message: 'Location updated successfully' });
    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Root Endpoint
app.get('/', (req, res) => {
    const socketStats = getStats();
    res.status(200).json({
        message: 'Welcome to the Olyox API',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        socketStats: socketStats
    });
});

// Enhanced Health Check with Socket.IO status
app.get('/health', async (req, res) => {
    const socketStats = getStats();
    const health = {
        status: 'UP',
        timestamp: new Date().toISOString(),
        services: {
            redis: {
                connected: pubClient && pubClient.isOpen,
                status: pubClient && pubClient.isOpen ? 'UP' : 'DOWN'
            },
            mongodb: {
                connected: mongoose.connection.readyState === 1,
                status: mongoose.connection.readyState === 1 ? 'UP' : 'DOWN'
            },
            socketio: {
                initialized: !!req.getIO,
                status: !!req.getIO ? 'UP' : 'DOWN',
                stats: socketStats
            }
        }
    };

    // Test Redis connection
    if (pubClient && pubClient.isOpen) {
        try {
            await pubClient.ping();
            health.services.redis.ping = 'SUCCESS';
        } catch (error) {
            health.services.redis.ping = 'FAILED';
            health.services.redis.error = error.message;
        }
    }

    const allServicesUp = Object.values(health.services).every(service => service.status === 'UP');
    const statusCode = allServicesUp ? 200 : 503;

    res.status(statusCode).json(health);
});

// Socket.IO statistics endpoint
app.get('/socket-stats', (req, res) => {
    const stats = getStats();
    res.json({
        success: true,
        stats: stats,
        timestamp: new Date().toISOString()
    });
});

// Enhanced location fetch with real-time capabilities
app.post('/Fetch-Current-Location', async (req, res) => {
    const { lat, lng, userId, userType } = req.body;

    if (!lat || !lng) {
        return res.status(400).json({ success: false, message: 'Latitude and longitude required' });
    }

    const cacheKey = `geocode:${lat},${lng}`;

    try {
        // Try to get from cache if Redis is available
        let cachedData = null;
        if (pubClient && pubClient.isOpen) {
            try {
                cachedData = await pubClient.get(cacheKey);
                if (cachedData) {
                    const result = JSON.parse(cachedData);

                    // Broadcast location update if user info provided
                    if (userId && userType && req.sendNotificationToUser) {
                        req.sendNotificationToUser(userId, userType, {
                            type: 'location_fetched',
                            data: result,
                            source: 'cache'
                        });
                    }

                    return res.status(200).json({
                        success: true,
                        data: result,
                        message: 'Location fetched from cache'
                    });
                }
            } catch (cacheError) {
                console.warn(`[${new Date().toISOString()}] Cache read error:`, cacheError.message);
            }
        }

        const response = await axios.get(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyCBATa-tKn2Ebm1VbQ5BU8VOqda2nzkoTU'}`
        );

        if (!response.data.results?.[0]) {
            return res.status(404).json({ success: false, message: 'No address found' });
        }

        const addressComponents = response.data.results[0].address_components;
        const addressDetails = {
            completeAddress: response.data.results[0].formatted_address,
            city: addressComponents.find(c => c.types.includes('locality'))?.long_name,
            area: addressComponents.find(c => c.types.includes('sublocality_level_1'))?.long_name,
            district: addressComponents.find(c => c.types.includes('administrative_area_level_3'))?.long_name,
            postalCode: addressComponents.find(c => c.types.includes('postal_code'))?.long_name,
            landmark: null,
            lat: response.data.results[0].geometry.location.lat,
            lng: response.data.results[0].geometry.location.lng
        };

        const result = { location: { lat, lng }, address: addressDetails };

        // Cache the result if Redis is available
        if (pubClient && pubClient.isOpen) {
            try {
                await pubClient.setEx(cacheKey, 3600, JSON.stringify(result));
            } catch (cacheError) {
                console.warn(`[${new Date().toISOString()}] Cache write error:`, cacheError.message);
            }
        }

        // Broadcast location update if user info provided
        if (userId && userType && req.sendNotificationToUser) {
            req.sendNotificationToUser(userId, userType, {
                type: 'location_fetched',
                data: result,
                source: 'google-api'
            });
        }

        res.status(200).json({ success: true, data: result, message: 'Location fetched' });
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Location fetch error:`, err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch location' });
    }
});

// Enhanced driver location endpoint with real-time tracking
app.get('/driver/:id/location', async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ success: false, message: 'Driver ID is required' });
        }

        const driver = await RiderModel.findById(id).select('location name phone');
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        // Get real-time location from Redis
        let realtimeLocation = null;
        try {
            const locationData = await pubClient.get(`location_driver_${id}`);
            if (locationData) {
                realtimeLocation = JSON.parse(locationData);
            }
        } catch (error) {
            console.warn('Error fetching realtime location:', error.message);
        }

        // Use realtime location if available, otherwise use database location
        const location = realtimeLocation || driver.location;

        if (!location || !location.coordinates || location.coordinates.length < 2) {
            return res.status(404).json({ success: false, message: 'Driver location not available' });
        }

        const lastUpdated = realtimeLocation ?
            new Date(realtimeLocation.timestamp) :
            driver.location?.lastUpdated;
        const timeAgo = lastUpdated ? getTimeAgo(new Date(lastUpdated)) : null;

        // Check online status
        const isOnline = await pubClient.get(`user_online_driver_${id}`);

        const riders = {
            id: driver._id,
            name: driver.name,
            phone: driver.phone,
            location: {
                lat: location.coordinates ? location.coordinates[1] : location.latitude,
                lng: location.coordinates ? location.coordinates[0] : location.longitude,
            },
            heading: realtimeLocation?.heading || null,
            speed: realtimeLocation?.speed || null,
            howOldUpdated: timeAgo,
            lastUpdated,
            isOnline: !!isOnline,
            hasRealtimeData: !!realtimeLocation
        };

        console.log(`[${new Date().toISOString()}] Fetched driver location for ID: ${id}`);
        res.json({ success: true, riders });
    } catch (err) {
        console.error(`[${new Date().toISOString()}] List riders error:`, err.message);
        res.status(500).json({ success: false, error: 'Failed to list riders' });
    }
});

// Helper function to get time ago string
function getTimeAgo(date) {
    const now = new Date();
    const diffMs = now - date;

    const seconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (seconds < 60) return `${seconds} seconds ago`;
    if (minutes < 60) return `${minutes} minutes ago`;
    if (hours < 24) return `${hours} hours ago`;
    return `${days} days ago`;
}

// Enhanced geo-code distance with real-time updates
app.post('/geo-code-distance', async (req, res) => {
    try {
        const { pickup, dropOff, rideId } = req.body;

        if (!pickup || !dropOff) {
            return res.status(400).json({ success: false, message: 'Pickup and dropoff addresses required' });
        }

        const cacheKey = `distance:${pickup}:${dropOff}`;

        // Try to get from cache if Redis is available
        if (pubClient && pubClient.isOpen) {
            try {
                const cachedData = await pubClient.get(cacheKey);
                if (cachedData) {
                    const result = JSON.parse(cachedData);

                    // Broadcast to ride room if rideId provided
                    if (rideId && req.sendToRide) {
                        req.sendToRide(rideId, 'distance_calculated', {
                            ...result,
                            source: 'cache'
                        });
                    }

                    return res.status(200).json({
                        success: true,
                        ...result,
                        fromCache: true
                    });
                }
            } catch (cacheError) {
                console.warn(`[${new Date().toISOString()}] Cache read error:`, cacheError.message);
            }
        }

        const apiKey = process.env.GOOGLE_MAPS_API_KEY || 'AIzaSyCBATa-tKn2Ebm1VbQ5BU8VOqda2nzkoTU';

        const pickupResponse = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: { address: pickup, key: apiKey }
        });

        if (pickupResponse.data.status !== 'OK') {
            return res.status(400).json({ success: false, message: 'Invalid pickup location' });
        }
        const pickupData = pickupResponse.data.results[0].geometry.location;

        const dropOffResponse = await axios.get('https://maps.googleapis.com/maps/api/geocode/json', {
            params: { address: dropOff, key: apiKey }
        });

        if (dropOffResponse.data.status !== 'OK') {
            return res.status(400).json({ success: false, message: 'Invalid dropoff location' });
        }
        const dropOffData = dropOffResponse.data.results[0].geometry.location;

        const distanceResponse = await axios.get('https://maps.googleapis.com/maps/api/distancematrix/json', {
            params: {
                origins: `${pickupData.lat},${pickupData.lng}`,
                destinations: `${dropOffData.lat},${dropOffData.lng}`,
                key: apiKey
            }
        });

        if (distanceResponse.data.status !== 'OK' || distanceResponse.data.rows[0].elements[0].status !== 'OK') {
            return res.status(400).json({ success: false, message: 'Failed to calculate distance' });
        }

        const distanceInfo = distanceResponse.data.rows[0].elements[0];
        const settings = await Settings.findOne();
        const distanceInKm = distanceInfo.distance.value / 1000;
        const price = distanceInKm * (settings?.foodDeliveryPrice || 12);

        const result = {
            pickupLocation: pickupData,
            dropOffLocation: dropOffData,
            distance: distanceInfo.distance.text,
            duration: distanceInfo.duration.text,
            price: `₹${price.toFixed(2)}`,
            distanceInKm: distanceInKm.toFixed(2)
        };

        // Cache the result if Redis is available
        if (pubClient && pubClient.isOpen) {
            try {
                await pubClient.setEx(cacheKey, 1800, JSON.stringify(result));
            } catch (cacheError) {
                console.warn(`[${new Date().toISOString()}] Cache write error:`, cacheError.message);
            }
        }

        // Broadcast to ride room if rideId provided
        if (rideId && req.sendToRide) {
            req.sendToRide(rideId, 'distance_calculated', {
                ...result,
                source: 'google-api'
            });
        }

        res.status(200).json({ success: true, ...result });
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Geo-code distance error:`, err.message);
        res.status(500).json({ success: false, message: 'Failed to calculate distance' });
    }
});

// New Socket.IO testing endpoints
app.post('/test-socket-notification', async (req, res) => {
    const { userId, userType, message } = req.body;

    if (!userId || !userType || !message) {
        return res.status(400).json({ error: 'userId, userType, and message are required' });
    }

    try {
        if (req.sendNotificationToUser) {
            req.sendNotificationToUser(userId, userType, {
                type: 'test_notification',
                message: message,
                timestamp: new Date().toISOString()
            });

            res.json({
                success: true,
                message: 'Notification sent via Socket.IO'
            });
        } else {
            res.status(503).json({ error: 'Socket.IO not available' });
        }
    } catch (error) {
        console.error('Error sending test notification:', error);
        res.status(500).json({ error: 'Failed to send notification' });
    }
});

app.post('/test-broadcast', async (req, res) => {
    const { userType, event, message } = req.body;

    if (!userType || !event || !message) {
        return res.status(400).json({ error: 'userType, event, and message are required' });
    }

    try {
        if (req.broadcastToUserType) {
            req.broadcastToUserType(userType, event, {
                message: message,
                timestamp: new Date().toISOString()
            });

            res.json({
                success: true,
                message: `Broadcasted ${event} to all ${userType}s`
            });
        } else {
            res.status(503).json({ error: 'Socket.IO not available' });
        }
    } catch (error) {
        console.error('Error broadcasting message:', error);
        res.status(500).json({ error: 'Failed to broadcast message' });
    }
});

// API Routes
app.use('/api/v1/rider', router);
app.use('/api/v1/rides', rides);
app.use('/api/v1/hotels', hotelRouter);
app.use('/api/v1/user', users);
app.use('/api/v1/tiffin', tiffin);
app.use('/api/v1/parcel', parcel);
app.use('/api/v1/heavy', Heavy);
app.use('/api/v1/admin', admin);
app.use('/api/v1/new', NewRoutes);

// 404 Handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found',
        path: req.originalUrl
    });
});

// Error Handler
app.use((err, req, res, next) => {
    console.error(`[${new Date().toISOString()}] Server error:`, err.message);
    console.error('Stack:', err.stack);

    res.status(err.status || 500).json({
        success: false,
        message: process.env.NODE_ENV === 'production' ? 'Something went wrong!' : err.message,
        ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
    });
});

// Graceful Shutdown
process.on('SIGTERM', async () => {
    console.log(`[${new Date().toISOString()}] SIGTERM received, shutting down gracefully`);

    server.close(async () => {
        console.log(`[${new Date().toISOString()}] HTTP server closed`);

        // Close Socket.IO connections
        const { cleanup } = require('./socket/socketManager');
        await cleanup();

        // Close Redis connection
        if (pubClient) {
            try {
                await pubClient.quit();
                console.log(`[${new Date().toISOString()}] Redis connection closed`);
            } catch (error) {
                console.error(`[${new Date().toISOString()}] Error closing Redis:`, error.message);
            }
        }

        // Close MongoDB connection
        try {
            await mongoose.connection.close();
            console.log(`[${new Date().toISOString()}] MongoDB connection closed`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error closing MongoDB:`, error.message);
        }

        process.exit(0);
    });
});

process.on('SIGINT', async () => {
    console.log(`[${new Date().toISOString()}] SIGINT received, shutting down gracefully`);
    process.emit('SIGTERM');
});

// Unhandled Promise Rejection
process.on('unhandledRejection', (reason, promise) => {
    console.error(`[${new Date().toISOString()}] Unhandled Promise Rejection:`, reason);
    console.error('Promise:', promise);
    // Don't exit the process, just log the error
});

// Uncaught Exception
process.on('uncaughtException', (error) => {
    console.error(`[${new Date().toISOString()}] Uncaught Exception:`, error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
});







async function startServer() {
  try {
    console.log(`[${new Date().toISOString()}] Starting server initialization...`);

    // Connect to Redis first
    await connectRedis();

    // Connect to databases
    await connectDatabases();

    // Create HTTP server
    const server = http.createServer(app);

    // Initialize Socket.IO
    await initializeSocket(server);

    // Start listening
    server.listen(PORT, () => {
      console.log(`[${new Date().toISOString()}] 🚀 Worker ${process.pid} running on port ${PORT}`);
      console.log(`Bull Board available at http://localhost:${PORT}/admin/queues`);
      console.log(`Socket.IO Stats available at http://localhost:${PORT}/socket-stats`);
      console.log(`Health Check available at http://localhost:${PORT}/health`);
      console.log(`[${new Date().toISOString()}] 🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`[${new Date().toISOString()}] ✅ All services connected successfully`);

      // Log Socket.IO statistics
      const stats = getStats();
      console.log(`[${new Date().toISOString()}] 📊 Socket.IO initialized with Redis adapter`);
      console.log(`[${new Date().toISOString()}] 👥 Ready to handle real-time connections`);
    });

  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Worker ${process.pid} failed:`, error.message);
    process.exit(1);
  }
}

// Cluster logic
if (cluster.isPrimary) {
  console.log(`Master ${process.pid} is running with ${numCPUs} CPUs`);

  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }

  // Restart worker if it dies
  cluster.on("exit", (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died. Restarting...`);
    cluster.fork();
  });
} else {
  // Worker starts the actual server
  startServer();
}