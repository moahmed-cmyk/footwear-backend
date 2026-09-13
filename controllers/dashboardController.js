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
        DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) >=
        DATE_FORMAT(
          DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)),
          '%Y-%m-01'
        )
        AND DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) <=
        DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE))
      `,
      itemWhere: `
        DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) >=
        DATE_FORMAT(
          DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)),
          '%Y-%m-01'
        )
        AND DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) <=
        DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE))
      `,
      params: [],
    };
  }

  if (filter === "custom" && startDate && endDate) {
    return {
      billWhere: `
        DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE))
        BETWEEN ? AND ?
      `,
      itemWhere: `
        DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE))
        BETWEEN ? AND ?
      `,
      params: [startDate, endDate],
    };
  }

  return {
    billWhere: `
      DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) =
      DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE))
    `,
    itemWhere: `
      DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) =
      DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE))
    `,
    params: [],
  };
}

function buildPreviousRange(filter, startDate, endDate) {
  if (filter === "month") {
    return {
      billWhere: `
        DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) >=
        DATE_FORMAT(
          DATE_SUB(
            DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)),
            INTERVAL 1 MONTH
          ),
          '%Y-%m-01'
        )
        AND DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) <
        DATE_FORMAT(
          DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)),
          '%Y-%m-01'
        )
      `,
      itemWhere: `
        DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) >=
        DATE_FORMAT(
          DATE_SUB(
            DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)),
            INTERVAL 1 MONTH
          ),
          '%Y-%m-01'
        )
        AND DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) <
        DATE_FORMAT(
          DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)),
          '%Y-%m-01'
        )
      `,
      params: [],
    };
  }

  if (filter === "custom" && startDate && endDate) {
    return {
      billWhere: `
        DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE))
        BETWEEN
        DATE_SUB(
          ?,
          INTERVAL DATEDIFF(?, ?) + 1 DAY
        )
        AND DATE_SUB(?, INTERVAL 1 DAY)
      `,
      itemWhere: `
        DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE))
        BETWEEN
        DATE_SUB(
          ?,
          INTERVAL DATEDIFF(?, ?) + 1 DAY
        )
        AND DATE_SUB(?, INTERVAL 1 DAY)
      `,
      params: [
        startDate,
        endDate,
        startDate,
        startDate,
      ],
    };
  }

  return {
    billWhere: `
      DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) =
      DATE_SUB(
        DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)),
        INTERVAL 1 DAY
      )
    `,
    itemWhere: `
      DATE(DATE_ADD(b.created_at, INTERVAL 330 MINUTE)) =
      DATE_SUB(
        DATE(DATE_ADD(NOW(), INTERVAL 330 MINUTE)),
        INTERVAL 1 DAY
      )
    `,
    params: [],
  };
}

exports.getDashboardV2 = async (req, res) => {
  try {
    const shopId = req.user.shop_id;
    const role = (req.user.role || "").toLowerCase();

    /*
     * OWNER
     * -------
     * Owner has full dashboard access.
     *
     * STAFF
     * -----
     * reports      -> sales / profit / chart
     * bill_history -> recent bills / bill count
     * stock        -> low stock information
     */

    let permissions = {
      reports: false,
      bill_history: false,
      stock: false,
    };

    if (role === "owner") {
      permissions = {
        reports: true,
        bill_history: true,
        stock: true,
      };
    } else if (role === "staff") {
      const [permissionRows] = await db.query(
        `
        SELECT permission, enabled
        FROM staff_permissions
        WHERE staff_id = ?
          AND shop_id = ?
          AND permission IN (
            'reports',
            'bill_history',
            'stock'
          )
        `,
        [
          req.user.user_id,
          shopId,
        ]
      );

      for (const row of permissionRows) {
        if (
          Object.prototype.hasOwnProperty.call(
            permissions,
            row.permission
          )
        ) {
          permissions[row.permission] =
            Boolean(row.enabled);
        }
      }
    }

    const filter = normalizeFilter(req.query.filter);

    const startDate = req.query.startDate;
    const endDate = req.query.endDate;

    const current = buildCurrentRange(
      filter,
      startDate,
      endDate
    );

    const previous = buildPreviousRange(
      filter,
      startDate,
      endDate
    );

    let currentSales = 0;
    let previousSales = 0;

    let currentBills = 0;
    let previousBills = 0;

    let currentProfit = 0;
    let previousProfit = 0;

    /*
     * REPORTS PERMISSION
     *
     * Sales
     * Profit
     * Growth
     * Chart
     */

    if (permissions.reports) {
      const [currentRows] = await db.query(
        `
        SELECT
          COALESCE(SUM(total), 0) AS sales,
          COUNT(*) AS bills
        FROM bills
        WHERE shop_id = ?
          AND ${current.billWhere}
        `,
        [
          shopId,
          ...current.params,
        ]
      );

      const [previousRows] = await db.query(
        `
        SELECT
          COALESCE(SUM(total), 0) AS sales,
          COUNT(*) AS bills
        FROM bills
        WHERE shop_id = ?
          AND ${previous.billWhere}
        `,
        [
          shopId,
          ...previous.params,
        ]
      );

      const [currentProfitRows] =
        await db.query(
          `
          SELECT
            COALESCE(SUM(bi.profit), 0) AS profit
          FROM bill_items bi
          INNER JOIN bills b
            ON b.id = bi.bill_id
          WHERE b.shop_id = ?
            AND ${current.itemWhere}
          `,
          [
            shopId,
            ...current.params,
          ]
        );

      const [previousProfitRows] =
        await db.query(
          `
          SELECT
            COALESCE(SUM(bi.profit), 0) AS profit
          FROM bill_items bi
          INNER JOIN bills b
            ON b.id = bi.bill_id
          WHERE b.shop_id = ?
            AND ${previous.itemWhere}
          `,
          [
            shopId,
            ...previous.params,
          ]
        );

      currentSales = Number(
        currentRows[0].sales || 0
      );

      previousSales = Number(
        previousRows[0].sales || 0
      );

      currentBills = Number(
        currentRows[0].bills || 0
      );

      previousBills = Number(
        previousRows[0].bills || 0
      );

      currentProfit = Number(
        currentProfitRows[0].profit || 0
      );

      previousProfit = Number(
        previousProfitRows[0].profit || 0
      );
    } else if (permissions.bill_history) {
      /*
       * Bill History without Reports
       *
       * Staff can know bill count,
       * but financial sales amount is hidden.
       */

      const [currentBillRows] =
        await db.query(
          `
          SELECT COUNT(*) AS bills
          FROM bills
          WHERE shop_id = ?
            AND ${current.billWhere}
          `,
          [
            shopId,
            ...current.params,
          ]
        );

      const [previousBillRows] =
        await db.query(
          `
          SELECT COUNT(*) AS bills
          FROM bills
          WHERE shop_id = ?
            AND ${previous.billWhere}
          `,
          [
            shopId,
            ...previous.params,
          ]
        );

      currentBills = Number(
        currentBillRows[0].bills || 0
      );

      previousBills = Number(
        previousBillRows[0].bills || 0
      );
    }

    /*
     * STOCK PERMISSION
     *
     * Low stock count + list
     */

    let lowStockCount = 0;
    let lowStockList = [];

    if (permissions.stock) {
      const [lowStockRows] =
        await db.query(
          `
          SELECT COUNT(*) AS count
          FROM products
          WHERE shop_id = ?
            AND CAST(stock AS UNSIGNED) <= 5
          `,
          [shopId]
        );

      lowStockCount = Number(
        lowStockRows[0].count || 0
      );

      const [lowStockRowsList] =
        await db.query(
          `
          SELECT
            id,
            name,
            stock
          FROM products
          WHERE shop_id = ?
            AND CAST(stock AS UNSIGNED) <= 5
          ORDER BY CAST(stock AS UNSIGNED) ASC
          LIMIT 3
          `,
          [shopId]
        );

      lowStockList =
        lowStockRowsList.map((p) => ({
          id: p.id,
          name: p.name || "Product",
          stock: Number(p.stock || 0),
        }));
    }

    /*
     * BILL HISTORY PERMISSION
     *
     * Recent bills only if permission enabled.
     *
     * Bill total is returned only when Reports
     * permission is also enabled.
     */

    let recentBills = [];

    if (permissions.bill_history) {
      const [recentBillRows] =
        await db.query(
          `
          SELECT
            id,
            customer_name,
            total,
            created_at
          FROM bills
          WHERE shop_id = ?
          ORDER BY created_at DESC
          LIMIT 3
          `,
          [shopId]
        );

      recentBills =
        recentBillRows.map((b) => ({
          id: b.id,

          invoiceNo:
            `INV-${b.id}`,

          customerName:
            b.customer_name ||
            "Walk-in Customer",

          total:
            permissions.reports
              ? Number(b.total || 0)
              : 0,

          time:
            new Date(
              b.created_at
            ).toLocaleTimeString(
              "en-IN",
              {
                hour: "2-digit",
                minute: "2-digit",
              }
            ),
        }));
    }

    /*
     * SALES CHART
     *
     * Reports permission only.
     */

    let chartRows = [];

    if (permissions.reports) {
      const chartSelect =
        filter === "today"
          ? `
            HOUR(
              DATE_ADD(
                created_at,
                INTERVAL 330 MINUTE
              )
            ) AS hour,

            MIN(
              DATE_FORMAT(
                DATE_ADD(
                  created_at,
                  INTERVAL 330 MINUTE
                ),
                '%h %p'
              )
            ) AS label
          `
          : `
            NULL AS hour,

            MIN(
              DATE_FORMAT(
                DATE_ADD(
                  created_at,
                  INTERVAL 330 MINUTE
                ),
                '%d %b'
              )
            ) AS label
          `;

      const chartGroup =
        filter === "today"
          ? `
            HOUR(
              DATE_ADD(
                created_at,
                INTERVAL 330 MINUTE
              )
            )
          `
          : `
            DATE(
              DATE_ADD(
                created_at,
                INTERVAL 330 MINUTE
              )
            )
          `;

      const [rows] =
        await db.query(
          `
          SELECT
            ${chartSelect},
            COALESCE(
              SUM(total),
              0
            ) AS sales
          FROM bills
          WHERE shop_id = ?
            AND ${current.billWhere}
          GROUP BY ${chartGroup}
          ORDER BY ${chartGroup} ASC
          `,
          [
            shopId,
            ...current.params,
          ]
        );

      chartRows =
        rows.map((c) => ({
          hour:
            c.hour === null
              ? null
              : Number(c.hour),

          label:
            c.label?.toString() || "",

          sales:
            Number(c.sales || 0),
        }));
    }

    /*
     * FINAL RESPONSE
     */

    return res.json({
      success: true,

      data: {
        filter,

        startDate:
          filter === "custom"
            ? startDate
            : null,

        endDate:
          filter === "custom"
            ? endDate
            : null,

        todaySales:
          currentSales,

        todayBills:
          currentBills,

        netProfit:
          currentProfit,

        lowStockItems:
          lowStockCount,

        salesGrowth:
          permissions.reports
            ? percentChange(
                currentSales,
                previousSales
              )
            : 0,

        billsGrowth:
          permissions.reports ||
          permissions.bill_history
            ? percentChange(
                currentBills,
                previousBills
              )
            : 0,

        profitGrowth:
          permissions.reports
            ? percentChange(
                currentProfit,
                previousProfit
              )
            : 0,

        recentBills,

        lowStockList,

        chart:
          chartRows,

        permissions: {
          reports:
            permissions.reports,

          bill_history:
            permissions.bill_history,

          stock:
            permissions.stock,
        },
      },
    });
  } catch (error) {
    console.error(
      "Dashboard V2 Error:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Dashboard data fetch failed",
      error: error.message,
    });
  }
};