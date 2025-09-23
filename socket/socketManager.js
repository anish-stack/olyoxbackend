// socket/socketManager.js
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

class SocketManager {
    constructor() {
        this.io = null;
        this.pubClient = null;
        this.subClient = null;
        this.connectedUsers = new Map(); // userId -> socketId
        this.connectedDrivers = new Map(); // driverId -> socketId
        this.rideRooms = new Map(); // rideId -> [userSocketId, driverSocketId]
    }

    async initSocket(server, existingRedisClient = null) {
        try {
            console.log(`[${new Date().toISOString()}] Initializing Socket.IO server...`);

            // Initialize Socket.IO
            this.io = new Server(server, {
                cors: {
                    origin: "*",
                    methods: ["GET", "POST"],
                    credentials: true
                },
                transports: ['websocket', 'polling'],
                pingTimeout: 60000,
                pingInterval: 25000,
                upgradeTimeout: 30000,
                allowRequest: (req, callback) => {
                    // Add any custom validation logic here
                    callback(null, true);
                }
            });

            // Setup Redis adapter for Socket.IO clustering
            if (existingRedisClient) {
                // Use existing Redis client
                this.pubClient = existingRedisClient;
                this.subClient = this.pubClient.duplicate();
            } else {
                // Create new Redis clients
                const redisOptions = {
                    socket: {
                        host: process.env.REDIS_HOST || 'localhost',
                        port: process.env.REDIS_PORT || 6379,
                        reconnectStrategy: (retries) => {
                            if (retries > 10) return new Error('Max retry attempts reached');
                            return Math.min(retries * 1000, 5000);
                        }
                    },
                    password: process.env.REDIS_PASSWORD || undefined
                };

                this.pubClient = createClient(redisOptions);
                this.subClient = createClient(redisOptions);
            }

            // Connect Redis clients if not already connected
            if (!this.pubClient.isOpen) await this.pubClient.connect();
            if (!this.subClient.isOpen) await this.subClient.connect();

            // Setup Redis adapter
            this.io.adapter(createAdapter(this.pubClient, this.subClient));

            // Setup Socket.IO event handlers
            this.setupSocketHandlers();

            console.log(`[${new Date().toISOString()}] ✅ Socket.IO server initialized with Redis adapter`);
            return this.io;

        } catch (error) {
            console.error(`[${new Date().toISOString()}] ❌ Socket.IO initialization failed:`, error.message);
            throw error;
        }
    }

    /**
     * Setup Socket.IO event handlers
     */
    setupSocketHandlers() {
        this.io.on('connection', (socket) => {
            console.log(`[${new Date().toISOString()}] New socket connection: ${socket.id}`);

            // Handle user authentication
            socket.on('authenticate', (data) => {
                this.handleAuthentication(socket, data);
            });

            // Handle location updates
            socket.on('location_update', (data) => {
                this.handleLocationUpdate(socket, data);
            });

            // Handle ride events
            socket.on('join_ride', (data) => {
                this.handleJoinRide(socket, data);
            });

            socket.on('leave_ride', (data) => {
                this.handleLeaveRide(socket, data);
            });

            // Handle driver availability
            socket.on('driver_available', (data) => {
                this.handleDriverAvailability(socket, data, true);
            });

            socket.on('driver_unavailable', (data) => {
                this.handleDriverAvailability(socket, data, false);
            });

            // Handle ride status updates
            socket.on('ride_status_update', (data) => {
                this.handleRideStatusUpdate(socket, data);
            });

            // Handle messaging
            socket.on('send_message', (data) => {
                this.handleMessage(socket, data);
            });

            // Handle custom events
            socket.on('custom_event', (data) => {
                this.handleCustomEvent(socket, data);
            });

            // Handle disconnection
            socket.on('disconnect', (reason) => {
                this.handleDisconnection(socket, reason);
            });

            // Handle errors
            socket.on('error', (error) => {
                console.error(`[${new Date().toISOString()}] Socket error for ${socket.id}:`, error);
            });
        });
    }

