const RestuarntOrderModel = require("../models/Tiifins/Restuarnt.Order.model");
const Restuarnt_Listing = require("../models/Tiifins/Restaurant.listing.model");
const Restaurant = require("../models/Tiifins/Resturant_register.model");
const SendWhatsAppMessage = require("../utils/whatsapp_send");
const User = require("../models/normal_user/User.model");
const Coupon = require('../models/Tiifins/couponsOfFood');
const SendWhatsAppMessageNormal = require("../utils/normalWhatsapp");

exports.create_order_of_food = async (req, res) => {
    try {
        const user_id = Array.isArray(req.user.user) ? req.user.user[0] : req.user.user;

        const { order_items, deliveryAddress, paymentMethod, total_payable, coupon_applied, user_lat, user_lng } = req.body;

        if (!order_items || order_items.length === 0) {
            return res.status(400).json({ success: false, message: "Your cart is empty. Please add items to place an order." });
        }

        if (!deliveryAddress?.flatNo || !deliveryAddress?.street || !deliveryAddress?.landmark || !deliveryAddress?.pincode) {
            return res.status(400).json({ success: false, message: "Please provide a complete delivery address, including Flat No, Street, Landmark, and Pincode." });
        }

        if (!user_lat || !user_lng) {
            return res.status(400).json({ success: false, message: "Unable to fetch your current location. Please enable location services and try again." });
        }

        if (!paymentMethod) {
            return res.status(400).json({ success: false, message: "Please select a valid payment method before proceeding with the order." });
        }

        if (total_payable <= 0) {
            return res.status(400).json({ success: false, message: "Total payable amount must be greater than zero." });
        }

        let items_For_Order = [];

        // Check food availability
        for (let i = 0; i < order_items.length; i++) {
            const item = order_items[i];
            const foodItem = await Restuarnt_Listing.findById(item._id);

            if (!foodItem) {
                return res.status(404).json({ success: false, message: `Food item with ID ${item._id} not found. Please check your cart.` });
            }

            if (!foodItem.food_availability) {
                return res.status(400).json({ success: false, message: `Sorry, "${foodItem.food_name}" is currently unavailable. Please choose another item.` });
            }

            items_For_Order.push({
                foodItem_id: foodItem._id,
                quantity: item.quantity,
                price: foodItem?.food_price
            });
        }

        // Generate a unique order ID
        const orderId = `ORDF${Date.now()}`;

        // Create new order
        const newOrder = new RestuarntOrderModel({
            Order_Id: orderId,
            user: user_id,
            restaurant: order_items[0]?.restaurant_id,
            address_details: deliveryAddress,
            user_current_location: {
                type: "Point",
                coordinates: [user_lng, user_lat]
            },
            items: items_For_Order,
            totalPrice: total_payable,
            coupon_which_applied: coupon_applied || null,
            paymentMethod,
            status: "Pending"
        });

        try {
            await newOrder.save();
        } catch (error) {
            if (error.code === 11000) {
                return res.status(400).json({
                    success: false,
                    message: "Duplicate Order ID detected. Please try placing the order again."
                });
            }
            throw error;
        }

        // Send order notification
        const send_order_notification = async () => {
            try {
                // console.log("Fetching restaurant details for ID:", newOrder?.restaurant);

                const find_Restaurant = await Restaurant.findById(newOrder?.restaurant);
                const find_user = await User.findById(newOrder?.user);

                // console.log("New Order:", newOrder);
                // console.log("User Details:", find_user?.number);

                if (!find_Restaurant) {
                    // Notify admin if restaurant is not found
                    const message = `Hey Admin, Order ID: ${newOrder.Order_Id} placed by ${find_user?.number || find_user?.name || 'User'
                        } is not assigned to any restaurant. Please assign this order and contact the user. User ID: ${find_user._id}`;

                    await SendWhatsAppMessage(message, 7217619794);
                    return;
                }

                // Fetch item names using foodItem_id from Restaurant.listing.model
                const itemDetails = await Promise.all(
                    newOrder.items.map(async (item) => {
                        const foodItem = await Restuarnt_Listing.findById(item.foodItem_id);
                        return foodItem ? `${foodItem.food_name} (x${item.quantity}) - ₹${item.price.toFixed(2)}` : null;
                    })
                );

                // Remove null values if any item is not found
                const formattedItems = itemDetails.filter(item => item).join("\n");

                // Construct message for restaurant
                const restaurantMessage = `*New Order Received!*\n\n*Order ID:* ${newOrder.Order_Id}\n*User:* ${find_user?.number || find_user?.name || "N/A"
                    }\n*Total Price:* ₹${newOrder.totalPrice.toFixed(2)}\n*Payment Method:* ${newOrder.paymentMethod}\n\n*Items Ordered:*\n${formattedItems}\n\n*Delivery Address:*\n${newOrder.address_details.flatNo}, ${newOrder.address_details.street}, ${newOrder.address_details.landmark}, ${newOrder.address_details.pincode}\n\n_For more details, please check the Vendor App._`;

                // Send WhatsApp message to restaurant
                await SendWhatsAppMessage(restaurantMessage, find_Restaurant.restaurant_contact);

            } catch (error) {
                console.error("Error sending notification:", error);
            }
        };

        await send_order_notification();
        const send_user_notification = async () => {
            try {
                const find_user = await User.findById(newOrder?.user);

                // Fetch item names using foodItem_id from Restaurant.listing.model
                const itemDetails = await Promise.all(
                    newOrder.items.map(async (item) => {
                        const foodItem = await Restuarnt_Listing.findById(item.foodItem_id);
                        return foodItem ? `• ${foodItem.food_name} (x${item.quantity}) - ₹${item.price.toFixed(2)}` : null;
                    })
                );

                // Remove null values if any item is not found
                const formattedItems = itemDetails.filter(item => item).join("\n");

                const userMessage = `📢 *Order Confirmation*\n\n🎉 *Great news!* Your order has been successfully placed.\n\n🆔 *Order ID:* ${newOrder.Order_Id}\n🛍️ *Items Ordered:*\n${formattedItems}\n\n💰 *Total Price:* ₹${newOrder.totalPrice.toFixed(2)}\n💳 *Payment Method:* ${newOrder.paymentMethod}\n\n📍 *Delivery Address:*\n${newOrder.address_details.flatNo}, ${newOrder.address_details.street}, ${newOrder.address_details.landmark}, ${newOrder.address_details.pincode}\n\n⏳ *Estimated Delivery Time:* *30 - 40 minutes*\n\n🚀 *Track your order status in the app!*\nThank you for choosing us. We hope you enjoy your meal! 🍽️`;

                await SendWhatsAppMessage(userMessage, find_user.number);
            } catch (error) {
                console.error("Error sending user notification:", error);
            }
        };

        await send_user_notification()

        return res.status(201).json({
            success: true,
            message: "Your order has been placed successfully! You will receive a confirmation shortly.",
            orderDetails: newOrder?._id,
            // items: itemDetailsFor
        });

    } catch (error) {
        console.error("Error placing order:", error);
        return res.status(500).json({ success: false, message: "Something went wrong while processing your order. Please try again later.", error: error.message });
    }
};



