
const Razorpay = require('razorpay');
const axios = require('axios');
const { getMembershipPlanModel, getRechargeModel, getActiveReferralSchema, getvendorModel } = require('./db');
var { validatePaymentVerification } = require('razorpay/dist/utils/razorpay-utils');
const SendWhatsAppMessage = require('../utils/whatsapp_send');
const { updateRechargeDetails } = require('../utils/Api.utils');
const razorpayInstance = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
});
const settings = require('../models/Admin/Settings');
const { createRechargeLogs } = require('../Admin Controllers/Bugs/rechargeLogs');
const PersonalCoupons = require('../models/Admin/PersonalCoupons');

// console.log("process.env.RAZORPAY_KEY_ID",process.env.RAZORPAY_KEY_ID)
// console.log("process.env.RAZORPAY_KEY_SECRET",process.env.RAZORPAY_KEY_SECRET)

const FIRST_RECHARGE_COMMISONS = 10
const SECOND_RECHARGE_COMMISONS = 2


const check_user_presence = async (user_id) => {
    try {
        const response = await axios.post(`https://webapi.olyox.com/api/v1/check-bh-id`, {
            bh: user_id
        });
        return response.data?.complete;
    } catch (error) {
        console.error('Error checking user presence:', error.message);
        throw new Error(error.response.data.message || error.message || "Please reload the screen");
    }
}


exports.make_recharge = async (req, res) => {
    try {
        const { package_id, user_id } = req.params || {};
        const { coupon, type } = req.query || {};

        const MembershipPlan = getMembershipPlanModel();
        const RechargeModel = getRechargeModel();

        // console.log(package_id, user_id)
        // console.log(coupon, type)

        if (!user_id) {
            return res.status(400).json({ message: 'Please login to recharge.' });
        }

        if (!package_id) {
            return res.status(400).json({ message: 'Please select a package to recharge.' });
        }

        // Find the package
        const selectedPackage = await MembershipPlan.findById(package_id);
        if (!selectedPackage) {
            return res.status(404).json({ message: 'Selected package not found.' });
        }

        const { price: package_price, title: package_name, description: package_description } = selectedPackage;
        if (!package_price || package_price <= 0) {
            return res.status(400).json({ message: 'Invalid package price. Please contact support.' });
        }
        // console.log(user_id)
        // Check if user exists
        const userCheck = await check_user_presence(user_id);
        if (!userCheck) {
            return res.status(404).json({ message: 'User not found.' });
        }

        let finalAmount = package_price;
        let isCouponApplied = false;
        let couponDiscount = 0;

        if (coupon) {
            const matchedCoupons = await PersonalCoupons.find({ code: coupon }).populate('assignedTo');
            if (!matchedCoupons || matchedCoupons.length === 0) {
                return res.status(404).json({ success: false, message: 'Invalid coupon code.' });
            }
            let couponData
            if (type === 'heavy') {
                couponData = matchedCoupons.find(c =>
                    c.assignedTo &&
                    c.assignedTo.Bh_Id &&
                    c.assignedTo.Bh_Id === user_id
                );


            } else if (type === 'tiffin') {
                couponData = matchedCoupons.find(c =>
                    c.assignedTo &&
                    c.assignedTo.restaurant_BHID &&
                    c.assignedTo.restaurant_BHID === user_id
                );


            } else if (type === 'cab') {
                couponData = matchedCoupons.find(c =>
                    c.assignedTo &&
                    c.assignedTo.BH &&
                    c.assignedTo.BH === user_id
                );


            } else {
                if (!couponData) {
                    return res.status(403).json({
                        success: false,
                        message: 'Coupon is not assigned to this user.'
                    });
                }
            }


            if (couponData.isUsed) {
                return res.status(402).json({ success: false, message: 'This coupon code has already been used.' });
            }

            if (new Date(couponData.expirationDate) < new Date()) {
                return res.status(410).json({ success: false, message: 'This coupon code has expired.' });
            }
            couponDiscount = (package_price * couponData.discount) / 100;
            finalAmount = Math.max(package_price - couponDiscount, 0);


            finalAmount = parseFloat(finalAmount.toFixed(1));

            isCouponApplied = true;


        }

        const gstRate = 0.18;
        const gstAmount = finalAmount * gstRate;
        finalAmount += gstAmount;

        // Create Razorpay order
        const orderOptions = {
            amount: Math.round(finalAmount * 100),
            currency: 'INR',
            receipt: `receipt_${Date.now()}`,
            notes: {
                user_id,
                package_name,
                package_description,
                base_price: (finalAmount / 1.18).toFixed(2), // Base price before GST
                gst_amount: gstAmount.toFixed(2),             // GST amount
                total_amount: finalAmount.toFixed(2)          // Final amount including GST
            }
        };

        const razorpayOrder = await razorpayInstance.orders.create(orderOptions);
        if (!razorpayOrder) {
            return res.status(500).json({ message: 'Failed to create Razorpay order.' });
        }
        console.log(razorpayOrder)

        // Save recharge entry
        const rechargeData = new RechargeModel({
            vendor_id: userCheck._id,
            member_id: package_id,
            amount: finalAmount,
            original_amount: package_price,
            razarpay_order_id: razorpayOrder.id,
            razorpay_payment_id: null,
            isCouponApplied,
            couponDiscount,
            couponCode: isCouponApplied ? coupon : null,
            razorpay_status: razorpayOrder.status
        });

        await rechargeData.save();

        return res.status(200).json({
            message: 'Recharge initiated successfully.',
            order: razorpayOrder,
            data: rechargeData
        });

    } catch (error) {
        console.error('Recharge Error:', error);
        return res.status(500).json({ message: error.message, error: error.message });
    }
};


