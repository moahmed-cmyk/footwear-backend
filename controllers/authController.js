const db = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
require("../config/firebaseAdmin");
const { getAuth } = require("firebase-admin/auth");
/*
|--------------------------------------------------------------------------
| HELPER FUNCTIONS
|--------------------------------------------------------------------------
*/

// Normalize Indian mobile number
const normalizePhone = (phone) => {
  if (!phone) return null;

  let value = String(phone)
    .trim()
    .replace(/\s+/g, "");

  if (value.startsWith("+91")) {
    value = value.substring(3);
  }

  if (value.startsWith("91") && value.length === 12) {
    value = value.substring(2);
  }

  return value;
};

// Generate 6 digit OTP
const generateOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

// Generate random password because users.password is NOT NULL
const generateRandomPassword = () => {
  return crypto.randomBytes(32).toString("hex");
};

/*
|--------------------------------------------------------------------------
| CREATE JWT TOKEN
|--------------------------------------------------------------------------
*/

const createToken = (user) => {
  return jwt.sign(
    {
      user_id: user.id,
      shop_id: user.shop_id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "7d",
    }
  );
};

/*
|--------------------------------------------------------------------------
| GOOGLE OWNER LOGIN
|--------------------------------------------------------------------------
*/

exports.googleOwnerLogin = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "Google ID token is required",
      });
    }

    // Verify Firebase ID token
   const decodedToken = await getAuth().verifyIdToken(idToken);

    const firebaseUid = decodedToken.uid;
    const email = decodedToken.email || null;

    if (!firebaseUid) {
      return res.status(401).json({
        success: false,
        message: "Invalid Google account",
      });
    }

    // Find existing OWNER using Firebase UID
    const [users] = await db.query(
      `
      SELECT
        id,
        shop_id,
        username,
        name,
        phone,
        email,
        firebase_uid,
        role,
        status
      FROM users
      WHERE firebase_uid = ?
        AND role = 'owner'
      LIMIT 1
      `,
      [firebaseUid]
    );

    const user = users[0];

    /*
    |--------------------------------------------------------------------------
    | EXISTING OWNER
    |--------------------------------------------------------------------------
    */

    if (user) {
      if (user.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "This owner account is inactive",
        });
      }

      // Get shop
      const [shops] = await db.query(
        `
        SELECT
          id,
          shop_name,
          owner_name,
          phone,
          address,
          gst_number,
          subscription_plan_id,
          subscription_status,
          subscription_end_date
        FROM shops
        WHERE id = ?
        LIMIT 1
        `,
        [user.shop_id]
      );

      const shop = shops[0];

      if (!shop) {
        return res.status(404).json({
          success: false,
          message: "Shop not found",
        });
      }

      // Subscription check
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      let subscriptionExpired = false;

      if (shop.subscription_status !== "active") {
        subscriptionExpired = true;
      }

      if (shop.subscription_end_date) {
        const endDate = new Date(
          shop.subscription_end_date
        );

        endDate.setHours(0, 0, 0, 0);

        if (endDate < today) {
          subscriptionExpired = true;
        }
      } else {
        subscriptionExpired = true;
      }

      // Create existing NIFORA JWT
      const token = createToken(user);

      return res.json({
        success: true,
        is_new_user: false,
        message: "Google login successful",

        token,

        subscription_expired: subscriptionExpired,

        user: {
          id: user.id,
          shop_id: user.shop_id,
          username: user.username,
          name: user.name,
          phone: user.phone,
          email: user.email || email,
          role: user.role,
        },

        shop: {
          id: shop.id,
          shop_name: shop.shop_name,
          owner_name: shop.owner_name,
          phone: shop.phone,
          address: shop.address,
          gst_number: shop.gst_number,
          subscription_plan_id:
            shop.subscription_plan_id,
          subscription_status:
            shop.subscription_status,
          subscription_end_date:
            shop.subscription_end_date,
        },
      });
    }

    /*
    |--------------------------------------------------------------------------
    | NEW GOOGLE USER
    |--------------------------------------------------------------------------
    |
    | IMPORTANT:
    | Do NOT automatically create a shop.
    |
    */

    return res.status(404).json({
      success: false,
      is_new_user: true,
      message: "Google account is not registered",
      firebase_uid: firebaseUid,
      email: email,
    });

    } catch (error) {
    console.error("GOOGLE OWNER LOGIN ERROR CODE:", error?.code);
    console.error("GOOGLE OWNER LOGIN ERROR MESSAGE:", error?.message);
    console.error("GOOGLE OWNER LOGIN ERROR FULL:", error);

    return res.status(401).json({
      success: false,
      message: "Google authentication failed",
      error_code: error?.code || null,
      error_message: error?.message || null,
    });
  }
};
/*
|--------------------------------------------------------------------------
| SEND OTP
|--------------------------------------------------------------------------
*/

