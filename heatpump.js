const { exec } = require("child_process");
const mongoose = require('mongoose')
const redis = require('redis'); // Using redis, not Redis
const fs = require("fs");
const axios = require("axios");
const path = require("path");
require('dotenv').config();

// ✅ Config
const LOG_FILE = "healthcheck.log";
const MEMORY_LIMIT = 500; // MB
const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || "968791cad69d4ec0a97639f33c19ce68";
const WHATSAPP_MOBILE = "7217619794";
const MONGO_URI = process.env.MONGO_DB_URL | "mongodb+srv://anishjha896:XVW5WPD9thEYac7E@cluster0.mj4f3.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0&tls=true&tlsAllowInvalidCertificates=false&rejectUnauthorized=false";

let messageBuffer = [];
let errorCount = 0;
let successCount = 0;
let startTime; // Global variable to track start time

// ================== Logging ==================
async function log(message, isError = false) {
    const time = new Date().toISOString();
    const fullMsg = `[${time}] ${message}`;
    messageBuffer.push(fullMsg);

    // Ensure log directory exists
    const logDir = path.dirname(LOG_FILE);
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    try {
        fs.appendFileSync(LOG_FILE, fullMsg + "\n");
    } catch (err) {
        console.error("Failed to write to log file:", err.message);
    }

    console.log(fullMsg);

    if (isError) {
        errorCount++;
    } else if (message.includes("✅")) {
        successCount++;
    }
}

// ================== System Info ==================
async function getSystemInfo() {
    return new Promise((resolve) => {
        exec("free -h && df -h /", async (err, stdout) => {
            if (err) {
                await log("❌ Could not get system info: " + err.message, true);
                return resolve();
            }

            const lines = stdout.split('\n');
            const memLine = lines.find(line => line.includes('Mem:'));
            const diskLine = lines.find(line => line.includes('/dev/'));

            if (memLine) {
                await log("💾 System Memory: " + memLine.trim());
            }
            if (diskLine) {
                await log("💿 Disk Usage: " + diskLine.trim());
            }

            resolve();
        });
    });
}

// ================== PM2 Check (Fixed) ==================
async function checkPM2() {
    return new Promise((resolve) => {
        // Fixed: pm2 jlist -> pm2 list (or pm2 jlist for JSON)
        exec("pm2 jlist", async (err, stdout) => {
            if (err) {
                await log("❌ Error fetching PM2 list: " + err.message, true);
                return resolve();
            }

            try {
                const processes = JSON.parse(stdout);

                if (processes.length === 0) {
                    await log("⚠️ No PM2 processes found");
                    return resolve();
                }

                await log(`📊 Found ${processes.length} PM2 process(es)`);

                for (let p of processes) {
                    const name = p.name;
                    const id = p.pm_id;
                    const status = p.pm2_env.status;
                    // Fixed: Proper memory calculation and null check
                    const memoryMb = p.monit && p.monit.memory ?
                        (p.monit.memory / 1024 / 1024).toFixed(1) : '0';
                    const cpu = p.monit && p.monit.cpu ? p.monit.cpu : '0';

                    await log(`📈 Process "${name}" [id:${id}] - Status: ${status} | CPU: ${cpu}% | Mem: ${memoryMb} MB`);

                    if (status !== 'online') {
                        await log(`⚠️ Process ${name} is ${status}, attempting restart...`);
                        exec(`pm2 restart ${id}`, (restartErr) => {
                            if (restartErr) {
                                log(`❌ Failed to restart ${name}: ${restartErr.message}`, true);
                            } else {
                                log(`✅ Successfully restarted ${name}`);
                            }
                        });
                    }

                    if (parseFloat(memoryMb) > MEMORY_LIMIT) {
                        await log(`⚠️ Restarting ${name} (id:${id}) - Memory exceeded ${MEMORY_LIMIT} MB (${memoryMb} MB)`);
                        exec(`pm2 restart ${id}`, (restartErr) => {
                            if (restartErr) {
                                log(`❌ Failed to restart ${name}: ${restartErr.message}`, true);
                            } else {
                                log(`✅ Successfully restarted ${name} due to high memory`);
                            }
                        });
                    }
                }
            } catch (e) {
                await log("❌ Error parsing PM2 data: " + e.message, true);
            }
            resolve();
        });
    });
}

