const jwt = require('jsonwebtoken')
require('dotenv').config()

const sendToken = async (user, res, status) => {
    try {
        //Generate JWT Token
        const token = jwt.sign({ id: user }, "dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih", {
            expiresIn: process.env.JWT_EXPIRES_TIME
        })

        const options = {
         
            httpOnly: true,
            secure: true
        };

        // Send token in cookie
        res.status(status).cookie('token', token, options).json({
            success: true,
            token,
            user
        });

    } catch (error) {
        console.log("tError ",error)
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
}

module.exports = sendToken;