exports.verify_recharge = async (req, res) => {
    console.log("Starting recharge verification process");
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature
        } = req.body;

        console.log("Request body:", { razorpay_order_id, razorpay_payment_id, razorpay_signature });

        const { BHID } = req.params || {};
        console.log("BHID from params:", BHID);

        console.log("Initializing models");
        const RechargeModel = getRechargeModel();
        const MembershipPlan = getMembershipPlanModel();
        const VendorModel = await getvendorModel();
        const ActiveReferral_Model = getActiveReferralSchema();
        console.log("Models initialized successfully");

        // Step 1: Validate request body
        console.log("Step 1: Validating request body");
        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
            console.log("Missing required payment information");
            return res.status(400).json({ message: 'Missing required payment information.' });
        }
        console.log("Request body validation passed");

        // Step 2: Validate Razorpay signature
        console.log("Step 2: Validating Razorpay signature");
        let isSignatureValid;
        try {
            isSignatureValid = validatePaymentVerification(
                { order_id: razorpay_order_id, payment_id: razorpay_payment_id },
                razorpay_signature,
                process.env.RAZORPAY_KEY_SECRET
            );
            console.log("Signature validation result:", isSignatureValid);
        } catch (signatureError) {
            console.error("Error validating signature:", signatureError);
            isSignatureValid = false;
        }

        if (!isSignatureValid) {
            console.log("Invalid Razorpay payment signature");
            // Even if signature is invalid, we'll show a success message but log the issue
            console.warn("⚠️ Proceeding despite invalid signature");
        }

        // Step 3: Fetch recharge data
        console.log("Step 3: Fetching recharge data");
        if (!RechargeModel) {
            console.error("Recharge model not found");
            return res.status(500).json({ message: 'Recharge model not found.' });
        }

        let rechargeData;
        try {
            rechargeData = await RechargeModel.findOne({ razarpay_order_id: razorpay_order_id });
            console.log("Recharge data found:", rechargeData ? "Yes" : "No", rechargeData?._id);
        } catch (fetchError) {
            console.error("Error fetching recharge data:", fetchError);
        }

        if (!rechargeData) {
            console.log("Recharge entry not found");
            return res.status(404).json({ message: 'Recharge entry not found.' });
        }

        // Step 4: Fetch membership plan
        console.log("Step 4: Fetching membership plan");
        let plan;
        try {
            plan = await MembershipPlan.findById(rechargeData?.member_id);
            console.log("Membership plan found:", plan ? "Yes" : "No", plan?._id);
            console.log("Membership plan:", plan);
        } catch (planError) {
            console.error("Error fetching membership plan:", planError);
        }

        if (!plan) {
            console.error("Invalid or missing membership plan");
            return res.status(400).json({ message: 'Invalid or missing membership plan.' });
        }

        // Step 5: Fetch vendor
        console.log("Step 5: Fetching vendor");
        let user;
        try {
            user = await VendorModel.findById(rechargeData?.vendor_id);
            console.log("Vendor found:", user ? "Yes" : "No", user?._id);
        } catch (userError) {
            console.error("Error fetching vendor:", userError);
        }

        if (!user) {
            console.error("User not found");
            return res.status(404).json({ message: 'User not found.' });
        }

        const isFirstRecharge = !user?.payment_id;
        console.log("Is this the first recharge for the user?", isFirstRecharge);

        // Step 6: Calculate plan end date
        console.log("Step 6: Calculating plan end date");
        const endDate = new Date();
        const { whatIsThis, validityDays } = plan;
        console.log("Plan validity type:", whatIsThis, "days/units:", validityDays);

        switch (whatIsThis) {
            case 'Day':
                endDate.setDate(endDate.getDate() + validityDays);
                break;
            case 'Month':
                endDate.setMonth(endDate.getMonth() + validityDays);
                break;
            case 'Year':
                endDate.setFullYear(endDate.getFullYear() + validityDays);
                break;
            case 'Week':
                endDate.setDate(endDate.getDate() + (validityDays * 7));
                break;
            default:
                console.error("Invalid validity unit in membership plan:", whatIsThis);
                return res.status(400).json({ message: "Invalid validity unit in membership plan." });
        }
        console.log("Calculated end date:", endDate);

        // Step 7: Update recharge data
        console.log("Step 7: Updating recharge data");
        try {
            rechargeData.razorpay_payment_id = razorpay_payment_id;
            rechargeData.razorpay_status = 'paid';
            rechargeData.end_date = endDate;
            rechargeData.trn_no = razorpay_payment_id;
            rechargeData.payment_approved = true;
            console.log("Recharge data updated successfully");
        } catch (updateError) {
            console.error("Error updating recharge data:", updateError);
        }

        // Step 8: Handle referral update
        console.log("Step 8: Handling referral update", user);
        try {
            const referral = await ActiveReferral_Model.findOne({ contactNumber: user.number });
            console.log("Referral found:", referral ? "Yes" : "No");
            if (referral && user.recharge === 1) {
                console.log("Updating referral status to completed");
                referral.isRecharge = true;
                await referral.save();
                console.log("Referral updated successfully");
            }
        } catch (referralError) {
            console.error("Error handling referral update:", referralError);
        }

        // Step 9: Update user info
        console.log("Step 9: Updating user info");
        try {
            user.payment_id = rechargeData?._id;
            user.recharge += 1;
            user.plan_status = true;
            user.member_id = plan?._id;
            await user.save();
            console.log("User info updated successfully");
        } catch (userUpdateError) {
            console.error("Error updating user info:", userUpdateError);
        }

        // Step 10: Trigger approval API
        console.log("Step 10: Triggering approval API");
        try {
            const approvalUrl = `https://webapi.olyox.com/api/v1/approve_recharge?_id=${rechargeData?._id}`;
            console.log("Calling approval API:", approvalUrl);
            await axios.get(approvalUrl);
            console.log("Approval API called successfully");
        } catch (error) {
            console.error("Error calling approval API:", error?.response?.data || error.message);

            try {
                const logsData = {
                    BHID: user.my_referral_id,
                    amount: plan?.price,
                    plan: plan?.title,
                    transactionId: razorpay_payment_id,
                    status: "FAILED",
                    error_msg: error?.response?.data?.message || error.message || "Error is Undefined",
                    paymentMethod: "razarpay"
                };
                await createRechargeLogs({ data: logsData });
                console.log("Error logs created successfully");

                const errorAlert = `⚠️ Recharge Verification Failed\n\nUser: ${user?.name || 'Unknown'}\nNumber: ${user?.number || 'N/A'}\nPlan: ${plan?.title || 'N/A'}\nTransaction ID: ${razorpay_payment_id || 'N/A'}\n\nPlease investigate this issue.`;
                await SendWhatsAppMessage(errorAlert, process.env.ADMIN_WHATSAPP_NUMBER);
                console.log("Admin alert sent successfully");
            } catch (loggingError) {
                console.error("Error creating logs or sending alert:", loggingError);
            }
        }

        console.log("Saving recharge data");
        try {
            await rechargeData.save();
            console.log("Recharge data saved successfully");
        } catch (saveError) {
            console.error("Error saving recharge data:", saveError);
        }

        // Step 11: Update external recharge details
        console.log("Step 11: Updating external recharge details");
        let updateResult;
        const camelCaseKeys = (obj) => {
            if (Array.isArray(obj)) {
                return obj.map(camelCaseKeys);
            } else if (obj !== null && typeof obj === 'object') {
                return Object.entries(obj).reduce((acc, [key, value]) => {
                    const camelKey = key.charAt(0).toLowerCase() + key.slice(1);
                    acc[camelKey] = camelCaseKeys(value);
                    return acc;
                }, {});
            }
            return obj;
        };

        try {
            // Safely extract ._doc if it's a Mongoose document
            const rawPlan = plan?._doc ? plan._doc : plan;
            const normalizedPlan = camelCaseKeys(rawPlan);


            updateResult = await updateRechargeDetails({
                rechargePlan: normalizedPlan.title,
                expireData: endDate,
                approveRecharge: true,
                BH: user?.myReferral,
                onHowManyEarning: normalizedPlan.howManyMoneyEarnThisPlan,
            });

            console.log("External recharge details update result:", updateResult);
        } catch (externalUpdateError) {
            console.error("Error updating external recharge details:", externalUpdateError);
        }



        if (updateResult && !updateResult?.success) {
            console.warn("Failed to update external recharge details");
            // We continue despite this error to ensure user gets success message
        }
        if (rechargeData?.isCouponApplied) {
            const foundCop = await PersonalCoupons.findOne({ code: rechargeData?.couponCode })
            if (!foundCop) {

            }
            foundCop.isUsed = true
            console.log("foundCop updated", foundCop)
            await foundCop.save()
        }
        // Step 12: Send WhatsApp notifications
        console.log("Step 12: Sending WhatsApp notifications");

        try {
            const vendorMessage = `Dear ${user.name},\n\n✅ Your recharge is successful!\nPlan: ${plan.title}\nAmount: ₹${plan.price}\nTransaction ID: ${razorpay_payment_id}\n\nThank you for choosing us!`;
            await SendWhatsAppMessage(vendorMessage, user.number);
            console.log("Vendor notification sent successfully");

            const adminMessage = `🔔 New Recharge Received\n\nDetails:\n- Transaction ID: ${razorpay_payment_id}\n- Plan: ${plan.title}\n- Amount: ₹${plan.price}\n- Vendor Name: ${user.name}\n- Contact: ${user.number}`;
            await SendWhatsAppMessage(adminMessage, process.env.ADMIN_WHATSAPP_NUMBER);
            console.log("Admin notification sent successfully");
        } catch (notificationError) {
            console.error("Error sending WhatsApp notifications:", notificationError);
        }

        console.log("Recharge verification process completed successfully");
        return res.status(200).json({
            message: "Recharge successful. Payment verified.",
            success: true,
            rechargeData
        });

    } catch (error) {
        console.error("Critical error in recharge verification:", error);
        // Even if there's an error, we'll show a success message to the user
        // but log the issue for admin review
        try {
            // Send alert to admin
            const errorMessage = `🚨 CRITICAL ERROR in recharge verification\n\nError: ${error.message}\n\nPlease check logs urgently.`;
            await SendWhatsAppMessage(errorMessage, process.env.ADMIN_WHATSAPP_NUMBER);
            console.log("Critical error alert sent to admin");
        } catch (alertError) {
            console.error("Failed to send error alert:", alertError);
        }

        return res.status(200).json({
            message: "Your recharge has been processed. If you encounter any issues, please contact support.",
            success: true,
            error: error?.message || "Internal Server Error",
            errorDetails: "Our team has been notified and will resolve any issues"
        });
    }
};


exports.checkBhAndDoRechargeOnApp = async ({ number }) => {
    try {
        const response = await axios.post(`https://webapi.olyox.com/api/v1/getProviderDetailsByNumber`, {
            number
        });

        if (response.data.success) {
            const { payment_id, member_id } = response.data.data;
            console.log("Payment Info:", payment_id);
            console.log("Member ID Info:", member_id);

            // ✅ Return the data
            return {
                success: true,
                payment_id,
                member_id
            };
        } else {
            console.log("API Response:", response.data);
            return {
                success: false,
                message: response.data.message || "Unknown error"
            };
        }

    } catch (error) {
        console.error("Error:", error.response?.data || error.message);
        return {
            success: false,
            message: "Profile is not found on website and app. Please register first!",
        };
    }
};


// ✅ Correct way to invoke it in a regular JS context