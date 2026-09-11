const db = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

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

// Generate random password because users.password is currently NOT NULL
const generateRandomPassword = () => {
  return crypto.randomBytes(32).toString("hex");
};

/*
|--------------------------------------------------------------------------
| CREATE JWT TOKEN
|--------------------------------------------------------------------------
|
| IMPORTANT:
| Existing NIFORA APIs use:
| req.user.user_id
| req.user.shop_id
| req.user.role
|
| So we MUST keep these exact names.
|
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
| SEND OTP
|--------------------------------------------------------------------------
|
| Supported purposes:
|
| register_owner
| owner_login
| staff_login
| staff_invite
|
*/

exports.sendOtp = async (req, res) => {
  try {
    const {
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
      "register_owner",
      "owner_login",
      "staff_login",
      "staff_invite",
    ];

    if (!allowedPurposes.includes(purpose)) {
      return res.status(400).json({
        success: false,
        message: "Invalid OTP purpose",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | Find Existing User
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

    const existingUser = users[0];

    /*
    |--------------------------------------------------------------------------
    | OWNER LOGIN
    |--------------------------------------------------------------------------
    */

    if (purpose === "owner_login") {
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

    if (purpose === "staff_login") {
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
          message: "Staff account is disabled or not verified",
        });
      }
    }

    /*
    |--------------------------------------------------------------------------
    | NEW OWNER REGISTRATION
    |--------------------------------------------------------------------------
    */

    if (
      purpose === "register_owner" &&
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
      [
        normalizedPhone,
        purpose,
      ]
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
        purpose,
        expiresAt,
      ]
    );

    /*
    |--------------------------------------------------------------------------
    | DEVELOPMENT OTP
    |--------------------------------------------------------------------------
    |
    | For now SMS provider is NOT connected.
    |
    | Development:
    | OTP will appear in terminal and response.
    |
    | Production:
    | We will connect MSG91 / Twilio / another SMS provider.
    |
    */

    console.log(
      `NIFORA OTP | ${normalizedPhone} | ${purpose} | ${otp}`
    );

    const response = {
      success: true,
      message: "OTP sent successfully",
    };

    // Only expose OTP outside production
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
    | COMPARE OTP
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
    | OWNER REGISTRATION OTP
    |--------------------------------------------------------------------------
    */

    if (
      purpose === "register_owner"
    ) {
      return res.json({
        success: true,
        verified: true,
        message:
          "Mobile number verified successfully",
        phone: normalizedPhone,
      });
    }

    /*
    |--------------------------------------------------------------------------
    | STAFF INVITATION OTP
    |--------------------------------------------------------------------------
    */

    if (
      purpose === "staff_invite"
    ) {
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
    | LOGIN USER
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
    | CHECK SUBSCRIPTION
    |--------------------------------------------------------------------------
    */

    const today = new Date();

    const endDate =
      shop.subscription_end_date
        ? new Date(
            shop.subscription_end_date
          )
        : null;

    if (
      shop.subscription_status !== "active" ||
      (endDate && endDate < today)
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Subscription expired. Please renew your plan.",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CREATE JWT
    |--------------------------------------------------------------------------
    */

    const token =
      createToken(user);

    /*
    |--------------------------------------------------------------------------
    | LOGIN RESPONSE
    |--------------------------------------------------------------------------
    */

    return res.json({
      success: true,
      message: "Login successful",

      token,

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
    |
    | Phone + OTP is the login method.
    | Existing password column is NOT NULL,
    | so we store a random hashed password.
    |
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
    | CREATE SHOP
    |--------------------------------------------------------------------------
    */

    const [shopResult] =
      await connection.query(
        `
        INSERT INTO shops
        (
          shop_name,
          owner_name,
          phone,
          address,
          gst_number
        )
        VALUES (?, ?, ?, ?, ?)
        `,
        [
          shop_name.trim(),
          owner_name.trim(),
          normalizedPhone,
          address || null,
          gst_number || null,
        ]
      );

    const shopId =
      shopResult.insertId;

    /*
    |--------------------------------------------------------------------------
    | CREATE OWNER USER
    |--------------------------------------------------------------------------
    */

    const [userResult] =
      await connection.query(
        `
        INSERT INTO users
        (
          shop_id,
          username,
          password,
          role,
          status,
          phone
        )
        VALUES (?, ?, ?, 'owner', 'active', ?)
        `,
        [
          shopId,
          ownerUsername,
          hashedPassword,
          normalizedPhone,
        ]
      );

    await connection.commit();

    /*
    |--------------------------------------------------------------------------
    | CREATE TOKEN
    |--------------------------------------------------------------------------
    */

    const user = {
      id: userResult.insertId,
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
        id: userResult.insertId,
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

exports.addStaff = async (
  req,
  res
) => {
  try {
    /*
    |--------------------------------------------------------------------------
    | OWNER CHECK
    |--------------------------------------------------------------------------
    */

    if (
      (req.user.role || "").toLowerCase() !==
      "owner"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only shop owner can add staff",
      });
    }

    const {
      staff_name,
      phone,
      username,
    } = req.body;

    const normalizedPhone =
      normalizePhone(phone);

    if (
      !staff_name ||
      !normalizedPhone
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Staff name and phone are required",
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
    | CHECK PHONE
    |--------------------------------------------------------------------------
    */

    const [existingUsers] =
      await db.query(
        `
        SELECT
          id,
          shop_id,
          role,
          status
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
          "This mobile number is already linked to an account",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | USERNAME
    |--------------------------------------------------------------------------
    */

    const staffUsername =
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
    | CREATE STAFF
    |--------------------------------------------------------------------------
    |
    | Inactive until staff verifies OTP.
    |
    */

    const [result] =
      await db.query(
        `
        INSERT INTO users
        (
          shop_id,
          username,
          password,
          role,
          status,
          phone
        )
        VALUES (?, ?, ?, 'staff', 'inactive', ?)
        `,
        [
          req.user.shop_id,
          staffUsername,
          hashedPassword,
          normalizedPhone,
        ]
      );

    /*
    |--------------------------------------------------------------------------
    | CREATE STAFF INVITATION OTP
    |--------------------------------------------------------------------------
    */

    const otp =
      generateOtp();

    const otpHash =
      await bcrypt.hash(
        otp,
        10
      );

    const expiresAt =
      new Date(
        Date.now() +
          5 * 60 * 1000
      );

    await db.query(
      `
      DELETE FROM otp_verifications
      WHERE phone = ?
      AND purpose = 'staff_invite'
      `,
      [normalizedPhone]
    );

    await db.query(
      `
      INSERT INTO otp_verifications
      (
        phone,
        otp_hash,
        purpose,
        expires_at
      )
      VALUES (?, ?, 'staff_invite', ?)
      `,
      [
        normalizedPhone,
        otpHash,
        expiresAt,
      ]
    );

    /*
    |--------------------------------------------------------------------------
    | DEVELOPMENT OTP
    |--------------------------------------------------------------------------
    */

    console.log(
      `NIFORA STAFF INVITE OTP | ${normalizedPhone} | ${otp}`
    );

    const response = {
      success: true,
      message:
        "Staff created. OTP sent to staff mobile number",
      staff_id: result.insertId,
    };

    if (
      process.env.NODE_ENV !==
      "production"
    ) {
      response.devOtp = otp;
    }

    return res.status(201).json(
      response
    );
  } catch (error) {
    console.error(
      "ADD STAFF ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to add staff",
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| VERIFY STAFF INVITATION
|--------------------------------------------------------------------------
|
| Staff uses OTP received after owner adds them.
|
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