const jwt = require('jsonwebtoken');

const send_token = async (user, message, res, req) => {
  try {
    const token = jwt.sign(
      { userId: user._id },
      'dfhdhfuehfuierrheuirheuiryueiryuiewyrshddjidshfuidhduih',
      { expiresIn: '30d' }
    );
    console.log("token", token)

    res.cookie('auth_token', token, {
      // httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 30 * 24 * 60 * 60 * 1000,
      // sameSite: 'strict',
    });


    return res.status(200).json({
      success: true,
      redirect: message,
      user: user._id,
      accountStatus:user?.isProfileComplete,
      isDocumentUpload:user?.isDocumentUpload,
      DocumentVerify:user?.DocumentVerify,
      message: 'Token generated and saved successfully',
      token: token,
    });
  } catch (error) {
    console.log(error);
    return res.status(500).json({
      success: false,
      message: 'Error generating token',
      error: error.message || 'Unknown error',
    });
  }
};

module.exports = send_token;
