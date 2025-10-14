const express = require('express');
const { registerRider, getAllRiders, changeLocation, login, resendOtp, verifyOtp, uploadDocuments, details, getMyAllDetails, getMyAllRides, toggleWorkStatusOfRider, verifyDocument, uploadPaymentQr, getMySessionsByUserId, riderDocumentsVerify, updateBlockStatus, getSingleRider, updateRiderDetails, updateRiderDocumentVerify, logoutRider, deleteRider, AdmintoggleWorkStatusOfRider, saveFcmTokenToken, assignFreeRechargeToRider, addOnVehicle, getMyAddOnVehicle, updateDriverVehicleAddsOn, updateVehicleDetailsForDriver, getAddOnVehicleAdmin, approveVehicleDocument, getAllAddOnVehicleAdmin, updateRiderProfileCompleted } = require('../controllers/rider.controller');
const { calculateRidePriceForUser, rideEndByFallBack } = require('../controllers/ride.request');

const router = express.Router();

const multer = require('multer');
const Protect = require('../middleware/Auth');
const { findAllOrders, logout, addFcm } = require('../user_controller/user.register.controller');
const { make_recharge, verify_recharge } = require('../PaymentWithWebDb/razarpay');
const { ride_status_after_booking } = require('../src/New-Rides-Controller/CreateNewRides');
const NewRideModelModel = require('../src/New-Rides-Controller/NewRideModel.model');

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    try {
      // Check the destination directory and ensure it's valid
      const destinationPath = 'uploads/';
      // If the directory doesn't exist, create it (this is optional, depending on your environment)
      const fs = require('fs');
      if (!fs.existsSync(destinationPath)) {
        fs.mkdirSync(destinationPath, { recursive: true });
      }
      cb(null, destinationPath);
    } catch (error) {
      console.error("❌ Error setting destination path:", error);
      cb(error);  // Pass the error to multer callback
    }
  },

  filename: function (req, file, cb) {
    try {
      const uniqueSuffix = Date.now() + '-' + file.originalname;
      console.log(`✅ File being saved with name: ${uniqueSuffix}`);
      cb(null, uniqueSuffix);
    } catch (error) {
      console.error("❌ Error generating filename:", error);
      cb(error);  // Pass the error to multer callback
    }
  }
});

const upload = multer({ storage: storage });



router.post('/register', registerRider);
router.post('/rider-verify', verifyOtp);
router.post('/rider-resend', resendOtp);
router.post('/rider-login', login);
router.post('/rider-end-fallback/:id', rideEndByFallBack);
router.get('/rider-logout/:rider_id', logoutRider);
router.post('/rider-upload', Protect, upload.array('documents'), uploadDocuments);
router.post('/rider-uploadPaymentQr', Protect, upload.single('image'), uploadPaymentQr)
router.get('/user-details', Protect, details);
router.put('/updateRiderBlock/:id', updateBlockStatus)
router.post('/update-fcm', Protect, saveFcmTokenToken)
router.get('/ride-status/:rideId', ride_status_after_booking)

router.get('/getMyAllDetails', getMyAllDetails);
router.get('/getMyAllRides', Protect, getMyAllRides);
router.post('/toggleWorkStatusOfRider', Protect, toggleWorkStatusOfRider);
router.post('/AdmintoggleWorkStatusOfRider/:id', AdmintoggleWorkStatusOfRider);
router.get('/getMySessionsByUserId', getMySessionsByUserId);
router.put('/rider_document_verify/:id', riderDocumentsVerify)

router.get('/', getAllRiders);

router.put('/:riderId/location', changeLocation);

router.post('/get-fare-info', calculateRidePriceForUser)
router.get('/do-verify', verifyDocument)

router.put('/updateRiderBlock/:id', updateBlockStatus)
router.get('/get_single_rider/:id', getSingleRider);
router.put('/update_rider_detail/:id', upload.any(), updateRiderDetails)

// universal logout
router.get('/logout', logout)

router.get('/recharge-wallet/:package_id/:user_id', make_recharge)
router.post('/fcm/add', addFcm)
router.post('/recharge-verify/:BHID', verify_recharge)

router.put('/update_rider_document_verify/:id', updateRiderDocumentVerify);

router.delete('/delete_rider_vendor/:id', deleteRider)

router.post('/free-recharge-wallet', assignFreeRechargeToRider)
// add on vehcile
router.post('/add-more-vehicle', Protect,upload.array('documents'), addOnVehicle)
router.get('/get-vehicles-details', Protect, getMyAddOnVehicle)
router.post('/change-vehicle-for-driver',Protect,updateVehicleDetailsForDriver)

router.post('/get_add_on_vehicle_Admin/:id',getAddOnVehicleAdmin)
router.get('/get_all_add_on_vehicle',getAllAddOnVehicleAdmin)

router.get('/update',updateDriverVehicleAddsOn)
router.put('/vehicles/:vehicleId/documents/:documentType/approve',approveVehicleDocument)

router.put('/update_rider_Profile_completed/:id',updateRiderProfileCompleted)





router.get('/:rideId/messages', async (req, res) => {
  try {
    const { rideId } = req.params;
    const ride = await NewRideModelModel.findById(rideId);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });

    res.json({ messages: ride.chat });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Send message
router.post('/:rideId/messages', async (req, res) => {
  try {
    const { rideId } = req.params;
    const { from, fromType, message } = req.body;

    if (!from || !fromType || !message)
      return res.status(400).json({ message: 'from, fromType, and message are required' });

    const ride = await NewRideModelModel.findById(rideId);
    if (!ride) return res.status(404).json({ message: 'Ride not found' });

    const chatData = { from, fromType, message, createdAt: new Date(), seen: false };

    ride.chat.push(chatData);
    await ride.save();

    res.json({ message: 'Message sent', chat: chatData });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});
module.exports = router;
