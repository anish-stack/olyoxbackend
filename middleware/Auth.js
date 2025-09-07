const jwt = require('jsonwebtoken');

const Protect = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.startsWith('Bearer ') 
        ? req.headers.authorization.split(' ')[1] 
        : req.cookies?.token || req.body?.token || null;
// const token = req.cookies.token || req.body.token || req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ message: 'No token provided' });
        }

        // console.log("Received Token:", token);
        // console.log("Received Token:", token);

        // Decode the token without verification
        const decodedWithoutVerify = jwt.decode(token);
       
        const decoded = jwt.verify(token, 'dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih');

        req.user = decoded;
        next();
    } catch (error) {
        console.log("JWT Verification Error:", error.message);
        return res.status(401).json({ message: 'Unauthorized' });
    }
};

module.exports = Protect;
