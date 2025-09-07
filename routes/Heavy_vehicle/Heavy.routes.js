const express = require('express');

const upload = require('../../middleware/multerV2');
const { createVehicle, getAllVehicles, getVehicle, updateVehicle, deleteVehicle, getcategoryIdVehicles } = require('../../Heavy_vehicle_Controllers/Vehicle_types/VehicleTypes');
const Protect = require('../../middleware/Auth');
const { createCategory, getAllCategories, getCategory, updateCategory, deleteCategory, toggleStatus } = require('../../Heavy_vehicle_Controllers/Vehicle_types/HeavyVehicleCategory');
const { create_heavy_vehicle_partner, verifyOTP, resendOTP, updateProfile, uploadDocuments, getMyProfile, getAllProfiles, getPartnerById, delete_account, login, updateServiceAreaOnly, getAllHeavyVehicles, updateIsBlockedHeavyVehicle, verifyDocumentOfHeavyTransport, deleteHeavyVendor, updateHTVehicalByAdmin } = require('../../Heavy_vehicle_Controllers/vehicle_partners/Auth.Partners');
const HeveyPartnerProtect = require('../../middleware/HeavyPartnerAuth');
const { getheaveyPartners, CreateCallAndMessageRequest, getAllCallAndMessage, changeCallAndMessageRequestStatus, deleteCallAndMessageRequest, getCallAndMessageByHevyVehicleId, updateStatusRequest, addNote, editNote, deleteNote } = require('../../Heavy_vehicle_Controllers/Get_partners/Get.Controllers');
const { getAllMyParcelByCustomerId, cancelOrder } = require('../../Parcel Controller/NewOrderParcel');

const Heavy = express.Router();

// heavy-category //
Heavy.post('/heavy-category', createCategory);
Heavy.get('/heavy-category', getAllCategories);
Heavy.get('/heavy-category/:id', getCategory);
Heavy.put('/heavy-category/:id', updateCategory);
Heavy.delete('/heavy-category/:id', deleteCategory);
Heavy.patch('/heavy-category/:id/toggle-status', toggleStatus);


// heavy-vehicle //
Heavy.post('/heavy-vehicle', createVehicle);
Heavy.get('/heavy-vehicle', getAllVehicles);
Heavy.get('/heavy-vehicle/category', getcategoryIdVehicles);
Heavy.get('/heavy-vehicle/:id', getVehicle);
Heavy.put('/heavy-vehicle/:id', updateVehicle);
Heavy.delete('/heavy-vehicle/:id', deleteVehicle);

// heavy-vehicle-auth //

Heavy.post('/heavy-vehicle-login', login);
Heavy.post('/heavy-vehicle-register', create_heavy_vehicle_partner);
Heavy.post('/heavy-vehicle-verify-otp', verifyOTP);
Heavy.post('/heavy-vehicle-resend-otp', resendOTP);
Heavy.put('/heavy-vehicle-profile-update/:id',upload.single('profileImage'), updateProfile);
Heavy.put('/heavy-vehicle-profile-update-by-admin/:id', updateHTVehicalByAdmin);
Heavy.post('/heavy-vehicle-services-area/:id', HeveyPartnerProtect, updateServiceAreaOnly);
Heavy.post('/heavy-vehicle-profile-document/:id', upload.single('image'), HeveyPartnerProtect, uploadDocuments);
Heavy.get('/heavy-vehicle-profile', HeveyPartnerProtect, getMyProfile);
Heavy.get('/heavy-vehicle-all-profile', getAllProfiles);
Heavy.get('/heavy-vehicle-profile/:id', getPartnerById);
Heavy.delete('/heavy-vehicle-profile-delete/:id', HeveyPartnerProtect, delete_account);

Heavy.get('/heavy-vehicle-partners',getheaveyPartners )

// Call and Message Request
Heavy.post('/generated-call-and-message-request',CreateCallAndMessageRequest)
Heavy.get('/get-my-all-parcel/:userId',getAllMyParcelByCustomerId)
Heavy.get('/get-all-call-and-message-request',getAllCallAndMessage)
Heavy.get('/get-all-call-and-message-request-by-partner/:id',getCallAndMessageByHevyVehicleId)
Heavy.put('/toggle-call-and-message-request/:id',changeCallAndMessageRequestStatus)
Heavy.delete('/delete-call-and-message-request/:id',deleteCallAndMessageRequest)

Heavy.post('/update-request-stauts/:id',updateStatusRequest)
Heavy.post('/add-note-request/:id',addNote)
Heavy.put('/edit-note-request/:requestId/:noteId',editNote)
Heavy.delete('/delete-note-request/:requestId/:noteId',deleteNote)




Heavy.get('/get_all_hv_vendor', getAllHeavyVehicles);

Heavy.put('/update_hv_vendor_is_block_status/:id', updateIsBlockedHeavyVehicle);
Heavy.put('/update_hv_vendor_document_verify/:id', verifyDocumentOfHeavyTransport);
Heavy.delete('/heavy_vehicle_profile_delete/:id', deleteHeavyVendor);


Heavy.post('/cancel-parcel/:parcelId',cancelOrder);

module.exports = Heavy;
