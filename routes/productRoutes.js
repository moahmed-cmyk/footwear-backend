const express = require("express");
const router = express.Router();

const {
  addProduct,
  getProducts,
  updateProduct,
  deleteProduct,
} = require("../controllers/productController");

const verifyToken = require("../middleware/authMiddleware");

router.post("/products", verifyToken, addProduct);
router.get("/products", verifyToken, getProducts);
router.put("/products/:id", verifyToken, updateProduct);
router.delete("/products/:id", verifyToken, deleteProduct);

module.exports = router;