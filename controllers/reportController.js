exports.staffPerformance = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;

    const [rows] = await db.query(
      `SELECT
          u.id,
          u.username,
          COUNT(b.id) as total_bills,
          COALESCE(SUM(b.total),0) as total_sales,
          COALESCE(SUM(bi.profit),0) as total_profit
       FROM users u
       LEFT JOIN bills b
          ON b.created_by = u.id
          AND b.shop_id = ?
       LEFT JOIN bill_items bi
          ON bi.bill_id = b.id
       WHERE u.shop_id = ?
       GROUP BY u.id, u.username
       ORDER BY total_sales DESC`,
      [shop_id, shop_id]
    );

    res.json({
      success: true,
      staff: rows,
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};