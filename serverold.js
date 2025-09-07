// Required Dependencies
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const connectDb = require('./database/db');
const cookies_parser = require('cookie-parser');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const timeout = require('express-timeout-handler');
const multer = require('multer');
require('dotenv').config();

// Redis Adapter and Client
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');
// Routes
const router = require('./routes/routes');
const rides = require('./routes/rides.routes');
const hotel_router = require('./routes/Hotel.routes');
const users = require('./routes/user_routes/user_routes');
const tiffin = require('./routes/Tiffin/Tiffin.routes');
const parcel = require('./routes/Parcel/Parcel.routes');
const admin = require('./routes/Admin/admin.routes');

// Models
const RiderModel = require('./models/Rider.model');
const userModel = require('./models/normal_user/User.model');
const Parcel_boy_Location = require('./models/Parcel_Models/Parcel_Boys_Location');
const Settings = require('./models/Admin/Settings');

// Controllers & Middleware
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
const Heavy = require('./routes/Heavy_vehicle/Heavy.routes');
const { connectwebDb } = require('./PaymentWithWebDb/db');
const startExpiryCheckJob = require('./cron_jobs/RiderJobs');
const tempRideDetailsSchema = require('./models/tempRideDetailsSchema');
const { default: mongoose } = require('mongoose');
const sendNotification = require('./utils/sendNotification');
const rideRequestModel = require('./models/ride.request.model');
const User = require('./models/normal_user/User.model');
const NewRoutes = require('./routes/New/New.routes');

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// Initialize Express app and HTTP server
const app = express();
const server = http.createServer(app);


//initialize Redis clients for Socket.IO

const redisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD || '',
    retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
            console.error(`[${new Date().toISOString()}] Redis connection refused, retrying...`);
            return Math.min(options.attempt * 100, 3000);
        }
        return undefined
    }
}

const pubClient = createClient(redisOptions)
const subClient = pubClient.duplicate();

pubClient.on('error', (err) => console.error(`[${new Date().toISOString()}] Redis Pub Client Error:`, err));
subClient.on('error', (err) => console.error(`[${new Date().toISOString()}] Redis Sub Client Error:`, err));
pubClient.on('connect', () => console.log(`[${new Date().toISOString()}] Redis Pub Client Connected`));
subClient.on('connect', () => console.log(`[${new Date().toISOString()}] Redis Sub Client Connected`));

app.set('pubClient', pubClient);
app.set('subClient', pubClient);

// Initialize Socket.IO with appropriate CORS and ping settings
const io = socketIo(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
        credentials: true,
    },
    transports: ['websocket', 'polling'],
    adapter: createAdapter(pubClient, subClient),
    pingInterval: 25000, // Send ping every 25 seconds
    pingTimeout: 20000,
});


// Connect to Redis clients with error handling
Promise.all([pubClient.connect(), subClient.connect()])
    .then(() => {
        console.log(`[${new Date().toISOString()}] Redis clients connected successfully`);
    })
    .catch((err) => {
        console.error(`[${new Date().toISOString()}] Failed to connect Redis clients:`, err);
    });

// Connect to the database
connectwebDb()
connectDb();
console.log('Attempting database connection...');

// Set socket.io instance to be accessible by routes
app.set("socketio", io);

// Middleware Setup
app.use(cors({
    origin: (origin, callback) => {
        callback(null, origin);
    },
    credentials: true,
}));
// app.set('trust proxy', 1); //proxy

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    standardHeaders: true,
    legacyHeaders: false,
    max: 500, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.'
});
app.use(limiter);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookies_parser());
// app.set('trust proxy', true);


const userSocketMap = new Map();     // Regular users
const driverSocketMap = new Map();   // Drivers
const tiffinPartnerMap = new Map();  // Tiffin service partners
const socketMetadata = new Map();
// Make driverSocketMap available to the entire application
app.set('driverSocketMap', driverSocketMap);
app.set('userSocketMap', userSocketMap);



const saveTempRideToFirebase = async (rideData) => {
    try {
        const adminSDK = await sendNotification.initializeFirebase();

        if (!adminSDK.apps || adminSDK.apps.length === 0) {
            console.log('No Firebase Admin SDK apps found');
            throw new Error('Firebase not initialized');
        }

        const db = adminSDK.database();
        const ref = db.ref(`tempRides/${rideData._id}`);

        const startTime = Date.now(); // start timer

        await ref.set(rideData);

        const endTime = Date.now(); // end timer
        const durationMs = endTime - startTime;
        console.log(
            `[${new Date().toISOString()}] Saved temp ride to Firebase: ${rideData._id} (took ${durationMs} ms)`
        );

        return { success: true, _id: rideData._id };

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Failed to save temp ride to Firebase:`, error);

        const startTime = Date.now();

        // Fallback to MongoDB
        const dataSave = await new tempRideDetailsSchema(rideData).save();

        const endTime = Date.now();
        const durationMs = endTime - startTime;
        console.log(
            `[${new Date().toISOString()}] Fallback: Saved temp ride to MongoDB: ${dataSave._id} (took ${durationMs} ms)`
        );

        return { success: true, _id: dataSave._id };
    }
};



const fetchTempRideFromFirebase = async (rideId) => {
    try {
        const adminSDK = await sendNotification.initializeFirebase();

        console.log('adminSDK.apps:', adminSDK.apps);

        if (!adminSDK.apps || adminSDK.apps.length === 0) {
            console.log('No Firebase Admin SDK apps found');
            throw new Error('Firebase not initialized');
        }
        const db = adminSDK.database();
        const ref = db.ref('tempRides');
        const snapshot = await ref.once('value');
        const rides = snapshot.val();

        // console.log('rides from Firebase:', rides);

        if (!rides) {
            console.warn(`[${new Date().toISOString()}] No temp rides found in Firebase`);
            // Fallback to MongoDB
            const mongoRide = await tempRideDetailsSchema.findOne({
                $or: [{ _id: rideId }, { "rideDetails._id": rideId }]
            }).lean();
            if (mongoRide) {
                console.log(`[${new Date().toISOString()}] Fallback: Found temp ride in MongoDB: ${rideId}`);
                return mongoRide;
            }
            return null;
        }

        // Search by either outer _id or inner rideDetails._id
        const ride = Object.values(rides).find(r => r._id === rideId || r.rideDetails?._id === rideId);

        console.log(`[${new Date().toISOString()}] Searching for temp ride in Firebase: ${rideId}`);

        if (!ride) {
            console.warn(`[${new Date().toISOString()}] Temp ride not found in Firebase: ${rideId}`);
            // Fallback to MongoDB
            const mongoRide = await tempRideDetailsSchema.findOne({
                $or: [{ _id: rideId }, { "rideDetails._id": rideId }]
            }).lean();
            if (mongoRide) {
                console.log(`[${new Date().toISOString()}] Fallback: Found temp ride in MongoDB: ${rideId}`);
                return mongoRide;
            }
            return null;
        }
        console.log(`[${new Date().toISOString()}] Fetched temp ride from Firebase: ${rideId}`);
        return ride;
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error fetching temp ride from Firebase:`, error);
        // Fallback to MongoDB
        const mongoRide = await tempRideDetailsSchema.findOne({
            $or: [{ _id: rideId }, { "rideDetails._id": rideId }]
        }).lean();
        if (mongoRide) {
            console.log(`[${new Date().toISOString()}] Fallback: Found temp ride in MongoDB: ${rideId}`);
            return mongoRide;
        }
        return null;
    }
};


