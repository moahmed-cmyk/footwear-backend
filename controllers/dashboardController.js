const db = require("../config/db");

function percentChange(today, yesterday) {
  today = Number(today || 0);
  yesterday = Number(yesterday || 0);

  if (yesterday === 0 && today > 0) return 100;
  if (yesterday === 0 && today === 0) return 0;

  return Number((((today - yesterday) / yesterday) * 100).toFixed(1));
}

exports.getDashboardV2 = async (req, res) => {
  try {
    const shopId = req.user.shop_id;

    const [today] = await db.query(`
      SELECT
        COALESCE(SUM(total),0) AS sales,
        COUNT(*) AS bills,
        COALESCE(SUM(discount),0) AS discount
      FROM bills
      WHERE shop_id = ?
      AND DATE(created_at) = CURDATE()
    `, [shopId]);

    const [yesterday] = await db.query(`
      SELECT
        COALESCE(SUM(total),0) AS sales,
        COUNT(*) AS bills
      FROM bills
      WHERE shop_id = ?
      AND DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
    `, [shopId]);

    const [todayProfit] = await db.query(`
      SELECT COALESCE(SUM(bi.profit),0) AS profit
      FROM bill_items bi
      INNER JOIN bills b ON b.id = bi.bill_id
      WHERE b.shop_id = ?
      AND DATE(b.created_at) = CURDATE()
    `, [shopId]);

    const [yesterdayProfit] = await db.query(`
      SELECT COALESCE(SUM(bi.profit),0) AS profit
      FROM bill_items bi
      INNER JOIN bills b ON b.id = bi.bill_id
      WHERE b.shop_id = ?
      AND DATE(b.created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
    `, [shopId]);

    const [lowStock] = await db.query(`
      SELECT COUNT(*) AS count
      FROM products
      WHERE shop_id = ?
      AND stock <= 5
    `, [shopId]);

    const [recentBills] = await db.query(`
      SELECT id, customer_name, total, created_at
      FROM bills
      WHERE shop_id = ?
      ORDER BY id DESC
      LIMIT 3
    `, [shopId]);

    const [lowStockList] = await db.query(`
      SELECT id, name, stock
      FROM products
      WHERE shop_id = ?
      AND stock <= 5
      ORDER BY stock ASC
      LIMIT 3
    `, [shopId]);

    const [chartRows] = await db.query(`
      SELECT HOUR(created_at) AS hour, COALESCE(SUM(total),0) AS sales
      FROM bills
      WHERE shop_id = ?
      AND DATE(created_at) = CURDATE()
      GROUP BY HOUR(created_at)
      ORDER BY hour ASC
    `, [shopId]);

    res.json({
      success: true,
      data: {
        todaySales: Number(today[0].sales || 0),
        todayBills: Number(today[0].bills || 0),
        netProfit: Number(todayProfit[0].profit || 0),
        lowStockItems: Number(lowStock[0].count || 0),

        salesGrowth: percentChange(today[0].sales, yesterday[0].sales),
        billsGrowth: percentChange(today[0].bills, yesterday[0].bills),
        profitGrowth: percentChange(todayProfit[0].profit, yesterdayProfit[0].profit),

        recentBills: recentBills.map(b => ({
          id: b.id,
          invoiceNo: `INV-${b.id}`,
          customerName: b.customer_name || "Walk-in Customer",
          total: Number(b.total || 0),
          time: new Date(b.created_at).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        })),

        lowStockList: lowStockList.map(p => ({
          id: p.id,
          name: p.name,
          stock: Number(p.stock || 0),
        })),

        chart: chartRows.map(c => ({
          hour: Number(c.hour),
          sales: Number(c.sales || 0),
        })),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Dashboard data fetch failed",
      error: error.message,
    });
  }
};