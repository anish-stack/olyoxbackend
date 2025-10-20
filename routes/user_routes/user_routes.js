const express = require('express');
const { createUser, verify_user, resendOtp,fine_me, login, findAllOrders, updateProfileDetails, getAllUser, updateBlockStatus, deleteMyAccount, updateFcmAndDetails, getAllUserFcm } = require('../../user_controller/user.register.controller');

const Protect = require('../../middleware/Auth');
const upload = require('../../middleware/multer');

const users = express.Router();

users.post('/register', createUser)
users.post('/verify-user', verify_user)
users.post('/resend-otp', resendOtp)
users.post('/login', login)
users.post('/delete-my-account/:id', deleteMyAccount)

users.get('/find_me',Protect, fine_me)
users.get('/find-Orders-details',Protect, findAllOrders)
users.post('/update-profile',Protect,upload.single('image'), updateProfileDetails)
users.post('/update-settings-user',Protect,updateFcmAndDetails)
// router.get('/find-Orders-details', Protect, findAllOrders);

users.get('/get_all_user',getAllUser)
users.get('/get_all_user_fcm',getAllUserFcm)

users.put('/update_user_block/:id',updateBlockStatus)


module.exports = users;
