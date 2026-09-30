const express = require("express");
const router = express.Router();

const adminAuthController = require("../controllers/adminAuthController");
const adminDashboardController = require("../controllers/adminDashboardController");
const adminAuthMiddleware = require("../middleware/adminAuthMiddleware");

router.post("/login", adminAuthController.adminLogin);

router.get(
  "/dashboard",
  adminAuthMiddleware,
  adminDashboardController.getDashboardStats
);

module.exports = router;