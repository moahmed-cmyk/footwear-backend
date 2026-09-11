const express = require("express");

const router = express.Router();

const authController = require("../controllers/authController");
const verifyToken = require("../middleware/authMiddleware");

/*
|--------------------------------------------------------------------------
| OWNER REGISTRATION / AUTO LOGIN
|--------------------------------------------------------------------------
*/

// Send OTP
// Backend automatically decides:
// Existing owner -> owner_login
// New mobile -> register_owner
router.post(
  "/send-owner-otp",
  (req, res, next) => {
    req.body.purpose = "owner_auto";
    next();
  },
  authController.sendOtp
);

// Verify OTP
// We need to know whether this OTP was created for:
// owner_login OR register_owner
router.post(
  "/verify-owner-otp",
  async (req, res) => {
    try {
      const db = require("../config/db");

      const phone = String(req.body.phone || "")
        .trim()
        .replace(/\s+/g, "");

      let normalizedPhone = phone;

      if (normalizedPhone.startsWith("+91")) {
        normalizedPhone = normalizedPhone.substring(3);
      }

      if (
        normalizedPhone.startsWith("91") &&
        normalizedPhone.length === 12
      ) {
        normalizedPhone = normalizedPhone.substring(2);
      }

      if (!normalizedPhone || !req.body.otp) {
        return res.status(400).json({
          success: false,
          message: "Phone number and OTP are required",
        });
      }

      /*
      |--------------------------------------------------------------------------
      | Check OTP purpose
      |--------------------------------------------------------------------------
      */

      const [otpRows] = await db.query(
        `
        SELECT purpose
        FROM otp_verifications
        WHERE phone = ?
        AND verified_at IS NULL
        ORDER BY id DESC
        LIMIT 1
        `,
        [normalizedPhone]
      );

      if (otpRows.length === 0) {
        return res.status(400).json({
          success: false,
          message: "OTP not found or already used",
        });
      }

      req.body.purpose = otpRows[0].purpose;

      return authController.verifyOtp(req, res);
    } catch (error) {
      console.error(
        "VERIFY OWNER OTP ROUTE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "OTP verification failed",
        error: error.message,
      });
    }
  }
);

/*
|--------------------------------------------------------------------------
| SHOP REGISTRATION
|--------------------------------------------------------------------------
*/

router.post(
  "/register-shop",
  authController.registerShop
);

/*
|--------------------------------------------------------------------------
| OWNER LOGIN
|--------------------------------------------------------------------------
*/

router.post(
  "/send-owner-login-otp",
  (req, res, next) => {
    req.body.purpose = "owner_login";
    next();
  },
  authController.sendOtp
);

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

router.post(
  "/send-staff-login-otp",
  (req, res, next) => {
    req.body.purpose = "staff_login";
    next();
  },
  authController.sendOtp
);

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