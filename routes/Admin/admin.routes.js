const express = require('express');
const multer = require('multer');

const {
    create_onboarding_slide,
    get_onboarding_slides,
    update_onboarding_slide,
    delete_onboarding_slide,
    get_onboarding_slide_by_id
} = require('../../Admin Controllers/OnboardFnc/Onboard.Controller');

const {
    createSuggestion,
    getAllSuggestions,
    getSuggestionById,
    updateSuggestion,
    deleteSuggestion,
    updateStatus,
    addRideSubSuggestion,
    getAllRideSubSuggestions,
    updateRideSubSuggestion,
    deleteRideSubSuggestion,
    getByCategoryId
} = require('../../Admin Controllers/RideControllers/Rides_Controoler');

const {
    createSetting,
    getSetting,
    updateSetting
} = require('../../Admin Controllers/settings/Settings');

const {
    createCancelReason,
    updateCancelReason,
    getAllCancelReasons,
    getSingleCancelReason,
    deleteCancelReason,
    toggleCancelReason,
    getAllCancelReasonsAdmin
} = require('../../Admin Controllers/settings/cancelReason');

const {
    createHeavyOption,
    getAllHeavyTransports,
    getHeavyTransportById,
    updateHeavyTransport,
    toggleActiveStatus,
    deleteHeavyTransport
} = require('../../Admin Controllers/settings/HeavyTransport');
const { createCoupon, getAllCoupons, getCouponById, updateCoupon, deleteCoupon, updateIsActiveStatus } = require('../../Admin Controllers/Coupon.Controller');
const {
    create_home_slide,
    get_home_slides,
    get_Home_slide_by_id,
    update_homeslide_slide,
    delete_homeslide_slide
} = require('../../Admin Controllers/OnboardFnc/HomeScreenSlide');
const { markPaid } = require('../../controllers/rider.controller');
const { createNotification, getNotifications, getNotificationById, markAsRead, deleteNotification } = require('../../Admin Controllers/settings/notificationController');
const { createPolicy, updatePolicy, getPolicyById, findPolicyByTitle, deletePolicy, getPolicies } = require('../../Admin Controllers/settings/privacyPolicyController');
const { createReport, getAllReports, getSingleReport, updateReport, deleteReport } = require('../../Admin Controllers/Bugs/LoginBugsReportsController');
const { createBonus, getAllBonuses, getBonusById, updateBonus, deleteBonus, updateBonusStatus } = require('../../Admin Controllers/createBonus/BonusController');
const { createAppHomeBanner, getAllAppHomeBanners, getSingleAppHomeBanner, updateAppHomeBanner, deleteAppHomeBanner, updateAppHomeBannerStatus } = require('../../Admin Controllers/AppHomeBanner');
const { getActiveCoupons, createPCoupon, getActivePCoupons, getCouponPById, updatePCoupon, deletePCoupon, getCouponpAById, getAllPartnersNameAndBHAndId, getAllPCoupons } = require('../../Admin Controllers/PersonalCoupons');
const { createAppVersion, deleteAppVersion, getLatestAppVersionByType, getAllAppVersions } = require('../../Admin Controllers/AppVersion');
const { webhookExotelApi } = require('../../controllers/ExotelApi');
const { DriverSendNotification } = require('../../Admin Controllers/notification/notificationController');

const admin = express.Router();

// Multer storage configuration for handling in-memory uploads
const storage = multer.memoryStorage({});
const upload = multer({ storage: storage });

// Onboarding Slides
admin.post('/create_onboarding_slide', upload.single('image'), create_onboarding_slide);
admin.get('/get_onboarding_slides', get_onboarding_slides);
admin.get('/get_single_onboarding_slides/:id', get_onboarding_slide_by_id);
admin.put('/update_onboarding_slide/:id', upload.single('image'), update_onboarding_slide);
admin.delete('/delete_onboarding_slide/:id', delete_onboarding_slide);

// Settings
admin.post('/createSetting', createSetting);
admin.get('/get_Setting', getSetting);
admin.post('/updateSetting', updateSetting);

// Cancel Reason Settings
admin.post('/cancel-reasons', createCancelReason);
admin.get('/get-All-Cancel-Reasons-Admin', getAllCancelReasonsAdmin);
admin.put('/cancel-reasons/:id', updateCancelReason);
admin.get('/cancel-reasons', getAllCancelReasons);
admin.get('/cancel-reasons/:id', getSingleCancelReason);
admin.delete('/cancel-reasons/:id', deleteCancelReason);
admin.put('/toggle-cancel-reasons/:id', toggleCancelReason);

