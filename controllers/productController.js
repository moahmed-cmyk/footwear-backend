const db = require("../config/db");
exports.addProduct = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;

    const {
      barcode,
      name,
      size,
      mrp,
      buying_price,
      stock,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }

    const cleanName = name.trim();
    const cleanSize = (size || "").trim();
    const cleanBarcode = (barcode || "").trim();

    const newStock = Number(stock || 0);

    const [existing] = await db.query(
      `SELECT id, stock
       FROM products
       WHERE shop_id = ?
       AND LOWER(name) = LOWER(?)
       AND LOWER(size) = LOWER(?)
       AND IFNULL(barcode, '') = ?
       LIMIT 1`,
      [shop_id, cleanName, cleanSize, cleanBarcode]
    );

    if (existing.length > 0) {
      const productId = existing[0].id;

      await db.query(
        `UPDATE products
         SET stock = stock + ?,
             mrp = ?,
             buying_price = ?
         WHERE id = ? AND shop_id = ?`,
        [
          newStock,
          mrp || 0,
          buying_price || 0,
          productId,
          shop_id,
        ]
      );

      return res.json({
        success: true,
        message: "Product already exists. Stock updated successfully",
        product_id: productId,
        updated: true,
      });
    }

    const [result] = await db.query(
      `INSERT INTO products 
       (shop_id, barcode, name, size, mrp, buying_price, stock)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        shop_id,
        cleanBarcode,
        cleanName,
        cleanSize,
        mrp || 0,
        buying_price || 0,
        newStock,
      ]
    );

    return res.json({
      success: true,
      message: "Product Added",
      product_id: result.insertId,
      updated: false,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.getProducts = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;

    const [products] = await db.query(
      `SELECT * FROM products 
       WHERE shop_id = ?
       ORDER BY id DESC`,
      [shop_id]
    );

    return res.json({
      success: true,
      count: products.length,
      products,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.updateProduct = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;
    const productId = req.params.id;

    const {
      barcode,
      name,
      size,
      mrp,
      buying_price,
      stock,
    } = req.body;

    const [check] = await db.query(
      `SELECT * FROM products 
       WHERE id = ? AND shop_id = ?`,
      [productId, shop_id]
    );

    if (check.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    await db.query(
      `UPDATE products 
       SET barcode = ?, name = ?, size = ?, mrp = ?, buying_price = ?, stock = ?
       WHERE id = ? AND shop_id = ?`,
      [
        barcode || "",
        name,
        size || "",
        mrp || 0,
        buying_price || 0,
        stock || 0,
        productId,
        shop_id,
      ]
    );

    return res.json({
      success: true,
      message: "Product Updated",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

exports.deleteProduct = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;
    const productId = req.params.id;

    const [check] = await db.query(
      `SELECT * FROM products 
       WHERE id = ? AND shop_id = ?`,
      [productId, shop_id]
    );

    if (check.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    await db.query(
      `DELETE FROM products 
       WHERE id = ? AND shop_id = ?`,
      [productId, shop_id]
    );

    return res.json({
      success: true,
      message: "Product Deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};