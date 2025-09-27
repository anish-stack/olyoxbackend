const express = require('express');
const http = require('http');
const cors = require('cors');
const { createClient } = require('redis');
const mongoose = require('mongoose');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const axios = require('axios');
require('dotenv').config();
const compression = require("compression")
// Database and Models
const connectDb = require('./database/db');
const { connectwebDb } = require('./PaymentWithWebDb/db');
const TrackEvent = require('./models/Admin/Tracking');
const rideRequestModel = require('./models/ride.request.model');
const RiderModel = require('./models/Rider.model');
const User = require('./models/normal_user/User.model');
const ParcelBoyLocation = require('./models/Parcel_Models/Parcel_Boys_Location');
const Settings = require('./models/Admin/Settings');
const tempRideDetailsSchema = require('./models/tempRideDetailsSchema');
const NewRideModel = require('./src/New-Rides-Controller/NewRideModel.model')
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
const cluster = require("cluster");
const os = require("os");

// Number of CPU cores
const numCPUs = os.cpus().length;
console.log("numCPUs", numCPUs)
// Controllers and Middleware
const {
    ChangeRideRequestByRider,
    findRider,
    rideStart,
    rideEnd,
    collectCash,
    AddRating,
    cancelRideByAnyOne,
    cancelRideForOtherDrivers,
    updateRideRejectionStatus,
    findNextAvailableDriver
} = require('./controllers/ride.request');
const {
    update_parcel_request,
    mark_reached,
    mark_pick,
    mark_deliver,
    mark_cancel
} = require('./driver');
const Protect = require('./middleware/Auth');
const { debugIOSNotification } = require('./utils/DebugNotifications');
const locationQueue = require('./queues/LocationQue');

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


async function sendPushNotification(expoPushTokens, title, body) {
    try {
        const response = await sendNotification.sendNotification(
            'f_tdIVaMTJyvTYwxrNtD8m:APA91bEyIBblc-oy_YdseEKWbXNor-kA_GYdniMi2BluhBkkvvjlg_QM-vXIJZdpcwh8j6L0yKWa_dNNygctLD1i9fCsPJbkLYVHGtFIMpe8DNseoHfA_ec',
            '🚖 Ride Request',
            'A new rider has booked a cab. Tap to view details.',
            { rideId: '12345', type: 'newBooking' }, // extra data
            true // Android flag if your fn supports it
        );

        console.log("✅ Notification sent successfully:", response);
    } catch (error) {
        console.error("❌ Failed to send notification:", error);
    }
}

// sendNotification.sendTestNotification("cTVlPvzWqE6WhQPcL87uQT:APA91bF-TV2a1TtNtrIJg_7iWtnb9kUfX8BhyHypQ-ZeAfMa3Dw_FtONXwCXnNnP-OcxxzNx4nRpIIP2G5OkXNA1ZRyBSSGerJ60lWUTIrhK0eQhB7oBFFw", "ios");
// sendNotification.sendNotification("dbRY9fE1K0VIvE23QS8qYK:APA91bF_WAKSnkSYri3LFBX7VBegYzxhmRWJCqAOFEYRlO3Z7hNh-_ynFEX2BKVJur9d-vjyszJ5Cdt-zCy5uhFc6TU4ZI1wKVN_Iz9tdAmyja_DKTQCQe4", "Hey Buddy i am Your Ios Notification code", "This is not for test")
//   .then(() => console.log("Success ios notification!"))
//   .catch(console.error);
// Example usage:
// const expoPushTokens = ['ExponentPushToken[yBRBtTIa6xCmtrO8igmTz0]'];






// Multer for File Uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Middleware
app.use(cors({ origin: '*', credentials: true }));
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

