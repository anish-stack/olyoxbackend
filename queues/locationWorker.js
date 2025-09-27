const RiderModel = require('../models/Rider.model');
const locationQueue = require('./LocationQue');

// Distance function
function haversineDistance(lat1, lon1, lat2, lon2) {
  const toRad = (x) => (x * Math.PI) / 180;
  const R = 6371e3;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

locationQueue.process(async (job) => {
  const { riderId, latitude, longitude, accuracy, speed, timestamp } = job.data;
console.log("Job data", job.data)
  try {
    // 1. Accuracy filter
    if (accuracy && accuracy > 50) {
      console.log(`⏩ Skipping ${riderId}: Poor accuracy (${accuracy}m)`);
      return;
    }

    // 2. Speed (convert to km/h)
    let speedKmh = null;
    if (typeof speed === 'number') {
      speedKmh = (speed * 3.6).toFixed(2);
      console.log(`🚖 Rider ${riderId} speed: ${speedKmh} km/h`);
    }

    // 3. Check previous location (skip if moved <20m)
    const prev = await RiderModel.findById(riderId, { location: 1 }).lean();
    if (prev?.location?.coordinates?.length === 2) {
      const [prevLng, prevLat] = prev.location.coordinates;
      const distance = haversineDistance(prevLat, prevLng, latitude, longitude);
      if (distance < 20) {
        console.log(`⏩ Skipping ${riderId}: moved only ${distance.toFixed(1)}m`);
        return;
      }
    }

    // 4. Save to DB
    await RiderModel.findOneAndUpdate(
      { _id: riderId },
      {
        location: { type: 'Point', coordinates: [longitude, latitude] },
        lastUpdated: new Date(timestamp || Date.now()),
        ...(speedKmh && { currentSpeed: speedKmh }),
        ...(accuracy && { accuracy }),
      },
      { upsert: true, new: true }
    );

    console.log(`✅ Rider ${riderId} location updated`);
  } catch (err) {
    console.error(`❌ Worker error for ${riderId}:`, err.message);
    throw err; // Bull will retry if fails
  }
});

locationQueue.on('waiting', (jobId) => {
  console.log(`⏳ Job waiting: ${jobId}`);
});

locationQueue.on('active', (job, jobPromise) => {
  console.log(`▶️ Job started: ${job.id}`, job.data);
});

locationQueue.on('completed', (job, result) => {
  console.log(`✅ Job completed: ${job.id}`);
});

locationQueue.on('failed', (job, err) => {
  console.error(`❌ Job failed: ${job.id}`, err.message);
});

locationQueue.on('stalled', (job) => {
  console.warn(`⚠️ Job stalled: ${job.id}`);
});


module.exports = locationQueue;