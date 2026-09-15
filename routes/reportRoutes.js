const express = require("express");

const router = express.Router();

const reportController = require("../controllers/reportController");

// ======================================================
// REPORTS
// ======================================================

router.get("/", reportController.getReports);

// ======================================================
// STAFF PERFORMANCE
// Existing API
// ======================================================

router.get("/staff-performance", reportController.staffPerformance);

module.exports = router;