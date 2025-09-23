// Required Dependencies
const express = require("express")
const cors = require("cors")
const cookieParser = require("cookie-parser")
const multer = require("multer")
const axios = require("axios")
const mongoose = require("mongoose")
require("dotenv").config()

// Database connections
const connectDb = require("./database/db")
const { connectwebDb } = require("./PaymentWithWebDb/db")

// Routes
const router = require("./routes/routes")
const rides = require("./routes/rides.routes")
const hotel_router = require("./routes/Hotel.routes")
const users = require("./routes/user_routes/user_routes")
const tiffin = require("./routes/Tiffin/Tiffin.routes")
const parcel = require("./routes/Parcel/Parcel.routes")
const admin = require("./routes/Admin/admin.routes")
const Heavy = require("./routes/Heavy_vehicle/Heavy.routes")

// Models
const RiderModel = require("./models/Rider.model")
const Parcel_boy_Location = require("./models/Parcel_Models/Parcel_Boys_Location")
const Settings = require("./models/Admin/Settings")
const tempRideDetailsSchema = require("./models/tempRideDetailsSchema")

// Middleware
const Protect = require("./middleware/Auth")

// Configure multer for file uploads
const storage = multer.memoryStorage()
const upload = multer({ storage: storage })

// Initialize Express app
const app = express()

// Connect to databases
connectDb()
connectwebDb()
console.log("Attempting database connection...")

// Middleware Setup
app.use(cors())
app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(cookieParser())

// API Routes
app.use("/api/v1/rider", router)
app.use("/api/v1/rides", rides)
app.use("/api/v1/hotels", hotel_router)
app.use("/api/v1/user", users)
app.use("/api/v1/tiffin", tiffin)
app.use("/api/v1/parcel", parcel)
app.use("/api/v1/heavy", Heavy)
app.use("/api/v1/admin", admin)

// File upload endpoint
app.post("/image-upload", upload.any(), async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] Image upload request received`, {
      filesCount: req.files ? req.files.length : 0,
    })

    return res.status(201).json({
      message: "Image uploaded successfully",
      data: req.files,
    })
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Image upload error:`, error.message)
    return res.status(500).json({
      message: "Image upload failed",
      error: error.message,
    })
  }
})

// Directions API endpoint
app.post('/directions', async (req, res) => {
    try {

        const data = req.body || {};

        // Check if the pickup and dropoff coordinates exist
        if (!data?.pickup?.latitude || !data?.pickup?.longitude || !data?.dropoff?.latitude || !data?.dropoff?.longitude) {
            return res.status(400).json({ error: 'Invalid pickup or dropoff location data' });
        }

        // Construct the Google Maps API URL
        const googleMapsUrl = `https://maps.googleapis.com/maps/api/directions/json?origin=${data?.pickup?.latitude},${data?.pickup?.longitude}&destination=${data?.dropoff?.latitude},${data?.dropoff?.longitude}&key=AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8`;

        // Make the request to Google Maps API
        const response = await axios.get(googleMapsUrl);

        // Check if the API returned valid data
        if (response.data.routes && response.data.routes[0] && response.data.routes[0].legs) {
            const leg = response.data.routes[0].legs[0];

            // Get the polyline encoded path for the directions
            const polyline = response.data.routes[0].overview_polyline.points;

            // Return the distance, duration, and polyline for frontend rendering
            return res.json({
                distance: leg.distance.text,
                duration: leg.duration.text,
                polyline: polyline, // Send polyline for rendering on the map
            });
        } else {
            return res.status(404).json({ error: 'No route found' });
        }
    } catch (error) {
        console.error('Error fetching directions:', error.response.data.message);
        return res.status(500).json({ error: 'Internal server error' });
    }
}); 

const ANDROID_STORE = "https://play.google.com/store/apps/details?id=com.happy_coding.olyox&hl=en_IN";
const IOS_STORE = "https://apps.apple.com/in/app/olyox-book-cab-hotel-food/id6744582670";


const rides = {
  "64a83f42": {
    id: "64a83f42",
    pickup: "Sector 99A",
    drop: "Sector 29",
    fare: 119.18
  }
};


