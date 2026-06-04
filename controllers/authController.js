const db = require("../config/db");
const bcrypt = require("bcryptjs");

exports.registerShop = async (req, res) => {
  try {
    const {
      shop_name,
      owner_name,
      username,
      password,
    } = req.body;

    const [shopResult] = await db.query(
      `INSERT INTO shops
      (shop_name, owner_name)
      VALUES (?, ?)`,
      [shop_name, owner_name]
    );

    const shopId = shopResult.insertId;

    const hashedPassword =
      await bcrypt.hash(password, 10);

    await db.query(
      `INSERT INTO users
      (shop_id, username, password, role)
      VALUES (?, ?, ?, ?)`,
      [
        shopId,
        username,
        hashedPassword,
        "owner",
      ]
    );

    res.json({
      success: true,
      message: "Shop Registered",
      shopId,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};