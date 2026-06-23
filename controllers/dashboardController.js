const db = require("../config/db");

exports.getDashboardV2 = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;

    const [todayRows] = await db.query(
      `
      SELECT 
        COALESCE(SUM(total), 0) AS todaySales,
        COUNT(*) AS todayBills
      FROM bills
      WHERE shop_id = ?
      AND DATE(created_at) = CURDATE()
      `,
      [shop_id]
    );

    const [yesterdayRows] = await db.query(
      `
      SELECT COALESCE(SUM(total), 0) AS yesterdaySales
      FROM bills
      WHERE shop_id = ?
      AND DATE(created_at) = DATE_SUB(CURDATE(), INTERVAL 1 DAY)
      `,
      [shop_id]
    );

    const [profitRows] = await db.query(
      `
      SELECT COALESCE(SUM(bi.profit), 0) AS netProfit
      FROM bill_items bi
      INNER JOIN bills b ON b.id = bi.bill_id
      WHERE b.shop_id = ?
      AND DATE(b.created_at) = CURDATE()
      `,
      [shop_id]
    );

    const [lowStockCountRows] = await db.query(
      `
      SELECT COUNT(*) AS lowStockItems
      FROM products
      WHERE shop_id = ?
      AND CAST(stock AS UNSIGNED) <= 5
      `,
      [shop_id]
    );

    const [recentBills] = await db.query(
      `
      SELECT 
        id,
        customer_name,
        total,
        DATE_FORMAT(created_at, '%h:%i %p') AS bill_time
      FROM bills
      WHERE shop_id = ?
      ORDER BY created_at DESC
      LIMIT 3
      `,
      [shop_id]
    );

    const [lowStockList] = await db.query(
      `
      SELECT 
        id,
        name,
        brand,
        size,
        stock
      FROM products
      WHERE shop_id = ?
      AND CAST(stock AS UNSIGNED) <= 5
      ORDER BY CAST(stock AS UNSIGNED) ASC
      LIMIT 3
      `,
      [shop_id]
    );

    const [chartRows] = await db.query(
      `
      SELECT 
        HOUR(created_at) AS hour,
        COALESCE(SUM(total), 0) AS sales
      FROM bills
      WHERE shop_id = ?
      AND DATE(created_at) = CURDATE()
      GROUP BY HOUR(created_at)
      ORDER BY hour ASC
      `,
      [shop_id]
    );

    const todaySales = Number(todayRows[0].todaySales || 0);
    const yesterdaySales = Number(yesterdayRows[0].yesterdaySales || 0);

    let salesGrowth = 0;
    if (yesterdaySales > 0) {
      salesGrowth = ((todaySales - yesterdaySales) / yesterdaySales) * 100;
    }

    return res.json({
      success: true,
      data: {
        todaySales,
        todayBills: Number(todayRows[0].todayBills || 0),
        netProfit: Number(profitRows[0].netProfit || 0),
        lowStockItems: Number(lowStockCountRows[0].lowStockItems || 0),
        salesGrowth: Number(salesGrowth.toFixed(1)),

        recentBills: recentBills.map((bill) => ({
          id: bill.id,
          invoiceNo: `INV-${String(bill.id).padStart(3, "0")}`,
          customerName: bill.customer_name || "Walk-in Customer",
          total: Number(bill.total || 0),
          time: bill.bill_time || "",
        })),

        lowStockList: lowStockList.map((item) => ({
          id: item.id,
          name: item.name,
          brand: item.brand,
          size: item.size,
          stock: Number(item.stock || 0),
        })),

        chart: chartRows.map((item) => ({
          hour: Number(item.hour),
          sales: Number(item.sales || 0),
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