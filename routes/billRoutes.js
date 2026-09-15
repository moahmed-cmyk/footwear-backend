const express = require("express");
const checkSubscription = require("../middleware/subscriptionMiddleware");
const router = express.Router();

const {
  createBill,
  getBills,
  updateBill,
  deleteBill,
} = require("../controllers/billController");

const verifyToken = require("../middleware/authMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");

// Create Bill
router.post(
  "/bills",
  verifyToken,
  requirePermission("create_bill"),
  createBill
);

// Bill History
router.get(
  "/bills",
  verifyToken,
  requirePermission("bill_history"),
  getBills
);

// Update Bill
router.put(
  "/bills/:id",
  verifyToken,
  requirePermission("create_bill"),
  updateBill
);

// Delete Bill
router.delete(
  "/bills/:id",
  verifyToken,
  requirePermission("create_bill"),
  deleteBill
);

module.exports = router;