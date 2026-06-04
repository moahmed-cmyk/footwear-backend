const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./config/db");
const verifyToken = require("./middleware/authMiddleware");
const productRoutes = require("./routes/productRoutes");
const billRoutes = require("./routes/billRoutes");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());
app.use("/", productRoutes);
app.use("/", billRoutes);

// Test API
app.get("/", async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT NOW() as serverTime"
    );

    res.json({
      success: true,
      database: "Connected",
      time: rows[0].serverTime,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Register Shop + Owner
app.post("/register-shop", async (req, res) => {
  const connection = await db.getConnection();

  try {
    const {
      shop_name,
      owner_name,
      phone,
      address,
      gst_number,
      username,
      password,
    } = req.body;

    if (!shop_name || !owner_name || !username || !password) {
      return res.status(400).json({
        success: false,
        message:
          "Shop name, owner name, username and password are required",
      });
    }

    await connection.beginTransaction();

    const [shopResult] = await connection.query(
      `INSERT INTO shops 
       (shop_name, owner_name, phone, address, gst_number)
       VALUES (?, ?, ?, ?, ?)`,
      [
        shop_name,
        owner_name,
        phone || "",
        address || "",
        gst_number || "",
      ]
    );

    const shopId = shopResult.insertId;

    const hashedPassword = await bcrypt.hash(password, 10);

    await connection.query(
      `INSERT INTO users 
       (shop_id, username, password, role)
       VALUES (?, ?, ?, ?)`,
      [shopId, username, hashedPassword, "owner"]
    );

    await connection.commit();

    res.json({
      success: true,
      message: "Shop and owner created successfully",
      data: {
        shop_id: shopId,
        shop_name,
        owner_name,
        username,
        role: "owner",
      },
    });
  } catch (error) {
    await connection.rollback();

    res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    connection.release();
  }
});

app.post(
  "/products",
  verifyToken,
  async (req, res) => {
    try {
      const {
        barcode,
        name,
        size,
        mrp,
        buying_price,
        stock,
      } = req.body;

      const shopId = req.user.shop_id;

      const [result] = await db.query(
        `INSERT INTO products
        (
          shop_id,
          barcode,
          name,
          size,
          mrp,
          buying_price,
          stock
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          shopId,
          barcode || "",
          name,
          size || "",
          mrp || 0,
          buying_price || 0,
          stock || 0,
        ]
      );

      res.json({
        success: true,
        message: "Product Added",
        product_id: result.insertId,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

app.get(
  "/products",
  verifyToken,
  async (req, res) => {
    try {
      const shopId = req.user.shop_id;

      const [products] = await db.query(
        `SELECT *
         FROM products
         WHERE shop_id = ?
         ORDER BY id DESC`,
        [shopId]
      );

      res.json({
        success: true,
        count: products.length,
        products,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  }
);

// Login API
app.post("/login", async (req, res) => {
  try {
    const { shop_id, username, password } = req.body;

    if (!shop_id || !username || !password) {
      return res.status(400).json({
        success: false,
        message: "shop_id, username and password are required",
      });
    }

    const [users] = await db.query(
      `SELECT 
        u.id,
        u.shop_id,
        u.username,
        u.password,
        u.role,
        s.shop_name
       FROM users u
       INNER JOIN shops s ON s.id = u.shop_id
       WHERE u.shop_id = ? AND u.username = ?
       LIMIT 1`,
      [shop_id, username]
    );

    if (users.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or shop",
      });
    }

    const user = users[0];

    const isMatch = await bcrypt.compare(
      password,
      user.password
    );

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid password",
      });
    }

    const token = jwt.sign(
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

    res.json({
      success: true,
      message: "Login successful",
      token,
      user: {
        id: user.id,
        shop_id: user.shop_id,
        shop_name: user.shop_name,
        username: user.username,
        role: user.role,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});