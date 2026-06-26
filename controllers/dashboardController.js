const db = require("../config/db");

function percentChange(current, previous) {
  current = Number(current || 0);
  previous = Number(previous || 0);

  if (previous === 0 && current > 0) return 100;
  if (previous === 0 && current === 0) return 0;

  return Number((((current - previous) / previous) * 100).toFixed(1));
}

function normalizeFilter(filter) {
  if (filter === "month") return "month";
  if (filter === "custom") return "custom";
  return "today";
}

function buildCurrentRange(filter, startDate, endDate) {
  if (filter === "month") {
    return {
      billWhere: `
        DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) >= DATE_FORMAT(DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)), '%Y-%m-01')
        AND DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) <= DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE))
      `,
      itemWhere: `
        DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) >= DATE_FORMAT(DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)), '%Y-%m-01')
        AND DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) <= DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE))
      `,
      params: [],
    };
  }

  if (filter === "custom" && startDate && endDate) {
    return {
      billWhere: `DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) BETWEEN ? AND ?`,
      itemWhere: `DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) BETWEEN ? AND ?`,
      params: [startDate, endDate],
    };
  }

  return {
    billWhere: `
      DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) = DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE))
    `,
    itemWhere: `
      DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) = DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE))
    `,
    params: [],
  };
}

function buildPreviousRange(filter, startDate, endDate) {
  if (filter === "month") {
    return {
      billWhere: `
        DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) >= DATE_FORMAT(DATE_SUB(DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)), INTERVAL 1 MONTH), '%Y-%m-01')
        AND DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) < DATE_FORMAT(DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)), '%Y-%m-01')
      `,
      itemWhere: `
        DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) >= DATE_FORMAT(DATE_SUB(DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)), INTERVAL 1 MONTH), '%Y-%m-01')
        AND DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) < DATE_FORMAT(DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)), '%Y-%m-01')
      `,
      params: [],
    };
  }

  if (filter === "custom" && startDate && endDate) {
    return {
      billWhere: `
        DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE))
        BETWEEN DATE_SUB(?, INTERVAL DATEDIFF(?, ?) + 1 DAY)
        AND DATE_SUB(?, INTERVAL 1 DAY)
      `,
      itemWhere: `
        DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE))
        BETWEEN DATE_SUB(?, INTERVAL DATEDIFF(?, ?) + 1 DAY)
        AND DATE_SUB(?, INTERVAL 1 DAY)
      `,
      params: [startDate, endDate, startDate, startDate],
    };
  }

  return {
    billWhere: `
      DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) = DATE_SUB(DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)), INTERVAL 1 DAY)
    `,
    itemWhere: `
      DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) = DATE_SUB(DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)), INTERVAL 1 DAY)
    `,
    params: [],
  };
}

exports.getDashboardV2 = async (req, res) => {
  try {
    const shopId = req.user.shop_id;
    const filter = normalizeFilter(req.query.filter);
    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const current = buildCurrentRange(filter, startDate, endDate);
    const previous = buildPreviousRange(filter, startDate, endDate);

    const [currentRows] = await db.query(
      `
      SELECT COALESCE(SUM(total), 0) AS sales, COUNT(*) AS bills
      FROM bills
      WHERE shop_id = ? AND ${current.billWhere}
      `,
      [shopId, ...current.params]
    );

    const [previousRows] = await db.query(
      `
      SELECT COALESCE(SUM(total), 0) AS sales, COUNT(*) AS bills
      FROM bills
      WHERE shop_id = ? AND ${previous.billWhere}
      `,
      [shopId, ...previous.params]
    );

    const [currentProfitRows] = await db.query(
      `
      SELECT COALESCE(SUM(bi.profit), 0) AS profit
      FROM bill_items bi
      INNER JOIN bills b ON b.id = bi.bill_id
      WHERE b.shop_id = ? AND ${current.itemWhere}
      `,
      [shopId, ...current.params]
    );

    const [previousProfitRows] = await db.query(
      `
      SELECT COALESCE(SUM(bi.profit), 0) AS profit
      FROM bill_items bi
      INNER JOIN bills b ON b.id = bi.bill_id
      WHERE b.shop_id = ? AND ${previous.itemWhere}
      `,
      [shopId, ...previous.params]
    );

    const [lowStockRows] = await db.query(
      `
      SELECT COUNT(*) AS count
      FROM products
      WHERE shop_id = ? AND CAST(stock AS UNSIGNED) <= 5
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

const chartSelect =
  filter === "today"
    ? `
      HOUR(DATE_ADD(created_at, INTERVAL 330 MINUTE)) AS hour,
      MIN(DATE_FORMAT(DATE_ADD(created_at, INTERVAL 330 MINUTE), '%h %p')) AS label
    `
    : `
      NULL AS hour,
      MIN(DATE_FORMAT(DATE_ADD(created_at, INTERVAL 330 MINUTE), '%d %b')) AS label
    `;

    const chartGroup =
      filter === "today"
        ? `HOUR(DATE_ADD(created_at, INTERVAL 330 MINUTE))`
        : `DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE))`;

    const [chartRows] = await db.query(
      `
      SELECT
        ${chartSelect},
        COALESCE(SUM(total), 0) AS sales
      FROM bills
      WHERE shop_id = ? AND ${current.billWhere}
      GROUP BY ${chartGroup}
      ORDER BY ${chartGroup} ASC
      `,
      [shopId, ...current.params]
    );

    const currentSales = Number(currentRows[0].sales || 0);
    const previousSales = Number(previousRows[0].sales || 0);

    const currentBills = Number(currentRows[0].bills || 0);
    const previousBills = Number(previousRows[0].bills || 0);

    const currentProfit = Number(currentProfitRows[0].profit || 0);
    const previousProfit = Number(previousProfitRows[0].profit || 0);

    return res.json({
      success: true,
      data: {
        filter,
        startDate: filter === "custom" ? startDate : null,
        endDate: filter === "custom" ? endDate : null,

        todaySales: currentSales,
        todayBills: currentBills,
        netProfit: currentProfit,
        lowStockItems: Number(lowStockRows[0].count || 0),

        salesGrowth: percentChange(currentSales, previousSales),
        billsGrowth: percentChange(currentBills, previousBills),
        profitGrowth: percentChange(currentProfit, previousProfit),

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
          hour: c.hour === null ? null : Number(c.hour),
          label: c.label?.toString() || "",
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