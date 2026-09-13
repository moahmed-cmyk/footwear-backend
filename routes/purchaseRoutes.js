const express = require("express");

const router = express.Router();

const verifyToken = require("../middleware/authMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");

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

// ============================================================
// PURCHASE PERMISSION
// Owner = always allowed
// Staff = only if purchase permission is ON
// ============================================================

router.post(
  "/purchase-entries",
  verifyToken,
  requirePermission("purchase"),
  createPurchaseEntry
);

router.get(
  "/purchase-entries",
  verifyToken,
  requirePermission("purchase"),
  getPurchaseEntries
);

router.get(
  "/purchase-entries/summary",
  verifyToken,
  requirePermission("purchase"),
  getPurchaseSummary
);

// Barcode lookup for Purchase Entry scanner
router.get(
  "/purchase-products/barcode/:barcode",
  verifyToken,
  requirePermission("purchase"),
  getProductByBarcode
);

router.get(
  "/purchase-entries/:id",
  verifyToken,
  requirePermission("purchase"),
  getPurchaseEntryDetails
);

router.put(
  "/purchase-entries/:id",
  verifyToken,
  requirePermission("purchase"),
  updatePurchaseEntry
);

router.patch(
  "/purchase-entries/:id/status",
  verifyToken,
  requirePermission("purchase"),
  updatePurchaseStatus
);

router.delete(
  "/purchase-entries/:id",
  verifyToken,
  requirePermission("purchase"),
  deletePurchaseEntry
);

module.exports = router;