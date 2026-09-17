const db = require("../config/db");

// ======================================================
// REPORTS
// ======================================================

exports.getReports = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;

    const {
      filter = "today",
      startDate,
      endDate,
    } = req.query;

    // ==================================================
    // DATE FILTER
    // IST = UTC + 5 HOURS 30 MINUTES
    // ==================================================

    let billDateWhere = "";
    let expenseDateWhere = "";

    const billParams = [shop_id];
    const expenseParams = [shop_id];

    // ==================================================
    // TODAY
    // ==================================================

    if (filter === "today") {
      billDateWhere = `
        AND DATE(
          DATE_ADD(
            b.created_at,
            INTERVAL 330 MINUTE
          )
        ) =
        DATE(
          DATE_ADD(
            UTC_TIMESTAMP(),
            INTERVAL 330 MINUTE
          )
        )
      `;

      expenseDateWhere = `
        AND DATE(expense_date) =
        DATE(
          DATE_ADD(
            UTC_TIMESTAMP(),
            INTERVAL 330 MINUTE
          )
        )
      `;
    }

    // ==================================================
    // THIS WEEK
    // ==================================================

    else if (filter === "week") {
      billDateWhere = `
        AND DATE(
          DATE_ADD(
            b.created_at,
            INTERVAL 330 MINUTE
          )
        )
        BETWEEN
          DATE_SUB(
            DATE(
              DATE_ADD(
                UTC_TIMESTAMP(),
                INTERVAL 330 MINUTE
              )
            ),
            INTERVAL WEEKDAY(
              DATE(
                DATE_ADD(
                  UTC_TIMESTAMP(),
                  INTERVAL 330 MINUTE
                )
              )
            ) DAY
          )
          AND
          DATE(
            DATE_ADD(
              UTC_TIMESTAMP(),
              INTERVAL 330 MINUTE
            )
          )
      `;

      expenseDateWhere = `
        AND DATE(expense_date)
        BETWEEN
          DATE_SUB(
            DATE(
              DATE_ADD(
                UTC_TIMESTAMP(),
                INTERVAL 330 MINUTE
              )
            ),
            INTERVAL WEEKDAY(
              DATE(
                DATE_ADD(
                  UTC_TIMESTAMP(),
                  INTERVAL 330 MINUTE
                )
              )
            ) DAY
          )
          AND
          DATE(
            DATE_ADD(
              UTC_TIMESTAMP(),
              INTERVAL 330 MINUTE
            )
          )
      `;
    }

    // ==================================================
    // THIS MONTH
    // ==================================================

    else if (filter === "month") {
      billDateWhere = `
        AND MONTH(
          DATE_ADD(
            b.created_at,
            INTERVAL 330 MINUTE
          )
        )
        =
        MONTH(
          DATE_ADD(
            UTC_TIMESTAMP(),
            INTERVAL 330 MINUTE
          )
        )

        AND YEAR(
          DATE_ADD(
            b.created_at,
            INTERVAL 330 MINUTE
          )
        )
        =
        YEAR(
          DATE_ADD(
            UTC_TIMESTAMP(),
            INTERVAL 330 MINUTE
          )
        )
      `;

      expenseDateWhere = `
        AND MONTH(expense_date)
        =
        MONTH(
          DATE_ADD(
            UTC_TIMESTAMP(),
            INTERVAL 330 MINUTE
          )
        )

        AND YEAR(expense_date)
        =
        YEAR(
          DATE_ADD(
            UTC_TIMESTAMP(),
            INTERVAL 330 MINUTE
          )
        )
      `;
    }

    // ==================================================
    // CUSTOM
    // ==================================================

 else if (filter === "custom") {
  if (!startDate || !endDate) {
    return res.status(400).json({
      success: false,
      message: "startDate and endDate are required",
    });
  }

  // Allow only YYYY-MM-DD
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

  if (
    !dateRegex.test(startDate) ||
    !dateRegex.test(endDate)
  ) {
    return res.status(400).json({
      success: false,
      message: "Invalid date format",
    });
  }

  billDateWhere = `
    AND DATE(
      DATE_ADD(
        b.created_at,
        INTERVAL 330 MINUTE
      )
    )
    BETWEEN '${startDate}' AND '${endDate}'
  `;

  expenseDateWhere = `
    AND DATE(expense_date)
    BETWEEN '${startDate}' AND '${endDate}'
  `;
}
    // ==================================================
    // INVALID FILTER
    // ==================================================

    else {
      return res.status(400).json({
        success: false,
        message: "Invalid report filter",
      });
    }

    // ==================================================
    // 1. SALES SUMMARY
    // ==================================================

    const [salesRows] = await db.query(
      `
      SELECT

        COALESCE(
          SUM(b.total),
          0
        ) AS total_sales,

        COUNT(b.id) AS total_bills,

        COALESCE(
          (
            SELECT
              SUM(bi.quantity)

            FROM bill_items bi

            INNER JOIN bills bb
              ON bb.id = bi.bill_id

            WHERE bb.shop_id = ?

            ${billDateWhere.replace(
              /b\./g,
              "bb."
            )}
          ),
          0
        ) AS total_items,

        COALESCE(
          SUM(b.discount),
          0
        ) AS total_discount,

        COALESCE(
          SUM(b.cash_amount),
          0
        ) AS cash_sales,

        COALESCE(
          SUM(b.upi_amount),
          0
        ) AS upi_sales,

        COALESCE(
          SUM(
            b.total
            - COALESCE(b.cash_amount, 0)
            - COALESCE(b.upi_amount, 0)
          ),
          0
        ) AS credit_sales

      FROM bills b

      WHERE b.shop_id = ?

      ${billDateWhere}
      `,
      [
        shop_id,
        ...billParams,
      ]
    );

    // ==================================================
    // 2. PROFIT
    // ==================================================

    const [profitRows] = await db.query(
      `
      SELECT

        COALESCE(
          SUM(bi.profit),
          0
        ) AS item_profit,

        COALESCE(
          SUM(b.discount),
          0
        ) AS total_discount

      FROM bills b

      LEFT JOIN bill_items bi
        ON bi.bill_id = b.id

      WHERE b.shop_id = ?

      ${billDateWhere}
      `,
      billParams
    );

    // ==================================================
    // 3. EXPENSES
    // ==================================================

    const [expenseRows] = await db.query(
      `
      SELECT

        COALESCE(
          SUM(amount),
          0
        ) AS total_expenses

      FROM expenses

      WHERE shop_id = ?

      ${expenseDateWhere}
      `,
      expenseParams
    );

    // ==================================================
    // CALCULATIONS
    // ==================================================

    const totalSales =
      Number(
        salesRows[0].total_sales || 0
      );

    const totalBills =
      Number(
        salesRows[0].total_bills || 0
      );

    const totalItems =
      Number(
        salesRows[0].total_items || 0
      );

    const totalDiscount =
      Number(
        profitRows[0].total_discount || 0
      );

    const itemProfit =
      Number(
        profitRows[0].item_profit || 0
      );

    const totalExpenses =
      Number(
        expenseRows[0].total_expenses || 0
      );

    const totalProfit =
      itemProfit - totalDiscount;

    const netProfit =
      totalProfit - totalExpenses;

    const cashSales =
      Number(
        salesRows[0].cash_sales || 0
      );

    const upiSales =
      Number(
        salesRows[0].upi_sales || 0
      );

    const creditSales =
      Number(
        salesRows[0].credit_sales || 0
      );

    // ==================================================
    // 4. STAFF SALES
    // Only staff who actually created bills
    // ==================================================

    let staffDateWhere = "";

    if (filter === "today") {
      staffDateWhere = `
        AND DATE(
          DATE_ADD(
            b.created_at,
            INTERVAL 330 MINUTE
          )
        )
        =
        DATE(
          DATE_ADD(
            UTC_TIMESTAMP(),
            INTERVAL 330 MINUTE
          )
        )
      `;
    }

    else if (filter === "week") {
      staffDateWhere = `
        AND DATE(
          DATE_ADD(
            b.created_at,
            INTERVAL 330 MINUTE
          )
        )
        BETWEEN
          DATE_SUB(
            DATE(
              DATE_ADD(
                UTC_TIMESTAMP(),
                INTERVAL 330 MINUTE
              )
            ),
            INTERVAL WEEKDAY(
              DATE(
                DATE_ADD(
                  UTC_TIMESTAMP(),
                  INTERVAL 330 MINUTE
                )
              )
            ) DAY
          )
          AND
          DATE(
            DATE_ADD(
              UTC_TIMESTAMP(),
              INTERVAL 330 MINUTE
            )
          )
      `;
    }

    else if (filter === "month") {
      staffDateWhere = `
        AND MONTH(
          DATE_ADD(
            b.created_at,
            INTERVAL 330 MINUTE
          )
        )
        =
        MONTH(
          DATE_ADD(
            UTC_TIMESTAMP(),
            INTERVAL 330 MINUTE
          )
        )

        AND YEAR(
          DATE_ADD(
            b.created_at,
            INTERVAL 330 MINUTE
          )
        )
        =
        YEAR(
          DATE_ADD(
            UTC_TIMESTAMP(),
            INTERVAL 330 MINUTE
          )
        )
      `;
    }