// Endpoint to share ride
app.get("/share-ride/:rideId", (req, res) => {
  const { rideId } = req.params;
  const ride = rides[rideId];

  if (!ride) return res.status(404).send("Ride not found");

  // Deep link to open app ride page
  const deepLink = `http://192.168.1.10:3200/share-ride-to-loveone/${rideId}`;

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


// Location webhook for cab drivers
app.post(
  "/webhook/cab-receive-location",
  async (req, res, next) => {
    if (!req.body.riderId) {
      // Apply Protect middleware only if riderId is not provided
      return Protect(req, res, next)
    }
    next() // Proceed to the handler if riderId is provided
  },
  async (req, res) => {
    try {
      const { latitude, longitude, riderId } = req.body
      let userId
      if (riderId) {
        userId = riderId // Use riderId from the body if it's provided
      } else {
        userId = req.user.userId // Otherwise, get userId from the authenticated user
      }

      console.log("Location update request received")

      const data = await RiderModel.findOneAndUpdate(
        { _id: userId },
        {
          location: {
            type: "Point",
            coordinates: [longitude, latitude],
          },
          lastUpdated: new Date(),
        },
        { upsert: true, new: true },
      )

      console.log("Rider location updated")

      res.status(200).json({ message: "Location updated successfully" })
    } catch (error) {
      console.error("Error updating location:", error)
      res.status(500).json({ error: "Internal server error" })
    }
  },
)

// Location webhook for parcel delivery personnel
app.post("/webhook/receive-location", Protect, async (req, res) => {
  try {
    console.log("User location update request received", req.user)
    const { latitude, longitude } = req.body
    const userId = req.user.userId

    const data = await Parcel_boy_Location.findOneAndUpdate(
      { _id: userId },
      {
        location: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
        lastUpdated: new Date(),
      },
      { upsert: true, new: true },
    )

    res.status(200).json({ message: "Location updated successfully" })
  } catch (error) {
    console.error("Error updating location:", error)
    res.status(500).json({ error: "Internal server error" })
  }
})

// Helper function to delay execution
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Get ride details by ID
app.get("/rider/:tempRide", async (req, res) => {
  try {
    const { tempRide } = req.params
    console.log("[STEP 1] Received tempRide param:", tempRide)

    if (!tempRide || !mongoose.Types.ObjectId.isValid(tempRide)) {
      console.log("[STEP 2] Invalid ride ID")
      return res.status(400).json({ error: "Invalid ride ID" })
    }

    const objectId = new mongoose.Types.ObjectId(tempRide)
    console.log("[STEP 3] Converted to ObjectId:", objectId)

    let ride = null
    const maxRetries = 3
    const delayMs = 12000 // 12 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`[STEP 4.${attempt}] Attempt ${attempt} to fetch ride...`)
      ride = await tempRideDetailsSchema.findOne({
        $or: [{ _id: objectId }, { "rideDetails._id": objectId }],
      })

      if (ride) {
        console.log(`[STEP 5.${attempt}] Ride found on attempt ${attempt}`)
        return res.status(200).json({ ride })
      }

      console.log(`[STEP 6.${attempt}] Ride not found on attempt ${attempt}, retrying in 12 seconds...`)
      if (attempt < maxRetries) {
        await delay(delayMs)
      }
    }

    console.log("[STEP 7] Ride not found after 3 attempts")
    return res.status(404).json({ error: "Ride not found after retrying" })
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error fetching temp ride:`, err)
    return res.status(500).json({ error: "Internal server error" })
  }
})

// Get all available riders
app.get("/rider", async (req, res) => {
  try {
    const riders = await RiderModel.find({ isAvailable: true })
    res.render("riders", { riders })
  } catch (err) {
    res.status(500).send("Error retrieving riders")
  }
})

// Root endpoint
app.get("/", (req, res) => {
  res.status(201).json({
    message: "Welcome to the API",
  })
})

// Fetch current location details
app.post("/Fetch-Current-Location", async (req, res) => {
  const { lat, lng } = req.body
  console.log("Location fetch request:", req.body)

  // Check if latitude and longitude are provided
  if (!lat || !lng) {
    return res.status(400).json({
      success: false,
      message: "Latitude and longitude are required",
    })
  }

  try {
    // Fetch address details using the provided latitude and longitude
    const addressResponse = await axios.get(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${process.env.GOOGLE_MAPS_API_KEY || "AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8"}`,
    )

    // Check if any results are returned
    if (addressResponse.data.results.length > 0) {
      const addressComponents = addressResponse.data.results[0].address_components

      let city = null
      let area = null
      let postalCode = null
      let district = null

      // Extract necessary address components
      addressComponents.forEach((component) => {
        if (component.types.includes("locality")) {
          city = component.long_name
        } else if (component.types.includes("sublocality_level_1")) {
          area = component.long_name
        } else if (component.types.includes("postal_code")) {
          postalCode = component.long_name
        } else if (component.types.includes("administrative_area_level_3")) {
          district = component.long_name // Get district
        }
      })

      // Prepare the address details object
      const addressDetails = {
        completeAddress: addressResponse.data.results[0].formatted_address,
        city: city,
        area: area,
        district: district,
        postalCode: postalCode,
        landmark: null, // Placeholder for landmark if needed
        lat: addressResponse.data.results[0].geometry.location.lat,
        lng: addressResponse.data.results[0].geometry.location.lng,
      }

      // Respond with the location and address details
      return res.status(200).json({
        success: true,
        data: {
          location: { lat, lng },
          address: addressDetails,
        },
        message: "Location fetch successful",
      })
    } else {
      return res.status(404).json({
        success: false,
        message: "No address found for the given location",
      })
    }
  } catch (error) {
    console.error("Error fetching address:", error)
    return res.status(500).json({
      success: false,
      message: "Failed to fetch address",
    })
  }
})

