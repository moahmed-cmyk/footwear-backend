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
  getProductByBarcode,
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

// Barcode lookup for Purchase Entry scanner
router.get(
  "/purchase-products/barcode/:barcode",
  verifyToken,
  getProductByBarcode
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