// Create a new coupon
exports.createCoupon = async (req, res) => {
    try {
        const { title, Coupon_Code, min_order_amount, max_discount, discount_type, discount, active } = req.body;

        if (!title || !Coupon_Code || !min_order_amount || !max_discount || !discount_type || !discount) {
            return res.status(400).json({
                success: false,
                message: "All required fields must be provided.",
            });
        }

        const existingCoupon = await Coupon.findOne({ Coupon_Code });
        if (existingCoupon) {
            return res.status(400).json({
                success: false,
                message: "Coupon code already exists.",
            });
        }

        const coupon = await Coupon.create({
            title,
            Coupon_Code,
            min_order_amount,
            max_discount,
            discount_type,
            discount,
            active
        });

        return res.status(201).json({
            success: true,
            message: "Coupon created successfully.",
            data: coupon,
        });
    } catch (error) {
        console.error("Error creating coupon:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while creating coupon.",
            error: error.message,
        });
    }
};

// Get all coupons
exports.getAllCoupons = async (req, res) => {
    try {
        const coupons = await Coupon.find();
        return res.status(200).json({
            success: true,
            data: coupons,
        });
    } catch (error) {
        console.error("Error fetching coupons:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while fetching coupons.",
            error: error.message,
        });
    }
};

// Get a single coupon by ID
exports.getSingleCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const coupon = await Coupon.findById(id);

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found.",
            });
        }

        return res.status(200).json({
            success: true,
            data: coupon,
        });
    } catch (error) {
        console.error("Error fetching coupon:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while fetching the coupon.",
            error: error.message,
        });
    }
};

