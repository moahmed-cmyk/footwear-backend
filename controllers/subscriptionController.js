const Razorpay = require("razorpay");
const crypto = require("crypto");
const db = require("../config/db");

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// =====================================================
// CREATE SUBSCRIPTION ORDER
// =====================================================
exports.createSubscriptionOrder = async (req, res) => {
  try {
    const shopId = req.user.shop_id;
    const { plan_id } = req.body;

    if (!shopId) {
      return res.status(401).json({
        success: false,
        message: "Shop ID not found",
      });
    }

    if (!plan_id) {
      return res.status(400).json({
        success: false,
        message: "Plan ID is required",
      });
    }

    // -------------------------------------------------
    // Get plan from database
    // IMPORTANT: Never trust price from Flutter
    // -------------------------------------------------
    const [plans] = await db.query(
      `
      SELECT
        id,
        plan_name,
        price,
        duration_days,
        description
      FROM subscription_plans
      WHERE id = ?
        AND status = 'active'
      LIMIT 1
      `,
      [plan_id]
    );

    if (plans.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    const plan = plans[0];

    // Free Trial should not create a payment order
    if (Number(plan.price) <= 0) {
      return res.status(400).json({
        success: false,
        message: "This plan does not require payment",
      });
    }

    // -------------------------------------------------
    // Convert ₹ to paise
    // Example: ₹199 = 19900 paise
    // -------------------------------------------------
    const amountInPaise = Math.round(Number(plan.price) * 100);

    if (!Number.isFinite(amountInPaise) || amountInPaise <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid subscription amount",
      });
    }

    // -------------------------------------------------
    // Razorpay receipt
    // Max 40 characters
    // -------------------------------------------------
    const receipt = `NIFORA_${shopId}_${Date.now()}`;

    // -------------------------------------------------
    // Create Razorpay order
    // -------------------------------------------------
    const razorpayOrder = await razorpay.orders.create({
      amount: amountInPaise,
      currency: "INR",
      receipt: receipt,
      notes: {
        shop_id: String(shopId),
        plan_id: String(plan.id),
        plan_name: String(plan.plan_name),
      },
    });

    // -------------------------------------------------
    // Get next subscriptions ID from TiDB sequence
    // -------------------------------------------------
    const [sequenceRows] = await db.query(
      `SELECT NEXT VALUE FOR subscriptions_id_seq AS id`
    );

    const subscriptionId = sequenceRows[0].id;

    // -------------------------------------------------
    // Save pending subscription
    // -------------------------------------------------
    await db.query(
      `
      INSERT INTO subscriptions
      (
        id,
        shop_id,
        plan_id,
        amount,
        status,
        payment_id,
        order_id
      )
      VALUES
      (?, ?, ?, ?, 'pending', NULL, ?)
      `,
      [
        subscriptionId,
        shopId,
        plan.id,
        Number(plan.price),
        razorpayOrder.id,
      ]
    );

    // -------------------------------------------------
    // Send order details to Flutter
    // -------------------------------------------------
    return res.status(200).json({
      success: true,
      message: "Subscription order created",
      order: {
        id: razorpayOrder.id,
        amount: razorpayOrder.amount,
        currency: razorpayOrder.currency,
        receipt: razorpayOrder.receipt,
      },
      subscription: {
        id: subscriptionId,
        shop_id: shopId,
        plan_id: plan.id,
        plan_name: plan.plan_name,
        price: Number(plan.price),
        duration_days: plan.duration_days,
      },
      razorpay_key_id: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error(
      "CREATE SUBSCRIPTION ORDER ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to create subscription order",
      error: error.message,
    });
  }
};


// =====================================================
// VERIFY RAZORPAY PAYMENT
// =====================================================
exports.verifySubscriptionPayment = async (req, res) => {
  try {
    const shopId = req.user.shop_id;

    const {
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
    } = req.body;

    if (
      !razorpay_payment_id ||
      !razorpay_order_id ||
      !razorpay_signature
    ) {
      return res.status(400).json({
        success: false,
        message: "Payment verification details are required",
      });
    }

    // -------------------------------------------------
    // Find our pending subscription
    // -------------------------------------------------
    const [subscriptions] = await db.query(
      `
      SELECT
        id,
        shop_id,
        plan_id,
        amount,
        status,
        order_id
      FROM subscriptions
      WHERE shop_id = ?
        AND order_id = ?
      LIMIT 1
      `,
      [shopId, razorpay_order_id]
    );

    if (subscriptions.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subscription order not found",
      });
    }

    const subscription = subscriptions[0];

    if (subscription.status === "paid") {
      return res.status(400).json({
        success: false,
        message: "Payment already verified",
      });
    }

    // -------------------------------------------------
    // Generate signature
    // -------------------------------------------------
    const generatedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(
        `${subscription.order_id}|${razorpay_payment_id}`
      )
      .digest("hex");

    // -------------------------------------------------
    // Compare signatures safely
    // -------------------------------------------------
const generatedBuffer = Buffer.from(generatedSignature);
const receivedBuffer = Buffer.from(razorpay_signature);

const isValid =
  generatedBuffer.length === receivedBuffer.length &&
  crypto.timingSafeEqual(generatedBuffer, receivedBuffer);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: "Invalid payment signature",
      });
    }

    // -------------------------------------------------
    // Get plan
    // -------------------------------------------------
    const [plans] = await db.query(
      `
      SELECT
        id,
        plan_name,
        price,
        duration_days
      FROM subscription_plans
      WHERE id = ?
        AND status = 'active'
      LIMIT 1
      `,
      [subscription.plan_id]
    );

    if (plans.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subscription plan not found",
      });
    }

    const plan = plans[0];

    // -------------------------------------------------
    // Calculate subscription dates
    // -------------------------------------------------
    const startDate = new Date();

    const endDate = new Date(startDate);
    endDate.setDate(
      endDate.getDate() + Number(plan.duration_days)
    );

    const formatDate = (date) => {
      const year = date.getFullYear();
      const month = String(
        date.getMonth() + 1
      ).padStart(2, "0");
      const day = String(
        date.getDate()
      ).padStart(2, "0");

      return `${year}-${month}-${day}`;
    };

    const formattedStartDate = formatDate(startDate);
    const formattedEndDate = formatDate(endDate);

    // -------------------------------------------------
    // Update subscription record
    // -------------------------------------------------
    await db.query(
      `
      UPDATE subscriptions
      SET
        status = 'paid',
        payment_id = ?,
        start_date = ?,
        end_date = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND shop_id = ?
      `,
      [
        razorpay_payment_id,
        formattedStartDate,
        formattedEndDate,
        subscription.id,
        shopId,
      ]
    );

    // -------------------------------------------------
    // Activate plan for shop
    // -------------------------------------------------
    await db.query(
      `
      UPDATE shops
      SET
        subscription_plan_id = ?,
        subscription_status = 'active',
        subscription_end_date = ?
      WHERE id = ?
      `,
      [
        plan.id,
        formattedEndDate,
        shopId,
      ]
    );

    return res.status(200).json({
      success: true,
      message: "Payment verified successfully",
      subscription: {
        plan_id: plan.id,
        plan_name: plan.plan_name,
        price: Number(plan.price),
        start_date: formattedStartDate,
        end_date: formattedEndDate,
        status: "active",
      },
    });
  } catch (error) {
    console.error(
      "VERIFY SUBSCRIPTION PAYMENT ERROR:",
      error
    );

    return res.status(500).json({
      success: false,   
      message: "Payment verification failed",
      error: error.message,
    }); 
  }
};