// Health check endpoint for load balancer
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'UP',
        timestamp: new Date().toISOString(),
        redisConnected: pubClient.isOpen && subClient.isOpen,
        mongodbConnected: mongoose.connection.readyState === 1,

    });
});
// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`[${new Date().toISOString()}] New client connected: ${socket.id}`);
    socketMetadata.set(socket.id, {
        connectedAt: Date.now(),
        lastPing: Date.now(),
        userType: null,
        userId: null,
        isAuthenticated: false
    });
    socket.on('user_connect', (data) => {
        if (!data || !data.userId || !data.userType) {
            console.error(`[${new Date().toISOString()}] Invalid user connect data:`, data);
            return;
        }

        // Remove any existing connection for this user
        const existingSocketId = userSocketMap.get(data.userId);
        if (existingSocketId && existingSocketId !== socket.id) {
            console.log(`[${new Date().toISOString()}] Removing existing connection for user ${data.userId}`);
            const existingSocket = io.sockets.sockets.get(existingSocketId);
            if (existingSocket) {
                existingSocket.disconnect(true);
            }
            socketMetadata.delete(existingSocketId);
        }

        // Store the user's socket ID
        userSocketMap.set(data.userId, socket.id);

        // Update socket metadata
        const metadata = socketMetadata.get(socket.id);
        if (metadata) {
            metadata.userType = data.userType;
            metadata.userId = data.userId;
            metadata.isAuthenticated = true;
            socketMetadata.set(socket.id, metadata);
        }

        console.log(`[${new Date().toISOString()}] User ${data.userId} connected with socket ID: ${socket.id}`);

        // Send confirmation
        socket.emit('connection_confirmed', {
            status: 'success',
            socketId: socket.id,
            userId: data.userId,
            userType: data.userType
        });
    });


    /**
     * Handle driver connections
     * Maps a driver's ID to their socket ID for targeted communications
     */
    socket.on('driver_connect', (data) => {
        if (!data || !data.userId) {
            console.error(`[${new Date().toISOString()}] Invalid driver connect data:`, data);
            socket.emit('connection_error', { error: 'Invalid connection data' });
            return;
        }

        // Remove any existing connection for this driver
        const existingSocketId = driverSocketMap.get(data.userId);
        if (existingSocketId && existingSocketId !== socket.id) {
            console.log(`[${new Date().toISOString()}] Removing existing connection for driver ${data.userId}`);
            const existingSocket = io.sockets.sockets.get(existingSocketId);
            if (existingSocket) {
                existingSocket.disconnect(true);
            }
            socketMetadata.delete(existingSocketId);
        }

        // Store the driver's socket ID
        driverSocketMap.set(data.userId, socket.id);

        // Update socket metadata
        const metadata = socketMetadata.get(socket.id);
        if (metadata) {
            metadata.userType = data.userType || 'driver';
            metadata.userId = data.userId;
            metadata.isAuthenticated = true;
            socketMetadata.set(socket.id, metadata);
        }

        console.log(`[${new Date().toISOString()}] Driver ${data.userId} connected with socket ID: ${socket.id}`);
        console.log(`[${new Date().toISOString()}] Current driver connections:`, Array.from(driverSocketMap.entries()));

        // Send confirmation
        socket.emit('connection_confirmed', {
            status: 'success',
            socketId: socket.id,
            userId: data.userId,
            userType: data.userType || 'driver'
        });
    });

    socket.on("ping-custom", (payload) => {
        const metadata = socketMetadata.get(socket.id);

        if (!metadata || !metadata.isAuthenticated) {
            console.warn(`[${new Date().toISOString()}] ⚠️ Received ping from unauthenticated socket: ${socket.id}`);
            socket.emit("pong-custom", {
                message: "Pong from server! (Not authenticated)",
                timestamp: Date.now(),
                echo: payload,
                authenticated: false
            });
            return;
        }

        // Update last ping time
        metadata.lastPing = Date.now();
        socketMetadata.set(socket.id, metadata);

        console.log(`[${new Date().toISOString()}] 🔄 Received ping-custom from ${socket.id} (${metadata.userType}: ${metadata.userId}):`, payload);

        socket.emit("pong-custom", {
            message: "Pong from server!",
            timestamp: Date.now(),
            echo: payload,
            authenticated: true,
            userType: metadata.userType,
            userId: metadata.userId
        });

        console.log(`[${new Date().toISOString()}] ✅ Sent pong-custom to ${socket.id}`);
    });

    socket.on("ping-custom-user", (payload) => {
        const metadata = socketMetadata.get(socket.id);

        if (!metadata || !metadata.isAuthenticated) {
            console.warn(`[${new Date().toISOString()}] ⚠️ Received user ping from unauthenticated socket: ${socket.id}`);
            return;
        }

        // Update last ping time
        metadata.lastPing = Date.now();
        socketMetadata.set(socket.id, metadata);

        console.log(`[${new Date().toISOString()}] 🔄 Received ping-custom from user app ${socket.id} (${metadata.userId}):`, payload);

        socket.emit("pong-custom-user", {
            message: "Pong from server!",
            timestamp: Date.now(),
            echo: payload,
            authenticated: true
        });

        console.log(`[${new Date().toISOString()}] ✅ Sent pong-custom-user to ${socket.id}`);
    });

    /**
     * Handle tiffin partner connections
     * Maps a tiffin partner's ID to their socket ID for targeted communications
     */
    socket.on('tiffin_partner', (data) => {
        if (!data || !data.userId) {
            console.error(`[${new Date().toISOString()}] Invalid tiffin_partner connect data:`, data);
            return;
        }

        // Store the tiffin partner's socket ID
        tiffinPartnerMap.set(data.userId, socket.id);
        console.log(`[${new Date().toISOString()}] Tiffin partner ${data.userId} connected with socket ID: ${socket.id}`);
    });

    /**
     * Broadcasts ride data to all connected drivers
     * @param {Object} rideData - The ride data to be sent to drivers
     */
    // const emitRideToDrivers = (rideData) => {
    //     console.log(`[${new Date().toISOString()}] Broadcasting ride to ${driverSocketMap.size} drivers`);

    //     let emittedCount = 0;
    //     driverSocketMap.forEach((driverSocketId, driverId) => {
    //         console.log(`[${new Date().toISOString()}] Sending ride data to driver ${driverId} (socket: ${driverSocketId})`);
    //         io.to(driverSocketId).emit('ride_come', rideData);
    //         emittedCount++;
    //     });

    //     console.log(`[${new Date().toISOString()}] Emitted ride data to ${emittedCount} drivers`);
    // };



    socket.on('ride_accepted', async (data) => {
        try {
            console.log(`[${new Date().toISOString()}] Ride acceptance request:`, data);

            if (!data || !data.data) {
                console.error(`[${new Date().toISOString()}] Invalid ride acceptance data`);
                return;
            }

            // Process the data and change ride request status
            const updatedRide = await ChangeRideRequestByRider(io, data.data);
            console.log(`[${new Date().toISOString()}] Ride status updated:`, updatedRide.rideStatus);

            const populatedRide = await rideRequestModel
                .findById(data?.data?.ride_request_id)
                .populate('rider');

            if (updatedRide.rideStatus === 'accepted') {
                const userId = String(updatedRide.user);
                const userSocketId = userSocketMap.get(userId);

                console.log(`[${new Date().toISOString()}] Notifying user ${userId}, socket found: ${Boolean(userSocketId)}`);

                const userToken = populatedRide?.userFcm;
                const title = '🎉 Ride Accepted!';
                const body = `🎉 Great news! ${populatedRide?.rider?.name} is on the way to pick you up. Get ready for a smooth ride ahead! 🚗✨`;

                if (userSocketId) {
                    io.to(userSocketId).emit('ride_accepted_message', {
                        message: 'Your ride request has been accepted!',
                        rideDetails: updatedRide,
                    });

                    if (userToken) {
                        try {
                            await sendNotification.sendNotification(userToken, title, body, {
                                event: 'RIDE_ACCEPTED',
                                eta: 5,
                                message: 'Your ride request has been accepted!',
                                rideDetails: updatedRide,
                                screen: 'TrackRider',
                                riderId: populatedRide?.rider?.name,
                            });
                        } catch (fcmError) {
                            console.warn(`[${new Date().toISOString()}] Failed to send FCM to user ${userId}:`, fcmError);
                        }
                    }

                    console.log(`[${new Date().toISOString()}] Acceptance notification sent to user: ${userId}`);
                } else {
                    if (userToken) {
                        try {
                            await sendNotification.sendNotification(userToken, title, body, {
                                event: 'RIDE_ACCEPTED',
                                eta: 5,
                                message: 'Your ride request has been accepted!',
                                rideDetails: updatedRide,
                                screen: 'TrackRider',
                                riderId: populatedRide?.rider?.name,
                            });
                        } catch (fcmError) {
                            console.warn(`[${new Date().toISOString()}] Failed to send FCM (no socket) to user ${userId}:`, fcmError);
                        }
                    }

                    console.log(`[${new Date().toISOString()}] No active socket found for user: ${userId}`);
                }

                // === Notify Rider (Driver) ===
                const riderId = String(updatedRide.rider?._id);
                const riderSocketId = driverSocketMap.get(riderId);

                console.log(`[${new Date().toISOString()}] Notifying rider ${riderId}, socket found: ${Boolean(riderSocketId)}`);

                if (riderSocketId) {
                    io.to(riderSocketId).emit('rider_confirm_message', {
                        message: 'You have successfully accepted the ride!',
                        rideDetails: updatedRide,
                    });
                    console.log(`[${new Date().toISOString()}] Confirmation sent to rider: ${riderId}`);
                } else {
                    console.log(`[${new Date().toISOString()}] No active socket found for rider: ${riderId}`);
                }

                // === Cancel the ride for all other drivers ===
                await cancelRideForOtherDrivers(io, updatedRide?.temp_ride_id, riderId, driverSocketMap);
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error handling ride_accepted event:`, error);
            socket.emit('ride_error', { message: 'Ride has already been accepted by another rider' });
        }
    });


    socket.on('ride_rejected', async (data) => {
        try {
            console.log(`[${new Date().toISOString()}] Ride rejection request:`, data);

            if (!data || !data.ride_id || !data.driver_id) {
                console.error(`[${new Date().toISOString()}] Invalid ride rejection data: Missing required fields`);
                return socket.emit('ride_error', { message: 'Invalid rejection data. Please provide ride_id and driver_id.' });
            }

            const { ride_id, driver_id } = data;

            // Update the ride request notification status
            await updateRideRejectionStatus(ride_id, driver_id);

            // If needed, find the next available driver
            await findNextAvailableDriver(io, ride_id);

            // Send confirmation to the driver
            socket.emit('rejection_confirmed', {
                message: 'Ride rejection recorded successfully',
                ride_id: ride_id,
                timestamp: new Date()
            });

            console.log(`[${new Date().toISOString()}] Successfully processed ride rejection for ride: ${ride_id} by driver: ${driver_id}`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error handling ride_rejected event:`, error);
            socket.emit('ride_error', { message: 'Failed to process ride rejection' });
        }
    });

    /**
     * Handle ride acceptance by user
     * Notifies the driver that the user has accepted the ride
     */
    socket.on('rideAccepted_by_user', async (data) => {
        try {
            const { driver, ride } = data;
            if (!driver || !ride || !ride.rider) {
                console.error(`[${new Date().toISOString()}] Invalid rideAccepted_by_user data:`, data);
                return;
            }
            const start = Date.now();
            console.log(`[${new Date().toISOString()}] Starting DB save process for rider: ${ride.rider._id}`);
            const rideData = {
                _id: new mongoose.Types.ObjectId().toString(), // Generate unique ID for Firebase
                driver: {
                    name: driver.name,
                    carModel: driver.carModel,
                    carNumber: driver.carNumber,
                    vehicleType: driver.vehicleType,
                    rating: driver.rating,
                    trips: driver.trips,
                    distance: driver.distance,
                    price: driver.price,
                    otp: driver.otp,
                    pickup_desc: driver.pickup_desc,
                    drop_desc: driver.drop_desc,
                    eta: driver.eta,
                    rideStatus: driver.rideStatus,
                },
                rideDetails: {
                    _id: ride._id,
                    RideOtp: ride.RideOtp,
                    rideStatus: ride.rideStatus,
                    ride_is_started: ride.ride_is_started,
                    eta: ride.eta,
                    EtaOfRide: ride.EtaOfRide,
                    is_ride_paid: ride.is_ride_paid,
                    kmOfRide: ride.kmOfRide,
                    pickup_desc: ride.pickup_desc,
                    drop_desc: ride.drop_desc,
                    createdAt: ride.createdAt,
                    updatedAt: ride.updatedAt,
                    currentLocation: ride.currentLocation,
                    dropLocation: ride.dropLocation,
                    pickupLocation: ride.pickupLocation,
                    retryCount: ride.retryCount,
                    currentSearchRadius: ride.currentSearchRadius,
                    user: ride.user,
                    rider: {
                        _id: ride.rider._id,
                        name: ride.rider.name,
                        phone: ride.rider.phone,
                        Ratings: ride.rider.Ratings,
                        TotalRides: ride.rider.TotalRides,
                        isActive: ride.rider.isActive,
                        isAvailable: ride.rider.isAvailable,
                        isPaid: ride.rider.isPaid,
                        isProfileComplete: ride.rider.isProfileComplete,
                        DocumentVerify: ride.rider.DocumentVerify,
                        BH: ride.rider.BH,
                        YourQrCodeToMakeOnline: ride.rider.YourQrCodeToMakeOnline,
                    },
                },
                message: 'You can start this ride',
            };
            const dataSave = await saveTempRideToFirebase(rideData);
            const update_driver = await RiderModel.findById(ride.rider._id);
            if (!update_driver) {
                console.error(`[${new Date().toISOString()}] Rider not found for ID: ${ride.rider._id}`);
                return;
            }
            update_driver.on_ride_id = dataSave._id;
            await update_driver.save();
            const end = Date.now();
            console.log(`[${new Date().toISOString()}] DB save completed in ${(end - start)} ms for rider: ${ride.rider._id}`);
            const driverSocketId = driverSocketMap.get(ride.rider._id);
            if (driverSocketId) {
                io.to(driverSocketId).emit('ride_accepted_message', {
                    message: 'You can start this ride',
                    rideDetails: ride,
                    driver: driver,
                    temp_ride_id: dataSave._id
                });
                console.log(`[${new Date().toISOString()}] ride_accepted_message emitted to socket for rider: ${ride.rider._id}`);
            } else {
                console.log(`[${new Date().toISOString()}] No active socket found for rider: ${ride.rider._id}`);
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in rideAccepted_by_user:`, error);
        }
    });


    /**
         * Handle ride cancel by user or driver
         * Notifies the driver that the user has cancel the ride same as user if rider cancel
         */
    socket.on('ride-cancel-by-user', async (data) => {
        try {
            console.log("🚀 Received ride cancellation request:", data);

            const { cancelBy, rideData, reason } = data || {};

            if (!cancelBy || !rideData || !reason) {
                console.error("❌ Missing required fields in cancellation data.");
                return;
            }

            console.log("🔍 Processing cancellation by:", cancelBy);

            const dataOfRide = await cancelRideByAnyOne(cancelBy, rideData, reason);

            console.log("✅ Ride cancellation processed:", dataOfRide);

            if (dataOfRide.success) {
                const { ride } = dataOfRide;

                if (!ride) {
                    console.error("❌ Ride data is missing after cancellation.");
                    return;
                }

                console.log("🛑 Ride Status:", ride.rideStatus);
                console.log("🕒 Ride Cancel Time:", ride.rideCancelTime);

                if (cancelBy === "user") {
                    console.log("📢 Notifying driver about cancellation...", driverSocketMap);

                    const riderId = ride.rider?._id;


                    if (!riderId) {
                        console.error("❌ Rider ID is missing! Cannot find driver socket.");
                    } else {
                        const driverSocketId = driverSocketMap.get(String(riderId));
                        console.log("📡 Found driver socket ID:", driverSocketId);

                        if (driverSocketId) {
                            io.to(driverSocketId).emit('ride_cancelled', {
                                message: "🚖 Ride cancelled by user",
                                rideDetails: rideData,
                            });
                            console.log("mesage send")
                        } else {
                            console.warn("⚠️ Driver socket ID not found in map.");
                        }
                    }

                } else if (cancelBy === "driver") {
                    console.log("📢 Notifying user about cancellation...");
                    const userSocketId = userSocketMap.get(String(ride.user?._id));

                    const foundUser = await userModel.findOne({
                        _id: ride.user?._id
                    })
                    if (userSocketId) {
                        console.log("📡 Sending cancel notification to user:", userSocketId);
                        io.to(userSocketId).emit('ride_cancelled_message', {
                            message: "🚕 Ride cancelled by driver",
                            rideDetails: rideData,
                        });

                        const userToken = foundUser?.fcmToken;
                        const title = 'Ride Cancelled by Driver';
                        const body = 'Unfortunately, your driver has cancelled the ride. We apologize for the inconvenience. Please try booking another ride.';

                        if (userToken) {
                            try {
                                await sendNotification.sendNotification(userToken, title, body);
                                console.log("✅ FCM notification sent to user.");
                            } catch (error) {
                                console.error("❌ Error sending FCM to user:", error);
                            }
                        } else {
                            console.warn("⚠️ No FCM token found for user.");
                        }

                        console.log("📨 Message sent to user via socket.");
                    } else {
                        const userToken = foundUser?.fcmToken;
                        const title = 'Ride Cancelled by Driver';
                        const body = 'Unfortunately, your driver has cancelled the ride. We apologize for the inconvenience. Please try booking another ride.';

                        if (userToken) {
                            try {
                                await sendNotification.sendNotification(userToken, title, body);
                                console.log("✅ FCM notification sent to offline user.");
                            } catch (error) {
                                console.error("❌ Error sending FCM to offline user:", error);
                            }
                        } else {
                            console.warn("⚠️ No FCM token found for offline user.");
                        }

                        console.warn("⚠️ User socket ID not found. User might be offline.");
                    }

                }
            } else {
                console.error("❌ Ride cancellation failed:", dataOfRide.message);
            }

        } catch (error) {
            console.error("❌ Error while canceling ride:", error);
        }
    });


    /**
     * Handle new ride requests from users
     * Processes a new ride request and broadcasts it to available drivers
     */
    socket.on('send_message', async (data) => {
        try {
            console.log(`[${new Date().toISOString()}] New ride request received:`, data);

            if (!data || !data.data || !data.data._id) {
                console.error(`[${new Date().toISOString()}] Invalid ride data: Missing required fields`);
                socket.emit('message_response', { success: false, error: "Invalid ride data" });
                return;
            }


            // Find rider information for the ride
            // The findRider function already emits to drivers, so we don't need to do it again
            const riderData = await findRider(data.data._id, io, app);

            if (riderData && riderData.success) {

                socket.emit('message_response', {
                    success: true,
                    message: "Ride request sent to drivers",
                    riderData
                });
            } else {
                const userSocketId = userSocketMap.get(data.data.user);

                console.error(`[${new Date().toISOString()}] Rider not found for user ID: ${data.data.user}, request ID: ${data.data._id}`);

                if (userSocketId) {
                    try {
                        const userToken = data?.data?.userFcm;
                        const title = 'You can retry in a few moments.';
                        const body = 'Sorry, no riders are currently available nearby. Please try again shortly.';

                        await sendNotification.sendNotification(userToken, title, body, {
                            event: "NO_RIDERS_AVAILABLE",
                            retryAfter: 120,
                            screen: "RetryBooking"
                        });
                    } catch (fcmError) {
                        console.warn(`[${new Date().toISOString()}] Failed to send FCM notification:`, fcmError);
                    }

                    io.to(userSocketId).emit('sorry_no_rider_available', {
                        success: false,
                        message: "Sorry, no riders are currently available nearby. Please try again shortly.",
                        retrySuggestion: "You can retry in a few moments."
                    });
                } else {
                    try {
                        const userToken = data?.data?.userFcm;
                        const title = 'You can retry in a few moments.';
                        const body = 'Sorry, no riders are currently available nearby. Please try again shortly.';

                        await sendNotification.sendNotification(userToken, title, body);
                    } catch (fcmError) {
                        console.warn(`[${new Date().toISOString()}] Failed to send FCM notification (no socket):`, fcmError);
                    }

                    console.warn(`Socket ID not found for user: ${data.data.user}`);
                }

            }

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error processing ride request:`, error);
            socket.emit('message_response', {
                success: false,
                error: 'Failed to process the ride request',
            });
        }
    });

    /**
     * Handle ride start event
     * Updates ride status to 'started' and notifies the user
     */
    socket.on('ride_started', async (data) => {
        try {
            console.log(`[${new Date().toISOString()}] Ride start request:`, data);

            if (!data || !data.ride?.rideDetails?.user) {
                console.error(`[${new Date().toISOString()}] Invalid ride_started data`);
                return;
            }

            const userId = String(data.ride.rideDetails.user);
            const userSocketId = userSocketMap.get(userId);
            const rideStartResult = await rideStart(data.ride);
            const foundUser = await userModel.findOne({
                _id: userId
            })

            if (rideStartResult.success) {
                console.log(`[${new Date().toISOString()}] Ride started successfully for user ${userId}`);

                if (userSocketId) {
                    io.to(userSocketId).emit('ride_user_start', {
                        message: 'Your ride has started!',
                        rideDetails: data,
                    });

                    try {
                        if (foundUser?.fcmToken) {
                            const userToken = foundUser?.fcmToken;
                            const title = 'Your Ride Has Started! Stay Safe!';
                            const body = 'Your ride has officially started. Your driver is on the way. Please stay safe and be careful during your journey. We wish you a smooth ride!';

                            await sendNotification.sendNotification(userToken, title, body);
                        }
                    } catch (fcmError) {
                        console.warn(`[${new Date().toISOString()}] Failed to send ride start FCM:`, fcmError);
                    }

                    console.log(`[${new Date().toISOString()}] Start notification sent to user: ${userId}`);
                } else {
                    try {
                        if (foundUser?.fcmToken) {
                            const userToken = foundUser?.fcmToken;
                            const title = 'Your Ride Has Started! Stay Safe!';
                            const body = 'Your ride has officially started. Your driver is on the way. Please stay safe and be careful during your journey. We wish you a smooth ride!';

                            await sendNotification.sendNotification(userToken, title, body);
                        }
                    } catch (fcmError) {
                        console.warn(`[${new Date().toISOString()}] Failed to send ride start FCM (no socket):`, fcmError);
                    }

                    console.log(`[${new Date().toISOString()}] No active socket found for user: ${userId}`);
                }
            }
            else {
                console.error(`[${new Date().toISOString()}] Error starting ride:`, rideStartResult);
                socket.emit('ride_error', { message: 'Failed to start ride' });
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in ride_started:`, error);
            socket.emit('ride_error', { message: 'Failed to process ride start' });
        }
    });


    /**
     * Handle ride end event
     * Updates ride status to 'completed' and notifies the driver
     */

    socket.on('ride_end_by_rider', async (data) => {
        try {
            const ride_id = data?.rideDetails?.ride?.rideDetails?._id;
            const user = data?.rideDetails?.ride?.rideDetails?.user;

            // 🚫 Invalid data check
            if (!user || !ride_id) {
                console.error(`[${new Date().toISOString()}] Invalid ride_end_by_rider data`, data);
                return;
            }

            const userSocketId = userSocketMap.get(String(user));
            const foundUser = await userModel.findOne({ _id: user });

            const userToken = foundUser?.fcmToken;
            const title = 'Ride Completed! Please Make Your Payment';
            const body = 'Your ride has ended successfully. Kindly proceed to make the payment. Thank you for riding with us!';

            if (userSocketId) {
                io.to(userSocketId).emit('your_ride_is_mark_complete', {
                    message: 'Rider marked your ride as complete. Please confirm if it’s correct.',
                    rideId: ride_id,
                });

                try {
                    if (userToken) {
                        await sendNotification.sendNotification(userToken, title, body);
                        console.log(`[${new Date().toISOString()}] Notification sent to user (via socket): ${user}`);
                    }
                } catch (notifError) {
                    console.warn(`[${new Date().toISOString()}] Notification error (socket user):`, notifError);
                }

            } else {
                try {
                    if (userToken) {
                        await sendNotification.sendNotification(userToken, title, body);
                        console.log(`[${new Date().toISOString()}] Notification sent to user (offline): ${user}`);
                    }
                } catch (notifError) {
                    console.warn(`[${new Date().toISOString()}] Notification error (offline user):`, notifError);
                }

                console.log(`[${new Date().toISOString()}] No active socket found for user: ${user}`);
            }

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in ride_end_by_rider handler:`, error);
        }
    });


    socket.on('ride_end_by_user_', async (data) => {
        try {
            const { ride } = data || {};


            if (!ride?.rider?._id || !ride?._id) {
                console.error(`[${new Date().toISOString()}] ❌ Invalid ride_end_by_user data`, data);

                io.to(socket.id).emit('ride_end_error', {
                    success: false,
                    message: 'Invalid ride details provided. Please try again or contact support.',
                });

                return;
            }

            const driverSocketIds = driverSocketMap.get(String(ride.rider._id));
            const userSocketId = userSocketMap.get(String(ride.user));

            if (driverSocketIds) {
                io.to(driverSocketIds).emit('your_ride_is_mark_complete_by_user', {
                    message: 'User marked your ride as complete. Please confirm if it’s correct.',
                    rideId: ride._id,
                });
                console.log(`[${new Date().toISOString()}] ✅ Ride end confirmation sent to Driver: ${ride.rider._id}`);
            } else {
                console.warn(`[${new Date().toISOString()}] ⚠️ No active socket found for rider: ${ride.rider._id}`);
                io.to(userSocketId).emit('ride_end_error', {
                    success: false,
                    message: 'The driver is currently offline. Please wait or try again shortly.',
                });
            }

        } catch (error) {
            console.error(`[${new Date().toISOString()}] ❌ Error in ride_end_by_user_`, error);
            io.to(userSocketId).emit('ride_end_error', {
                success: false,
                message: 'Something went wrong while ending the ride. Please try again later.',
                error: error.message,
            });
        }
    });



    socket.on('ride_incorrect_mark_done_user', async (data) => {
        try {
            console.log(data)
            const user = data?.rideDetails?.ride?.rideDetails?.user;

            if (!user) {
                console.error(`[${new Date().toISOString()}] ❌ Invalid ride_incorrect_mark_done_user: Missing user`);
                return;
            }

            const userSocketId = userSocketMap.get(String(user));

            if (userSocketId) {
                io.to(userSocketId).emit('ride_incorrect_mark_done_user_done', {
                    message: 'You have marked the ride as complete incorrectly. If you have any problem or concern, please talk to support.',
                });
            } else {
                console.warn(`[${new Date().toISOString()}] ⚠️ No active socket for user: ${user}`);
            }

        } catch (error) {
            console.error(`[${new Date().toISOString()}] ❌ Error in ride_incorrect_mark_done_user:`, error);
        }
    });




    socket.on('endRide', async (data) => {
        try {
            console.log(`[${new Date().toISOString()}] Ride end request:`, data);

            if (!data || !data.ride) {
                console.error(`[${new Date().toISOString()}] Invalid endRide data`);
                return;
            }

            const rideEndResult = await rideEnd(data.ride);

            if (rideEndResult.success) {
                console.log(`[${new Date().toISOString()}] Ride ended successfully. Driver ID: ${rideEndResult.driverId}`);

                const driverSocketId = driverSocketMap.get(String(rideEndResult.driverId));

                if (driverSocketId) {
                    io.to(driverSocketId).emit('ride_end', {
                        message: 'Your ride has been completed. Please collect payment.',
                        rideDetails: data,
                    });
                    console.log(`[${new Date().toISOString()}] End notification sent to driver: ${rideEndResult.driverId}`);
                } else {
                    console.log(`[${new Date().toISOString()}] No active socket found for driver: ${rideEndResult.driverId}`);
                }
            } else {
                console.error(`[${new Date().toISOString()}] Error ending ride:`, rideEndResult.error);
                socket.emit('ride_error', { message: 'Failed to end ride' });
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in endRide:`, error);
            socket.emit('ride_error', { message: 'Failed to process ride end' });
        }
    });


    socket.on('send_rider_location', async (data) => {
        const { rider, user } = data || {};

        if (!rider || !user) {
            console.error('[send_rider_location] Invalid data received:', data);
            return;
        }

        const riderId = rider?._id;
        if (!riderId) {
            console.error('[send_rider_location] Rider ID missing in data:', rider);
            return;
        }

        try {
            const foundLiveLocation = await RiderModel.findById(riderId);
            if (!foundLiveLocation) {
                console.error(`[send_rider_location] Rider with ID ${riderId} not found`);
                return;
            }

            const reterviewdLocation = foundLiveLocation?.location;
            if (!reterviewdLocation || reterviewdLocation.coordinates.length < 2) {
                console.error(`[send_rider_location] Location not found or invalid for rider ID ${riderId}`);
                return;
            }

            const foundUserSocket = userSocketMap.get(String(user));
            if (!foundUserSocket) {
                console.error(`[send_rider_location] No active socket found for user ID ${user}`);
                return;
            }

            // Emit location to user
            io.to(foundUserSocket).emit('rider_location', {
                message: 'Rider location updated',
                location: reterviewdLocation.coordinates,
            });

            console.log(`[send_rider_location] Sent rider location to user ${user}`);

        } catch (error) {
            console.error('[send_rider_location] Error handling location update:', error);
        }
    });


    /**
     * Handle payment received event
     * Updates ride payment status and prompts user for rating
     */
    socket.on('isPay', async (data) => {
        try {
            console.log(`[${new Date().toISOString()}] Payment confirmation received:`, data);

            if (!data || !data.ride || !data.ride.user || !data?.paymentMethod) {
                console.error(`[${new Date().toISOString()}] Invalid payment data`);
                return;
            }

            const collectResult = await collectCash({ data: data.ride, paymentMethod: data?.paymentMethod });

            if (collectResult.success) {
                console.log(`[${new Date().toISOString()}] Payment recorded successfully for user: ${data.ride.user}`);

                const userSocketId = userSocketMap.get(String(data.ride.user));
                const foundUser = await userModel.findOne({ _id: data.ride.user });

                const title = 'Payment Received – Thank You!';
                const body = 'We’ve received your payment successfully. Please take a moment to rate your ride experience. Your feedback helps us improve!';

                if (userSocketId) {
                    io.to(userSocketId).emit('give-rate', {
                        message: 'Your payment has been received. Please rate your ride.',
                        rideDetails: data,
                    });

                    try {
                        await sendNotification.sendNotification(foundUser?.fcmToken, title, body);
                    } catch (fcmError) {
                        console.warn(`[${new Date().toISOString()}] Failed to send FCM notification to socket user ${data.ride.user}:`, fcmError);
                    }

                    console.log(`[${new Date().toISOString()}] Rating request sent to user: ${data.ride.user}`);
                } else {
                    try {
                        await sendNotification.sendNotification(foundUser?.fcmToken, title, body);
                    } catch (fcmError) {
                        console.warn(`[${new Date().toISOString()}] Failed to send FCM notification (no socket) to user ${data.ride.user}:`, fcmError);
                    }

                    console.log(`[${new Date().toISOString()}] No active socket found for user: ${data.ride.user}`);
                }
            } else {
                console.error(`[${new Date().toISOString()}] Error recording payment:`, collectResult.error);
                socket.emit('payment_error', { message: 'Failed to process payment confirmation' });
            }

        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in isPay:`, error);
            socket.emit('payment_error', { message: 'Failed to process payment' });
        }
    });

    /**
     * Handle rating submission
     * Records the user's rating and notifies the driver
     */
    socket.on('rating', async (data) => {
        try {
            console.log(`[${new Date().toISOString()}] Rating submission received:`, data);

            const { rating, ride } = data;

            if (!rating || !ride) {
                console.error(`[${new Date().toISOString()}] Invalid rating data`);
                return;
            }

            const ratingResult = await AddRating(ride, rating);

            if (ratingResult.success) {
                console.log(`[${new Date().toISOString()}] Rating added successfully. Driver ID: ${ratingResult.driverId}`);

                const driverSocketId = driverSocketMap.get(String(ratingResult.driverId));

                if (driverSocketId) {
                    io.to(driverSocketId).emit('rating', {
                        message: 'You have received a rating for your ride.',
                        rating: rating,
                    });
                    console.log(`[${new Date().toISOString()}] Rating notification sent to driver: ${ratingResult.driverId}`);
                } else {
                    console.log(`[${new Date().toISOString()}] No active socket found for driver: ${ratingResult.driverId}`);
                }
            } else {
                console.error(`[${new Date().toISOString()}] Error adding rating:`, ratingResult.error);
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in rating:`, error);
        }
    });

    /**
     * Handle parcel acceptance by driver
     * Updates the parcel request and notifies relevant parties
     */
    socket.on("driver_parcel_accept", async (data) => {
        try {
            console.log(`[${new Date().toISOString()}] Parcel acceptance request:`, data);

            if (!data || !data.order_id || !data.driver_id) {
                console.error(`[${new Date().toISOString()}] Invalid parcel acceptance data`);
                return;
            }

            const response = await update_parcel_request(io, data, driverSocketMap, userSocketMap);

            if (response.status) {
                console.log(`[${new Date().toISOString()}] Parcel accepted successfully:`, response.message);

                // Find the driver's socket ID
                const driverSocketId = driverSocketMap.get(data.driver_id);

                if (driverSocketId) {
                    io.to(driverSocketId).emit("order_update_success", {
                        status: true,
                        message: "Order successfully accepted",
                        order_id: data.order_id,
                    });
                    console.log(`[${new Date().toISOString()}] Acceptance confirmation sent to driver: ${data.driver_id}`);
                } else {
                    console.log(`[${new Date().toISOString()}] No active socket found for driver: ${data.driver_id}`);
                }
            } else {
                console.error(`[${new Date().toISOString()}] Parcel acceptance failed:`, response.error);

                // Send failure response back to driver
                const driverSocketId = driverSocketMap.get(data.driver_id);

                if (driverSocketId) {
                    io.to(driverSocketId).emit("order_update_failed", {
                        status: false,
                        message: response.message || "Failed to accept order",
                    });
                }
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in driver_parcel_accept:`, error);
        }
    });

    /**
     * Handle driver reached pickup location event
     * Updates the parcel status and notifies relevant parties
     */
    socket.on('driver_reached', async (data) => {
        try {
            console.log(`[${new Date().toISOString()}] Driver reached notification:`, data);

            if (!data || !data._id || !data.driverId) {
                console.error(`[${new Date().toISOString()}] Invalid driver_reached data`);
                return;
            }

            const response = await mark_reached(io, data, driverSocketMap, userSocketMap);

            if (response.status) {
                console.log(`[${new Date().toISOString()}] Driver reached status updated:`, response.message);

                // Notify driver of successful status update
                const driverSocketId = driverSocketMap.get(data.driver_id);

                if (driverSocketId) {
                    io.to(driverSocketId).emit("order_mark_success", {
                        status: true,
                        message: "Location reached status updated",
                        order_id: data._id,
                    });
                }
            } else {
                console.error(`[${new Date().toISOString()}] Driver reached status update failed:`, response.error);

                // Notify driver of failed status update
                const driverSocketId = driverSocketMap.get(data.driver_id);

                if (driverSocketId) {
                    io.to(driverSocketId).emit("order_update_failed", {
                        status: false,
                        message: response.message || "Failed to update status",
                    });
                }
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in driver_reached:`, error);
        }
    });

    /**
     * Handle pickup confirmation event
     * Updates the parcel status to 'picked up' and notifies relevant parties
     */
    socket.on('mark_pick', async (data) => {
        try {
            console.log(`[${new Date().toISOString()}] Parcel pickup notification:`, data);

            if (!data || !data._id || !data.driverId) {
                console.error(`[${new Date().toISOString()}] Invalid mark_pick data`);
                return;
            }

            const response = await mark_pick(io, data, driverSocketMap, userSocketMap);

            if (response.status) {
                console.log(`[${new Date().toISOString()}] Parcel pickup status updated:`, response.message);

                // Notify driver of successful pickup status update
                const driverSocketId = driverSocketMap.get(data.driver_id);

                if (driverSocketId) {
                    io.to(driverSocketId).emit("mark_pick_driver", {
                        status: true,
                        message: "Pickup status updated successfully",
                        order_id: data._id,
                    });
                }
            } else {
                console.error(`[${new Date().toISOString()}] Parcel pickup status update failed:`, response.error);

                // Notify driver of failed pickup status update
                const driverSocketId = driverSocketMap.get(data.driver_id);

                if (driverSocketId) {
                    io.to(driverSocketId).emit("order_update_failed", {
                        status: false,
                        message: response.message || "Failed to update pickup status",
                    });
                }
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in mark_pick:`, error);
        }
    });

    /**
     * Handle delivery confirmation event
     * Updates the parcel status to 'delivered' and notifies relevant parties
     */
    socket.on('mark_deliver', async (data, moneyWriteAble, mode) => {
        try {
            console.log(`[${new Date().toISOString()}] Parcel delivery notification:`, data);

            if (!data || !data._id || !data.driverId) {
                console.error(`[${new Date().toISOString()}] Invalid mark_deliver data`);
                return;
            }

            const response = await mark_deliver(io, data, driverSocketMap, userSocketMap, moneyWriteAble, mode);

            if (response.status) {
                console.log(`[${new Date().toISOString()}] Parcel delivery status updated:`, response.message);

                // Notify driver of successful delivery status update
                const driverSocketId = driverSocketMap.get(data.driver_id);

                if (driverSocketId) {
                    io.to(driverSocketId).emit("mark_pick_driver", {
                        status: true,
                        message: "Delivery status updated successfully",
                        order_id: data._id,
                    });
                }
            } else {
                console.error(`[${new Date().toISOString()}] Parcel delivery status update failed:`, response.error);

                // Notify driver of failed delivery status update
                const driverSocketId = driverSocketMap.get(data.driver_id);

                if (driverSocketId) {
                    io.to(driverSocketId).emit("order_update_failed", {
                        status: false,
                        message: response.message || "Failed to update delivery status",
                    });
                }
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in mark_deliver:`, error);
        }
    });

    /**
     * Handle order cancellation event
     * Updates the parcel status to 'cancelled' and notifies relevant parties
     */
    socket.on('mark_cancel', async (data) => {
        try {
            console.log(`[${new Date().toISOString()}] Order cancellation request:`, data);

            if (!data || !data._id || !data.driverId) {
                console.error(`[${new Date().toISOString()}] Invalid mark_cancel data`);
                return;
            }

            const response = await mark_cancel(io, data, driverSocketMap, userSocketMap);

            if (response.status) {
                console.log(`[${new Date().toISOString()}] Order cancellation status updated:`, response.message);

                // Notify driver of successful cancellation status update
                const driverSocketId = driverSocketMap.get(data.driver_id);

                if (driverSocketId) {
                    io.to(driverSocketId).emit("mark_pick_driver", {
                        status: true,
                        message: "Cancellation status updated successfully",
                        order_id: data._id,
                    });
                }
            } else {
                console.error(`[${new Date().toISOString()}] Order cancellation status update failed:`, response.error);

                // Notify driver of failed cancellation status update
                const driverSocketId = driverSocketMap.get(data.driver_id);

                if (driverSocketId) {
                    io.to(driverSocketId).emit("order_update_failed", {
                        status: false,
                        message: response.message || "Failed to update cancellation status",
                    });
                }
            }
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error in mark_cancel:`, error);
        }
    });

    socket.on('background_ping', (data) => {

        if (data) {
            console.log('Ignored background_ping: app is in background', data);
            return;
        }


    });

    /**
     * Handle client disconnections
     * Removes the disconnected client from appropriate connection maps
     */
    socket.on('disconnect', (reason) => {
        try {
            console.log(`[${new Date().toISOString()}] Client disconnected. Socket ID: ${socket.id}, Reason: ${reason}`);

            // Get socket metadata before cleanup
            const metadata = socketMetadata.get(socket.id);
            const connectionInfo = metadata ? {
                userId: metadata.userId,
                userType: metadata.userType,
                isAuthenticated: metadata.isAuthenticated,
                connectedAt: metadata.connectedAt,
                lastPing: metadata.lastPing,
                connectionDuration: Date.now() - metadata.connectedAt,
                timeSinceLastPing: Date.now() - metadata.lastPing
            } : null;

            if (connectionInfo) {
                console.log(`[${new Date().toISOString()}] Connection info for ${socket.id}:`, {
                    user: `${connectionInfo.userType}:${connectionInfo.userId}`,
                    authenticated: connectionInfo.isAuthenticated,
                    duration: `${Math.round(connectionInfo.connectionDuration / 1000)}s`,
                    lastPingAgo: `${Math.round(connectionInfo.timeSinceLastPing / 1000)}s`
                });
            }

            // Enhanced disconnect reason handling
            switch (reason) {
                case 'io server disconnect':
                    console.warn(`[${new Date().toISOString()}] Server disconnected the socket, client needs to reconnect manually.`);
                    if (connectionInfo) {
                        console.warn(`[${new Date().toISOString()}] Disconnected user: ${connectionInfo.userType}:${connectionInfo.userId}`);
                    }
                    break;

                case 'io client disconnect':
                    console.info(`[${new Date().toISOString()}] Client disconnected intentionally.`);
                    if (connectionInfo) {
                        console.info(`[${new Date().toISOString()}] Clean disconnect for: ${connectionInfo.userType}:${connectionInfo.userId}`);
                    }
                    break;

                case 'ping timeout':
                    console.warn(`[${new Date().toISOString()}] Ping timeout - client not responding.`);
                    if (connectionInfo) {
                        console.warn(`[${new Date().toISOString()}] Timeout for: ${connectionInfo.userType}:${connectionInfo.userId}, last ping: ${Math.round(connectionInfo.timeSinceLastPing / 1000)}s ago`);
                    }
                    break;

                case 'transport close':
                    console.warn(`[${new Date().toISOString()}] Transport closed unexpectedly.${reason}`);
                    if (connectionInfo) {
                        console.warn(`[${new Date().toISOString()}] Transport issue for: ${connectionInfo.userType}:${connectionInfo.userId}`);
                    }
                    break;

                case 'transport error':
                    console.error(`[${new Date().toISOString()}] Transport error occurred.${reason}`);
                    if (connectionInfo) {
                        console.error(`[${new Date().toISOString()}] Transport error for: ${connectionInfo.userType}:${connectionInfo.userId}`);
                    }
                    break;

                default:
                    console.log(`[${new Date().toISOString()}] Unknown disconnect reason: ${reason}`);
                    if (connectionInfo) {
                        console.log(`[${new Date().toISOString()}] Unknown disconnect for: ${connectionInfo.userType}:${connectionInfo.userId}`);
                    }
                    break;
            }

            // Comprehensive cleanup with enhanced logging
            let cleanupCount = 0;
            let cleanupDetails = [];

            // Remove from userSocketMap if present
            for (const [userId, socketId] of userSocketMap.entries()) {
                if (socketId === socket.id) {
                    userSocketMap.delete(userId);
                    cleanupCount++;
                    cleanupDetails.push(`User ${userId}`);
                    console.log(`[${new Date().toISOString()}] User ${userId} disconnected and removed from userSocketMap`);
                    break;
                }
            }

            // Remove from driverSocketMap if present
            for (const [driverId, socketId] of driverSocketMap.entries()) {
                if (socketId === socket.id) {
                    driverSocketMap.delete(driverId);
                    cleanupCount++;
                    cleanupDetails.push(`Driver ${driverId}`);
                    console.log(`[${new Date().toISOString()}] Driver ${driverId} disconnected and removed from driverSocketMap`);

                    // Log updated driver connections after removal
                    console.log(`[${new Date().toISOString()}] Updated driver connections:`, Array.from(driverSocketMap.entries()));
                    break;
                }
            }

            // Remove from tiffinPartnerMap if present
            for (const [partnerId, socketId] of tiffinPartnerMap.entries()) {
                if (socketId === socket.id) {
                    tiffinPartnerMap.delete(partnerId);
                    cleanupCount++;
                    cleanupDetails.push(`Tiffin partner ${partnerId}`);
                    console.log(`[${new Date().toISOString()}] Tiffin partner ${partnerId} disconnected and removed from tiffinPartnerMap`);
                    break;
                }
            }

            // Clean up socket metadata (IMPORTANT!)
            const metadataRemoved = socketMetadata.delete(socket.id);
            if (metadataRemoved) {
                cleanupCount++;
                cleanupDetails.push('Socket metadata');
                console.log(`[${new Date().toISOString()}] Socket metadata cleaned up for ${socket.id}`);
            }

            // Summary logging
            if (cleanupCount > 0) {
                console.log(`[${new Date().toISOString()}] ✅ Cleanup completed: ${cleanupCount} items removed (${cleanupDetails.join(', ')})`);
            } else {
                console.warn(`[${new Date().toISOString()}] ⚠️ No cleanup items found for socket ${socket.id} - possible orphaned connection`);
            }

            // Log current connection counts after cleanup
            console.log(`[${new Date().toISOString()}] Current connection counts:`, {
                users: userSocketMap.size,
                drivers: driverSocketMap.size,
                tiffinPartners: tiffinPartnerMap.size,
                totalSockets: socketMetadata.size,
                activeConnections: io.engine.clientsCount
            });

            // Additional validation - check for orphaned entries
            const orphanedUsers = [];
            const orphanedDrivers = [];
            const orphanedPartners = [];

            for (const [userId, socketId] of userSocketMap.entries()) {
                if (!io.sockets.sockets.get(socketId)) {
                    orphanedUsers.push({ userId, socketId });
                }
            }

            for (const [driverId, socketId] of driverSocketMap.entries()) {
                if (!io.sockets.sockets.get(socketId)) {
                    orphanedDrivers.push({ driverId, socketId });
                }
            }

            for (const [partnerId, socketId] of tiffinPartnerMap.entries()) {
                if (!io.sockets.sockets.get(socketId)) {
                    orphanedPartners.push({ partnerId, socketId });
                }
            }

            // Clean up orphaned entries
            if (orphanedUsers.length > 0 || orphanedDrivers.length > 0 || orphanedPartners.length > 0) {
                console.warn(`[${new Date().toISOString()}] 🧹 Found orphaned entries, cleaning up...`);

                orphanedUsers.forEach(({ userId, socketId }) => {
                    userSocketMap.delete(userId);
                    socketMetadata.delete(socketId);
                    console.log(`[${new Date().toISOString()}] Cleaned orphaned user: ${userId} (${socketId})`);
                });

                orphanedDrivers.forEach(({ driverId, socketId }) => {
                    driverSocketMap.delete(driverId);
                    socketMetadata.delete(socketId);
                    console.log(`[${new Date().toISOString()}] Cleaned orphaned driver: ${driverId} (${socketId})`);
                });

                orphanedPartners.forEach(({ partnerId, socketId }) => {
                    tiffinPartnerMap.delete(partnerId);
                    socketMetadata.delete(socketId);
                    console.log(`[${new Date().toISOString()}] Cleaned orphaned tiffin partner: ${partnerId} (${socketId})`);
                });

                console.log(`[${new Date().toISOString()}] ✅ Orphan cleanup completed: ${orphanedUsers.length + orphanedDrivers.length + orphanedPartners.length} entries removed`);
            }

        } catch (err) {
            console.error(`[${new Date().toISOString()}] ❌ Error handling disconnect for socket ${socket.id}:`, err);

            // Fallback cleanup in case of error
            try {
                socketMetadata.delete(socket.id);
                console.log(`[${new Date().toISOString()}] 🆘 Fallback: Removed socket metadata for ${socket.id}`);
            } catch (fallbackErr) {
                console.error(`[${new Date().toISOString()}] ❌ Fallback cleanup also failed:`, fallbackErr);
            }
        }
    });

});

