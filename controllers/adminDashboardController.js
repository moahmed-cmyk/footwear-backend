const db = require("../config/db"); // unga DB connection file path verify pannunga

const getDashboardStats = async (req, res) => {
  try {
    const [[shopStats]] = await db.query(`
      SELECT
        COUNT(*) AS totalShops,
        SUM(
          CASE
            WHEN subscription_status = 'active'
              AND subscription_plan_id <> 3
              AND subscription_end_date >= CURDATE()
            THEN 1 ELSE 0
          END
        ) AS activeSubscriptions,
        SUM(
          CASE
            WHEN subscription_plan_id = 3
            THEN 1 ELSE 0
          END
        ) AS trialShops,
        SUM(
          CASE
            WHEN subscription_end_date IS NOT NULL
              AND subscription_end_date < CURDATE()
            THEN 1 ELSE 0
          END
        ) AS expired
      FROM shops
    `);

    return res.status(200).json({
      success: true,
      data: {
        totalShops: Number(shopStats.totalShops || 0),
        activeSubscriptions: Number(shopStats.activeSubscriptions || 0),
        trialShops: Number(shopStats.trialShops || 0),
        expired: Number(shopStats.expired || 0),
      },
    });
  } catch (error) {
    console.error("ADMIN DASHBOARD STATS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load dashboard statistics",
    });
  }
};

module.exports = { getDashboardStats };