// Middleware to check Redis connection
app.use((req, res, next) => {
    if (!pubClient || !pubClient.isOpen) {
        console.warn(`[${new Date().toISOString()}] Redis client not available for request: ${req.path}`);
    }
    next();
});
// ia am ams
// Long Polling Updates Endpoint
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

        while (Date.now() - startTime < timeoutMs) {
            const updates = await pubClient.lPop(key);
            if (updates) {
                const data = JSON.parse(updates);
                return res.json({ success: true, updates: data });
            }
            await new Promise(resolve => setTimeout(resolve, 1000));
        }
        res.json({ success: true, updates: null });
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Polling error for ${userType}:${userId}:`, err.message);
        res.status(500).json({ success: false, message: 'Polling failed' });
    }
});

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
            console.log('Passing API result to client:', result);

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

// List Available Riders
app.get('/rider', async (req, res) => {
    try {
        console.log("iamht")
        const riders = await RiderModel.find({ isAvailable: true });
        res.json({ success: true, riders });
    } catch (err) {
        console.error(`[${new Date().toISOString()}] List riders error:`, err.message);
        res.status(500).json({ success: false, error: 'Failed to list riders' });
    }
});

app.get('/rider/:tempRide', async (req, res) => {
    const { tempRide } = req.params;

    if (!mongoose.Types.ObjectId.isValid(tempRide)) {
        console.warn("[STEP 2] Invalid ride ID");
        return res.status(400).json({ error: 'Invalid ride ID' });
    }

    try {
        console.log("[STEP 3] Fetching ride from MongoDB...");

        const ride = await NewRideModel.findById(tempRide)
            .select("-__v -updatedAt") // optional: exclude unused ride fields
            .populate("user", "name email number") // fetch only required user fields
            .populate("driver", "-documents -preferences -updateLogs -RechargeData") // fetch all driver fields EXCEPT these
            .lean()
            .exec();

        if (!ride) {
            console.warn("[STEP 4] Ride not found in MongoDB");
            return res.status(404).json({ error: 'Ride not found' });
        }

        return res.status(200).json({
            success: true,
            data: ride
        });

    } catch (error) {
        console.error(`[ERROR] ${new Date().toISOString()} Internal server error:`, error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

const GEO_UPDATE_TTL = 30;
function haversineDistance(lat1, lon1, lat2, lon2) {
    const toRad = (x) => (x * Math.PI) / 180;
    const R = 6371e3; // metres
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

app.post('/webhook/cab-receive-location', Protect, async (req, res) => {
    try {
        const riderId = req.user?.userId;
        const { latitude, longitude, accuracy, speed, timestamp, platform } = req.body;

        if (!riderId) return Protect(req, res);

        const now = timestamp || Date.now();

        // ✅ Redis cache
        const locationData = {
            riderId,
            latitude,
            longitude,
            accuracy,
            speed,
            platform: platform || 'unknown',
            timestamp: now,
        };

        await pubClient.setEx(
            `rider:location:${riderId}`,
            GEO_UPDATE_TTL,
            JSON.stringify(locationData)
        );

        console.log(`📦 Cached in Redis for rider ${riderId}:`);

        // ✅ Accuracy filter
        // if (accuracy && accuracy > 10) {
        //     //   console.log(`⏩ Skip DB update for ${riderId}: poor accuracy (${accuracy}m)`);
        //     return res.status(200).json({
        //         message: "Location cached (DB skipped due to accuracy)",
        //         dbUpdated: false,
        //         data: locationData,
        //     });
        // }

        // ✅ Check previous location (skip if moved <20m)
        const prev = await RiderModel.findById(riderId, { location: 1 }).lean();
        if (prev?.location?.coordinates?.length === 2) {
            const [prevLng, prevLat] = prev.location.coordinates;
            const distance = haversineDistance(prevLat, prevLng, latitude, longitude);

            if (distance < 20) {
                // console.log(`⏩ Skip DB update for ${riderId}: moved only ${distance.toFixed(1)}m`);
                return res.status(200).json({
                    message: "Location cached (DB skipped due to low movement)",
                    dbUpdated: false,
                    data: locationData,
                });
            }
        }

        // // ✅ Speed convert (m/s → km/h)
        // let speedKmh = null;
        // if (typeof speed === "number") {
        //     speedKmh = (speed * 3.6).toFixed(2);
        // }

        // ✅ DB update
        const updatedDoc = await RiderModel.findOneAndUpdate(
            { _id: riderId },
            {
                location: { type: "Point", coordinates: [longitude, latitude] },
                lastUpdated: new Date(now)
            },
            { upsert: true, new: true }
        );

        if (updatedDoc) {
            console.log(`💾 DB updated for rider ${riderId}:`, {
                name: updatedDoc.name,
                coords: updatedDoc.location?.coordinates
            });

            return res.status(200).json({
                message: "Location cached and updated successfully",
                dbUpdated: true,
                data: locationData,
            });
        } else {
            console.log(`⚠️ Rider ${riderId} not found in DB`);
            return res.status(200).json({
                message: "Location cached (DB not found)",
                dbUpdated: false,
                data: locationData,
            });
        }
    } catch (err) {
        console.error("❌ Error handling location update:", err.message);
        res.status(500).json({ error: "Internal server error" });
    }
});

app.post('/webhook/receive-location', Protect, async (req, res) => {
    try {
        console.log("user hits", req.user)
        const { latitude, longitude } = req.body;
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
        // console.log("data", data)

        res.status(200).json({ message: 'Location updated successfully' });
    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Root Endpoint
app.get('/', (req, res) => {
    res.status(200).json({
        message: 'Welcome to the API',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// Health Check
app.get('/health', async (req, res) => {
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

// Fetch Current Location
app.post('/Fetch-Current-Location', async (req, res) => {
    const { lat, lng } = req.body;

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
                    return res.status(200).json({
                        success: true,
                        data: JSON.parse(cachedData),
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

        res.status(200).json({ success: true, data: result, message: 'Location fetched' });
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Location fetch error:`, err.message);
        res.status(500).json({ success: false, message: 'Failed to fetch location' });
    }
});


