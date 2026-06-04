const express = require("express");
const router = express.Router();

const {
  createBill,
  getBills,
} = require("../controllers/billController");

const verifyToken = require("../middleware/authMiddleware");

router.post("/bills", verifyToken, createBill);
router.get("/bills", verifyToken, getBills);

module.exports = router;