// API Routes
app.use('/api/v1/rider', router);
app.use('/api/v1/rides', rides);
app.use('/api/v1/hotels', hotel_router);
app.use('/api/v1/user', users);
app.use('/api/v1/tiffin', tiffin);
app.use('/api/v1/parcel', parcel);
app.use('/api/v1/heavy', Heavy);
app.use('/api/v1/admin', admin);
app.use('/api/v1/new', NewRoutes);



app.post('/image-upload', upload.any(), async (req, res) => {
    try {
        console.log(`[${new Date().toISOString()}] Image upload request received`, {
            filesCount: req.files ? req.files.length : 0
        });

        return res.status(201).json({
            message: "Image uploaded successfully",
            data: req.files
        });
    } catch (error) {
        console.error(`[${new Date().toISOString()}] Image upload error:`, error.message);
        return res.status(500).json({
            message: "Image upload failed",
            error: error.message
        });
    }
});


// Define the route to fetch directions
app.post('/directions', async (req, res) => {
    try {
        const data = req.body || {};

        console.log(data)

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
            console.log('Passing cached result to client:', result);

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


app.post('/webhook/cab-receive-location', async (req, res, next) => {
    if (!req.body.riderId) {
        // Apply Protect middleware only if riderId is not provided
        return Protect(req, res, next);
    }
    next(); // Proceed to the handler if riderId is provided
}, async (req, res) => {
    try {
        const { latitude, longitude, riderId } = req.body;
        let userId;
        if (riderId) {
            userId = riderId;  // Use riderId from the body if it's provided
        } else {
            userId = req.user.userId;  // Otherwise, get userId from the authenticated user
        }



        const data = await RiderModel.findOneAndUpdate(
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

        // console.log("data of rider updated");

        res.status(200).json({ message: 'Location updated successfully' });
    } catch (error) {
        console.error('Error updating location:', error);
        res.status(500).json({ error: 'Internal server error' });
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

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

app.get('/rider/:tempRide', async (req, res) => {
    const { tempRide } = req.params;
    console.log(`[STEP 1] Received tempRide param: ${tempRide}`);

    if (!tempRide || !mongoose.Types.ObjectId.isValid(tempRide)) {
        console.warn("[STEP 2] Invalid ride ID");
        return res.status(400).json({ error: 'Invalid ride ID' });
    }

    const maxRetries = 3;
    const delayMs = 12000;

    try {
        let ride = null;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            console.log(`[STEP 3.${attempt}] Attempt ${attempt} to fetch ride from Firebase/MongoDB...`);

            ride = await fetchTempRideFromFirebase(tempRide);

            if (ride) {
                console.log(`[STEP 4.${attempt}] Ride found, fetching user...`);
                const userId = ride?.rideDetails?.user || ride?.user; // fallback if user is directly on ride
                if (!userId) {
                    console.warn(`[STEP 5.${attempt}] User ID not found in ride data`);
                    return res.status(404).json({ error: 'User not found for ride' });
                }

                const user = await User.findById(userId).lean();
                if (!user) {
                    console.warn(`[STEP 6.${attempt}] User not found for ride`);
                    return res.status(404).json({ error: 'User not found for ride' });
                }

                console.log(`[STEP 7.${attempt}] Ride and user found, returning response`);
                return res.status(200).json({
                    ride: {
                        ...ride,
                        found: user
                    }
                });
            }else{
                  const mongoRide = await tempRideDetailsSchema.findOne({
                $or: [{ _id: rideId }, { "rideDetails._id": tempRide }]
            }).lean();
            }

            console.log(`[STEP 8.${attempt}] Ride not found, retrying in ${delayMs / 1000} seconds...`);
            if (attempt < maxRetries) await delay(delayMs);
        }

        console.error("[STEP 9] Ride not found after maximum retries");
        return res.status(404).json({ error: 'Ride not found after retrying' });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Internal error:`, error);
        return res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/rider', async (req, res) => {
    try {
        const riders = await RiderModel.find({ isAvailable: true });
        res.render('riders', { riders });
    } catch (err) {
        res.status(500).send('Error retrieving riders');
    }
});

app.get('/', (req, res) => {
    res.status(201).json({
        message: 'Welcome to the API',
    })
})

app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});



app.post('/Fetch-Current-Location', async (req, res) => {
    const { lat, lng } = req.body;
    if (!lat || !lng) {
        return res.status(400).json({ success: false, message: "Latitude and longitude are required" });
    }

    const cacheKey = `geocode:${lat},${lng}`;

    try {
        // Check Redis cache first
        const cachedData = await pubClient.get(cacheKey);
        if (cachedData) {
            return res.status(200).json({
                success: true,
                data: JSON.parse(cachedData),
                message: "Location fetch successful (from cache)"
            });
        }

        // If no cache, fetch from Google
        const addressResponse = await axios.get(
            `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=AIzaSyCBATa-tKn2Ebm1VbQ5BU8VOqda2nzkoTU`
        );

        if (addressResponse.data.results.length > 0) {
            const addressComponents = addressResponse.data.results[0].address_components;

            let city = null, area = null, postalCode = null, district = null;

            addressComponents.forEach(component => {
                if (component.types.includes('locality')) city = component.long_name;
                else if (component.types.includes('sublocality_level_1')) area = component.long_name;
                else if (component.types.includes('postal_code')) postalCode = component.long_name;
                else if (component.types.includes('administrative_area_level_3')) district = component.long_name;
            });

            const addressDetails = {
                completeAddress: addressResponse.data.results[0].formatted_address,
                city,
                area,
                district,
                postalCode,
                landmark: null,
                lat: addressResponse.data.results[0].geometry.location.lat,
                lng: addressResponse.data.results[0].geometry.location.lng,
            };

            const responseData = {
                location: { lat, lng },
                address: addressDetails,
            };

            // Cache the result for 1 hour (3600 seconds)
            await pubClient.setEx(cacheKey, 3600, JSON.stringify(responseData));

            return res.status(200).json({
                success: true,
                data: responseData,
                message: "Location fetch successful"
            });
        } else {
            return res.status(404).json({ success: false, message: "No address found for the given location" });
        }
    } catch (error) {
        console.error('Error fetching address:', error);
        return res.status(500).json({ success: false, message: "Failed to fetch address" });
    }
});


app.post("/geo-code-distance", async (req, res) => {
    try {
        const { pickup, dropOff } = req.body;
        if (!pickup || !dropOff) {
            return res.status(400).json({ message: "Pickup and DropOff addresses are required" });
        }

        const cacheKey = `distance:${pickup}:${dropOff}`;

        // Check Redis cache
        const cachedDistance = await pubClient.get(cacheKey);
        if (cachedDistance) {
            return res.status(200).json(JSON.parse(cachedDistance));
        }

        // Geocode pickup
        const pickupResponse = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
            params: { address: pickup, key: 'AIzaSyCBATa-tKn2Ebm1VbQ5BU8VOqda2nzkoTU' },
        });
        if (pickupResponse.data.status !== "OK") {
            return res.status(400).json({ message: "Invalid Pickup location" });
        }
        const pickupData = pickupResponse.data.results[0].geometry.location;

        // Geocode dropoff
        const dropOffResponse = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
            params: { address: dropOff, key: 'AIzaSyCBATa-tKn2Ebm1VbQ5BU8VOqda2nzkoTU' },
        });
        if (dropOffResponse.data.status !== "OK") {
            return res.status(400).json({ message: "Invalid Dropoff location" });
        }
        const dropOffData = dropOffResponse.data.results[0].geometry.location;

        // Distance Matrix API call
        const distanceResponse = await axios.get("https://maps.googleapis.com/maps/api/distancematrix/json", {
            params: {
                origins: `${pickupData.lat},${pickupData.lng}`,
                destinations: `${dropOffData.lat},${dropOffData.lng}`,
                key: 'AIzaSyCBATa-tKn2Ebm1VbQ5BU8VOqda2nzkoTU',
            },
        });

        if (distanceResponse.data.status !== "OK") {
            return res.status(400).json({ message: "Failed to calculate distance" });
        }

        const distanceInfo = distanceResponse.data.rows[0].elements[0];
        if (distanceInfo.status !== "OK") {
            return res.status(400).json({ message: "Invalid distance calculation" });
        }

        const settings = await Settings.findOne();

        const distanceInKm = distanceInfo.distance.value / 1000;
        const price = distanceInKm * settings.foodDeliveryPrice;

        const responseData = {
            pickupLocation: pickupData,
            dropOffLocation: dropOffData,
            distance: distanceInfo.distance.text,
            duration: distanceInfo.duration.text,
            price: `₹${price.toFixed(2)}`,
        };

        // Cache distance result for 30 minutes
        await pubClient.setEx(cacheKey, 1800, JSON.stringify(responseData));

        return res.status(200).json(responseData);
    } catch (error) {
        console.error("Error in geo-code-distance:", error);
        return res.status(500).json({ message: "Internal server error", error: error.message });
    }
});


// Start the server
const PORT = 3100;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    // startExpiryCheckJob();
});