// Update a coupon by ID
exports.updateCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const updatedData = req.body;

        const coupon = await Coupon.findByIdAndUpdate(id, updatedData, { new: true });

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found.",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Coupon updated successfully.",
            data: coupon,
        });
    } catch (error) {
        console.error("Error updating coupon:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while updating the coupon.",
            error: error.message,
        });
    }
};

// Delete a coupon by ID
exports.deleteCoupon = async (req, res) => {
    try {
        const { id } = req.params;
        const coupon = await Coupon.findByIdAndDelete(id);

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found.",
            });
        }

        return res.status(200).json({
            success: true,
            message: "Coupon deleted successfully.",
        });
    } catch (error) {
        console.error("Error deleting coupon:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while deleting the coupon.",
            error: error.message,
        });
    }
};

// Toggle active status of a coupon by ID
exports.toggleStatusOfActive = async (req, res) => {
    try {
        const { id } = req.params;
        const coupon = await Coupon.findById(id);

        if (!coupon) {
            return res.status(404).json({
                success: false,
                message: "Coupon not found.",
            });
        }

        coupon.active = !coupon.active;
        await coupon.save();

        return res.status(200).json({
            success: true,
            message: `Coupon status updated to ${coupon.active ? "active" : "inactive"}.`,
            data: coupon,
        });
    } catch (error) {
        console.error("Error toggling coupon status:", error);
        return res.status(500).json({
            success: false,
            message: "Server error while toggling coupon status.",
            error: error.message,
        });
    }
};


