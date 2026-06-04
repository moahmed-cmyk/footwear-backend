const express = require("express");
const router = express.Router();

router.post("/register-shop", async (req, res) => {
  try {
    const {
      shop_name,
      owner_name,
      username,
      password,
    } = req.body;

    return res.json({
      success: true,
      message: "Shop Registered",
      data: {
        shop_name,
        owner_name,
        username,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;