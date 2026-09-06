const express = require("express");

const router = express.Router();

const multer = require("multer");

const upload = multer({
  storage: multer.memoryStorage(),
});

const verifyToken = require("../middleware/authMiddleware");

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
  addProduct
);

// Get Products
router.get(
  "/products",
  verifyToken,
  getProducts
);

// Update Product
router.put(
  "/products/:id",
  verifyToken,
  updateProduct
);

// Delete Product
router.delete(
  "/products/:id",
  verifyToken,
  deleteProduct
);

// Stock History
router.get(
  "/products/:id/stock-history",
  verifyToken,
  getStockHistory
);

// Import Products Excel
router.post(
  "/products/import",
  verifyToken,
  upload.single("file"),
  importProducts
);

module.exports = router;