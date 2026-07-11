const express = require("express");
const router = express.Router();

const verifyToken = require(
  "../middleware/authMiddleware"
);

const {
  createPurchaseEntry,
  getPurchaseEntries,
  getPurchaseEntryDetails,
  updatePurchaseEntry,
  updatePurchaseStatus,
  deletePurchaseEntry,
  getPurchaseSummary,
} = require("../controllers/purchaseController");

router.post(
  "/purchase-entries",
  verifyToken,
  createPurchaseEntry
);

router.get(
  "/purchase-entries",
  verifyToken,
  getPurchaseEntries
);

router.get(
  "/purchase-entries/summary",
  verifyToken,
  getPurchaseSummary
);

router.get(
  "/purchase-entries/:id",
  verifyToken,
  getPurchaseEntryDetails
);

router.put(
  "/purchase-entries/:id",
  verifyToken,
  updatePurchaseEntry
);

router.patch(
  "/purchase-entries/:id/status",
  verifyToken,
  updatePurchaseStatus
);

router.delete(
  "/purchase-entries/:id",
  verifyToken,
  deletePurchaseEntry
);

module.exports = router;
