const Restaurant = require("../models/Tiifins/Resturant_register.model");
const Restaurant_Listing = require("../models/Tiifins/Restaurant.listing.model");
const mongoose = require('mongoose');
const RestaurantPackageModel = require("../models/Tiifins/Restaurant.package.model");
exports.find_Restaurant = async (req, res) => {
    try {
        const { restaurant_category, status, restaurant_in_top_list } = req.query;


        let query = {};

        if (restaurant_category) {
            query.restaurant_category = restaurant_category;
        }
        if (status) {
            query.status = status;
        }
        if (restaurant_in_top_list) {
            query.restaurant_in_top_list = restaurant_in_top_list;
        }

        // Fetch data from the database based on the query
        const restaurants = await Restaurant.find(query);

        // Respond with the fetched data
        return res.status(200).json({
            success: true,
            count: restaurants.length,
            message: "Restaurants fetched successfully.",
            data: restaurants,
        });
    } catch (error) {
        console.error("Error fetching restaurants:", error.message);
        return res.status(500).json({
            success: false,
            message: "An error occurred while fetching the restaurants.",
        });
    }
};

exports.update_Restaurant_status = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const updatedRestaurant = await Restaurant.findByIdAndUpdate(id, { status }, { new: true });
        if (!updatedRestaurant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found.",
            });
        }
        return res.status(200).json({
            success: true,
            message: "Restaurant status updated successfully.",
            data: updatedRestaurant,
        });
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}

exports.find_RestaurantbyId = async (req, res) => {
    try {
        const { id } = req.params;
        const restaurant = await Restaurant.findById(id);
        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found.",
            });
        }
        return res.status(200).json({
            success: true,
            message: "Restaurant found successfully.",
            data: restaurant,
        });
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}




exports.find_Restaurant_foods = async (req, res) => {
    try {
        const { food_category, food_availability, restaurant_id } = req.query;

        const query = {
            ...(food_category && { food_category }),
            ...(food_availability && { food_availability }),
            ...(restaurant_id && { restaurant_id }),
        };

        let restaurants_foods = await Restaurant_Listing.find(query).populate('restaurant_id');

        restaurants_foods = restaurants_foods.filter((item) => {
            const restaurant = item?.restaurant_id;
            const rechargeData = restaurant?.RechargeData;

            return (
                restaurant?.IsProfileComplete &&
                restaurant?.is_restaurant_in_has_valid_recharge &&
                rechargeData?.approveRecharge === true &&
                new Date(rechargeData?.expireData).setHours(0, 0, 0, 0) >= new Date().setHours(0, 0, 0, 0)
            );
        });

        restaurants_foods = restaurants_foods.sort(() => Math.random() - 0.5);

        return res.status(200).json({
            success: true,
            count: restaurants_foods.length,
            message: "Restaurants foods fetched successfully.",
            data: restaurants_foods,
        });
    } catch (error) {
        console.error("Error fetching restaurants foods:", error.message);
        return res.status(500).json({
            success: false,
            message: "An error occurred while fetching the restaurant foods.",
        });
    }
};



