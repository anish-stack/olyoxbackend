const crypto = require('crypto');

/**
 * Generates a secure OTP of a given length.
 * @param {number} length - The length of the OTP (default is 6).
 * @returns {string} - The generated OTP as a string.
 */
const generateOtp = (length = 6) => {
    try {
        const otp = crypto.randomInt(10 ** (length - 1), 10 ** length).toString();
        return otp;
    } catch (error) {
        console.error('Error generating OTP:', error);
        return null;
    }
};

module.exports = generateOtp;
