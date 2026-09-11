const express = require("express");

const router = express.Router();

const authController = require("../controllers/authController");
const verifyToken = require("../middleware/authMiddleware");

/*
|--------------------------------------------------------------------------
| OWNER REGISTRATION
|--------------------------------------------------------------------------
*/

// Send OTP for new owner
router.post(
  "/send-owner-otp",
  (req, res, next) => {
    req.body.purpose = "register_owner";
    next();
  },
  authController.sendOtp
);

// Verify owner OTP
router.post(
  "/verify-owner-otp",
  (req, res, next) => {
    req.body.purpose = "register_owner";
    next();
  },
  authController.verifyOtp
);

// Create shop after OTP verification
router.post(
  "/register-shop",
  authController.registerShop
);

/*
|--------------------------------------------------------------------------
| OWNER LOGIN
|--------------------------------------------------------------------------
*/

// Send owner login OTP
router.post(
  "/send-owner-login-otp",
  (req, res, next) => {
    req.body.purpose = "owner_login";
    next();
  },
  authController.sendOtp
);

// Verify owner login OTP
router.post(
  "/owner-login",
  (req, res, next) => {
    req.body.purpose = "owner_login";
    next();
  },
  authController.verifyOtp
);

/*
|--------------------------------------------------------------------------
| STAFF LOGIN
|--------------------------------------------------------------------------
*/

// Send staff login OTP
router.post(
  "/send-staff-login-otp",
  (req, res, next) => {
    req.body.purpose = "staff_login";
    next();
  },
  authController.sendOtp
);

// Verify staff login OTP
router.post(
  "/staff-login",
  (req, res, next) => {
    req.body.purpose = "staff_login";
    next();
  },
  authController.verifyOtp
);

/*
|--------------------------------------------------------------------------
| STAFF MANAGEMENT
|--------------------------------------------------------------------------
*/

// Owner adds staff
router.post(
  "/add-staff",
  verifyToken,
  authController.addStaff
);

// Staff verifies invitation OTP
router.post(
  "/verify-staff",
  authController.verifyStaff
);

module.exports = router;