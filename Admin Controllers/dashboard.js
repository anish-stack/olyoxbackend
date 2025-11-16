const User = require('../models/normal_user/User.model');
const Rider = require('../models/Rider.model');
const axios = require('axios');


// In-memory cache
const dashboardCache = new Map();
const CACHE_KEY = 'userDashboardStats';

exports.getUserDashboardStatics = async (req, res) => {
    try {
        // Return cached stats if available
        if (dashboardCache.has(CACHE_KEY)) {
            return res.status(200).json({
                success: true,
                stats: dashboardCache.get(CACHE_KEY),
                cached: true // optional, for debug
            });
        }

        // Current Date
        const today = new Date();
        const startOfToday = new Date(today.setHours(0, 0, 0, 0));
        const endOfToday = new Date(today.setHours(23, 59, 59, 999));

        // Yesterday
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const startOfYesterday = new Date(yesterday.setHours(0, 0, 0, 0));
        const endOfYesterday = new Date(yesterday.setHours(23, 59, 59, 999));

        // Last 7 Days
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);

        // Last 14 Days
        const lastTwoWeeks = new Date();
        lastTwoWeeks.setDate(lastTwoWeeks.getDate() - 14);

        // Last 30 Days
        const lastMonth = new Date();
        lastMonth.setDate(lastMonth.getDate() - 30);

        // Previous Month (for comparison)
        const prevMonthStart = new Date();
        prevMonthStart.setDate(prevMonthStart.getDate() - 60);
        const prevMonthEnd = new Date();
        prevMonthEnd.setDate(prevMonthEnd.getDate() - 30);

        // Queries
        const totalUsers = await User.countDocuments();

        const todayUsers = await User.countDocuments({
            createdAt: { $gte: startOfToday, $lte: endOfToday },
        });

        const yesterdayUsers = await User.countDocuments({
            createdAt: { $gte: startOfYesterday, $lte: endOfYesterday },
        });

        const lastWeekUsers = await User.countDocuments({
            createdAt: { $gte: lastWeek },
        });

        const lastTwoWeeksUsers = await User.countDocuments({
            createdAt: { $gte: lastTwoWeeks },
        });

        const lastMonthUsers = await User.countDocuments({
            createdAt: { $gte: lastMonth },
        });

        const prevMonthUsers = await User.countDocuments({
            createdAt: { $gte: prevMonthStart, $lte: prevMonthEnd },
        });

        // Platform wise
        const androidUsers = await User.countDocuments({ platform: "android" });
        const iosUsers = await User.countDocuments({ platform: "ios" });

        // Performance % (today vs yesterday)
        let todayPerformanceChange = 0;
        if (yesterdayUsers > 0) {
            todayPerformanceChange = ((todayUsers - yesterdayUsers) / yesterdayUsers) * 100;
        } else if (todayUsers > 0) {
            todayPerformanceChange = 100;
        }

        // Performance % (last week vs previous week)
        const lastWeekCount = lastWeekUsers;
        const lastTwoWeeksCount = lastTwoWeeksUsers - lastWeekUsers; // users who joined 8-14 days ago
        let twoWeekPerformanceChange = 0;
        if (lastTwoWeeksCount > 0) {
            twoWeekPerformanceChange = ((lastWeekCount - lastTwoWeeksCount) / lastTwoWeeksCount) * 100;
        }

        // Performance % (this month vs previous month)
        let monthlyPerformanceChange = 0;
        if (prevMonthUsers > 0) {
            monthlyPerformanceChange = ((lastMonthUsers - prevMonthUsers) / prevMonthUsers) * 100;
        }

        const stats = {
            totalUsers,
            todayUsers,
            yesterdayUsers,
            lastWeekUsers,
            lastTwoWeeksUsers,
            lastMonthUsers,
            prevMonthUsers,
            androidUsers,
            iosUsers,
            performance: {
                todayVsYesterday: todayPerformanceChange.toFixed(2) + "%",
                lastWeekVsPrevWeek: twoWeekPerformanceChange.toFixed(2) + "%",
                thisMonthVsPrevMonth: monthlyPerformanceChange.toFixed(2) + "%",
            },
        };

        // Store in cache
        dashboardCache.set(CACHE_KEY, stats);

        return res.status(200).json({
            success: true,
            stats,
            cached: false
        });
    } catch (error) {
        console.error("Error fetching dashboard stats:", error);
        return res.status(500).json({
            success: false,
            message: "Server Error",
            error: error.message,
        });
    }
};

// Optional: Function to invalidate cache when users are created/updated
exports.invalidateDashboardCache = () => {
    dashboardCache.delete(CACHE_KEY);
};


// Haversine formula to calculate distance in km
const calculateDistance = (lat1, lng1, lat2, lng2) => {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
};

// Utility: check if recharge is valid
const isRechargeValid = (rider) => {
    if (!rider.RechargeData || !rider.RechargeData.approveRecharge) return false;
    const expireDate = new Date(rider.RechargeData.expireData);
    return expireDate > new Date();
};