// Calculate distance between two addresses
app.post("/geo-code-distance", async (req, res) => {
  try {
    const { pickup, dropOff } = req.body

    if (!pickup || !dropOff) {
      return res.status(400).json({ message: "Pickup and DropOff addresses are required" })
    }

    // Geocode Pickup Location
    const pickupResponse = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
      params: {
        address: pickup,
        key: process.env.GOOGLE_MAPS_API_KEY || "AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8",
      },
    })

    if (pickupResponse.data.status !== "OK") {
      return res.status(400).json({ message: "Invalid Pickup location" })
    }
    const pickupData = pickupResponse.data.results[0].geometry.location

    // Geocode Dropoff Location
    const dropOffResponse = await axios.get("https://maps.googleapis.com/maps/api/geocode/json", {
      params: {
        address: dropOff,
        key: process.env.GOOGLE_MAPS_API_KEY || "AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8",
      },
    })

    if (dropOffResponse.data.status !== "OK") {
      return res.status(400).json({ message: "Invalid Dropoff location" })
    }
    const dropOffData = dropOffResponse.data.results[0].geometry.location

    // Calculate Distance using Google Distance Matrix API
    const distanceResponse = await axios.get("https://maps.googleapis.com/maps/api/distancematrix/json", {
      params: {
        origins: `${pickupData.lat},${pickupData.lng}`,
        destinations: `${dropOffData.lat},${dropOffData.lng}`,
        key: process.env.GOOGLE_MAPS_API_KEY || "AIzaSyBvyzqhO8Tq3SvpKLjW7I5RonYAtfOVIn8",
      },
    })

    if (distanceResponse.data.status !== "OK") {
      return res.status(400).json({ message: "Failed to calculate distance" })
    }

    const distanceInfo = distanceResponse.data.rows[0].elements[0]

    if (distanceInfo.status !== "OK") {
      return res.status(400).json({ message: "Invalid distance calculation" })
    }

    const settings = await Settings.findOne()

    const distanceInKm = distanceInfo.distance.value / 1000 // Convert meters to kilometers
    const price = distanceInKm * (settings?.foodDeliveryPrice || 20) // Default to ₹20 per km if settings not found

    return res.status(200).json({
      pickupLocation: pickupData,
      dropOffLocation: dropOffData,
      distance: distanceInfo.distance.text,
      duration: distanceInfo.duration.text,
      price: `₹${price.toFixed(2)}`, // Show price with 2 decimal places
    })
  } catch (error) {
    console.error("Error in geo-code-distance:", error)
    return res.status(500).json({ message: "Internal server error", error: error.message })
  }
})

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception 🔥", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection 💥", reason);
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack)
  res.status(500).send("Something broke!")
})

module.exports = app