// Admin Heavy Vehicle Settings
admin.post('/create-heavy', upload.single('image'), createHeavyOption);
admin.put('/update-heavy/:id', upload.single('image'), updateHeavyTransport);
admin.get('/get-heavy', getAllHeavyTransports);
admin.get('/get-single-heavy/:id', getHeavyTransportById);
admin.delete('/delete-heavy/:id', deleteHeavyTransport);
admin.post('/toggle-status-heavy/:id', toggleActiveStatus);

// Suggestions
admin.post('/createSuggestion', upload.single('icons_image'), createSuggestion);
admin.get('/getAllSuggestions', getAllSuggestions);
admin.get('/getSuggestionById/:id', getSuggestionById);
admin.put('/updateSuggestion/update/:id', upload.single('icons_image'), updateSuggestion);
admin.put('/updateSuggestionStatus/:id', updateStatus);
admin.delete('/deleteSuggestion/delete/:id', deleteSuggestion);

// Suggestions Sub

admin.post('/ride-sub-suggestion/:id', addRideSubSuggestion);
admin.get('/ride-sub-suggestion', getAllRideSubSuggestions);
admin.get('/ride-sub-suggestion/by-category/:id', getByCategoryId);
admin.put('/ride-sub-suggestion/:id', updateRideSubSuggestion);
admin.delete('/ride-sub-suggestion/:id', deleteRideSubSuggestion);




// Home Screen Slides
admin.post('/create_home_slide', upload.single('image'), create_home_slide);
admin.get('/get_home_slides', get_home_slides);
admin.get('/get_single_home_slides/:id', get_Home_slide_by_id);
admin.put('/update_home_slide/:id', upload.single('image'), update_homeslide_slide);
admin.delete('/delete_home_slide/:id', delete_homeslide_slide);

//mark paid
admin.post('/mark-paid', markPaid);

//notification
admin.post("/create-notification", createNotification);
admin.get("/all-notification", getNotifications);
admin.get("/notification/:id", getNotificationById);
admin.put("/mark-read-notification/:id", markAsRead);
admin.delete("/delete-notification/:id", deleteNotification);


// Coupon routes here 

admin.post('/createCoupon', createCoupon);
admin.get('/all_getCoupon', getAllCoupons);
admin.get('/getSingleCoupon/:id', getCouponById);
admin.put('/updateCoupon/:id', updateCoupon);
admin.delete('/deleteCoupon/:id', deleteCoupon);
admin.put('/updateCouponStatus/:id', updateIsActiveStatus);

// policy routes here 
admin.post('/policy', createPolicy);
admin.get('/policies', getPolicies);
admin.put('/policy/:id', updatePolicy);
admin.get('/policy/:id', getPolicyById);
admin.get('/policies/search', findPolicyByTitle);
admin.delete('/policy/:id', deletePolicy);


//Login register  bugs
admin.post('/report', upload.single('image'), createReport);
admin.get('/reports', getAllReports);
admin.get('/report/:id', getSingleReport);
admin.put('/report/:id', updateReport);
admin.delete('/report/:id', deleteReport);

//  bonuses
admin.post('/admin/bonuses', createBonus);
admin.get('/admin/bonuses', getAllBonuses);
admin.get('/admin/bonuses/:id', getBonusById);
admin.put('/admin/bonuses/:id', updateBonus);
admin.delete('/admin/bonuses/:id', deleteBonus);
admin.put('/admin/update_bonus_status/:id', updateBonusStatus);


// app home banner
admin.post('/create_home_banner', upload.single('image'), createAppHomeBanner);
admin.get('/get_home_banners', getAllAppHomeBanners);
admin.get('/get_single_home_banner/:id', getSingleAppHomeBanner);
admin.put('/update_home_banner/:id', upload.single('image'), updateAppHomeBanner);
admin.delete('/delete_home_banner/:id', deleteAppHomeBanner);
admin.patch('/toggle_home_banner/:id', updateAppHomeBannerStatus);


// Routes for personal coupons
admin.post('/personal-coupons/create', createPCoupon);
admin.get('/all-partners', getAllPartnersNameAndBHAndId);
admin.get('/personal-coupons/active', getActivePCoupons);
admin.get('/personal-coupons', getAllPCoupons);
admin.get('/personal-coupons/:id', getCouponPById);
admin.get('/personal-coupon/:id', getCouponpAById);
admin.put('/personal-coupons/:id', updatePCoupon);
admin.delete('/personal-coupons/:id', deletePCoupon);

admin.post('/send-notification-driver',DriverSendNotification)

admin.post('/app-version/create', createAppVersion);
admin.delete('/app-version/delete/:id', deleteAppVersion);
admin.get('/app-version/by-type/:app_type', getLatestAppVersionByType);
admin.get('/app-version/all', getAllAppVersions);

admin.get('/webhook-exotel-api',webhookExotelApi)

module.exports = admin;