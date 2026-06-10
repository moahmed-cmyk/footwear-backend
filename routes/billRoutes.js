const express = require("express");
const router = express.Router();

const {
  createBill,
  getBills,
  updateBill,
  deleteBill,
} = require("../controllers/billController");

const verifyToken = require("../middleware/authMiddleware");

router.post("/bills", verifyToken, createBill);
router.get("/bills", verifyToken, getBills);
router.put("/bills/:id", verifyToken, updateBill);
router.delete("/bills/:id", verifyToken, deleteBill);

module.exports = router;