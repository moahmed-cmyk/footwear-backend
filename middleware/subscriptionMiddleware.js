const db = require("../config/db");

const checkSubscription = async (req, res, next) => {
  try {
    if (!req.user || !req.user.shop_id) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const shopId = req.user.shop_id;

    const [rows] = await db.query(
      `
      SELECT
        subscription_status,
        subscription_end_date
      FROM shops
      WHERE id = ?
      LIMIT 1
      `,
      [shopId]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    const shop = rows[0];

    if (
      shop.subscription_status !== "active" ||
      !shop.subscription_end_date
    ) {
      return res.status(403).json({
        success: false,
        subscription_expired: true,
        message:
          "Your subscription has expired. Please renew your plan.",
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const endDate = new Date(shop.subscription_end_date);
    endDate.setHours(0, 0, 0, 0);

    if (endDate < today) {
      return res.status(403).json({
        success: false,
        subscription_expired: true,
        message:
          "Your subscription has expired. Please renew your plan.",
      });
    }

    next();
  } catch (error) {
    console.error(
      "SUBSCRIPTION MIDDLEWARE ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Subscription check failed",
      error: error.message,
    });
  }
};

module.exports = checkSubscription;