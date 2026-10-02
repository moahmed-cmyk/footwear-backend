const db = require("../config/db");

const getShops = async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        s.id,
        s.shop_name,
        COALESCE(u.name, s.owner_name) AS owner_name,
        COALESCE(u.phone, s.phone) AS phone,
        u.email,
        s.address,
        s.gst_number,
        s.subscription_status,
        s.subscription_end_date,
        s.subscription_plan_id,
        s.created_at
      FROM shops s
      LEFT JOIN users u
        ON u.shop_id = s.id
        AND u.role = 'owner'
      ORDER BY s.created_at DESC
    `);

    return res.status(200).json({
      success: true,
      count: rows.length,
      data: rows,
    });
  } catch (error) {
    console.error("ADMIN SHOPS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load shops",
    });
  }
};

module.exports = {
  getShops,
};