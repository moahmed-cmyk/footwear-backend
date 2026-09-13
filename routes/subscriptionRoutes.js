const express = require("express");

const router = express.Router();

const verifyToken = require("../middleware/authMiddleware");
const subscriptionController = require("../controllers/subscriptionController");

// Create Razorpay subscription order
router.post(
  "/subscription/create-order",
  verifyToken,
  subscriptionController.createSubscriptionOrder
);

// Verify Razorpay payment
router.post(
  "/subscription/verify-payment",
  verifyToken,
  subscriptionController.verifySubscriptionPayment
);

module.exports = router;