exports.find_Restaurant_And_Her_foods = async (req, res) => {
    try {
        const { restaurant_id } = req.query;
        console.log(restaurant_id)
        // Validate the restaurant_id
        if (!restaurant_id || !mongoose.Types.ObjectId.isValid(restaurant_id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid or missing restaurant ID.",
            });
        }

        const id = new mongoose.Types.ObjectId(restaurant_id);

        // Fetch restaurant details
        const find_Restaurant = await Restaurant.findById(id);
        if (!find_Restaurant) {
            return res.status(404).json({
                success: false,
                message: "Restaurant not found.",
            });
        }

        // Fetch restaurant foods
        const restaurants_foods = await Restaurant_Listing.find({ restaurant_id }).populate('restaurant_id');

        return res.status(200).json({
            success: true,
            count: restaurants_foods.length,
            message: restaurants_foods.length ? "Restaurant foods fetched successfully." : "No foods found for the given restaurant.",
            details: find_Restaurant,
            food: restaurants_foods,
        });
    } catch (error) {
        console.error("Error fetching restaurants and foods:", error.message);
        return res.status(500).json({
            success: false,
            message: "An error occurred while fetching the restaurant's foods. Please try again later.",
            error: error.message,
        });
    }
};
exports.find_RestaurantTop = async (req, res) => {
    try {
        let { lat, lng, page, limit } = req.query;
        let query = { restaurant_in_top_list: true };
        if (lat && lng) {
            lat = parseFloat(lat);
            lng = parseFloat(lng);
            if (isNaN(lat) || isNaN(lng)) {
                return res.status(400).json({ success: false, message: "Invalid latitude or longitude" });
            }

            query.geo_location = {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [lng, lat]
                    },
                    $maxDistance: 4000 // 5km radius
                }
            };
        }

        // Find top restaurants based on the query
        const topRestaurants = await Restaurant.find(query);

        if (!topRestaurants.length) {
            // If no nearby restaurants found, show all top restaurants and message
            let allTopRestaurants = await Restaurant.find({ restaurant_in_top_list: true });

            return res.status(200).json({
                success: true,
                message: "No nearby restaurants found. Showing all top restaurants.",
                count: allTopRestaurants.length,
                data: allTopRestaurants
            });
        }

        // Shuffle the array using Fisher-Yates algorithm
        for (let i = topRestaurants.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [topRestaurants[i], topRestaurants[j]] = [topRestaurants[j], topRestaurants[i]];
        }

        // Send shuffled restaurants as response
        res.status(200).json({
            success: true,
            message: "Nearby top restaurants found.",
            count: topRestaurants.length,
            data: topRestaurants
        });
    } catch (error) {
        console.error("Error fetching top restaurants:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
};
exports.getPackages = async (req, res) => {
    try {
        let { lat, lng } = req.query || {};
        let query = {};

        if (lat && lng) {
            lat = parseFloat(lat);
            lng = parseFloat(lng);
            if (isNaN(lat) || isNaN(lng)) {
                return res.status(400).json({ success: false, message: "Invalid latitude or longitude" });
            }

            query.geo_location = {
                $near: {
                    $geometry: {
                        type: "Point",
                        coordinates: [lng, lat]
                    },
                    $maxDistance: 5000 // 5km radius
                }
            };
        }

        let AllNearByRestaurant = await Restaurant.find(query);
        // If no nearby restaurants found, fetch restaurants within 10km radius
        if (lat && lng && AllNearByRestaurant.length === 0) {
            query.geo_location.$near.$maxDistance = 10000; // 10km radius
            AllNearByRestaurant = await Restaurant.find(query);
        }

        // If no latitude and longitude provided, fetch all restaurants
        if (!lat || !lng) {
            AllNearByRestaurant = await Restaurant.find({});
        }
        console.log("AllNearByRestaurant", AllNearByRestaurant)


        if (AllNearByRestaurant.length === 0) {
            return res.status(404).json({ success: false, message: "No restaurants found" });
        }

        const foundPackages = await RestaurantPackageModel.find({
            restaurant_id: { $in: AllNearByRestaurant.map((restaurant) => restaurant._id) }
        }).populate('restaurant_id');

        // Shuffle the array using Fisher-Yates algorithm
        for (let i = foundPackages.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [foundPackages[i], foundPackages[j]] = [foundPackages[j], foundPackages[i]];
        }

        return res.status(200).json({ success: true, packages: foundPackages });
    } catch (error) {
        console.error("Error fetching packages:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

exports.deleteResturant = async (req, res) => {
    try {
        const { id } = req.params;
        const deletedResturant = await Restaurant.findByIdAndDelete(id);
        if (!deletedResturant) {
            return res.status(404).json({
                success: false,
                message: "Resturant not found.",
            });
        }
        return res.status(200).json({
            success: true,
            message: "Resturant deleted successfully.",
            data: deletedResturant,
        });
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        })
    }
}