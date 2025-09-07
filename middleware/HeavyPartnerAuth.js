const jwt = require('jsonwebtoken');
const Heavy_vehicle_partners = require('../models/Heavy_vehicle/Heavy_vehicle_partners');

const HeveyPartnerProtect = async (req, res, next) => {
    try {
        // Extract the token from headers, cookies, or body
        const token = req.headers.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.split(' ')[1]
            : req.cookies?.token || req.body?.token || null;

        if (!token) {
            return res.status(401).json({ 
                success: false,
                message: 'Unauthorized: No token provided'
            });
        }

        // Verify the token
        const decoded = jwt.verify(token, process.env.HEAVY_PARTNER_SECRET);

        // Check if the decoded token contains a valid partner ID
        const partner = await Heavy_vehicle_partners.findById(decoded.id?._id);
        if (!partner) {
            return res.status(404).json({ 
                success: false,
                message: 'Partner not found'
            });
        }

    
        req.user = partner;
        next();
    } catch (error) {
        console.error("JWT Verification Error:", error.message);
        return res.status(401).json({ 
            success: false,
            message: 'Unauthorized: Invalid token'
        });
    }
};

module.exports = HeveyPartnerProtect;