// ================== MongoDB Atlas Check (Improved) ==================
async function checkMongo() {
    try {
        await log("🔍 Checking MongoDB Atlas connection...", MONGO_URI);

        const start = Date.now();

        await mongoose.connect(process.env.MONGO_DB_URL, {
            serverSelectionTimeoutMS: 30000
        });
        const duration = Date.now() - start;

        await log(`✅ MongoDB Atlas is UP - Response time: ${duration}ms`);

        // Optional: quick ping using admin command
        const admin = mongoose.connection.db.admin();
        const result = await admin.ping();
        await log(`📡 Ping result: ${JSON.stringify(result)}`);

    } catch (err) {
        await log("❌ MongoDB Atlas connection failed: " + err.message, true);

        if (err.name === 'MongooseServerSelectionError') {
            await log("🔧 Suggestion: Check network connectivity and MongoDB cluster status", true);
        }
    } finally {
        try {
            await mongoose.connection.close();
            await log("🔌 MongoDB connection closed");
        } catch (closeErr) {
            await log("⚠️ Error closing MongoDB connection: " + closeErr.message);
        }
    }
}
// ================== Redis Check + Reset (Fixed to use redis method) ==================
async function checkRedis() {
    let redisClient;
    try {
        await log("🔍 Checking Redis connection...");

        // Fixed: Using redis.createClient() method (not ioredis)
        redisClient = redis.createClient({
            socket: {
                host: process.env.REDIS_HOST || "127.0.0.1",
                port: process.env.REDIS_PORT || 6379,
                connectTimeout: 5000,
                lazyConnect: true
            },
            password: process.env.REDIS_PASSWORD || undefined,
        });

        // Handle connection errors
        redisClient.on('error', (err) => {
            log(`❌ Redis client error: ${err.message}`, true);
        });

        await redisClient.connect();

        // Test connection
        const pong = await redisClient.ping();
        await log(`✅ Redis is UP - Response: ${pong}`);

        // Get Redis info
        const info = await redisClient.info('memory');
        const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
        if (memoryMatch) {
            await log(`💾 Redis Memory Usage: ${memoryMatch[1].trim()}`);
        }

        // Reset Redis (optional - comment out if not needed)
        const keyCount = await redisClient.dbSize();
        await log(`🔢 Redis has ${keyCount} keys before flush`);

        await redisClient.flushAll();
        await log("♻️ Redis cache flushed (reset complete)");

    } catch (err) {
        await log("❌ Redis connection failed: " + err.message, true);

        if (err.code === 'ECONNREFUSED') {
            await log("🔧 Suggestion: Check if Redis server is running", true);
        }
    } finally {
        if (redisClient && redisClient.isOpen) {
            try {
                await redisClient.quit();
            } catch (closeErr) {
                await log("⚠️ Error closing Redis connection: " + closeErr.message);
            }
        }
    }
}

// ================== API Health Check ==================
async function checkAPIEndpoint() {
    try {
        const apiUrl = process.env.API_URL || "http://localhost:3200/health";
        await log(`🔍 Checking API endpoint: ${apiUrl}`);

        const response = await axios.get(apiUrl, {
            timeout: 10000,
            validateStatus: function (status) {
                return status < 500; // Accept any status less than 500
            }
        });

        await log(`✅ API endpoint responded - Status: ${response.status}`);

        if (response.data) {
            await log(`📄 API Response: ${JSON.stringify(response.data).substring(0, 100)}...`);
        }

    } catch (err) {
        await log("❌ API endpoint check failed: " + err.message, true);
    }
}

