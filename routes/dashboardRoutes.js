const express = require("express");
const router = express.Router();

const { getDashboardV2 } = require("../controllers/dashboardController");
const verifyToken = require("../middleware/authMiddleware");

router.get("/dashboard-v2", verifyToken, getDashboardV2);

module.exports = router;