exports.sendOtp = async (req, res) => {
  try {
    let {
      phone,
      purpose = "owner_login",
    } = req.body;

    const normalizedPhone = normalizePhone(phone);

    if (!normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Phone number is required",
      });
    }

    if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid Indian mobile number",
      });
    }

    const allowedPurposes = [
      "owner_auto",
      "owner_login",
      "staff_login",
      "staff_invite",
      "register_owner",
    ];

    if (!allowedPurposes.includes(purpose)) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP purpose",
      });
    }

    // Find existing user
    const [users] = await db.query(
      `
      SELECT
        id,
        shop_id,
        username,
        phone,
        role,
        status
      FROM users
      WHERE phone = ?
      LIMIT 1
      `,
      [normalizedPhone]
    );

    const existingUser = users[0];

    /*
    |--------------------------------------------------------------------------
    | OWNER AUTO FLOW
    |--------------------------------------------------------------------------
    */

    let actualPurpose = purpose;
    let isNewUser = false;

    if (purpose === "owner_auto") {
      if (existingUser) {
        if (existingUser.role !== "owner") {
          return res.status(403).json({
            success: false,
            message:
              "This mobile number belongs to a staff account",
          });
        }

        if (existingUser.status !== "active") {
          return res.status(403).json({
            success: false,
            message: "This owner account is inactive",
          });
        }

        actualPurpose = "owner_login";
        isNewUser = false;
      } else {
        actualPurpose = "register_owner";
        isNewUser = true;
      }
    }

    /*
    |--------------------------------------------------------------------------
    | OWNER LOGIN
    |--------------------------------------------------------------------------
    */

    if (actualPurpose === "owner_login") {
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          message:
            "No owner account found with this mobile number",
        });
      }

      if (existingUser.role !== "owner") {
        return res.status(403).json({
          success: false,
          message:
            "This mobile number belongs to a staff account",
        });
      }

      if (existingUser.status !== "active") {
        return res.status(403).json({
          success: false,
          message: "This owner account is inactive",
        });
      }
    }

    /*
    |--------------------------------------------------------------------------
    | STAFF LOGIN
    |--------------------------------------------------------------------------
    */

    if (actualPurpose === "staff_login") {
      if (!existingUser) {
        return res.status(404).json({
          success: false,
          message:
            "No staff account found with this mobile number",
        });
      }

      if (existingUser.role !== "staff") {
        return res.status(403).json({
          success: false,
          message:
            "This mobile number belongs to an owner account",
        });
      }

      if (existingUser.status !== "active") {
        return res.status(403).json({
          success: false,
          message:
            "Staff account is disabled or not verified",
        });
      }
    }

    /*
    |--------------------------------------------------------------------------
    | NEW OWNER REGISTRATION
    |--------------------------------------------------------------------------
    */

    if (
      actualPurpose === "register_owner" &&
      existingUser
    ) {
      return res.status(409).json({
        success: false,
        message:
          "An account already exists with this mobile number",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | DELETE OLD OTP
    |--------------------------------------------------------------------------
    */

    await db.query(
      `
      DELETE FROM otp_verifications
      WHERE phone = ?
      AND purpose = ?
      `,
      [normalizedPhone, actualPurpose]
    );

    /*
    |--------------------------------------------------------------------------
    | GENERATE OTP
    |--------------------------------------------------------------------------
    */

    const otp = generateOtp();

    const otpHash = await bcrypt.hash(
      otp,
      10
    );

    const expiresAt = new Date(
      Date.now() + 5 * 60 * 1000
    );

    /*
    |--------------------------------------------------------------------------
    | SAVE OTP
    |--------------------------------------------------------------------------
    */

    await db.query(
      `
      INSERT INTO otp_verifications
      (
        phone,
        otp_hash,
        purpose,
        expires_at
      )
      VALUES (?, ?, ?, ?)
      `,
      [
        normalizedPhone,
        otpHash,
        actualPurpose,
        expiresAt,
      ]
    );

    /*
    |--------------------------------------------------------------------------
    | DEVELOPMENT OTP
    |--------------------------------------------------------------------------
    */

    console.log(
      `NIFORA OTP | ${normalizedPhone} | ${actualPurpose} | ${otp}`
    );

    const response = {
      success: true,
      message: "OTP sent successfully",
      is_new_user: isNewUser,
    };

    if (process.env.NODE_ENV !== "production") {
      response.devOtp = otp;
    }

    return res.json(response);
  } catch (error) {
    console.error(
      "SEND OTP ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to send OTP",
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| VERIFY OTP
|--------------------------------------------------------------------------
*/

exports.verifyOtp = async (req, res) => {
  try {
    const {
      phone,
      otp,
      purpose = "owner_login",
    } = req.body;

    const normalizedPhone =
      normalizePhone(phone);

    if (!normalizedPhone || !otp) {
      return res.status(400).json({
        success: false,
        message:
          "Phone number and OTP are required",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | FIND OTP
    |--------------------------------------------------------------------------
    */

    const [rows] = await db.query(
      `
      SELECT *
      FROM otp_verifications
      WHERE phone = ?
      AND purpose = ?
      AND verified_at IS NULL
      ORDER BY id DESC
      LIMIT 1
      `,
      [
        normalizedPhone,
        purpose,
      ]
    );

    const otpRecord = rows[0];

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message:
          "OTP not found or already used",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CHECK EXPIRY
    |--------------------------------------------------------------------------
    */

    if (
      new Date(otpRecord.expires_at) <
      new Date()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP expired. Please request a new OTP",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CHECK ATTEMPTS
    |--------------------------------------------------------------------------
    */

    if (otpRecord.attempts >= 5) {
      return res.status(429).json({
        success: false,
        message:
          "Too many incorrect attempts. Request a new OTP",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | VERIFY OTP
    |--------------------------------------------------------------------------
    */

    const isValid =
      await bcrypt.compare(
        String(otp),
        otpRecord.otp_hash
      );

    if (!isValid) {
      await db.query(
        `
        UPDATE otp_verifications
        SET attempts = attempts + 1
        WHERE id = ?
        `,
        [otpRecord.id]
      );

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | MARK OTP VERIFIED
    |--------------------------------------------------------------------------
    */

    await db.query(
      `
      UPDATE otp_verifications
      SET verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [otpRecord.id]
    );

    /*
    |--------------------------------------------------------------------------
    | NEW OWNER
    |--------------------------------------------------------------------------
    */

    if (purpose === "register_owner") {
      return res.json({
        success: true,
        verified: true,
        is_new_user: true,
        message:
          "Mobile number verified successfully",
        phone: normalizedPhone,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | STAFF INVITATION
    |--------------------------------------------------------------------------
    */

    if (purpose === "staff_invite") {
      return res.json({
        success: true,
        verified: true,
        message:
          "Staff mobile number verified successfully",
        phone: normalizedPhone,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | FIND EXISTING USER
    |--------------------------------------------------------------------------
    */

    const [users] = await db.query(
      `
      SELECT
        id,
        shop_id,
        username,
        phone,
        role,
        status
      FROM users
      WHERE phone = ?
      LIMIT 1
      `,
      [normalizedPhone]
    );

    const user = users[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "Account not found",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | ACCOUNT STATUS
    |--------------------------------------------------------------------------
    */

    if (user.status !== "active") {
      return res.status(403).json({
        success: false,
        message:
          "This account is inactive",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | GET SHOP
    |--------------------------------------------------------------------------
    */

    const [shops] = await db.query(
      `
      SELECT
        id,
        shop_name,
        owner_name,
        phone,
        address,
        gst_number,
        subscription_plan_id,
        subscription_status,
        subscription_end_date
      FROM shops
      WHERE id = ?
      LIMIT 1
      `,
      [user.shop_id]
    );

    const shop = shops[0];

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CHECK SUBSCRIPTION STATUS
    |--------------------------------------------------------------------------
    |
    | IMPORTANT:
    | Expired subscription MUST NOT block login.
    |
    | We issue the JWT token even when the subscription
    | is expired. Flutter will use subscription_expired
    | to open SubscriptionExpiredPage.
    |
    */

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let subscriptionExpired = false;

    if (
      shop.subscription_status !== "active"
    ) {
      subscriptionExpired = true;
    }

    if (shop.subscription_end_date) {
      const endDate =
        new Date(
          shop.subscription_end_date
        );

      endDate.setHours(0, 0, 0, 0);

      if (endDate < today) {
        subscriptionExpired = true;
      }
    } else {
      // No subscription end date = treat as expired
      subscriptionExpired = true;
    }

    /*
    |--------------------------------------------------------------------------
    | CREATE TOKEN
    |--------------------------------------------------------------------------
    */

    const token = createToken(user);

    /*
    |--------------------------------------------------------------------------
    | EXISTING USER LOGIN
    |--------------------------------------------------------------------------
    */

    return res.json({
      success: true,
      verified: true,
      is_new_user: false,
      message: "Login successful",

      token,

      // IMPORTANT FOR FLUTTER ROUTING
      subscription_expired:
        subscriptionExpired,

      user: {
        id: user.id,
        shop_id: user.shop_id,
        username: user.username,
        phone: user.phone,
        role: user.role,
      },

      shop: {
        id: shop.id,
        shop_name: shop.shop_name,
        owner_name: shop.owner_name,
        phone: shop.phone,
        address: shop.address,
        gst_number: shop.gst_number,

        subscription_plan_id:
          shop.subscription_plan_id,

        subscription_status:
          shop.subscription_status,

        subscription_end_date:
          shop.subscription_end_date,
      },
    });
  } catch (error) {
    console.error(
      "VERIFY OTP ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "OTP verification failed",
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| REGISTER OWNER / CREATE SHOP
|--------------------------------------------------------------------------
|
| NEW:
| Active Free Trial plan is automatically selected
| from subscription_plans table.
|
*/

exports.registerShop = async (
  req,
  res
) => {
  let connection;

  try {
    const {
      shop_name,
      owner_name,
      phone,
      address,
      gst_number,
      username,
    } = req.body;

    const normalizedPhone =
      normalizePhone(phone);

    /*
    |--------------------------------------------------------------------------
    | VALIDATION
    |--------------------------------------------------------------------------
    */

    if (
      !shop_name ||
      !owner_name ||
      !normalizedPhone
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Shop name, owner name and phone are required",
      });
    }

    if (
      !/^[6-9]\d{9}$/.test(
        normalizedPhone
      )
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Enter a valid Indian mobile number",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CHECK VERIFIED OWNER OTP
    |--------------------------------------------------------------------------
    */

    const [verifiedOtp] =
      await db.query(
        `
        SELECT id
        FROM otp_verifications
        WHERE phone = ?
        AND purpose = 'register_owner'
        AND verified_at IS NOT NULL
        AND verified_at >= DATE_SUB(
          CURRENT_TIMESTAMP,
          INTERVAL 15 MINUTE
        )
        ORDER BY id DESC
        LIMIT 1
        `,
        [normalizedPhone]
      );

    if (!verifiedOtp.length) {
      return res.status(403).json({
        success: false,
        message:
          "Please verify your mobile number with OTP first",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CHECK EXISTING USER
    |--------------------------------------------------------------------------
    */

    const [existingUsers] =
      await db.query(
        `
        SELECT id
        FROM users
        WHERE phone = ?
        LIMIT 1
        `,
        [normalizedPhone]
      );

    if (existingUsers.length) {
      return res.status(409).json({
        success: false,
        message:
          "An account already exists with this mobile number",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | USERNAME
    |--------------------------------------------------------------------------
    */

    const ownerUsername =
      username &&
      username.trim()
        ? username.trim()
        : normalizedPhone;

    /*
    |--------------------------------------------------------------------------
    | RANDOM PASSWORD
    |--------------------------------------------------------------------------
    */

    const randomPassword =
      generateRandomPassword();

    const hashedPassword =
      await bcrypt.hash(
        randomPassword,
        10
      );

    /*
    |--------------------------------------------------------------------------
    | DATABASE TRANSACTION
    |--------------------------------------------------------------------------
    */

    connection =
      await db.getConnection();

    await connection.beginTransaction();

    /*
    |--------------------------------------------------------------------------
    | GET ACTIVE FREE TRIAL PLAN
    |--------------------------------------------------------------------------
    |
    | We do NOT hard-code plan id = 3.
    | The active Free Trial plan is found
    | automatically from subscription_plans.
    |
    */

    const [freeTrialPlans] =
      await connection.query(
        `
        SELECT
          id,
          duration_days
        FROM subscription_plans
        WHERE plan_name = 'Free Trial'
        AND status = 'active'
        ORDER BY id ASC
        LIMIT 1
        `
      );

    if (!freeTrialPlans.length) {
      throw new Error(
        "Active Free Trial subscription plan not found"
      );
    }

    const freeTrialPlanId =
      Number(
        freeTrialPlans[0].id
      );

    const freeTrialDays =
      Number(
        freeTrialPlans[0].duration_days
      );

    if (
      !Number.isInteger(
        freeTrialPlanId
      ) ||
      !Number.isInteger(
        freeTrialDays
      ) ||
      freeTrialDays <= 0
    ) {
      throw new Error(
        "Invalid Free Trial plan configuration"
      );
    }

    /*
    |--------------------------------------------------------------------------
    | GET SHOP ID FROM TIDB SEQUENCE
    |--------------------------------------------------------------------------
    */

    const [shopSequence] =
      await connection.query(
        `
        SELECT NEXT VALUE FOR shops_id_seq AS shop_id
        `
      );

    const shopId =
      Number(
        shopSequence[0].shop_id
      );

    /*
    |--------------------------------------------------------------------------
    | CREATE SHOP
    |--------------------------------------------------------------------------
    */

    await connection.query(
      `
      INSERT INTO shops
      (
        id,
        shop_name,
        owner_name,
        phone,
        address,
        gst_number,
        subscription_plan_id,
        subscription_status,
        subscription_end_date
      )
      VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        'active',
        DATE_ADD(
          CURRENT_DATE,
          INTERVAL ${freeTrialDays} DAY
        )
      )
      `,
      [
        shopId,
        shop_name.trim(),
        owner_name.trim(),
        normalizedPhone,
        address || null,
        gst_number || null,
        freeTrialPlanId,
      ]
    );

    /*
    |--------------------------------------------------------------------------
    | GET USER ID FROM TIDB SEQUENCE
    |--------------------------------------------------------------------------
    */

    const [userSequence] =
      await connection.query(
        `
        SELECT NEXT VALUE FOR users_id_seq AS user_id
        `
      );

    const userId =
      Number(
        userSequence[0].user_id
      );

    /*
    |--------------------------------------------------------------------------
    | CREATE OWNER USER
    |--------------------------------------------------------------------------
    */

    await connection.query(
      `
      INSERT INTO users
      (
        id,
        shop_id,
        username,
        password,
        role,
        status,
        phone
      )
      VALUES (?, ?, ?, ?, 'owner', 'active', ?)
      `,
      [
        userId,
        shopId,
        ownerUsername,
        hashedPassword,
        normalizedPhone,
      ]
    );

    /*
    |--------------------------------------------------------------------------
    | COMMIT
    |--------------------------------------------------------------------------
    */

    await connection.commit();

    /*
    |--------------------------------------------------------------------------
    | CREATE TOKEN
    |--------------------------------------------------------------------------
    */

    const user = {
      id: userId,
      shop_id: shopId,
      role: "owner",
    };

    const token =
      createToken(user);

    /*
    |--------------------------------------------------------------------------
    | RESPONSE
    |--------------------------------------------------------------------------
    */

    return res.status(201).json({
      success: true,
      message:
        "Shop registered successfully",

      token,

      user: {
        id: userId,
        username: ownerUsername,
        phone: normalizedPhone,
        role: "owner",
        shop_id: shopId,
      },

      shop: {
        id: shopId,
        shop_name:
          shop_name.trim(),
        owner_name:
          owner_name.trim(),
        subscription_plan_id:
          freeTrialPlanId,
        subscription_status:
          "active",
      },
    });
  } catch (error) {
    /*
    |--------------------------------------------------------------------------
    | ROLLBACK
    |--------------------------------------------------------------------------
    */

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "ROLLBACK ERROR:",
          rollbackError
        );
      }
    }

    console.error(
      "REGISTER SHOP ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Shop registration failed",
      error: error.message,
    });
  } finally {
    /*
    |--------------------------------------------------------------------------
    | RELEASE CONNECTION
    |--------------------------------------------------------------------------
    */

    if (connection) {
      connection.release();
    }
  }
};

/*
|--------------------------------------------------------------------------
| ADD STAFF
|--------------------------------------------------------------------------
|
| Only OWNER can add staff.
|
*/

exports.addStaff = async (req, res) => {
  try {
    // ============================================================
    // OWNER CHECK
    // ============================================================

    if ((req.user.role || "").toLowerCase() !== "owner") {
      return res.status(403).json({
        success: false,
        message: "Only shop owner can add staff",
      });
    }

    // ============================================================
    // GET INPUT
    // ============================================================

    const staffName = String(req.body.staff_name || "").trim();
    const staffUsername = String(req.body.username || "").trim();
    const staffPassword = String(req.body.password || "");
    const shopId = Number(req.user.shop_id);

    // ============================================================
    // VALIDATION
    // ============================================================

    if (!staffName || !staffUsername || !staffPassword) {
      return res.status(400).json({
        success: false,
        message: "Staff name, username and password are required",
      });
    }

    if (!shopId || !Number.isInteger(shopId) || shopId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop",
      });
    }

    if (staffName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Staff name is too long",
      });
    }

    if (staffUsername.length < 3 || staffUsername.length > 50) {
      return res.status(400).json({
        success: false,
        message: "Username must be between 3 and 50 characters",
      });
    }

    if (!/^[a-zA-Z0-9._-]+$/.test(staffUsername)) {
      return res.status(400).json({
        success: false,
        message:
          "Username can contain only letters, numbers, dot, underscore and hyphen",
      });
    }

    if (staffPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    if (staffPassword.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Password is too long",
      });
    }

    // ============================================================
    // CHECK USERNAME
    // ============================================================
    // Username must be unique across NIFORA.
    // ============================================================

    const [existingUsers] = await db.query(
      `
      SELECT
        id,
        shop_id,
        username,
        role,
        status
      FROM users
      WHERE LOWER(username) = LOWER(?)
      LIMIT 1
      `,
      [staffUsername]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message: "This username is already taken",
      });
    }

    // ============================================================
    // HASH PASSWORD
    // ============================================================

    const hashedPassword = await bcrypt.hash(
      staffPassword,
      12
    );

    // ============================================================
    // GET STAFF ID FROM TIDB SEQUENCE
    // ============================================================

    const [staffSequence] = await db.query(
      `
      SELECT NEXT VALUE FOR users_id_seq AS user_id
      `
    );

    const staffId = Number(
      staffSequence[0].user_id
    );

    if (!staffId) {
      return res.status(500).json({
        success: false,
        message: "Failed to generate staff ID",
      });
    }

    // ============================================================
    // CREATE STAFF
    // ============================================================
    // IMPORTANT:
    // shop_id comes ONLY from authenticated owner's JWT.
    // status = active because we are using Option A.
    // ============================================================

    await db.query(
      `
      INSERT INTO users
      (
        id,
        shop_id,
        username,
        name,
        password,
        role,
        status,
        phone
      )
      VALUES (?, ?, ?, ?, ?, 'staff', 'active', NULL)
      `,
      [
        staffId,
        shopId,
        staffUsername,
        staffName,
        hashedPassword,
      ]
    );

    // ============================================================
    // SUCCESS
    // ============================================================

    return res.status(201).json({
      success: true,
      message: "Staff created successfully",
      staff: {
        id: staffId,
        shop_id: shopId,
        username: staffUsername,
        name: staffName,
        role: "staff",
        status: "active",
      },
    });

  } catch (error) {
    console.error("ADD STAFF ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to add staff",
      error: error.message,
    });
  }
};
/*
|--------------------------------------------------------------------------
| VERIFY STAFF INVITATION
|--------------------------------------------------------------------------
*/
/*
|--------------------------------------------------------------------------
| VERIFY STAFF INVITATION
|--------------------------------------------------------------------------
*/

exports.verifyStaff = async (
  req,
  res
) => {
  try {
    const {
      phone,
      otp,
    } = req.body;

    const normalizedPhone =
      normalizePhone(phone);

    if (
      !normalizedPhone ||
      !otp
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Phone number and OTP are required",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | FIND OTP
    |--------------------------------------------------------------------------
    */

    const [rows] =
      await db.query(
        `
        SELECT *
        FROM otp_verifications
        WHERE phone = ?
        AND purpose = 'staff_invite'
        AND verified_at IS NULL
        ORDER BY id DESC
        LIMIT 1
        `,
        [normalizedPhone]
      );

    const otpRecord =
      rows[0];

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        message:
          "OTP not found or already used",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | EXPIRY
    |--------------------------------------------------------------------------
    */

    if (
      new Date(
        otpRecord.expires_at
      ) < new Date()
    ) {
      return res.status(400).json({
        success: false,
        message:
          "OTP expired. Please ask owner to send a new invitation",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | ATTEMPTS
    |--------------------------------------------------------------------------
    */

    if (
      otpRecord.attempts >= 5
    ) {
      return res.status(429).json({
        success: false,
        message:
          "Too many attempts. Request a new OTP",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | VERIFY OTP
    |--------------------------------------------------------------------------
    */

    const valid =
      await bcrypt.compare(
        String(otp),
        otpRecord.otp_hash
      );

    if (!valid) {
      await db.query(
        `
        UPDATE otp_verifications
        SET attempts = attempts + 1
        WHERE id = ?
        `,
        [otpRecord.id]
      );

      return res.status(400).json({
        success: false,
        message: "Invalid OTP",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | MARK OTP VERIFIED
    |--------------------------------------------------------------------------
    */

    await db.query(
      `
      UPDATE otp_verifications
      SET verified_at = CURRENT_TIMESTAMP
      WHERE id = ?
      `,
      [otpRecord.id]
    );

    /*
    |--------------------------------------------------------------------------
    | FIND STAFF
    |--------------------------------------------------------------------------
    */

    const [users] =
      await db.query(
        `
        SELECT
          id,
          shop_id,
          username,
          phone,
          role,
          status
        FROM users
        WHERE phone = ?
        AND role = 'staff'
        LIMIT 1
        `,
        [normalizedPhone]
      );

    const staff =
      users[0];

    if (!staff) {
      return res.status(404).json({
        success: false,
        message:
          "Staff account not found",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | ACTIVATE STAFF
    |--------------------------------------------------------------------------
    */

    await db.query(
      `
      UPDATE users
      SET status = 'active'
      WHERE id = ?
      `,
      [staff.id]
    );

    /*
    |--------------------------------------------------------------------------
    | CREATE STAFF TOKEN
    |--------------------------------------------------------------------------
    */

    const token =
      createToken({
        id: staff.id,
        shop_id: staff.shop_id,
        role: "staff",
      });

    /*
    |--------------------------------------------------------------------------
    | RESPONSE
    |--------------------------------------------------------------------------
    */

    return res.json({
      success: true,
      message:
        "Staff verified successfully",

      token,

      user: {
        id: staff.id,
        shop_id: staff.shop_id,
        username: staff.username,
        phone: staff.phone,
        role: "staff",
      },
    });
  } catch (error) {
    console.error(
      "VERIFY STAFF ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Staff verification failed",
      error: error.message,
    });
  }
};


/*
|--------------------------------------------------------------------------
| CHANGE STAFF NAME
|--------------------------------------------------------------------------
*/

exports.changeStaffName = async (
  req,
  res
) => {
  try {
    // ============================================================
    // LOGGED-IN OWNER
    // ============================================================

    const ownerShopId =
      Number(req.user.shop_id);

    const ownerRole =
      String(req.user.role || "")
        .toLowerCase();

    // ============================================================
    // OWNER ONLY
    // ============================================================

    if (ownerRole !== "owner") {
      return res.status(403).json({
        success: false,
        message:
          "Only owner can change staff name",
      });
    }

    // ============================================================
    // STAFF ID
    // ============================================================

    const staffId =
      Number(req.params.id);

    // ============================================================
    // STAFF NAME
    // ============================================================

    const name =
      String(req.body.name || "")
        .trim();

    // ============================================================
    // VALIDATE STAFF ID
    // ============================================================

    if (
      !Number.isInteger(staffId) ||
      staffId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid staff ID",
      });
    }

    // ============================================================
    // VALIDATE SHOP
    // ============================================================

    if (
      !Number.isInteger(ownerShopId) ||
      ownerShopId <= 0
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Invalid shop",
      });
    }

    // ============================================================
    // VALIDATE NAME
    // ============================================================

    if (!name) {
      return res.status(400).json({
        success: false,
        message:
          "Staff name is required",
      });
    }

    if (name.length > 100) {
      return res.status(400).json({
        success: false,
        message:
          "Staff name is too long",
      });
    }

    // ============================================================
    // CHECK STAFF BELONGS TO OWNER SHOP
    // ============================================================

    const [staffRows] =
      await db.query(
        `
        SELECT
          id,
          name,
          phone,
          role,
          status
        FROM users
        WHERE id = ?
        AND shop_id = ?
        AND role = 'staff'
        LIMIT 1
        `,
        [
          staffId,
          ownerShopId,
        ]
      );

    if (
      staffRows.length === 0
    ) {
      return res.status(404).json({
        success: false,
        message:
          "Staff not found",
      });
    }

    // ============================================================
    // UPDATE ONLY NAME
    // ============================================================

    await db.query(
      `
      UPDATE users
      SET name = ?
      WHERE id = ?
      AND shop_id = ?
      AND role = 'staff'
      `,
      [
        name,
        staffId,
        ownerShopId,
      ]
    );

    // ============================================================
    // SUCCESS
    // ============================================================

    return res.status(200).json({
      success: true,
      message:
        "Staff name updated successfully",
      name: name,
    });

  } catch (error) {
    console.error(
      "CHANGE STAFF NAME ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to change staff name",
      error: error.message,
    });
  }
};


/*
|--------------------------------------------------------------------------
| REGISTER SHOP WITH GOOGLE
|--------------------------------------------------------------------------
|
| New Google owner:
| Google Login
|      ↓
| Firebase ID Token
|      ↓
| Verify Firebase token
|      ↓
| Create Shop + Owner
|      ↓
| Create NIFORA JWT
|
*/

exports.registerGoogleShop = async (req, res) => {
  let connection;

  try {
    const {
      idToken,
      shop_name,
      owner_name,
      address,
      gst_number,
    } = req.body;

    // ============================================================
    // VALIDATION
    // ============================================================

    if (!idToken) {
      return res.status(400).json({
        success: false,
        message: "Google ID token is required",
      });
    }

    if (!shop_name || !shop_name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Shop name is required",
      });
    }

    if (!owner_name || !owner_name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Owner name is required",
      });
    }

    // ============================================================
    // VERIFY FIREBASE ID TOKEN
    // ============================================================

    const decodedToken =
      await getAuth().verifyIdToken(idToken);

    const firebaseUid = decodedToken.uid;
    const email = decodedToken.email || null;
    const googleName =
      decodedToken.name || owner_name.trim();

    if (!firebaseUid) {
      return res.status(401).json({
        success: false,
        message: "Invalid Google account",
      });
    }

    // ============================================================
    // CHECK IF GOOGLE ACCOUNT ALREADY EXISTS
    // ============================================================

    const [existingUsers] = await db.query(
      `
      SELECT
        id,
        shop_id,
        username,
        name,
        phone,
        email,
        firebase_uid,
        role,
        status
      FROM users
      WHERE firebase_uid = ?
        AND role = 'owner'
      LIMIT 1
      `,
      [firebaseUid]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "This Google account is already registered",
        is_new_user: false,
      });
    }

    // ============================================================
    // DATABASE TRANSACTION
    // ============================================================

    connection = await db.getConnection();

    await connection.beginTransaction();

    // ============================================================
    // GET ACTIVE FREE TRIAL PLAN
    // ============================================================

    const [freeTrialPlans] =
      await connection.query(
        `
        SELECT
          id,
          duration_days
        FROM subscription_plans
        WHERE plan_name = 'Free Trial'
          AND status = 'active'
        ORDER BY id ASC
        LIMIT 1
        `
      );

    if (!freeTrialPlans.length) {
      throw new Error(
        "Active Free Trial subscription plan not found"
      );
    }

    const freeTrialPlanId =
      Number(freeTrialPlans[0].id);

    const freeTrialDays =
      Number(
        freeTrialPlans[0].duration_days
      );

    if (
      !Number.isInteger(freeTrialPlanId) ||
      !Number.isInteger(freeTrialDays) ||
      freeTrialDays <= 0
    ) {
      throw new Error(
        "Invalid Free Trial plan configuration"
      );
    }

    // ============================================================
    // GET SHOP ID FROM TIDB SEQUENCE
    // ============================================================

    const [shopSequence] =
      await connection.query(
        `
        SELECT NEXT VALUE FOR shops_id_seq AS shop_id
        `
      );

    const shopId =
      Number(shopSequence[0].shop_id);

    if (!shopId) {
      throw new Error(
        "Failed to generate shop ID"
      );
    }

    // ============================================================
    // CREATE SHOP
    // ============================================================
    //
    // Google registration does NOT require mobile number.
    //
    // phone = NULL
    //
    // IMPORTANT:
    // Your shops.phone column must allow NULL.
    //
    // ============================================================

    await connection.query(
      `
      INSERT INTO shops
      (
        id,
        shop_name,
        owner_name,
        phone,
        address,
        gst_number,
        subscription_plan_id,
        subscription_status,
        subscription_end_date
      )
      VALUES (
        ?, ?, ?, NULL, ?, ?, ?,
        'active',
        DATE_ADD(
          CURRENT_DATE,
          INTERVAL ${freeTrialDays} DAY
        )
      )
      `,
      [
        shopId,
        shop_name.trim(),
        owner_name.trim(),
        address?.trim() || null,
        gst_number?.trim() || null,
        freeTrialPlanId,
      ]
    );

    // ============================================================
    // GET USER ID FROM TIDB SEQUENCE
    // ============================================================

    const [userSequence] =
      await connection.query(
        `
        SELECT NEXT VALUE FOR users_id_seq AS user_id
        `
      );

    const userId =
      Number(userSequence[0].user_id);

    if (!userId) {
      throw new Error(
        "Failed to generate user ID"
      );
    }

    // ============================================================
    // GOOGLE USERNAME
    // ============================================================
    //
    // Google account is identified by firebase_uid.
    //
    // Email is NOT used as identity.
    //
    // ============================================================

    const ownerUsername =
      email && email.trim()
        ? email.trim()
        : `google_${firebaseUid.substring(0, 12)}`;

    // ============================================================
    // RANDOM PASSWORD
    // ============================================================
    //
    // Google users don't use this password for login.
    // It exists only because users.password is NOT NULL.
    //
    // ============================================================

    const randomPassword =
      generateRandomPassword();

    const hashedPassword =
      await bcrypt.hash(
        randomPassword,
        10
      );

    // ============================================================
    // CREATE OWNER USER
    // ============================================================

    await connection.query(
      `
      INSERT INTO users
      (
        id,
        shop_id,
        username,
        name,
        password,
        role,
        status,
        phone,
        email,
        firebase_uid
      )
      VALUES (
        ?, ?, ?, ?, ?,
        'owner',
        'active',
        NULL,
        ?,
        ?
      )
      `,
      [
        userId,
        shopId,
        ownerUsername,
        googleName,
        hashedPassword,
        email,
        firebaseUid,
      ]
    );

    // ============================================================
    // COMMIT
    // ============================================================

    await connection.commit();

    // ============================================================
    // CREATE NIFORA JWT
    // ============================================================

    const user = {
      id: userId,
      shop_id: shopId,
      role: "owner",
    };

    const token = createToken(user);

    // ============================================================
    // RESPONSE
    // ============================================================

    return res.status(201).json({
      success: true,
      is_new_user: true,
      message:
        "Google shop registered successfully",

      token,

      user: {
        id: userId,
        shop_id: shopId,
        username: ownerUsername,
        name: googleName,
        phone: null,
        email: email,
        firebase_uid: firebaseUid,
        role: "owner",
      },

      shop: {
        id: shopId,
        shop_name: shop_name.trim(),
        owner_name: owner_name.trim(),
        phone: null,
        address:
          address?.trim() || null,
        gst_number:
          gst_number?.trim() || null,
        subscription_plan_id:
          freeTrialPlanId,
        subscription_status: "active",
      },
    });
  } catch (error) {
    // ============================================================
    // ROLLBACK
    // ============================================================

    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "GOOGLE REGISTER ROLLBACK ERROR:",
          rollbackError
        );
      }
    }

    console.error(
      "GOOGLE SHOP REGISTRATION ERROR CODE:",
      error?.code
    );

    console.error(
      "GOOGLE SHOP REGISTRATION ERROR MESSAGE:",
      error?.message
    );

    console.error(
      "GOOGLE SHOP REGISTRATION ERROR FULL:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Google shop registration failed",
      error_code:
        error?.code || null,
      error_message:
        error?.message || null,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }

  /*
|--------------------------------------------------------------------------
| STAFF LOGIN - USERNAME + PASSWORD
|--------------------------------------------------------------------------
*/

exports.staffLogin = async (req, res) => {
  try {
    // ============================================================
    // GET INPUT
    // ============================================================

    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    // ============================================================
    // VALIDATION
    // ============================================================

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    // ============================================================
    // FIND STAFF
    // ============================================================

    const [users] = await db.query(
      `
      SELECT
        id,
        shop_id,
        username,
        name,
        password,
        phone,
        role,
        status
      FROM users
      WHERE LOWER(username) = LOWER(?)
        AND role = 'staff'
      LIMIT 1
      `,
      [username]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    const staff = users[0];

    // ============================================================
    // CHECK STATUS
    // ============================================================

    if (staff.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "Staff account is inactive",
      });
    }

    // ============================================================
    // CHECK PASSWORD
    // ============================================================

    const passwordValid = await bcrypt.compare(
      password,
      staff.password
    );

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password",
      });
    }

    // ============================================================
    // CHECK SHOP
    // ============================================================

    const [shops] = await db.query(
      `
      SELECT
        id,
        shop_name,
        owner_name,
        phone,
        address,
        gst_number,
        subscription_plan_id,
        subscription_status,
        subscription_end_date
      FROM shops
      WHERE id = ?
      LIMIT 1
      `,
      [staff.shop_id]
    );

    const shop = shops[0];

    if (!shop) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    // ============================================================
    // CHECK SUBSCRIPTION
    // ============================================================

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let subscriptionExpired = false;

    if (shop.subscription_status !== "active") {
      subscriptionExpired = true;
    }

    if (shop.subscription_end_date) {
      const endDate = new Date(shop.subscription_end_date);
      endDate.setHours(0, 0, 0, 0);

      if (endDate < today) {
        subscriptionExpired = true;
      }
    } else {
      subscriptionExpired = true;
    }

    // ============================================================
    // CREATE NIFORA JWT
    // ============================================================

    const token = createToken({
      id: staff.id,
      shop_id: staff.shop_id,
      role: "staff",
    });

    // ============================================================
    // SUCCESS
    // ============================================================

    return res.json({
      success: true,
      message: "Staff login successful",

      token,

      subscription_expired: subscriptionExpired,

      user: {
        id: staff.id,
        shop_id: staff.shop_id,
        username: staff.username,
        name: staff.name,
        phone: staff.phone,
        role: "staff",
      },

      shop: {
        id: shop.id,
        shop_name: shop.shop_name,
        owner_name: shop.owner_name,
        phone: shop.phone,
        address: shop.address,
        gst_number: shop.gst_number,
        subscription_plan_id: shop.subscription_plan_id,
        subscription_status: shop.subscription_status,
        subscription_end_date: shop.subscription_end_date,
      },
    });

  } catch (error) {
    console.error("STAFF LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Staff login failed",
      error: error.message,
    });
  }
};
};