app.get('/driver/:id/location', async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ success: false, message: 'Driver ID is required' });
        }

        const driver = await RiderModel.findById(id);
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        if (!driver.location || !driver.location.coordinates || driver.location.coordinates.length < 2) {
            return res.status(404).json({ success: false, message: 'Driver location not available' });
        }

        const lastUpdated = driver.location?.lastUpdated;
        const timeAgo = lastUpdated ? getTimeAgo(new Date(lastUpdated)) : null;

        const riders = {
            id: driver._id,
            name: driver.name,
            phone: driver.phone,
            location: {
                lat: driver.location.coordinates[1],
                lng: driver.location.coordinates[0],
            },
            howOldUpdated: timeAgo,
            lastUpdated,
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


// Geo-code Distance
app.post('/geo-code-distance', async (req, res) => {
    try {
        const { pickup, dropOff } = req.body;

        if (!pickup || !dropOff) {
            return res.status(400).json({ success: false, message: 'Pickup and dropoff addresses required' });
        }

        const cacheKey = `distance:${pickup}:${dropOff}`;

        // Try to get from cache if Redis is available
        if (pubClient && pubClient.isOpen) {
            try {
                const cachedData = await pubClient.get(cacheKey);
                if (cachedData) {
                    return res.status(200).json({ success: true, ...JSON.parse(cachedData), fromCache: true });
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

        res.status(200).json({ success: true, ...result });
    } catch (err) {
        console.error(`[${new Date().toISOString()}] Geo-code distance error:`, err.message);
        res.status(500).json({ success: false, message: 'Failed to calculate distance' });
    }
});

const ANDROID_STORE = "https://play.google.com/store/apps/details?id=com.happy_coding.olyox&hl=en_IN";
const IOS_STORE = "https://apps.apple.com/in/app/olyox-book-cab-hotel-food/id6744582670";


const ridesTest = {
    "64a83f42": {
        id: "64a83f42",
        pickup: "Sector 99A",
        drop: "Sector 29",
        fare: 119.18
    }
};


// Endpoint to share ride
app.get("/share-ride-to-loveone/:rideId", (req, res) => {
    const { rideId } = req.params;
    const ride = ridesTest[rideId];

    if (!ride) return res.status(404).send("Ride not found");

    // Deep link to open app ride page
    const deepLink = `https://appv2.olyox.com/share-ride-to-loveone/${rideId}`;

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
app.use(
    compression({
        threshold: 0, // compress everything, even small responses
    })
);
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
    const PORT = process.env.PORT || 3100;

    try {
        console.log(`[${new Date().toISOString()}] Worker ${process.pid} starting...`);

        // Connect to Redis first
        await connectRedis();

        // Connect to databases
        await connectDatabases();

        // Start the server
        server.listen(PORT, () => {
            console.log(`[${new Date().toISOString()}] 🚀 Server running on port ${PORT} (Worker ${process.pid})`);
            console.log(`Bull Board available at http://localhost:${PORT}/admin/queues`);
            console.log(`[${new Date().toISOString()}] 🌍 Environment: ${process.env.NODE_ENV || "development"}`);
            console.log(`[${new Date().toISOString()}] ✅ All services connected successfully`);
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] ❌ Failed to start server (Worker ${process.pid}):`, error.message);
        process.exit(1);
    }
}

// Cluster logic
if (cluster.isMaster) {
    console.log(`[${new Date().toISOString()}] 🛠 Master ${process.pid} is running`);
    console.log(`[${new Date().toISOString()}] Spawning ${numCPUs} workers...`);

    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    // Restart worker if it dies
    cluster.on("exit", (worker, code, signal) => {
        console.log(`[${new Date().toISOString()}] ⚠️ Worker ${worker.process.pid} died. Restarting...`);
        cluster.fork();
    });
} else {
    // Workers run the server
    startServer();
}