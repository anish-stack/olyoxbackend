const jwt = require('jsonwebtoken');

// Secret keys
const ACCESS_TOKEN_SECRET = 'dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih';
const REFRESH_TOKEN_SECRET = 'your_refresh_secret_here'; // should be stored securely

// Example refresh function (replace with your logic)
const refreshToken = (oldToken) => {
  try {
    // Decode without verifying expiration
    const decoded = jwt.decode(oldToken);

    if (!decoded) return null;

    // Issue a new access token
    return jwt.sign(
      { id: decoded.id, email: decoded.email }, // include the payload you need
      ACCESS_TOKEN_SECRET,
      { expiresIn: '1h' } // new token expiry
    );
  } catch (err) {
    return null;
  }
};

const Protect = async (req, res, next) => {
  try {
    // 1️⃣ Collect token from all sources
    const authHeader = req.headers.authorization;
    let token =
      authHeader && authHeader.startsWith('Bearer')
        ? authHeader.split(' ')[1]
        : req.cookies?.token || req.body?.token || null;

    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    try {
      // 2️⃣ Verify token
      const decoded = jwt.verify(token, ACCESS_TOKEN_SECRET);
      req.user = decoded;
      return next();
    } catch (verifyError) {
      // 3️⃣ Token expired? Try refresh
      if (verifyError.name === 'TokenExpiredError') {
        const newToken = refreshToken(token);

        if (!newToken) {
          return res.status(401).json({ message: 'Token expired. Please login again.' });
        }

        // Optionally set the new token in cookies or headers
        res.setHeader('x-access-token', newToken);
        req.user = jwt.verify(newToken, ACCESS_TOKEN_SECRET); // validate new token
        return next();
      }

      // Other JWT errors
      return res.status(401).json({ message: 'Unauthorized' });
    }
  } catch (error) {
    console.error('JWT Middleware Error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = Protect;
