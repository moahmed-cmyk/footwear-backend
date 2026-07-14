const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const db = require("./config/db");
const verifyToken = require("./middleware/authMiddleware");

const productRoutes = require("./routes/productRoutes");
const billRoutes = require("./routes/billRoutes");
const dashboardRoutes = require("./routes/dashboardRoutes");
const purchaseRoutes = require("./routes/purchaseRoutes");

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

app.use("/", dashboardRoutes);
app.use("/", productRoutes);
app.use("/", billRoutes);
app.use("/", purchaseRoutes);

  app.get("/", async (req, res) => {
    try {
      const [rows] = await db.query("SELECT NOW() as serverTime");

      res.json({
        success: true,
        database: "Connected",
        time: rows[0].serverTime,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

app.get("/net-profit", verifyToken, async (req, res) => {
  try {
    const shopId = req.user.shop_id;
    const { startDate, endDate } = req.query;

    let billWhere = "WHERE b.shop_id = ?";
    let expenseWhere = "WHERE shop_id = ?";

    const billParams = [shopId];
    const expenseParams = [shopId];

    if (startDate && endDate) {
      billWhere += " AND DATE(b.created_at) BETWEEN ? AND ?";
      expenseWhere += " AND DATE(expense_date) BETWEEN ? AND ?";

      billParams.push(startDate, endDate);
      expenseParams.push(startDate, endDate);
    }

    const [profitRows] = await db.query(
      `
      SELECT
        COALESCE(SUM(b.total), 0) AS total_sales,
        COALESCE(SUM(bi.profit), 0) AS item_profit,
        COALESCE(SUM(DISTINCT b.discount), 0) AS total_discount
      FROM bills b
      LEFT JOIN bill_items bi ON bi.bill_id = b.id
      ${billWhere}
      `,
      billParams
    );

    const [expenseRows] = await db.query(
      `
      SELECT COALESCE(SUM(amount), 0) AS total_expenses
      FROM expenses
      ${expenseWhere}
      `,
      expenseParams
    );

    const totalSales = Number(profitRows[0].total_sales || 0);

    const totalProfit =
      Number(profitRows[0].item_profit || 0) -
      Number(profitRows[0].total_discount || 0);

    const totalExpenses = Number(expenseRows[0].total_expenses || 0);
    const netProfit = totalProfit - totalExpenses;

    res.json({
      success: true,
      report: {
        total_sales: totalSales,
        total_profit: totalProfit,
        total_expenses: totalExpenses,
        net_profit: netProfit,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

  app.post("/expenses", verifyToken, async (req, res) => {
    try {
      const { title, amount, category, expense_date } = req.body;

      if (!title || !amount || !expense_date) {
        return res.status(400).json({
          success: false,
          message: "Title, amount and date required",
        });
      }

      const [result] = await db.query(
        `INSERT INTO expenses
        (shop_id, title, amount, category, expense_date, created_by)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [
          req.user.shop_id,
          title,
          amount,
          category || "",
          expense_date,
          req.user.user_id,
        ]
      );

      res.json({
        success: true,
        message: "Expense added successfully",
        expense_id: result.insertId,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
  app.get("/expenses", verifyToken, async (req, res) => {
    try {
      const [expenses] = await db.query(
        `
        SELECT
          e.*,
          u.username AS created_by_name
        FROM expenses e
        LEFT JOIN users u
          ON u.id = e.created_by
        WHERE e.shop_id = ?
        ORDER BY e.expense_date DESC, e.id DESC
        `,
        [req.user.shop_id]
      );

      res.json({
        success: true,
        expenses,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.put("/expenses/:id", verifyToken, async (req, res) => {
    try {
      const expenseId = req.params.id;
      const shopId = req.user.shop_id;
      const userId = req.user.user_id;
      const role = (req.user.role || "").toLowerCase();

      const { title, amount } = req.body;

      if (!title || !amount) {
        return res.status(400).json({
          success: false,
          message: "Title and amount required",
        });
      }

      let query = `
        UPDATE expenses
        SET title = ?, amount = ?
        WHERE id = ? AND shop_id = ?
      `;

      const params = [title, amount, expenseId, shopId];

      if (role !== "owner") {
        query += ` AND created_by = ?`;
        params.push(userId);
      }

      const [result] = await db.query(query, params);

      if (result.affectedRows === 0) {
        return res.status(403).json({
          success: false,
          message: "Not allowed or expense not found",
        });
      }

      res.json({
        success: true,
        message: "Expense updated successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.delete("/expenses/:id", verifyToken, async (req, res) => {
    try {
      if ((req.user.role || "").toLowerCase() !== "owner") {
        return res.status(403).json({
          success: false,
          message: "Only owner can delete expense",
        });
      }

      const [result] = await db.query(
        `DELETE FROM expenses WHERE id = ? AND shop_id = ?`,
        [req.params.id, req.user.shop_id]
      );

      if (result.affectedRows === 0) {
        return res.status(404).json({
          success: false,
          message: "Expense not found",
        });
      }

      res.json({
        success: true,
        message: "Expense deleted successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
  app.post("/register-shop", async (req, res) => {
    const connection = await db.getConnection();

    try {
      const {
        shop_name,
        owner_name,
        phone,
        address,
        gst_number,
        username,
        password,
      } = req.body;

      if (!shop_name || !owner_name || !username || !password) {
        return res.status(400).json({
          success: false,
          message:
            "Shop name, owner name, username and password are required",
        });
      }

      await connection.beginTransaction();

      const [shopResult] = await connection.query(
        `INSERT INTO shops 
        (shop_name, owner_name, phone, address, gst_number)
        VALUES (?, ?, ?, ?, ?)`,
        [
          shop_name,
          owner_name,
          phone || "",
          address || "",
          gst_number || "",
        ]
      );

      const shopId = shopResult.insertId;

      const hashedPassword = await bcrypt.hash(password, 10);

      await connection.query(
        `INSERT INTO users 
        (shop_id, username, password, role, status)
        VALUES (?, ?, ?, ?, ?)`,
        [shopId, username, hashedPassword, "owner", "active"]
      );

      await connection.commit();

      res.json({
        success: true,
        message: "Shop and owner created successfully",
        data: {
          shop_id: shopId,
          shop_name,
          owner_name,
          username,
          role: "owner",
        },
      });
    } catch (error) {
      await connection.rollback();

      res.status(500).json({
        success: false,
        error: error.message,
      });
    } finally {
      connection.release();
    }
  });

  app.post("/staff", verifyToken, async (req, res) => {
    try {
      const { username, password } = req.body;
      const shopId = req.user.shop_id;

      if (req.user.role !== "owner") {
        return res.status(403).json({
          success: false,
          message: "Only owner can add staff",
        });
      }

      if (!username || !password) {
        return res.status(400).json({
          success: false,
          message: "Username and password required",
        });
      }

      const [existing] = await db.query(
        `SELECT id FROM users
        WHERE shop_id = ? AND username = ?`,
        [shopId, username]
      );

      if (existing.length > 0) {
        return res.status(400).json({
          success: false,
          message: "Username already exists",
        });
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const [result] = await db.query(
        `INSERT INTO users
        (shop_id, username, password, role, status)
        VALUES (?, ?, ?, ?, ?)`,
        [shopId, username, hashedPassword, "staff", "active"]
      );

      res.json({
        success: true,
        message: "Staff Added Successfully",
        staff_id: result.insertId,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/monthly-top-selling", verifyToken, async (req, res) => {
    try {
      const shopId = req.user.shop_id;

      const [rows] = await db.query(
        `
        SELECT
          product_name,
          SUM(quantity) AS total_qty
        FROM bill_items bi
        INNER JOIN bills b
          ON b.id = bi.bill_id
        WHERE b.shop_id = ?
        GROUP BY product_name
        ORDER BY total_qty DESC
        LIMIT 20
        `,
        [shopId]
      );

      res.json({
        success: true,
        products: rows,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
  app.get("/sales-report", verifyToken, async (req, res) => {
    try {
      const shopId = req.user.shop_id;

      const [bills] = await db.query(
        `
        SELECT
          id,
          customer_name,
          total,
          discount,
          created_at
        FROM bills
        WHERE shop_id = ?
        ORDER BY id DESC
        `,
        [shopId]
      );

      res.json({
        success: true,
        bills,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/dashboard", verifyToken, async (req, res) => {
    try {
      const shopId = req.user.shop_id;
      const { filter = "today", startDate, endDate } = req.query;

      let billDateWhere = "";
      let billParams = [shopId];

      let expenseDateWhere = "";
      let expenseParams = [shopId];

      if (filter === "today") {
        billDateWhere = " AND DATE(b.created_at) = CURDATE()";
        expenseDateWhere = " AND DATE(created_at) = CURDATE()";
      }

      if (filter === "month") {
        billDateWhere =
          " AND MONTH(b.created_at) = MONTH(CURDATE()) AND YEAR(b.created_at) = YEAR(CURDATE())";
        expenseDateWhere =
          " AND MONTH(created_at) = MONTH(CURDATE()) AND YEAR(created_at) = YEAR(CURDATE())";
      }

      if (filter === "custom" && startDate && endDate) {
        billDateWhere = " AND DATE(b.created_at) BETWEEN ? AND ?";
        expenseDateWhere = " AND DATE(created_at) BETWEEN ? AND ?";
        billParams.push(startDate, endDate);
        expenseParams.push(startDate, endDate);
      }

      const [salesRows] = await db.query(
        `
        SELECT
          COALESCE(SUM(bi.profit), 0) AS item_profit,
          COALESCE(SUM(bi.quantity), 0) AS total_items,
          COUNT(DISTINCT b.id) AS total_bills
        FROM bills b
        LEFT JOIN bill_items bi ON bi.bill_id = b.id
        WHERE b.shop_id = ?
        ${billDateWhere}
        `,
        billParams
      );

      const [billRows] = await db.query(
        `
        SELECT
          COALESCE(SUM(total), 0) AS total_sales,
          COALESCE(SUM(discount), 0) AS total_discount,
          COALESCE(SUM(CASE WHEN LOWER(payment_type) = 'cash' THEN total ELSE 0 END), 0) AS cash_sales,
          COALESCE(SUM(CASE WHEN LOWER(payment_type) = 'upi' THEN total ELSE 0 END), 0) AS upi_sales
        FROM bills b
        WHERE b.shop_id = ?
        ${billDateWhere}
        `,
        billParams
      );

      const [expenseRows] = await db.query(
        `
        SELECT COALESCE(SUM(amount), 0) AS total_expenses
        FROM expenses
        WHERE shop_id = ?
        ${expenseDateWhere}
        `,
        expenseParams
      );

      const grossProfit =
        Number(salesRows[0].item_profit || 0) -
        Number(billRows[0].total_discount || 0);

      const netProfit =
        grossProfit - Number(expenseRows[0].total_expenses || 0);

      const [productRows] = await db.query(
        `
        SELECT
          COUNT(*) AS total_products,
          COALESCE(SUM(CASE WHEN stock <= 5 THEN 1 ELSE 0 END), 0) AS low_stock_count
        FROM products
        WHERE shop_id = ?
        `,
        [shopId]
      );

      const [topRows] = await db.query(
        `
        SELECT
          bi.product_name,
          SUM(bi.quantity) AS total_qty
        FROM bill_items bi
        INNER JOIN bills b ON b.id = bi.bill_id
        WHERE b.shop_id = ?
        ${billDateWhere}
        GROUP BY bi.product_name
        ORDER BY total_qty DESC
        LIMIT 1
        `,
        billParams
      );

      res.json({
        success: true,
        dashboard: {
          total_sales: billRows[0].total_sales,
          cash_sales: billRows[0].cash_sales,
          upi_sales: billRows[0].upi_sales,
          total_discount: billRows[0].total_discount,
          total_expenses: expenseRows[0].total_expenses,
          total_profit: netProfit,
          total_items: salesRows[0].total_items,
          total_bills: salesRows[0].total_bills,
          total_products: productRows[0].total_products,
          low_stock_count: productRows[0].low_stock_count,
          top_product: topRows.length > 0 ? topRows[0].product_name : "No sales",
          top_qty: topRows.length > 0 ? topRows[0].total_qty : 0,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
  app.get("/low-stock", verifyToken, async (req, res) => {
    try {
      const shopId = req.user.shop_id;


      const [products] = await db.query(
        `
        SELECT
          id,
          barcode,
          name,
          size,
          mrp,
          stock
        FROM products
        WHERE shop_id = ?
        AND stock <= 5
        ORDER BY stock ASC
        `,
        [shopId]
      );

      res.json({
        success: true,
        products,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/staff", verifyToken, async (req, res) => {
    try {
      const shopId = req.user.shop_id;

      const [staff] = await db.query(
        `SELECT id, username, role, status
        FROM users
        WHERE shop_id = ? AND role = 'staff'
        ORDER BY id DESC`,
        [shopId]
      );

      res.json({
        success: true,
        staff,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.put("/staff/:id/status", verifyToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { status } = req.body;

      if (req.user.role !== "owner") {
        return res.status(403).json({
          success: false,
          message: "Only owner can update staff",
        });
      }

      if (status !== "active" && status !== "inactive") {
        return res.status(400).json({
          success: false,
          message: "Invalid status",
        });
      }

      await db.query(
        `UPDATE users
        SET status = ?
        WHERE id = ? AND shop_id = ? AND role = 'staff'`,
        [status, id, req.user.shop_id]
      );

      res.json({
        success: true,
        message:
          status === "active"
            ? "Staff enabled successfully"
            : "Staff disabled successfully",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/staff-sales", verifyToken, async (req, res) => {
    try {
      const shopId = req.user.shop_id;

      const [rows] = await db.query(
        `
        SELECT
          u.username AS staff_name,
          COUNT(b.id) AS total_bills,
          COALESCE(SUM(b.total), 0) AS total_sales,
          COALESCE(SUM(b.discount), 0) AS total_discount
        FROM users u
        LEFT JOIN bills b 
          ON b.created_by = u.id 
          AND b.shop_id = u.shop_id
        WHERE u.shop_id = ?
        GROUP BY u.id, u.username
        ORDER BY total_sales DESC
        `,
        [shopId]
      );

      res.json({
        success: true,
        reports: rows,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });
app.get("/profit-report", verifyToken, async (req, res) => {
  try {
    const shopId = req.user.shop_id;
    const { startDate, endDate } = req.query;

    let dateWhere = "";
    const params = [shopId];

    if (startDate && endDate) {
      dateWhere = " AND DATE(b.created_at) BETWEEN ? AND ?";
      params.push(startDate, endDate);
    }

    const [rows] = await db.query(
      `
      SELECT
        COALESCE(SUM(bi.total), 0) AS total_sales,
        COALESCE(SUM(bi.buying_price * bi.quantity), 0) AS total_buying,
        COALESCE(SUM(bi.profit), 0) AS total_profit,
        COALESCE(SUM(bi.quantity), 0) AS total_qty
      FROM bill_items bi
      INNER JOIN bills b ON b.id = bi.bill_id
      WHERE b.shop_id = ?
      ${dateWhere}
      `,
      params
    );

    res.json({
      success: true,
      report: rows[0],
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});
  app.get("/subscription-status", verifyToken, async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT
          subscription_status,
          subscription_end_date
        FROM shops
        WHERE id = ?`,
        [req.user.shop_id]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Shop not found",
        });
      }

      const shop = rows[0];

      const today = new Date();
      const endDate = shop.subscription_end_date
        ? new Date(shop.subscription_end_date)
        : null;

      const expired =
        shop.subscription_status !== "active" ||
        (endDate && endDate < today);

      res.json({
        success: true,
        expired,
        subscription_status: shop.subscription_status,
        subscription_end_date: shop.subscription_end_date,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.get("/notifications", verifyToken, async (req, res) => {
    try {
      const [rows] = await db.query(
        `SELECT *
        FROM notifications
        WHERE shop_id = ?
        ORDER BY id DESC
        LIMIT 50`,
        [req.user.shop_id]
      );

      const [countRows] = await db.query(
        `SELECT COUNT(*) AS unread_count
        FROM notifications
        WHERE shop_id = ? AND is_read = 0`,
        [req.user.shop_id]
      );

      res.json({
        success: true,
        unread_count: countRows[0].unread_count,
        notifications: rows,
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.put("/notifications/read-all", verifyToken, async (req, res) => {
    try {
      await db.query(
        `UPDATE notifications
        SET is_read = 1
        WHERE shop_id = ?`,
        [req.user.shop_id]
      );

      res.json({
        success: true,
        message: "Notifications marked as read",
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  app.post("/login", async (req, res) => {
    try {
      const { shop_id, username, password } = req.body;

      if (!shop_id || !username || !password) {
        return res.status(400).json({
          success: false,
          message: "shop_id, username and password are required",
        });
      }

      const [users] = await db.query(
        `SELECT 
          u.id,
          u.shop_id,
          u.username,
          u.password,
          u.role,
          u.status,
        s.shop_name,
  s.subscription_status,
  s.subscription_end_date
        FROM users u
        INNER JOIN shops s ON s.id = u.shop_id
        WHERE u.shop_id = ? AND u.username = ?
        LIMIT 1`,
        [shop_id, username]
      );

      if (users.length === 0) {
        return res.status(401).json({
          success: false,
          message: "Invalid username or shop",
        });
      }

      const user = users[0];

      const today = new Date();
  const endDate = user.subscription_end_date
    ? new Date(user.subscription_end_date)
    : null;

  if (
    user.subscription_status !== "active" ||
    (endDate && endDate < today)
  ) {
    return res.status(403).json({
      success: false,
      message: "Subscription expired. Please renew your plan.",
    });
  }

      if (user.status === "inactive") {
        return res.status(401).json({
          success: false,
          message: "Staff account disabled",
        });
      }

      const isMatch = await bcrypt.compare(password, user.password);

      if (!isMatch) {
        return res.status(401).json({
          success: false,
          message: "Invalid password",
        });
      }

      const token = jwt.sign(
        {
          user_id: user.id,
          shop_id: user.shop_id,
          role: user.role,
        },
        process.env.JWT_SECRET,
        {
          expiresIn: "7d",
        }
      );

      res.json({
        success: true,
        message: "Login successful",
        token,
        user: {
          id: user.id,
          shop_id: user.shop_id,
          shop_name: user.shop_name,
          username: user.username,
          role: user.role,
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  const PORT = process.env.PORT || 5000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});