    /**
     * Handle user authentication
     */
    handleAuthentication(socket, data) {
        const { userId, userType, token } = data;
        
        if (!userId || !userType) {
            socket.emit('auth_error', { message: 'Invalid authentication data' });
            return;
        }

        // Store user info in socket
        socket.userId = userId;
        socket.userType = userType; // 'user', 'driver', 'admin', etc.

        // Add to appropriate tracking map
        if (userType === 'driver') {
            this.connectedDrivers.set(userId, socket.id);
            socket.join('drivers'); // Join drivers room
        } else {
            this.connectedUsers.set(userId, socket.id);
            socket.join('users'); // Join users room
        }

        // Join user-specific room
        socket.join(`${userType}_${userId}`);

        console.log(`[${new Date().toISOString()}] User authenticated: ${userType}_${userId} (${socket.id})`);
        socket.emit('authenticated', { userId, userType, socketId: socket.id });

        // Notify about online status
        this.broadcastUserOnlineStatus(userId, userType, true);
    }

    /**
     * Handle location updates
     */
    handleLocationUpdate(socket, data) {
        const { latitude, longitude, heading, speed } = data;
        const userId = socket.userId;
        const userType = socket.userType;

        if (!userId || !latitude || !longitude) {
            socket.emit('location_error', { message: 'Invalid location data' });
            return;
        }

        const locationData = {
            userId,
            userType,
            latitude,
            longitude,
            heading: heading || null,
            speed: speed || null,
            timestamp: new Date().toISOString()
        };

        // Broadcast location to relevant users
        if (userType === 'driver') {
            // Broadcast to users who are tracking this driver
            this.io.to(`tracking_driver_${userId}`).emit('driver_location', locationData);
            
            // Also broadcast to ride rooms if driver is in active ride
            this.rideRooms.forEach((participants, rideId) => {
                if (participants.includes(socket.id)) {
                    this.io.to(`ride_${rideId}`).emit('driver_location', locationData);
                }
            });
        }

        // Store in Redis for persistence
        this.storeLocationInRedis(userId, userType, locationData);
    }

    /**
     * Handle joining a ride
     */
    handleJoinRide(socket, data) {
        const { rideId } = data;
        const userId = socket.userId;
        const userType = socket.userType;

        if (!rideId || !userId) {
            socket.emit('ride_join_error', { message: 'Invalid ride data' });
            return;
        }

        const roomName = `ride_${rideId}`;
        socket.join(roomName);

        // Track ride participants
        if (!this.rideRooms.has(rideId)) {
            this.rideRooms.set(rideId, []);
        }
        
        const participants = this.rideRooms.get(rideId);
        if (!participants.includes(socket.id)) {
            participants.push(socket.id);
        }

        console.log(`[${new Date().toISOString()}] ${userType}_${userId} joined ride ${rideId}`);
        
        // Notify other participants
        socket.to(roomName).emit('user_joined_ride', {
            userId,
            userType,
            rideId,
            timestamp: new Date().toISOString()
        });

        socket.emit('ride_joined', { rideId, participants: participants.length });
    }

