const express = require("express");

const router = express.Router();

const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
});

const verifyToken = require("../middleware/authMiddleware");
const requirePermission = require("../middleware/permissionMiddleware");

const {
  addProduct,
  getProducts,
  updateProduct,
  deleteProduct,
  importProducts,
  getStockHistory,
} = require("../controllers/productController");

// Add Product
router.post(
  "/products",
  verifyToken,
  requirePermission("products"),
  addProduct
);

// Get Products
router.get(
  "/products",
  verifyToken,
  requirePermission("products"),
  getProducts
);

// Update Product
router.put(
  "/products/:id",
  verifyToken,
  requirePermission("products"),
  updateProduct
);

// Delete Product
router.delete(
  "/products/:id",
  verifyToken,
  requirePermission("products"),
  deleteProduct
);

// Stock History
router.get(
  "/products/:id/stock-history",
  verifyToken,
  requirePermission("stock"),
  getStockHistory
);

// Import Products Excel
router.post(
  "/products/import",
  verifyToken,
  requirePermission("products"),
  upload.single("file"),
  importProducts
);

module.exports = router;