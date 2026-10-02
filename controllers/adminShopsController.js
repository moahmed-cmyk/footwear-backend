const db = require("../config/db");

const PAID_PLAN_ID = 4;
const EXPECTED_AMOUNT = 299;
const EXPECTED_DURATION_DAYS = 30;

const formatDate = (value) => {
  if (!value) return null;

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
};

const addDays = (dateString, days) => {
  const [year, month, day] = dateString.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

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

const activateSubscription = async (req, res) => {
  const shopId = Number(req.body.shop_id);
  const paymentId = String(req.body.payment_id || "").trim();
  const orderId = req.body.order_id
    ? String(req.body.order_id).trim()
    : null;

  if (!Number.isInteger(shopId) || shopId <= 0) {
    return res.status(400).json({
      success: false,
      message: "Valid shop_id is required",
    });
  }

  if (!paymentId || paymentId.length > 150) {
    return res.status(400).json({
      success: false,
      message: "GPay payment reference is required",
    });
  }

  let connection;

  try {
    connection = await db.getConnection();
    await connection.beginTransaction();

    // Prevent activating a shop that does not exist.
    const [shopRows] = await connection.query(
      `SELECT id, subscription_end_date
       FROM shops
       WHERE id = ?
       FOR UPDATE`,
      [shopId]
    );

    if (shopRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Shop not found",
      });
    }

    // Confirm the configured ₹299 / 30-day plan.
    const [planRows] = await connection.query(
      `SELECT id, price, duration_days, status
       FROM subscription_plans
       WHERE id = ?
       LIMIT 1`,
      [PAID_PLAN_ID]
    );

    const plan = planRows[0];

    if (
      !plan ||
      Number(plan.price) !== EXPECTED_AMOUNT ||
      Number(plan.duration_days) !== EXPECTED_DURATION_DAYS ||
      plan.status !== "active"
    ) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "₹299 monthly subscription plan is not configured correctly",
      });
    }

    // Do not allow the same GPay reference to be used twice.
    const [duplicateRows] = await connection.query(
      `SELECT id
       FROM subscriptions
       WHERE payment_id = ?
       LIMIT 1`,
      [paymentId]
    );

    if (duplicateRows.length > 0) {
      await connection.rollback();
      return res.status(409).json({
        success: false,
        message: "This payment reference has already been used",
      });
    }

    const [todayRows] = await connection.query(
      `SELECT CURDATE() AS today`
    );

    const today = formatDate(todayRows[0].today);
    const currentEndDate = formatDate(shopRows[0].subscription_end_date);

    // If the current subscription is still valid, continue after its expiry.
    // Otherwise, start from today.
    const hasRemainingDays = currentEndDate && currentEndDate >= today;
    const startDate = hasRemainingDays
      ? addDays(currentEndDate, 1)
      : today;

    // Add 30 days to the existing expiry when still active.
    // This preserves the customer's remaining days.
    const endDate = hasRemainingDays
      ? addDays(currentEndDate, EXPECTED_DURATION_DAYS)
      : addDays(today, EXPECTED_DURATION_DAYS);

    await connection.query(
      `INSERT INTO subscriptions
        (shop_id, plan_id, amount, status, start_date, end_date, payment_id, order_id)
       VALUES (?, ?, ?, 'paid', ?, ?, ?, ?)`,
      [
        shopId,
        PAID_PLAN_ID,
        EXPECTED_AMOUNT,
        startDate,
        endDate,
        paymentId,
        orderId,
      ]
    );

    await connection.query(
      `UPDATE shops
       SET subscription_status = 'active',
           subscription_plan_id = ?,
           subscription_end_date = ?
       WHERE id = ?`,
      [PAID_PLAN_ID, endDate, shopId]
    );

    await connection.commit();

    return res.status(200).json({
      success: true,
      message: "Subscription activated successfully",
      data: {
        shop_id: shopId,
        plan_id: PAID_PLAN_ID,
        amount: EXPECTED_AMOUNT,
        duration_days: EXPECTED_DURATION_DAYS,
        start_date: startDate,
        end_date: endDate,
        payment_id: paymentId,
      },
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error("SUBSCRIPTION ROLLBACK ERROR:", rollbackError);
      }
    }

    console.error("ADMIN SUBSCRIPTION ACTIVATION ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to activate subscription",
    });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = {
  getShops,
  activateSubscription,
};