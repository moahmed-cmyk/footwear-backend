const db = require("../config/db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

// ============================================================
// ADMIN LOGIN
// ============================================================

exports.adminLogin = async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    // --------------------------------------------------------
    // VALIDATION
    // --------------------------------------------------------

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required",
      });
    }

    // --------------------------------------------------------
    // FIND ADMIN
    // --------------------------------------------------------

    const [admins] = await db.query(
      `
      SELECT
        id,
        username,
        password_hash,
        name,
        is_active
      FROM admin_users
      WHERE LOWER(username) = LOWER(?)
      LIMIT 1
      `,
      [username]
    );

    if (admins.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin username or password",
      });
    }

    const admin = admins[0];

    // --------------------------------------------------------
    // CHECK STATUS
    // --------------------------------------------------------

    if (!admin.is_active) {
      return res.status(403).json({
        success: false,
        message: "Admin account is inactive",
      });
    }

    // --------------------------------------------------------
    // CHECK PASSWORD
    // --------------------------------------------------------

    const passwordValid = await bcrypt.compare(
      password,
      admin.password_hash
    );

    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        message: "Invalid admin username or password",
      });
    }

    // --------------------------------------------------------
    // CREATE ADMIN JWT
    // --------------------------------------------------------

    const token = jwt.sign(
      {
        admin_id: admin.id,
        role: "admin",
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    // --------------------------------------------------------
    // SUCCESS
    // --------------------------------------------------------

    return res.status(200).json({
      success: true,
      message: "Admin login successful",
      token,
      admin: {
        id: admin.id,
        username: admin.username,
        name: admin.name,
        role: "admin",
      },
    });
  } catch (error) {
    console.error("ADMIN LOGIN ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server error during admin login",
    });
  }
};