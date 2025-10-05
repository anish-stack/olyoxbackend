const User = require('../models/normal_user/User.model');
const Rider = require('../models/Rider.model');
const axios = require('axios');

exports.getUserDashboardStatics = async (req, res) => {
    try {
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

        return res.status(200).json({
            success: true,
            stats: {
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
            },
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
    try {
        const { searchTerm, locationSearch, rechargeFilter, page = 1, limit = 10 } = req.query;

        let filter = {
            $or: [
                { isAvailable: true },
                { on_ride_id: { $exists: true, $ne: null } },
            ],
        };

        if (searchTerm) {
            filter.$and = [
                {
                    $or: [
                        { name: { $regex: searchTerm, $options: 'i' } },
                        { phone: { $regex: searchTerm, $options: 'i' } },
                    ]
                }
            ];
        }

        // Recharge filter
        if (rechargeFilter === 'valid') {
            filter['RechargeData.expireData'] = { $gt: new Date() };
            filter['RechargeData.approveRecharge'] = true;
        } else if (rechargeFilter === 'expired') {
            filter.$or.push(
                { 'RechargeData.expireData': { $lte: new Date() } },
                { 'RechargeData.approveRecharge': false },
                { 'RechargeData': { $exists: false } }
            );
        }

  
        let riders = await Rider.find(filter)
            .select('_id name phone location RechargeData createdAt rideVehicleInfo lastUpdated isAvailable on_ride_id')
            .sort({ createdAt: -1 })
            .lean();

        // Location filter
        if (locationSearch) {
            const searchCoords = await getCoordinatesFromAddress(locationSearch);
            if (searchCoords) {
                riders = riders.filter(r => {
                    if (r.location?.coordinates?.length === 2) {
                        const [lng, lat] = r.location.coordinates;
                        const distance = calculateDistance(searchCoords.lat, searchCoords.lng, lat, lng);
                        return distance <= 5;
                    }
                    return false;
                });
            }
        }

        const totalRiders = riders.length;
        const startIndex = (parseInt(page) - 1) * parseInt(limit);
        const paginatedRiders = riders.slice(startIndex, startIndex + parseInt(limit));

        // Map minimal fields + recharge status
        const minimalRiders = paginatedRiders.map(r => ({
            _id: r._id,
            name: r.name,
            phone: r.phone,
            location: r.location || null,
            rechargeData: r.RechargeData || null,
           rideVehicleInfo: r.rideVehicleInfo || null,
           lastUpdated: r.lastUpdated || null,


            createdAt: r.createdAt,
            isAvailable: r.isAvailable,
            on_ride_id: r.on_ride_id || null,
            rechargeValid: isRechargeValid(r),
        }));

        res.json({
            success: true,
            totalRiders,
            page: parseInt(page),
            limit: parseInt(limit),
            data: minimalRiders,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server Error' });
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