const express = require('express');
const multer = require('multer');
const { register_restaurant, register_restaurant_fake, add_food_listing, get_all_listing, get_All_tiffin_id, login, verify_otp, getSingleTiffinProfile, delete_food_listing, updateIsWorking, update_available_status, passwordChange, resend_otp, getFoodListingById, getCustomTiffinListingById, updateLogo, updateResturant, updateTiffinDocumentVerify, getAllPackageListing, getAllFoodListing } = require('../../Tiffins/Create_Restaurant');
const { find_Restaurant, find_Restaurant_foods, find_Restaurant_And_Her_foods, find_RestaurantTop, getPackages, find_RestaurantbyId, update_Restaurant_status, deleteResturant } = require('../../Tiffins/Get_resturant');
const { create_order_of_food, cancel_order, admin_cancel_order, get_my_latest_order, get_order_by_id, get_orders_by_restaurant, change_order_status, getAllTiffinOrder, createCoupon, getAllCoupons, getSingleCoupon, updateCoupon, deleteCoupon, toggleStatusOfActive, deleleteTiffinOrder, changeOrderStatusByAdmin } = require('../../Tiffins/Food_Order');
const { createCustomTiffin, getAllTiffinPlans, getTiffinPlanById, updateTiffinPlan, deleteTiffinPlan, tryhit, updateAvailableTiffinPlans } = require('../../Tiffins/CustomTiffine_controller');
const Protect = require('../../middleware/Auth');

const tiffin = express.Router();

// Multer setup
const storage = multer.memoryStorage()

const upload = multer({ storage: storage });

// Tiffin routes
tiffin.post('/register_restaurant', register_restaurant)
tiffin.put('/update_is_working/:id', updateIsWorking)
tiffin.get('/fake_register_restaurant', register_restaurant_fake)
tiffin.post('/register_listing', upload.single('images'), add_food_listing)
// tiffin.post('/register_listing', add_food_listing)
tiffin.put('/update_available_food_status/:id', update_available_status)
tiffin.get('/get_all_tiffin_listing', get_all_listing)
tiffin.delete('/delete_tiffin_listing/:id', delete_food_listing)
tiffin.get('/get_all_tiffin_resturant', get_All_tiffin_id)
tiffin.post('/tiffin_login', login)
tiffin.post('/resend-otp', resend_otp);
tiffin.post('/verify_otp', verify_otp)
tiffin.get('/get_single_tiffin_profile', Protect, getSingleTiffinProfile)
tiffin.put('/update_password/:id', passwordChange)
tiffin.put('/verify_tiffin_document/:id', updateTiffinDocumentVerify)
tiffin.get('/get_food_by_resutrant_id', Protect, getFoodListingById)
tiffin.get('/get_custom_tiffin_by_resutrant_id', Protect, getCustomTiffinListingById)

tiffin.put('/update_logo/:id', upload.single('logo'), updateLogo);
tiffin.put('/update_restaurant_details/:id',
    upload.fields([
        { name: 'restaurant_fssai_image', maxCount: 1 },
        { name: 'restaurant_pan_image', maxCount: 1 },
        { name: 'restaurant_adhar_front_image', maxCount: 1 },
        { name: 'restaurant_adhar_back_image', maxCount: 1 }
    ]), updateResturant);


// get tiffins
tiffin.get('/get_restaurant', find_Restaurant)
tiffin.get('/get_single_restaurant/:id', find_RestaurantbyId)
tiffin.put('/update_restaurant_status/:id', update_Restaurant_status)
tiffin.get('/find_Restaurant_foods', find_Restaurant_foods)
tiffin.get('/find_Restaurant_And_Her_foods', find_Restaurant_And_Her_foods)
tiffin.post('/create_order_of_food', Protect, create_order_of_food)
tiffin.get('/get_my_latest_order', Protect, get_my_latest_order)
tiffin.get('/get_order_by_id/:orderId', get_order_by_id)
tiffin.get('/get_order_for_resturant/:restaurantId', get_orders_by_restaurant)
tiffin.put('/update_order_status/:orderId', change_order_status)
tiffin.get('/find_RestaurantTop', find_RestaurantTop)
tiffin.get('/find_Restaurant_Packages', getPackages)
tiffin.get('/food_order/cancel/:orderId', cancel_order)
tiffin.get('/food_order/admin-cancel/:orderId/:reason', admin_cancel_order)

tiffin.delete('/delete_tiffin_vendor/:id',deleteResturant)



tiffin.post("/create_custom_tiffin", upload.single('images'), createCustomTiffin);
tiffin.get("/get_all_tiffin", getAllTiffinPlans);
tiffin.get("/get_custom_tiffin_by_id/:id", getTiffinPlanById);
tiffin.put("/update_custom_tiffin/:id", updateTiffinPlan);
tiffin.delete("/delete_custom_tiffin/:id", deleteTiffinPlan);
tiffin.put('/update_tiffin_availability/:id', updateAvailableTiffinPlans);

tiffin.get('/get_all_orders', getAllTiffinOrder)

tiffin.delete('/delete_tiffin_order/:id', deleleteTiffinOrder)
tiffin.put('/update_tiffin_order_status/:id', changeOrderStatusByAdmin)


tiffin.get('/get_all_package_listing/:id', getAllPackageListing)
tiffin.get('/get_all_food_listing/:id', getAllFoodListing)

// tiffin coupons

tiffin.post('/tiffin-coupons', createCoupon);
tiffin.get('/tiffin-coupons', getAllCoupons);
tiffin.get('/tiffin-coupons/:id', getSingleCoupon);
tiffin.put('/tiffin-coupons/:id', updateCoupon);
tiffin.delete('/tiffin-coupons/:id', deleteCoupon);
tiffin.patch('/tiffin-coupons/toggle/:id', toggleStatusOfActive);



module.exports = tiffin;