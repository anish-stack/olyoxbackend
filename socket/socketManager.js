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
        this.connectedParcelDrivers = new Map(); // parcelDriverId -> socketId
        this.rideRooms = new Map(); // rideId -> [userSocketId, driverSocketId]
        this.parcelRooms = new Map(); // parcelId -> [userSocketId, parcelDriverSocketId]
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

            // PARCEL DELIVERY HANDLERS
            socket.on('join_parcel_delivery', (data) => {
                this.handleJoinParcelDelivery(socket, data);
            });

            socket.on('leave_parcel_delivery', (data) => {
                this.handleLeaveParcelDelivery(socket, data);
            });

            socket.on('parcel_driver_available', (data) => {
                this.handleParcelDriverAvailability(socket, data, true);
            });

            socket.on('parcel_driver_unavailable', (data) => {
                this.handleParcelDriverAvailability(socket, data, false);
            });

            socket.on('parcel_status_update', (data) => {
                this.handleParcelStatusUpdate(socket, data);
            });

            socket.on('parcel_pickup_request', (data) => {
                this.handleParcelPickupRequest(socket, data);
            });

            socket.on('parcel_pickup_accepted', (data) => {
                this.handleParcelPickupAccepted(socket, data);
            });

            socket.on('parcel_pickup_rejected', (data) => {
                this.handleParcelPickupRejected(socket, data);
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
        socket.userType = userType; // 'user', 'driver', 'parcel_driver', 'admin', etc.

        // Add to appropriate tracking map
        if (userType === 'driver') {
            this.connectedDrivers.set(userId, socket.id);
            socket.join('drivers'); // Join drivers room
        } else if (userType === 'parcel_driver') {
            this.connectedParcelDrivers.set(userId, socket.id);
            socket.join('parcel_drivers'); // Join parcel drivers room
        } else {
            this.connectedUsers.set(userId, socket.id);
            socket.join('users'); // Join users room
        }

        // Join user-specific room
        socket.join(`${userType}_${userId}`);

        console.log(`[${new Date().toISOString()}] ${userType} authenticated: ${userType}_${userId} (${socket.id})`);
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
        } else if (userType === 'parcel_driver') {
            // Broadcast to users who are tracking this parcel driver
            this.io.to(`tracking_parcel_driver_${userId}`).emit('parcel_driver_location', locationData);

            // Also broadcast to parcel rooms if driver is in active delivery
            this.parcelRooms.forEach((participants, parcelId) => {
                if (participants.includes(socket.id)) {
                    this.io.to(`parcel_${parcelId}`).emit('parcel_driver_location', locationData);
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

    // ===== PARCEL DELIVERY METHODS =====

    /**
     * Handle joining a parcel delivery
     */
    handleJoinParcelDelivery(socket, data) {
        const { parcelId } = data;
        const userId = socket.userId;
        const userType = socket.userType;

        if (!parcelId || !userId) {
            socket.emit('parcel_join_error', { message: 'Invalid parcel data' });
            return;
        }

        const roomName = `parcel_${parcelId}`;
        socket.join(roomName);

        // Track parcel participants
        if (!this.parcelRooms.has(parcelId)) {
            this.parcelRooms.set(parcelId, []);
        }

        const participants = this.parcelRooms.get(parcelId);
        if (!participants.includes(socket.id)) {
            participants.push(socket.id);
        }

        console.log(`[${new Date().toISOString()}] ${userType}_${userId} joined parcel delivery ${parcelId}`);

        // Notify other participants
        socket.to(roomName).emit('user_joined_parcel', {
            userId,
            userType,
            parcelId,
            timestamp: new Date().toISOString()
        });

        socket.emit('parcel_joined', { parcelId, participants: participants.length });
    }

    /**
     * Handle leaving a parcel delivery
     */
    handleLeaveParcelDelivery(socket, data) {
        const { parcelId } = data;
        const userId = socket.userId;
        const userType = socket.userType;

        if (!parcelId) return;

        const roomName = `parcel_${parcelId}`;
        socket.leave(roomName);

        // Remove from parcel participants
        if (this.parcelRooms.has(parcelId)) {
            const participants = this.parcelRooms.get(parcelId);
            const index = participants.indexOf(socket.id);
            if (index > -1) {
                participants.splice(index, 1);
            }

            if (participants.length === 0) {
                this.parcelRooms.delete(parcelId);
            }
        }

        console.log(`[${new Date().toISOString()}] ${userType}_${userId} left parcel delivery ${parcelId}`);

        // Notify remaining participants
        socket.to(roomName).emit('user_left_parcel', {
            userId,
            userType,
            parcelId,
            timestamp: new Date().toISOString()
        });
    }

    /**
     * Handle parcel driver availability changes
     */
    handleParcelDriverAvailability(socket, data, isAvailable) {
        const parcelDriverId = socket.userId;

        if (socket.userType !== 'parcel_driver') {
            socket.emit('error', { message: 'Only parcel drivers can change availability' });
            return;
        }

        const availabilityData = {
            parcelDriverId,
            isAvailable,
            location: data.location || null,
            vehicleType: data.vehicleType || null, // bike, scooter, car, van
            maxWeight: data.maxWeight || null,
            maxDistance: data.maxDistance || null,
            timestamp: new Date().toISOString()
        };

        // Broadcast to admin dashboard
        this.io.to('admins').emit('parcel_driver_availability_changed', availabilityData);

        // Store in Redis
        this.pubClient.setEx(
            `parcel_driver_availability_${parcelDriverId}`,
            3600,
            JSON.stringify(availabilityData)
        );

        console.log(`[${new Date().toISOString()}] Parcel Driver ${parcelDriverId} availability: ${isAvailable}`);
        socket.emit('parcel_availability_updated', { isAvailable });
    }

    /**
     * Handle parcel pickup request
     */
    handleParcelPickupRequest(socket, data) {
        const { parcelId, pickupLocation, deliveryLocation, weight, description, urgency } = data;
        const userId = socket.userId;

        if (!parcelId || !pickupLocation || !deliveryLocation) {
            socket.emit('parcel_request_error', { message: 'Invalid parcel request data' });
            return;
        }

        const requestData = {
            parcelId,
            userId,
            pickupLocation,
            deliveryLocation,
            weight: weight || null,
            description: description || '',
            urgency: urgency || 'normal', // normal, urgent, express
            timestamp: new Date().toISOString()
        };

        // Broadcast to all available parcel drivers
        this.io.to('parcel_drivers').emit('new_parcel_request', requestData);

        // Store request in Redis
        this.pubClient.setEx(
            `parcel_request_${parcelId}`,
            1800, // 30 minutes expiry
            JSON.stringify(requestData)
        );

        console.log(`[${new Date().toISOString()}] New parcel pickup request: ${parcelId}`);
        socket.emit('parcel_request_sent', { parcelId });
    }

    /**
     * Handle parcel pickup accepted
     */
    handleParcelPickupAccepted(socket, data) {
        const { parcelId } = data;
        const parcelDriverId = socket.userId;

        if (socket.userType !== 'parcel_driver' || !parcelId) {
            socket.emit('parcel_accept_error', { message: 'Invalid parcel accept data' });
            return;
        }

        const acceptData = {
            parcelId,
            parcelDriverId,
            status: 'accepted',
            estimatedPickupTime: data.estimatedPickupTime || null,
            timestamp: new Date().toISOString()
        };

        // Get original request data to notify the user
        this.pubClient.get(`parcel_request_${parcelId}`)
            .then(requestDataStr => {
                if (requestDataStr) {
                    const requestData = JSON.parse(requestDataStr);

                    // Notify the user who made the request
                    this.io.to(`user_${requestData.userId}`).emit('parcel_pickup_accepted', {
                        ...acceptData,
                        driverInfo: {
                            driverId: parcelDriverId,
                            // Add more driver info as needed
                        }
                    });

                    // Notify other drivers that request is no longer available
                    socket.to('parcel_drivers').emit('parcel_request_taken', { parcelId });

                    // Join both user and driver to parcel room
                    this.handleJoinParcelDelivery(socket, { parcelId });

                    console.log(`[${new Date().toISOString()}] Parcel ${parcelId} accepted by driver ${parcelDriverId}`);
                }
            })
            .catch(error => {
                console.error('Error retrieving parcel request:', error);
                socket.emit('parcel_accept_error', { message: 'Request not found or expired' });
            });

        socket.emit('parcel_acceptance_confirmed', { parcelId });
    }

    /**
     * Handle parcel pickup rejected
     */
    handleParcelPickupRejected(socket, data) {
        const { parcelId, reason } = data;
        const parcelDriverId = socket.userId;

        if (socket.userType !== 'parcel_driver' || !parcelId) {
            return;
        }

        const rejectionData = {
            parcelId,
            parcelDriverId,
            reason: reason || 'Driver unavailable',
            timestamp: new Date().toISOString()
        };

        // Log the rejection
        console.log(`[${new Date().toISOString()}] Parcel ${parcelId} rejected by driver ${parcelDriverId}: ${reason}`);

        // Store rejection for analytics
        this.pubClient.setEx(
            `parcel_rejection_${parcelId}_${parcelDriverId}`,
            3600,
            JSON.stringify(rejectionData)
        );
    }

    /**
     * Handle parcel status updates
     */
    handleParcelStatusUpdate(socket, data) {
        const { parcelId, status, additionalData } = data;
        const userId = socket.userId;
        const userType = socket.userType;

        if (!parcelId || !status) {
            socket.emit('parcel_update_error', { message: 'Invalid parcel update data' });
            return;
        }

        const updateData = {
            parcelId,
            status, // pending, accepted, picked_up, in_transit, delivered, cancelled
            updatedBy: userId,
            userType,
            additionalData: additionalData || {},
            timestamp: new Date().toISOString()
        };

        // Broadcast to parcel room
        this.io.to(`parcel_${parcelId}`).emit('parcel_status_updated', updateData);

        // Broadcast to admin dashboard
        this.io.to('admins').emit('parcel_status_updated', updateData);

        // Send push notification based on status
        this.sendParcelNotification(parcelId, status, updateData);

        console.log(`[${new Date().toISOString()}] Parcel ${parcelId} status updated to: ${status}`);
    }

    /**
     * Send parcel-specific notifications
     */
    sendParcelNotification(parcelId, status, data) {
        let notificationMessage = '';

        switch (status) {
            case 'accepted':
                notificationMessage = 'Your parcel pickup has been accepted by a driver';
                break;
            case 'picked_up':
                notificationMessage = 'Your parcel has been picked up and is on the way';
                break;
            case 'in_transit':
                notificationMessage = 'Your parcel is in transit';
                break;
            case 'delivered':
                notificationMessage = 'Your parcel has been delivered successfully';
                break;
            case 'cancelled':
                notificationMessage = 'Your parcel delivery has been cancelled';
                break;
            default:
                notificationMessage = `Parcel status updated: ${status}`;
        }

        // Send to parcel room
        this.io.to(`parcel_${parcelId}`).emit('parcel_notification', {
            message: notificationMessage,
            status,
            parcelId,
            timestamp: new Date().toISOString()
        });
    }

    // ===== EXISTING METHODS (keeping them as they were) =====

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
        const { recipientId, rideId, parcelId, message, messageType } = data;
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
            parcelId: parcelId || null,
            message,
            messageType: messageType || 'text',
            timestamp: new Date().toISOString()
        };

        // Send to specific recipient, ride room, or parcel room
        if (recipientId) {
            this.io.to(`user_${recipientId}`).emit('new_message', messageData);
            this.io.to(`driver_${recipientId}`).emit('new_message', messageData);
            this.io.to(`parcel_driver_${recipientId}`).emit('new_message', messageData);
        } else if (rideId) {
            this.io.to(`ride_${rideId}`).emit('new_message', messageData);
        } else if (parcelId) {
            this.io.to(`parcel_${parcelId}`).emit('new_message', messageData);
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
            } else if (userType === 'parcel_driver') {
                this.connectedParcelDrivers.delete(userId);
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

            // Remove from parcel rooms
            this.parcelRooms.forEach((participants, parcelId) => {
                const index = participants.indexOf(socket.id);
                if (index > -1) {
                    participants.splice(index, 1);
                    if (participants.length === 0) {
                        this.parcelRooms.delete(parcelId);
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
        } else if (userType === 'parcel_driver') {
            this.io.to('users').emit('parcel_driver_status_changed', statusData);
            this.io.to('admins').emit('parcel_driver_status_changed', statusData);
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
            parcelDrivers: this.connectedParcelDrivers.size,
            activeRides: this.rideRooms.size,
            activeParcels: this.parcelRooms.size,
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
            let room = '';
            if (userType === 'driver') {
                room = 'drivers';
            } else if (userType === 'parcel_driver') {
                room = 'parcel_drivers';
            } else {
                room = 'users';
            }

            this.io.to(room).emit(event, {
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
     * Send data to specific parcel room
     */
    sendToParcel(parcelId, event, data) {
        if (this.io) {
            this.io.to(`parcel_${parcelId}`).emit(event, {
                ...data,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Get all connected users and drivers
     */
    getAllConnectedClients() {
        return {
            users: Array.from(this.connectedUsers.entries()).map(([userId, socketId]) => ({
                userId,
                socketId,
                userType: 'user'
            })),
            drivers: Array.from(this.connectedDrivers.entries()).map(([driverId, socketId]) => ({
                userId: driverId,
                socketId,
                userType: 'driver'
            })),
            parcelDrivers: Array.from(this.connectedParcelDrivers.entries()).map(([parcelDriverId, socketId]) => ({
                userId: parcelDriverId,
                socketId,
                userType: 'parcel_driver'
            }))
        };
    }

    /**
     * Get all connected drivers (ride drivers only)
     */
    getAllConnectedUsers() {
        return {
            users: Array.from(this.connectedUsers.entries()).map(([userId, socketId]) => ({
                userId,
                socketId,
                userType: 'user'
            })),
        }
    }
    getAllConnectedDriver() {
        return {
            drivers: Array.from(this.connectedDrivers.entries()).map(([driverId, socketId]) => ({
                driverId,
                socketId
            }))
        };
    }

    /**
     * Get all connected parcel drivers
     */
    getAllConnectedParcelDrivers() {
        return {
            parcelDrivers: Array.from(this.connectedParcelDrivers.entries()).map(([parcelDriverId, socketId]) => ({
                parcelDriverId,
                socketId
            }))
        };
    }

    /**
     * Get nearby available parcel drivers
     */
    async getNearbyParcelDrivers(latitude, longitude, radius = 5) {
        const availableDrivers = [];

        for (const [driverId, socketId] of this.connectedParcelDrivers.entries()) {
            try {
                const availabilityData = await this.pubClient.get(`parcel_driver_availability_${driverId}`);
                const locationData = await this.pubClient.get(`location_parcel_driver_${driverId}`);

                if (availabilityData && locationData) {
                    const availability = JSON.parse(availabilityData);
                    const location = JSON.parse(locationData);

                    if (availability.isAvailable) {
                        // Calculate distance (simple haversine formula)
                        const distance = this.calculateDistance(
                            latitude, longitude,
                            location.latitude, location.longitude
                        );

                        if (distance <= radius) {
                            availableDrivers.push({
                                driverId,
                                socketId,
                                distance,
                                location: location,
                                availability: availability
                            });
                        }
                    }
                }
            } catch (error) {
                console.error(`Error checking driver ${driverId}:`, error);
            }
        }

        // Sort by distance
        return availableDrivers.sort((a, b) => a.distance - b.distance);
    }

    /**
     * Calculate distance between two coordinates (in km)
     */
    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Earth's radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Broadcast parcel request to nearby drivers
     */
    async broadcastParcelToNearbyDrivers(parcelData) {
        try {
            const { pickupLocation } = parcelData;
            const nearbyDrivers = await this.getNearbyParcelDrivers(
                pickupLocation.latitude,
                pickupLocation.longitude,
                10 // 10km radius
            );

            console.log(`[${new Date().toISOString()}] Broadcasting parcel ${parcelData.parcelId} to ${nearbyDrivers.length} nearby drivers`);

            // Send to each nearby driver individually
            nearbyDrivers.forEach(driver => {
                this.io.to(driver.socketId).emit('nearby_parcel_request', {
                    ...parcelData,
                    distance: driver.distance,
                    estimatedTime: Math.round(driver.distance * 3) // rough estimate: 3 minutes per km
                });
            });

            return nearbyDrivers.length;
        } catch (error) {
            console.error('Error broadcasting to nearby drivers:', error);
            return 0;
        }
    }

    /**
     * Get socket statistics
     */
    getStats() {
        return {
            connectedUsers: this.connectedUsers.size,
            connectedDrivers: this.connectedDrivers.size,
            connectedParcelDrivers: this.connectedParcelDrivers.size,
            activeRides: this.rideRooms.size,
            activeParcels: this.parcelRooms.size,
            totalSockets: this.io ? this.io.sockets.sockets.size : 0,
            redisConnected: this.pubClient && this.pubClient.isOpen
        };
    }

    /**
     * Send emergency notification to all drivers in area
     */
    async sendEmergencyNotification(latitude, longitude, message, radius = 20) {
        const nearbyDrivers = await this.getNearbyParcelDrivers(latitude, longitude, radius);
        const nearbyRideDrivers = []; // You can implement similar logic for ride drivers

        const emergencyData = {
            type: 'emergency',
            message,
            location: { latitude, longitude },
            radius,
            timestamp: new Date().toISOString()
        };

        // Send to all nearby drivers
        [...nearbyDrivers, ...nearbyRideDrivers].forEach(driver => {
            this.io.to(driver.socketId).emit('emergency_notification', emergencyData);
        });

        // Also send to admins
        this.io.to('admins').emit('emergency_notification', emergencyData);

        return nearbyDrivers.length + nearbyRideDrivers.length;
    }

    /**
     * Handle parcel driver batch status update
     */
    updateMultipleParcelStatuses(parcelIds, status, updatedBy, userType) {
        const updateData = {
            parcelIds,
            status,
            updatedBy,
            userType,
            timestamp: new Date().toISOString()
        };

        // Update each parcel
        parcelIds.forEach(parcelId => {
            this.io.to(`parcel_${parcelId}`).emit('parcel_status_updated', {
                parcelId,
                ...updateData
            });
        });

        // Notify admins
        this.io.to('admins').emit('batch_parcel_update', updateData);

        console.log(`[${new Date().toISOString()}] Batch updated ${parcelIds.length} parcels to status: ${status}`);
    }

    /**
     * Get delivery analytics
     */
    async getDeliveryAnalytics(timeframe = '24h') {
        try {
            // This would typically query your database
            // For now, returning current socket statistics
            const stats = this.getStats();

            return {
                timeframe,
                totalDeliveries: stats.activeParcels,
                activeDrivers: stats.connectedParcelDrivers,
                averageDeliveryTime: '25 minutes', // This would come from actual data
                successRate: '98.5%', // This would come from actual data
                peakHours: ['12:00-14:00', '18:00-20:00'], // This would come from actual data
                topAreas: ['Downtown', 'City Center', 'Mall Area'], // This would come from actual data
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            console.error('Error getting delivery analytics:', error);
            return null;
        }
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

    // User/Driver notifications
    sendNotificationToUser: (userId, userType, notification) =>
        socketManager.sendNotificationToUser(userId, userType, notification),
    broadcastToUserType: (userType, event, data) =>
        socketManager.broadcastToUserType(userType, event, data),

    // Ride functions
    sendToRide: (rideId, event, data) =>
        socketManager.sendToRide(rideId, event, data),
    getAllConnectedClients: () => socketManager.getAllConnectedClients(),
    getAllConnectedDriver: () => socketManager.getAllConnectedDriver(),

    // Parcel functions
    sendToParcel: (parcelId, event, data) =>
        socketManager.sendToParcel(parcelId, event, data),
    getAllConnectedParcelDrivers: () => socketManager.getAllConnectedParcelDrivers(),
    getAllConnectedUsers: () => socketManager.getAllConnectedUsers(),
    getNearbyParcelDrivers: (lat, lng, radius) =>
        socketManager.getNearbyParcelDrivers(lat, lng, radius),
    broadcastParcelToNearbyDrivers: (parcelData) =>
        socketManager.broadcastParcelToNearbyDrivers(parcelData),
    updateMultipleParcelStatuses: (parcelIds, status, updatedBy, userType) =>
        socketManager.updateMultipleParcelStatuses(parcelIds, status, updatedBy, userType),

    // Emergency and analytics
    sendEmergencyNotification: (lat, lng, message, radius) =>
        socketManager.sendEmergencyNotification(lat, lng, message, radius),
    getDeliveryAnalytics: (timeframe) => socketManager.getDeliveryAnalytics(timeframe),

    cleanup: () => socketManager.cleanup(),
    socketManager // Export the instance for advanced usage
};