    /**
     * Handle leaving a ride
     */
    handleLeaveRide(socket, data) {
        const { rideId } = data;
        const userId = socket.userId;
        const userType = socket.userType;

        if (!rideId) return;

        const roomName = `ride_${rideId}`;
        socket.leave(roomName);

        // Remove from ride participants
        if (this.rideRooms.has(rideId)) {
            const participants = this.rideRooms.get(rideId);
            const index = participants.indexOf(socket.id);
            if (index > -1) {
                participants.splice(index, 1);
            }

            if (participants.length === 0) {
                this.rideRooms.delete(rideId);
            }
        }

        console.log(`[${new Date().toISOString()}] ${userType}_${userId} left ride ${rideId}`);
        
        // Notify remaining participants
        socket.to(roomName).emit('user_left_ride', {
            userId,
            userType,
            rideId,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Handle driver availability changes
     */
    handleDriverAvailability(socket, data, isAvailable) {
        const driverId = socket.userId;
        
        if (socket.userType !== 'driver') {
            socket.emit('error', { message: 'Only drivers can change availability' });
            return;
        }

        const availabilityData = {
            driverId,
            isAvailable,
            location: data.location || null,
            timestamp: new Date().toISOString()
        };

        // Broadcast to admin dashboard
        this.io.to('admins').emit('driver_availability_changed', availabilityData);

        // Store in Redis
        this.pubClient.setEx(
            `driver_availability_${driverId}`, 
            3600, 
            JSON.stringify(availabilityData)
        );

        console.log(`[${new Date().toISOString()}] Driver ${driverId} availability: ${isAvailable}`);
        socket.emit('availability_updated', { isAvailable });
    }

    /**
     * Handle ride status updates
     */
    handleRideStatusUpdate(socket, data) {
        const { rideId, status, additionalData } = data;
        const userId = socket.userId;
        const userType = socket.userType;

        if (!rideId || !status) {
            socket.emit('ride_update_error', { message: 'Invalid ride update data' });
            return;
        }

        const updateData = {
            rideId,
            status,
            updatedBy: userId,
            userType,
            additionalData: additionalData || {},
            timestamp: new Date().toISOString()
        };

        // Broadcast to ride room
        this.io.to(`ride_${rideId}`).emit('ride_status_updated', updateData);

        // Broadcast to admin dashboard
        this.io.to('admins').emit('ride_status_updated', updateData);

        console.log(`[${new Date().toISOString()}] Ride ${rideId} status updated to: ${status}`);
    }

    /**
     * Handle messaging between users
     */
    handleMessage(socket, data) {
        const { recipientId, rideId, message, messageType } = data;
        const senderId = socket.userId;
        const senderType = socket.userType;

        if (!message) {
            socket.emit('message_error', { message: 'Message content is required' });
            return;
        }

        const messageData = {
            senderId,
            senderType,
            recipientId: recipientId || null,
            rideId: rideId || null,
            message,
            messageType: messageType || 'text',
            timestamp: new Date().toISOString()
        };

        // Send to specific recipient or ride room
        if (recipientId) {
            this.io.to(`user_${recipientId}`).emit('new_message', messageData);
            this.io.to(`driver_${recipientId}`).emit('new_message', messageData);
        } else if (rideId) {
            this.io.to(`ride_${rideId}`).emit('new_message', messageData);
        }

        // Store message in Redis/Database
        this.storeMessage(messageData);
    }

    /**
     * Handle custom events
     */
    handleCustomEvent(socket, data) {
        const { event, payload, target } = data;
        const userId = socket.userId;
        const userType = socket.userType;

        if (!event || !payload) return;

        const eventData = {
            event,
            payload,
            senderId: userId,
            senderType: userType,
            timestamp: new Date().toISOString()
        };

        // Emit to target or broadcast
        if (target) {
            this.io.to(target).emit(event, eventData);
        } else {
            socket.broadcast.emit(event, eventData);
        }
    }

    /**
     * Handle socket disconnection
     */
    handleDisconnection(socket, reason) {
        const userId = socket.userId;
        const userType = socket.userType;

        if (userId) {
            // Remove from tracking maps
            if (userType === 'driver') {
                this.connectedDrivers.delete(userId);
            } else {
                this.connectedUsers.delete(userId);
            }

            // Remove from ride rooms
            this.rideRooms.forEach((participants, rideId) => {
                const index = participants.indexOf(socket.id);
                if (index > -1) {
                    participants.splice(index, 1);
                    if (participants.length === 0) {
                        this.rideRooms.delete(rideId);
                    }
                }
            });

            // Notify about offline status
            this.broadcastUserOnlineStatus(userId, userType, false);

            console.log(`[${new Date().toISOString()}] User disconnected: ${userType}_${userId} (${reason})`);
        } else {
            console.log(`[${new Date().toISOString()}] Anonymous socket disconnected: ${socket.id} (${reason})`);
        }
    }

    /**
     * Broadcast user online status
     */
    broadcastUserOnlineStatus(userId, userType, isOnline) {
        const statusData = {
            userId,
            userType,
            isOnline,
            timestamp: new Date().toISOString()
        };

        // Broadcast to relevant users
        if (userType === 'driver') {
            this.io.to('users').emit('driver_status_changed', statusData);
            this.io.to('admins').emit('driver_status_changed', statusData);
        }

        // Store in Redis
        this.pubClient.setEx(
            `user_online_${userType}_${userId}`, 
            300, 
            JSON.stringify(statusData)
        );
    }

    /**
     * Store location data in Redis
     */
    async storeLocationInRedis(userId, userType, locationData) {
        try {
            const key = `location_${userType}_${userId}`;
            await this.pubClient.setEx(key, 300, JSON.stringify(locationData)); // 5 min expiry
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error storing location in Redis:`, error.message);
        }
    }

    /**
     * Store message
     */
    async storeMessage(messageData) {
        try {
            const key = `messages_${Date.now()}_${Math.random()}`;
            await this.pubClient.setEx(key, 86400, JSON.stringify(messageData)); // 24 hour expiry
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error storing message:`, error.message);
        }
    }

    /**
     * Get Socket.IO instance (for global access)
     */
    getIO() {
        if (!this.io) {
            throw new Error('Socket.IO not initialized. Call initSocket() first.');
        }
        return this.io;
    }

    /**
     * Get connected users count
     */
    getConnectedUsersCount() {
        return {
            users: this.connectedUsers.size,
            drivers: this.connectedDrivers.size,
            activeRides: this.rideRooms.size,
            totalConnections: this.io ? this.io.engine.clientsCount : 0
        };
    }

    /**
     * Send notification to specific user
     */
    sendNotificationToUser(userId, userType, notification) {
        console.log(`[${new Date().toISOString()}] Sending notification to ${userType}_${userId}:`, notification);
        const targetRoom = `${userType}_${userId}`;
        if (this.io) {
            this.io.to(targetRoom).emit('notification', {
                ...notification,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Broadcast to all users of a specific type
     */
    broadcastToUserType(userType, event, data) {
        if (this.io) {
            this.io.to(userType === 'driver' ? 'drivers' : 'users').emit(event, {
                ...data,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Send data to specific ride room
     */
    sendToRide(rideId, event, data) {
        if (this.io) {
            this.io.to(`ride_${rideId}`).emit(event, {
                ...data,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Get socket statistics
     */
    getStats() {
        return {
            connectedUsers: this.connectedUsers.size,
            connectedDrivers: this.connectedDrivers.size,
            activeRides: this.rideRooms.size,
            totalSockets: this.io ? this.io.sockets.sockets.size : 0,
            redisConnected: this.pubClient && this.pubClient.isOpen
        };
    }

    /**
     * Cleanup resources
     */
    async cleanup() {
        try {
            if (this.io) {
                this.io.close();
            }
            if (this.subClient && this.subClient.isOpen) {
                await this.subClient.quit();
            }
            console.log(`[${new Date().toISOString()}] Socket.IO resources cleaned up`);
        } catch (error) {
            console.error(`[${new Date().toISOString()}] Error during cleanup:`, error.message);
        }
    }
}

// Create singleton instance
const socketManager = new SocketManager();

// Export functions for global access
module.exports = {
    initSocket: (server, redisClient) => socketManager.initSocket(server, redisClient),
    getIO: () => socketManager.getIO(),
    getStats: () => socketManager.getStats(),
    getConnectedUsersCount: () => socketManager.getConnectedUsersCount(),
    sendNotificationToUser: (userId, userType, notification) => 
        socketManager.sendNotificationToUser(userId, userType, notification),
    broadcastToUserType: (userType, event, data) => 
        socketManager.broadcastToUserType(userType, event, data),
    sendToRide: (rideId, event, data) => 
        socketManager.sendToRide(rideId, event, data),
    cleanup: () => socketManager.cleanup(),
    socketManager // Export the instance for advanced usage
};