// Geocode address to coordinates using Google Maps API
const getCoordinatesFromAddress = async (address) => {
    if (!address) return null;
    try {
        const apiKey = process.env.GOOGLE_MAPS_API_KEY; // set in env
        const response = await axios.get(
            `https://maps.googleapis.com/maps/api/geocode/json`,
            { params: { address, key: apiKey } }
        );
        const location = response.data.results?.[0]?.geometry?.location;
        // console.log('Geocoding response:', response.data?.results?.[0]?.geometry);
        if (location) {
            return { lat: location.lat, lng: location.lng };
        }
        return null;
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
};

exports.getRiders = async (req, res) => {
  const timings = {};
  const startTime = Date.now();
  
  try {
    const { searchTerm, locationSearch, rechargeFilter } = req.query;

    const queryBuildStart = Date.now();
    
    // ✅ BASE QUERY - Simplified to use indexes
    let baseQuery = { category: "cab" };
    
    // 🔍 SEARCH - Use text index if available
    if (searchTerm) {
      // Option 1: If you created text index
      // baseQuery.$text = { $search: searchTerm };
      
      // Option 2: Use regex on indexed field only
      baseQuery.$or = [
        { phone: { $regex: searchTerm, $options: "i" } },
        { name: { $regex: searchTerm, $options: "i" } }
      ];
    }

    // 💳 RECHARGE FILTER - Simplified
    if (rechargeFilter === "valid") {
      baseQuery["RechargeData.expireData"] = { $gt: new Date() };
      baseQuery["RechargeData.approveRecharge"] = true;
    } else if (rechargeFilter === "expired") {
      // Instead of complex $or, use simple conditions
      baseQuery.$and = [
        {
          $or: [
            { "RechargeData.expireData": { $lte: new Date() } },
            { "RechargeData.expireData": { $exists: false } },
            { "RechargeData.approveRecharge": { $ne: true } }
          ]
        }
      ];
    }

    timings.queryBuild = Date.now() - queryBuildStart;

    // ⏱️ DATABASE QUERY - Two separate fast queries instead of one slow
    const dbQueryStart = Date.now();
    
    // Strategy: Fetch separately and merge (much faster!)
    const [availableRiders, onRideRiders] = await Promise.all([
      // Query 1: Available riders (uses index efficiently)
      Rider.find(
        { ...baseQuery, isAvailable: true },
        {
          name: 1, phone: 1, location: 1, RechargeData: 1,
          rideVehicleInfo: 1, lastUpdated: 1, isAvailable: 1, on_ride_id: 1
        }
      ).lean().limit(5000),
      
      // Query 2: Riders on ride (uses index efficiently)
      Rider.find(
        { ...baseQuery, on_ride_id: { $exists: true, $ne: null } },
        {
          name: 1, phone: 1, location: 1, RechargeData: 1,
          rideVehicleInfo: 1, lastUpdated: 1, isAvailable: 1, on_ride_id: 1
        }
      ).lean().limit(5000)
    ]);

    // Merge results and deduplicate by _id
    const riderMap = new Map();
    [...availableRiders, ...onRideRiders].forEach(rider => {
      riderMap.set(rider._id.toString(), rider);
    });
    const cabRiders = Array.from(riderMap.values());

    timings.dbQuery = Date.now() - dbQueryStart;
    timings.resultCount = cabRiders.length;

    // ⏱️ PROCESSING
    const processingStart = Date.now();
    const cabVehicleCounts = cabRiders.reduce((counts, rider) => {
      let type = rider.rideVehicleInfo?.vehicleType?.trim().toUpperCase() || "UNKNOWN";
      if (type.includes("SUV")) type = "SUV/XL";
      if (type.includes("TUK")) type = "TUKTUK";
      counts[type] = (counts[type] || 0) + 1;
      return counts;
    }, {});
    timings.processing = Date.now() - processingStart;

    timings.total = Date.now() - startTime;

    console.log("⏱️ API TIMINGS:", JSON.stringify(timings, null, 2));

    return res.json({
      success: true,
      totalCabRiders: cabRiders.length,
      cabVehicleCounts,
      apiExecutionTime: timings.total + " ms",
      timings,
      data: cabRiders,
    });

  } catch (err) {
    console.error("getRiders error:", err);
    return res.status(500).json({
      success: false,
      message: err.message,
      apiExecutionTime: Date.now() - startTime + " ms",
    });
  }
};

exports.getRidersAvaiable = async (req, res) => {
    try {



        // Select only required fields using .select()
        const selectFields = '_id name phone location rideVehicleInfo RechargeData createdAt isAvailable on_ride_id';

        let riders = await Rider.find()
            .select(selectFields)
            .sort({ createdAt: -1 })
            .lean();



        const totalRiders = riders.length;



        res.json({
            success: true,
            totalRiders,

            data: riders,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
};