else if (filter === "custom") {
  staffDateWhere = `
    AND DATE(
      DATE_ADD(
        b.created_at,
        INTERVAL 330 MINUTE
      )
    )
    BETWEEN '${startDate}' AND '${endDate}'
  `;
}

    // ==================================================
    // STAFF QUERY
    // ==================================================
const staffQueryParams = [
  shop_id,
  shop_id,
];

    const [staffRows] = await db.query(
      `
      SELECT

          u.id AS staff_id,

          u.username AS staff_name,

          COUNT(
            DISTINCT b.id
          ) AS total_bills,

          COALESCE(
            SUM(b.total),
            0
          ) AS total_sales,

          COALESCE(
            SUM(b.discount),
            0
          ) AS total_discount,

          COALESCE(
            SUM(bi.profit),
            0
          ) AS total_profit

      FROM users u

      INNER JOIN bills b
        ON b.created_by = u.id

        AND b.shop_id = ?

      LEFT JOIN bill_items bi
        ON bi.bill_id = b.id

      WHERE u.shop_id = ?

        AND LOWER(u.role) = 'staff'

        ${staffDateWhere}

      GROUP BY
        u.id,
        u.username

      ORDER BY
        total_sales DESC
      `,
      staffQueryParams
    );

    // ==================================================
    // RESPONSE
    // ==================================================

    return res.json({
      success: true,

      filter: {
        type: filter,
        start_date:
          startDate || null,
        end_date:
          endDate || null,
      },

      summary: {
        total_sales:
          totalSales,

        total_bills:
          totalBills,

        total_items:
          totalItems,

        total_profit:
          totalProfit,

        total_expenses:
          totalExpenses,

        net_profit:
          netProfit,

        total_discount:
          totalDiscount,
      },

      payment_summary: {
        cash:
          cashSales,

        upi:
          upiSales,

        credit:
          creditSales,
      },

      staff_sales:
        staffRows,
    });

  } catch (error) {
    console.error(
      "REPORTS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,

      message:
        "Failed to load reports",

      error:
        error.message,
    });
  }
};

// ======================================================
// STAFF PERFORMANCE
// Existing API - DO NOT REMOVE
// ======================================================

exports.staffPerformance = async (
  req,
  res
) => {
  try {
    const shop_id =
      req.user.shop_id;

    const [rows] =
      await db.query(
        `
        SELECT

            u.id,

            u.username,

            COUNT(b.id)
              AS total_bills,

            COALESCE(
              SUM(b.total),
              0
            ) AS total_sales,

            COALESCE(
              SUM(bi.profit),
              0
            ) AS total_profit

        FROM users u

        LEFT JOIN bills b
          ON b.created_by = u.id
          AND b.shop_id = ?

        LEFT JOIN bill_items bi
          ON bi.bill_id = b.id

        WHERE u.shop_id = ?

        GROUP BY
          u.id,
          u.username

        ORDER BY
          total_sales DESC
        `,
        [
          shop_id,
          shop_id,
        ]
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