// ================== WhatsApp Notification (Fixed) ==================
async function sendWhatsApp() {
    try {
        await log("📱 Sending WhatsApp notification...");

        // Calculate duration
        const duration = startTime ? ((Date.now() - startTime) / 1000).toFixed(2) : '0.00';

        // Create system status
        const systemStatus = errorCount === 0 ? "🟢 ALL SYSTEMS HEALTHY" : `🟡 ${errorCount} ISSUES DETECTED`;

        // Create a simplified, readable message
        const cleanSummary = `*Server Health Report*

${systemStatus}

📅 Time: ${new Date().toLocaleString()}
⏱️ Duration: ${duration}s
✅ Success: ${successCount}
❌ Errors: ${errorCount}

*Recent Issues:*
${messageBuffer
                .filter(msg => msg.includes('❌'))
                .slice(-5) // Only last 5 errors
                .map(msg => msg.replace(/\[.*?\]\s*/, '')) // Remove timestamp
                .join('\n')
                .substring(0, 1000) || 'No recent errors'}

*Status Summary:*
${messageBuffer
                .filter(msg => msg.includes('✅'))
                .slice(-3) // Only last 3 successes
                .map(msg => msg.replace(/\[.*?\]\s*/, '')) // Remove timestamp
                .join('\n')
                .substring(0, 500) || 'No successful checks'}`;

        // Truncate if still too long
        const maxLength = 3000;
        const finalMessage = cleanSummary.length > maxLength ?
            cleanSummary.substring(0, maxLength) + "\n\n... (truncated)" :
            cleanSummary;

        // Try POST method first
        try {
            const response = await axios.get("https://api.wtap.sms4power.com/wapp/v2/api/send", {
                apikey: WHATSAPP_API_KEY,
                mobile: WHATSAPP_MOBILE,
                msg: finalMessage
            }, {
                timeout: 15000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            await log("✅ WhatsApp message sent successfully (POST method)");

            if (response.data) {
                await log(`📊 WhatsApp API Response: ${JSON.stringify(response.data)}`);
            }

        } catch (postErr) {
            await log("❌ WhatsApp POST failed: " + postErr, true);

            // Fallback: Try GET method with simple message
            await log("🔄 Trying fallback GET method...");

            const shortMessage = `Server Health: ${systemStatus} - ${errorCount} errors, ${successCount} success at ${new Date().toLocaleString()}`;

            const fallbackResponse = await axios.get("https://api.wtap.sms4power.com/wapp/v2/api/send", {
                params: {
                    apikey: WHATSAPP_API_KEY,
                    mobile: WHATSAPP_MOBILE,
                    msg: shortMessage
                },
                timeout: 15000
            });

            await log("✅ WhatsApp fallback message sent successfully (GET method)");

            if (fallbackResponse.data) {
                await log(`📊 Fallback API Response: ${JSON.stringify(fallbackResponse.data)}`);
            }
        }

    } catch (err) {
        await log("❌ All WhatsApp methods failed: " + err.message, true);

        if (err.code === 'ETIMEDOUT') {
            await log("🔧 Suggestion: WhatsApp API timeout, check network connectivity", true);
        } else if (err.response) {
            await log(`📄 WhatsApp API Error Response: ${JSON.stringify(err.response.data)}`, true);
        }
    }
}

// ================== Main Function (Enhanced) ==================
(async () => {
    try {
        startTime = Date.now(); // Set global startTime
        await log("🚀 Starting Daily Healthcheck - " + new Date().toLocaleString());

        // System information
        await getSystemInfo();

        // Health checks
        await checkPM2();
        await checkMongo();
        await checkRedis();

        // Optional API check
        // await checkAPIEndpoint();

        const endTime = Date.now();
        const duration = ((endTime - startTime) / 1000).toFixed(2);

        await log(`✅ Healthcheck completed in ${duration}s`);
        await log(`📊 Summary: ${successCount} successful checks, ${errorCount} errors`);
        await log("=" + "=".repeat(50));

        // Send WhatsApp notification (removed the summary parameter)
        await sendWhatsApp();

        // Exit with appropriate code
        process.exit(errorCount > 0 ? 1 : 0);

    } catch (err) {
        await log("❌ Fatal error in healthcheck: " + err.message, true);
        console.error("Stack trace:", err.stack);
        process.exit(1);
    }
})();