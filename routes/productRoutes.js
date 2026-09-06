const express = require("express");
const router = express.Router();

const multer = require("multer");
const upload = multer({ storage: multer.memoryStorage() });

const {
  addProduct,
  getProducts,
  updateProduct,
  deleteProduct,
  importProducts,
} = require("../controllers/productController");
router.get(
  "/products/:id/stock-history",
  verifyToken,
  getStockHistory
);

const verifyToken = require("../middleware/authMiddleware");

router.post("/products", verifyToken, addProduct);
router.get("/products", verifyToken, getProducts);
router.put("/products/:id", verifyToken, updateProduct);
router.delete("/products/:id", verifyToken, deleteProduct);

router.post(
  "/products/import",
  verifyToken,
  upload.single("file"),
  importProducts
);

module.exports = router;