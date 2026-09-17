const express = require("express");

const router = express.Router();
const db = require("../config/db");
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
async function requireProductsRead(req, res, next) {
  try {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const role = (req.user.role || "").toLowerCase();

    // Owner → full access
    if (role === "owner") {
      return next();
    }

    // Staff → Create Bill can always read products
    // Product management itself is still protected separately
    if (role === "staff") {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: "Access denied",
    });
  } catch (error) {
    console.error("PRODUCT READ PERMISSION ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Permission check failed",
    });
  }
}
// Get Products
router.get(
  "/products",
  verifyToken,
  requireProductsRead,
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