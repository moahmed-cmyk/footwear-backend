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

    const todayDateSql = `
      DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) =
      DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE))
    `;

    const yesterdayDateSql = `
      DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) =
      DATE(DATE_SUB(DATE_ADD(NOW(), INTERVAL 330 MINUTE), INTERVAL 1 DAY))
    `;

    const billTodayDateSql = `
      DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) =
      DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE))
    `;

    const billYesterdayDateSql = `
      DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) =
      DATE(DATE_SUB(DATE_ADD(NOW(), INTERVAL 330 MINUTE), INTERVAL 1 DAY))
    `;

    const [todayRows] = await db.query(
      `
      SELECT
        COALESCE(SUM(total), 0) AS sales,
        COUNT(*) AS bills
      FROM bills
      WHERE shop_id = ?
      AND ${todayDateSql}
      `,
      [shopId]
    );

    const [yesterdayRows] = await db.query(
      `
      SELECT
        COALESCE(SUM(total), 0) AS sales,
        COUNT(*) AS bills
      FROM bills
      WHERE shop_id = ?
      AND ${yesterdayDateSql}
      `,
      [shopId]
    );

    const [todayProfitRows] = await db.query(
      `
      SELECT COALESCE(SUM(bi.profit), 0) AS profit
      FROM bill_items bi
      INNER JOIN bills b ON b.id = bi.bill_id
      WHERE b.shop_id = ?
      AND ${billTodayDateSql}
      `,
      [shopId]
    );

    const [yesterdayProfitRows] = await db.query(
      `
      SELECT COALESCE(SUM(bi.profit), 0) AS profit
      FROM bill_items bi
      INNER JOIN bills b ON b.id = bi.bill_id
      WHERE b.shop_id = ?
      AND ${billYesterdayDateSql}
      `,
      [shopId]
    );

    const [lowStockRows] = await db.query(
      `
      SELECT COUNT(*) AS count
      FROM products
      WHERE shop_id = ?
      AND CAST(stock AS UNSIGNED) <= 5
      `,
      [shopId]
    );

    const [recentBills] = await db.query(
      `
      SELECT id, customer_name, total, created_at
      FROM bills
      WHERE shop_id = ?
      ORDER BY created_at DESC
      LIMIT 3
      `,
      [shopId]
    );

    const [lowStockList] = await db.query(
      `
      SELECT id, name, stock
      FROM products
      WHERE shop_id = ?
      AND CAST(stock AS UNSIGNED) <= 5
      ORDER BY CAST(stock AS UNSIGNED) ASC
      LIMIT 3
      `,
      [shopId]
    );

    const [chartRows] = await db.query(
      `
      SELECT
        HOUR(DATE_ADD(created_at, INTERVAL 330 MINUTE)) AS hour,
        COALESCE(SUM(total), 0) AS sales
      FROM bills
      WHERE shop_id = ?
      AND ${todayDateSql}
      GROUP BY HOUR(DATE_ADD(created_at, INTERVAL 330 MINUTE))
      ORDER BY hour ASC
      `,
      [shopId]
    );

    const todaySales = Number(todayRows[0].sales || 0);
    const yesterdaySales = Number(yesterdayRows[0].sales || 0);

    const todayBills = Number(todayRows[0].bills || 0);
    const yesterdayBills = Number(yesterdayRows[0].bills || 0);

    const todayProfit = Number(todayProfitRows[0].profit || 0);
    const yesterdayProfit = Number(yesterdayProfitRows[0].profit || 0);

    return res.json({
      success: true,
      data: {
        todaySales,
        todayBills,
        netProfit: todayProfit,
        lowStockItems: Number(lowStockRows[0].count || 0),

        salesGrowth: percentChange(todaySales, yesterdaySales),
        billsGrowth: percentChange(todayBills, yesterdayBills),
        profitGrowth: percentChange(todayProfit, yesterdayProfit),

        recentBills: recentBills.map((b) => ({
          id: b.id,
          invoiceNo: `INV-${b.id}`,
          customerName: b.customer_name || "Walk-in Customer",
          total: Number(b.total || 0),
          time: new Date(b.created_at).toLocaleTimeString("en-IN", {
            hour: "2-digit",
            minute: "2-digit",
          }),
        })),

        lowStockList: lowStockList.map((p) => ({
          id: p.id,
          name: p.name || "Product",
          stock: Number(p.stock || 0),
        })),

        chart: chartRows.map((c) => ({
          hour: Number(c.hour),
          sales: Number(c.sales || 0),
        })),
      },
    });
  } catch (error) {
    console.error("Dashboard V2 Error:", error);
    return res.status(500).json({
      success: false,
      message: "Dashboard data fetch failed",
      error: error.message,
    });
  }
};