exports.cancel_order = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await RestuarntOrderModel.findById(orderId).populate("items.foodItem_id");

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        if (order.status === "Cancelled") {
            return res.status(400).json({ success: false, message: "Order is already cancelled" });
        }

        const currentTime = new Date();
        const orderTime = new Date(order.order_date);
        const timeDifference = Math.floor((currentTime - orderTime) / (1000 * 60)); // Convert to minutes

        const user = await User.findById(order.user);
        const restaurant = await Restaurant.findById(order.restaurant);

        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const itemsList = order.items
            .map((item) => `• ${item.foodItem_id.food_name} (x${item.quantity})`)
            .join("\n");

        if (timeDifference <= 10) {
            // Cancel the order immediately
            await RestuarntOrderModel.findByIdAndUpdate(orderId, { status: "Cancelled" });

            const userMessage = `❌ *Order Cancelled Successfully*\n\nYour order (ID: ${order?.Order_Id}) has been cancelled.\nRefund (if applicable) will be processed soon.\n\nThank you for using our service.`;
            await SendWhatsAppMessage(userMessage, user.number);

            if (restaurant) {
                const restaurantMessage = `🚨 *Order Cancelled*\n\nOrder ID: ${order?.Order_Id} has been cancelled by the user.\nPlease do not prepare the order.\n\nThank you.`;
                await SendWhatsAppMessage(restaurantMessage, restaurant.restaurant_contact);
            }

            return res.status(200).json({ success: true, message: "Order cancelled successfully" });
        } else {
            // Send cancellation request to admin
            const adminNumber = "7217619794"; // Replace with the actual admin number
            const adminMessage = `⚠️ *Order Cancellation Request*\n\n🛒 *Order ID:* ${order?.Order_Id}\n📅 *Order Age:* ${timeDifference} minutes\n\n👤 *User:* ${user.name || "N/A"} (${user.number})\n🏬 *Restaurant:* ${restaurant?.restaurant_name || "N/A"}\n📞 *Contact:* ${restaurant?.restaurant_contact || "N/A"}\n\n📝 *Ordered Items:*\n${itemsList}\n\nThe user has requested to cancel this order. Since it is older than 10 minutes, please review and cancel manually if necessary.`;

            if (order?.isAdminMessageSendForCancel === true) {
                return res.status(400).json({ success: false, message: "Order cancellation request already sent to admin please wait" })
            }
            await SendWhatsAppMessage(adminMessage, adminNumber);
            order.isAdminMessageSendForCancel = true
            await order.save()
            return res.status(200).json({ success: true, message: "Cancellation request sent to admin" });
        }
    } catch (error) {
        console.error("Error cancelling order:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

exports.get_my_latest_order = async (req, res) => {
    try {
        // Retrieve the user_id from the request
        const user_id = Array.isArray(req.user.user) ? req.user.user[0] : req.user.user;

        // Ensure the user exists
        const user = await User.findById(user_id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Retrieve the latest order with a status not equal to 'Cancelled'
        const order = await RestuarntOrderModel.find({
            user: user_id,
            status: { $ne: "Cancelled" } // Exclude 'Cancelled' orders
        }).sort({ createdAt: -1 }).populate("items.foodItem_id");;

        if (!order) {
            return res.status(404).json({ success: false, message: "No orders found for the user" });
        }

        return res.status(200).json({
            success: true,
            order
        });

    } catch (error) {
        console.error("Error fetching latest order:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

exports.get_order_by_id = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await RestuarntOrderModel.findById(orderId).populate("items.foodItem_id").populate("restaurant");

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        // Return the found order
        return res.status(200).json({
            success: true,
            order
        });

    } catch (error) {
        console.error("Error fetching order by ID:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

exports.get_orders_by_restaurant = async (req, res) => {
    try {
        const { restaurantId } = req.params; // Extract restaurant ID from request params

        const orders = await RestuarntOrderModel.find({ restaurant: restaurantId })
            .sort({ createdAt: -1 })
            .populate("items.foodItem_id")
            .populate("user")
            .populate("restaurant");

        if (!orders || orders.length === 0) {
            return res.status(404).json({
                success: false,
                message: "No orders found for this restaurant"
            });
        }

        return res.status(200).json({
            success: true,
            data: orders
        });

    } catch (error) {
        console.error("Error fetching orders by restaurant ID:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error"
        });
    }
};

exports.change_order_status = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status, deliveryBoyName, deliveryBoyPhone, deliveryBoyBikeNumber } = req.body;

        console.log("📦 Changing Order Status:", orderId, "→", status);

        const order = await RestuarntOrderModel.findById(orderId);
        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        const user = await User.findById(order.user);
        const userNumber = user?.number;

        order.status = status;
        await order.save();

        if (status === "Confirmed") {
            const message = `✅ Your order (ID: ${order.Order_Id}) has been confirmed! We're preparing your food and it will be on the way shortly. Thank you for ordering with us – Team Olyox.`;
            await SendWhatsAppMessage(message, userNumber);
        }

        if (status === "Out for Delivery") {
            const restaurant = await Restaurant.findById(order.restaurant);
            const restNumber = restaurant?.restaurant_phone;

            // Update wallet
            restaurant.wallet += order.totalPrice;

            const rechargeDate = new Date(restaurant?.RechargeData?.whichDateRecharge);
            const earningLimit = Number(restaurant?.RechargeData?.onHowManyEarning || 0);
            const planName = restaurant?.RechargeData?.rechargePlan || "N/A";

            const pastOrders = await RestuarntOrderModel.find({
                resturant: restaurant._id,
                status: "Out for Delivery",
                createdAt: { $gte: rechargeDate }
            });

            const pastEarnings = pastOrders.reduce((sum, o) => sum + Number(o.totalPrice || 0), 0);
            const totalEarnings = pastEarnings + Number(order.totalPrice || 0);
            const remaining = earningLimit - totalEarnings;

            console.log(`💰 Wallet Updated: ₹${restaurant.wallet}`);
            console.log(`📊 Plan: ${planName}, Total Earned: ₹${totalEarnings}, Limit: ₹${earningLimit}`);

            // Limit crossed
            if (totalEarnings >= earningLimit) {
                const message = `🚫 Your plan "${planName}" allowed earnings of ₹${earningLimit}. You've earned ₹${totalEarnings}. Please recharge to continue receiving orders – Team Olyox.`;
                await SendWhatsAppMessageNormal(message, restNumber);

                restaurant.isAvailable = false;
                restaurant.is_restaurant_in_has_valid_recharge = false;
                restaurant.isWorking = false;
                restaurant.RechargeData = {
                    expireData: new Date(Date.now() - 5 * 60 * 1000),
                    rechargePlan: '',
                    onHowManyEarning: '',
                    approveRecharge: false
                };

                console.log("⛔ Restaurant deactivated due to earnings limit reached.");
            } else if (remaining < 300) {
                const reminderMessage = `🔔 Reminder: Your plan "${planName}" has ₹${remaining} earning potential left (Earned: ₹${totalEarnings} / ₹${earningLimit}). Recharge soon to avoid interruptions – Team Olyox.`;
                await SendWhatsAppMessageNormal(reminderMessage, restNumber);
            }

            // Add delivery boy details
            order.deliveryBoyName = deliveryBoyName;
            order.deliveryBoyPhone = deliveryBoyPhone;
            order.deliveryBoyBikeNumber = deliveryBoyBikeNumber;
            await order.save();
            await restaurant.save();

            const message = `🚚 Your order (ID: ${order.Order_Id}) is out for delivery! Sit tight, it's on its way. Thank you for ordering – Team Olyox.`;
            await SendWhatsAppMessage(message, userNumber);
        }

        if (status === "Cancelled") {
            const message = `❌ Your order (ID: ${order.Order_Id}) has been cancelled. Sorry for the inconvenience. Feel free to place a new order anytime – Team Olyox.`;
            await SendWhatsAppMessage(message, userNumber);
        }

        return res.status(200).json({
            success: true,
            message: "Order status updated successfully"
        });

    } catch (error) {
        console.error("❌ Internal Server Error:", error);
        return res.status(500).json({
            success: false,
            message: "Internal server error",
            error: error.message
        });
    }
};


exports.admin_cancel_order = async (req, res) => {
    try {
        const { orderId, reason } = req.params;
        const order = await RestuarntOrderModel.findById(orderId);

        if (!order) {
            return res.status(404).json({ success: false, message: "Order not found" });
        }

        await RestuarntOrderModel.findByIdAndUpdate(orderId, { status: "Cancelled", adminWhyCancel: reason });

        const user = await User.findById(order.user);
        const restaurant = await Restuarnt_Listing.findById(order.restaurant);
        const adminNumber = "7217619794"; // Replace with actual admin number

        // Notify User
        const userMessage = `❌ *Order Cancelled by Admin*\n\nYour cancellation request for Order ID: ${order?.Order_Id} has been approved.\nRefund (if applicable) will be processed soon.`;
        await SendWhatsAppMessage(userMessage, user.number);

        // Notify Restaurant
        if (restaurant) {
            const restaurantMessage = `🚨 *Order Cancelled by Admin*\n\nOrder ID: ${orderId} has been cancelled by the admin upon user request.\nPlease do not proceed with the order.`;
            await SendWhatsAppMessage(restaurantMessage, restaurant.restaurant_contact);
        }

        // Notify Admin
        const adminMessage = `✅ *Order Cancellation Processed*\n\nOrder ID: ${order?.Order_Id} has been successfully cancelled.`;
        await SendWhatsAppMessage(adminMessage, adminNumber);

        return res.status(200).json({ success: true, message: "Order cancelled by admin successfully" });
    } catch (error) {
        console.error("Error cancelling order by admin:", error);
        return res.status(500).json({ success: false, message: "Internal server error" });
    }
};

exports.getAllTiffinOrder = async (req, res) => {
    try {
        const allOrder = await RestuarntOrderModel.find()
            .sort({ createdAt: -1 })
            .populate("items.foodItem_id")
            .populate("user")
            .populate("restaurant");

        if (!allOrder) {
            return res.status(400).json({
                success: false,
                message: "Order not found"
            })
        }
        return res.status(200).json({ success: true, data: allOrder });
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: "Internal servere error",
            error: error.message
        })
    }
}


exports.deleleteTiffinOrder = async (req, res) => {
    try {
        const { id } = req.params;
        const order = await RestuarntOrderModel.findByIdAndDelete(id);
        if (!order) {
            return res.status(400).json({
                success: false,
                message: "Order not found"
            })
        }
        return res.status(200).json({ success: true, message: "Order deleted successfully" });
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: "Internal servere error",
            error: error.message
        })
    }
}

exports.changeOrderStatusByAdmin = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        console.log('status', status)
        const order = await RestuarntOrderModel.findById(id);
        if (!order) {
            return res.status(400).json({
                success: false,
                message: "Order not found"
            })
        }
        order.status = status;
        await order.save();
        return res.status(200).json({ success: true, message: "Order status updated successfully" });
    } catch (error) {
        console.log("Internal server error", error)
        res.status(500).json({
            success: false,
            message: "Internal servere error",
            error: error.message
        })
    }
}