const express = require("express");

const router = express.Router();

const adminAuthController = require("../controllers/adminAuthController");
const adminDashboardController = require("../controllers/adminDashboardController");
const adminShopsController = require("../controllers/adminShopsController");
const adminAuthMiddleware = require("../middleware/adminAuthMiddleware");

router.post("/login", adminAuthController.adminLogin);

router.get(
  "/dashboard",
  adminAuthMiddleware,
  adminDashboardController.getDashboardStats
);

router.get(
  "/dashboard/monthly-revenue",
  adminAuthMiddleware,
  adminDashboardController.getMonthlyRevenue
);

router.get(
  "/shops",
  adminAuthMiddleware,
  adminShopsController.getShops
);

// Manual subscription activation after admin verifies GPay payment.
router.post(
  "/shops/activate-subscription",
  adminAuthMiddleware,
  adminShopsController.activateSubscription
);

module.exports = router;