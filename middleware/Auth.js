const jwt = require('jsonwebtoken');

const Protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.startsWith('Bearer')
      ? authHeader.split(' ')[1]
      : req.cookies?.token || req.body?.token || null;

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const decoded = jwt.verify(token, 'dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih');

    req.user = decoded;
    next();
  } catch (error) {
    console.log("JWT Verification Error:", error.message);
    return res.status(401).json({ message: error.name === 'TokenExpiredError' ? 'Token expired' : 'Unauthorized' });
  }
};

module.exports = Protect;