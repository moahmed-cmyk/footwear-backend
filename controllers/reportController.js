const db = require("../config/db");

// ======================================================
// REPORTS
// ======================================================

// ======================================================
// REPORTS
// ======================================================

exports.getReports = async (req, res) => {
  try {
    const shopId = req.user.shop_id;

    const {
      filter = "today",
      startDate,
      endDate,
    } = req.query;

    // ==================================================
    // DATE FILTER
    // ==================================================

    let billDateWhere = "";
    let expenseDateWhere = "";

    const billParams = [shopId];
    const expenseParams = [shopId];

    if (filter === "today") {
      billDateWhere = `
        AND DATE(b.created_at) = CURDATE()
      `;

      expenseDateWhere = `
        AND DATE(expense_date) = CURDATE()
      `;
    }

    else if (filter === "week") {
      billDateWhere = `
        AND DATE(b.created_at)
        BETWEEN DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
        AND CURDATE()
      `;

      expenseDateWhere = `
        AND DATE(expense_date)
        BETWEEN DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
        AND CURDATE()
      `;
    }

    else if (filter === "month") {
      billDateWhere = `
        AND MONTH(b.created_at) = MONTH(CURDATE())
        AND YEAR(b.created_at) = YEAR(CURDATE())
      `;

      expenseDateWhere = `
        AND MONTH(expense_date) = MONTH(CURDATE())
        AND YEAR(expense_date) = YEAR(CURDATE())
      `;
    }

    else if (filter === "custom") {
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "startDate and endDate are required",
        });
      }

      billDateWhere = `
        AND DATE(b.created_at) BETWEEN ? AND ?
      `;

      expenseDateWhere = `
        AND DATE(expense_date) BETWEEN ? AND ?
      `;

      billParams.push(startDate, endDate);
      expenseParams.push(startDate, endDate);
    }

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
        COALESCE(SUM(b.total), 0) AS total_sales,

        COUNT(b.id) AS total_bills,

        COALESCE(
          (
            SELECT SUM(bi.quantity)
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

        COALESCE(SUM(b.discount), 0) AS total_discount,

        COALESCE(SUM(b.cash_amount), 0) AS cash_sales,

        COALESCE(SUM(b.upi_amount), 0) AS upi_sales,

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
        shopId,
        ...billParams,
      ]
    );

    // ==================================================
    // 2. PROFIT
    // ==================================================

    const [profitRows] = await db.query(
      `
      SELECT
        COALESCE(SUM(bi.profit), 0) AS item_profit,

        COALESCE(SUM(b.discount), 0) AS total_discount

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
        COALESCE(SUM(amount), 0) AS total_expenses

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
      Number(salesRows[0].total_sales || 0);

    const totalBills =
      Number(salesRows[0].total_bills || 0);

    const totalItems =
      Number(salesRows[0].total_items || 0);

    const totalDiscount =
      Number(profitRows[0].total_discount || 0);

    const itemProfit =
      Number(profitRows[0].item_profit || 0);

    const totalExpenses =
      Number(expenseRows[0].total_expenses || 0);

    const totalProfit =
      itemProfit - totalDiscount;

    const netProfit =
      totalProfit - totalExpenses;

    const cashSales =
      Number(salesRows[0].cash_sales || 0);

    const upiSales =
      Number(salesRows[0].upi_sales || 0);

    const creditSales =
      Number(salesRows[0].credit_sales || 0);

    // ==================================================
    // 4. STAFF SALES
    // ==================================================

    let staffDateWhere = "";
    const staffParams = [shopId];

    if (filter === "today") {
      staffDateWhere = `
        AND DATE(b.created_at) = CURDATE()
      `;
    }

    else if (filter === "week") {
      staffDateWhere = `
        AND DATE(b.created_at)
        BETWEEN DATE_SUB(CURDATE(), INTERVAL WEEKDAY(CURDATE()) DAY)
        AND CURDATE()
      `;
    }

    else if (filter === "month") {
      staffDateWhere = `
        AND MONTH(b.created_at) = MONTH(CURDATE())
        AND YEAR(b.created_at) = YEAR(CURDATE())
      `;
    }

    else if (filter === "custom") {
      staffDateWhere = `
        AND DATE(b.created_at) BETWEEN ? AND ?
      `;

      staffParams.push(startDate, endDate);
    }

    const [staffRows] = await db.query(
      `
      SELECT
        u.id AS staff_id,

        u.username AS staff_name,

        COUNT(DISTINCT b.id) AS total_bills,

        COALESCE(SUM(b.total), 0) AS total_sales,

        COALESCE(SUM(b.discount), 0) AS total_discount,

        COALESCE(SUM(bi.profit), 0) AS total_profit

      FROM users u

      LEFT JOIN bills b
        ON b.created_by = u.id
        AND b.shop_id = ?
        ${staffDateWhere}

      LEFT JOIN bill_items bi
        ON bi.bill_id = b.id

      WHERE u.shop_id = ?
        AND LOWER(u.role) = 'staff'

      GROUP BY
        u.id,
        u.username

      ORDER BY total_sales DESC
      `,
      [
        shopId,
        ...(filter === "custom"
          ? [startDate, endDate]
          : []),
        shopId,
      ]
    );

    // ==================================================
    // RESPONSE
    // ==================================================

    return res.json({
      success: true,

      filter: {
        type: filter,
        start_date: startDate || null,
        end_date: endDate || null,
      },

      summary: {
        total_sales: totalSales,
        total_bills: totalBills,
        total_items: totalItems,
        total_profit: totalProfit,
        total_expenses: totalExpenses,
        net_profit: netProfit,
        total_discount: totalDiscount,
      },

      payment_summary: {
        cash: cashSales,
        upi: upiSales,
        credit: creditSales,
      },

      staff_sales: staffRows,
    });

  } catch (error) {
    console.error("REPORTS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to load reports",
      error: error.message,
    });
  }
};

// ======================================================
// STAFF PERFORMANCE
// Existing API
// ======================================================

exports.staffPerformance = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;

    const [rows] = await db.query(
      `
      SELECT
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
      ORDER BY total_sales DESC
      `,
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