const db = require("../config/db");
const XLSX = require("xlsx");

// ============================================================
// NORMALIZE PRODUCT NAME
// ============================================================
function normalizeName(value) {
  return (value || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

// ============================================================
// ADD PRODUCT
// ============================================================
exports.addProduct = async (req, res) => {
  try {
    // IMPORTANT:
    // Product must always belong to logged-in user's shop.
    const shop_id = req.user.shop_id;

    const {
      barcode,
      name,
      size,
      mrp,
      buying_price,
      stock,
    } = req.body;

    // ----------------------------------------------------------
    // VALIDATION
    // ----------------------------------------------------------
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }

    const cleanName = name.trim();
    const cleanSize = (size || "").trim();
    const cleanBarcode = (barcode || "").trim();

    const productMrp = Number(mrp || 0);
    const productBuyingPrice = Number(buying_price || 0);
    const newStock = Number(stock || 0);

    if (Number.isNaN(productMrp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid MRP",
      });
    }

    if (Number.isNaN(productBuyingPrice)) {
      return res.status(400).json({
        success: false,
        message: "Invalid buying price",
      });
    }

    if (Number.isNaN(newStock)) {
      return res.status(400).json({
        success: false,
        message: "Invalid stock",
      });
    }

    const normalizedName = normalizeName(cleanName);

    // ----------------------------------------------------------
    // DUPLICATE CHECK
    //
    // RULE:
    // Same Product Name + Same MRP
    // = DUPLICATE
    //
    // Same Product Name + Different MRP
    // = ALLOWED
    //
    // NOTE:
    // Size is intentionally NOT part of duplicate checking.
    // ----------------------------------------------------------
    const [existing] = await db.query(
      `SELECT id, name, size, mrp, stock
       FROM products
       WHERE shop_id = ?
       AND REPLACE(LOWER(name), ' ', '') = ?
       AND CAST(mrp AS DECIMAL(10,2)) =
           CAST(? AS DECIMAL(10,2))
       LIMIT 1`,
      [
        shop_id,
        normalizedName,
        productMrp,
      ]
    );

    if (existing.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "Product already exists with the same name and MRP",
        product_id: existing[0].id,
        duplicate: true,
      });
    }

    // ----------------------------------------------------------
    // INSERT NEW PRODUCT
    // ----------------------------------------------------------
    const [result] = await db.query(
      `INSERT INTO products
       (
         shop_id,
         barcode,
         name,
         size,
         mrp,
         buying_price,
         stock
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        shop_id,
        cleanBarcode,
        cleanName,
        cleanSize,
        productMrp,
        productBuyingPrice,
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
    console.error("Add Product Error:", error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ============================================================
// GET PRODUCTS
// ============================================================
exports.getProducts = async (req, res) => {
  try {
    // IMPORTANT:
    // Only products belonging to logged-in user's shop.
    const shop_id = req.user.shop_id;

    const [products] = await db.query(
      `SELECT *
       FROM products
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
    console.error("Get Products Error:", error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ============================================================
// UPDATE PRODUCT
// ============================================================
exports.updateProduct = async (req, res) => {
  try {
    // IMPORTANT:
    // Product can only be updated inside user's own shop.
    const shop_id = req.user.shop_id;
    const productId = req.params.id;

    const {
      barcode,
      name,
      size,
      mrp,
      buying_price,
    } = req.body;

    // ----------------------------------------------------------
    // BASIC VALIDATION
    // ----------------------------------------------------------
    if (!name || name.trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Product name is required",
      });
    }

    const cleanName = name.trim();
    const cleanSize = (size || "").trim();
    const cleanBarcode = (barcode || "").trim();

    const productMrp = Number(mrp || 0);
    const productBuyingPrice = Number(buying_price || 0);

    if (Number.isNaN(productMrp)) {
      return res.status(400).json({
        success: false,
        message: "Invalid MRP",
      });
    }

    if (Number.isNaN(productBuyingPrice)) {
      return res.status(400).json({
        success: false,
        message: "Invalid buying price",
      });
    }

    // ----------------------------------------------------------
    // CHECK CURRENT PRODUCT
    // ----------------------------------------------------------
    const [check] = await db.query(
      `SELECT *
       FROM products
       WHERE id = ?
       AND shop_id = ?`,
      [
        productId,
        shop_id,
      ]
    );

    if (check.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // ----------------------------------------------------------
    // DUPLICATE CHECK DURING UPDATE
    //
    // Same Product Name + Same MRP
    // cannot belong to another product.
    //
    // IMPORTANT:
    // Exclude current product ID.
    // ----------------------------------------------------------
    const normalizedName = normalizeName(cleanName);

    const [duplicate] = await db.query(
      `SELECT id
       FROM products
       WHERE shop_id = ?
       AND id <> ?
       AND REPLACE(LOWER(name), ' ', '') = ?
       AND CAST(mrp AS DECIMAL(10,2)) =
           CAST(? AS DECIMAL(10,2))
       LIMIT 1`,
      [
        shop_id,
        productId,
        normalizedName,
        productMrp,
      ]
    );

    if (duplicate.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "Another product already exists with the same name and MRP",
        product_id: duplicate[0].id,
        duplicate: true,
      });
    }

    // ----------------------------------------------------------
    // UPDATE
    // ----------------------------------------------------------
    await db.query(
      `UPDATE products
       SET
         barcode = ?,
         name = ?,
         size = ?,
         mrp = ?,
         buying_price = ?
       WHERE id = ?
       AND shop_id = ?`,
      [
        cleanBarcode,
        cleanName,
        cleanSize,
        productMrp,
        productBuyingPrice,
        productId,
        shop_id,
      ]
    );

    return res.json({
      success: true,
      message: "Product Updated",
    });
  } catch (error) {
    console.error("Update Product Error:", error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ============================================================
// IMPORT PRODUCTS
// ============================================================
exports.importProducts = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Excel file required",
      });
    }

    const workbook = XLSX.read(req.file.buffer, {
      type: "buffer",
    });

    const sheet =
      workbook.Sheets[workbook.SheetNames[0]];

    const rows = XLSX.utils.sheet_to_json(sheet);

    // ----------------------------------------------------------
    // EXCEL VALUE HELPER
    // ----------------------------------------------------------
    function getValue(row, keys) {
      const map = {};

      for (const key in row) {
        map[key.toLowerCase().trim()] = row[key];
      }

      for (const key of keys) {
        const value =
          map[key.toLowerCase().trim()];

        if (value !== undefined) {
          return value;
        }
      }

      return "";
    }

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;

    // ----------------------------------------------------------
    // PROCESS EACH ROW
    // ----------------------------------------------------------
    for (const row of rows) {
      try {
        const barcode = getValue(
          row,
          ["barcode"]
        )
          .toString()
          .trim();

        const name = getValue(
          row,
          ["product name", "name"]
        )
          .toString()
          .trim();

        const size = getValue(
          row,
          ["size"]
        )
          .toString()
          .trim();

        const mrp = Number(
          getValue(row, ["mrp"]) || 0
        );

        const buying_price = Number(
          getValue(row, [
            "buying price",
            "buying_price",
            "buyingprice",
          ]) || 0
        );

        const stock = Number(
          getValue(row, ["stock"]) || 0
        );

        // ------------------------------------------------------
        // REQUIRED NAME
        // ------------------------------------------------------
        if (!name) {
          skipped++;
          continue;
        }

        const normalizedName =
          normalizeName(name);

        // ------------------------------------------------------
        // DUPLICATE CHECK
        //
        // Same Shop
        // + Same Product Name
        // + Same MRP
        //
        // => existing product
        //
        // Different MRP
        // => new product
        // ------------------------------------------------------
        const [existing] = await db.query(
          `SELECT id
           FROM products
           WHERE shop_id = ?
           AND REPLACE(LOWER(name), ' ', '') = ?
           AND CAST(mrp AS DECIMAL(10,2)) =
               CAST(? AS DECIMAL(10,2))
           LIMIT 1`,
          [
            shop_id,
            normalizedName,
            mrp,
          ]
        );

        if (existing.length > 0) {
          // ----------------------------------------------------
          // EXISTING PRODUCT
          // ----------------------------------------------------
          await db.query(
            `UPDATE products
             SET
               stock = stock + ?,
               barcode = ?,
               buying_price = ?
             WHERE id = ?
             AND shop_id = ?`,
            [
              stock,
              barcode,
              buying_price,
              existing[0].id,
              shop_id,
            ]
          );

          updated++;
        } else {
          // ----------------------------------------------------
          // NEW PRODUCT
          // ----------------------------------------------------
          await db.query(
            `INSERT INTO products
             (
               shop_id,
               barcode,
               name,
               size,
               mrp,
               buying_price,
               stock
             )
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              shop_id,
              barcode,
              name,
              size,
              mrp,
              buying_price,
              stock,
            ]
          );

          imported++;
        }
      } catch (e) {
        console.error(
          "Import Row Error:",
          e.message
        );

        failed++;
      }
    }

    return res.json({
      success: true,
      message: "Excel import completed",
      imported,
      updated,
      skipped,
      failed,
    });
  } catch (error) {
    console.error(
      "Import Products Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ============================================================
// DELETE PRODUCT
// ============================================================
exports.deleteProduct = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;
    const productId = req.params.id;

    // ----------------------------------------------------------
    // CHECK PRODUCT BELONGS TO SHOP
    // ----------------------------------------------------------
    const [check] = await db.query(
      `SELECT *
       FROM products
       WHERE id = ?
       AND shop_id = ?`,
      [
        productId,
        shop_id,
      ]
    );

    if (check.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // ----------------------------------------------------------
    // DELETE
    // ----------------------------------------------------------
    await db.query(
      `DELETE FROM products
       WHERE id = ?
       AND shop_id = ?`,
      [
        productId,
        shop_id,
      ]
    );

    return res.json({
      success: true,
      message: "Product Deleted",
    });
  } catch (error) {
    console.error(
      "Delete Product Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ============================================================
// GET STOCK HISTORY
// ============================================================
exports.getStockHistory = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;
    const productId = req.params.id;

    // ----------------------------------------------------------
    // GET PRODUCT
    // ----------------------------------------------------------
    const [product] = await db.query(
      `SELECT
         id,
         name,
         barcode,
         size,
         mrp,
         buying_price,
         stock
       FROM products
       WHERE id = ?
       AND shop_id = ?`,
      [
        productId,
        shop_id,
      ]
    );

    if (product.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Product not found",
      });
    }

    // ----------------------------------------------------------
    // GET HISTORY
    // ----------------------------------------------------------
    const [history] = await db.query(
      `SELECT
         id,
         type,
         quantity,
         balance_stock,
         reference_id,
         reference_no,
         note,
         created_at
       FROM stock_history
       WHERE product_id = ?
       AND shop_id = ?
       ORDER BY created_at DESC, id DESC`,
      [
        productId,
        shop_id,
      ]
    );

    return res.json({
      success: true,
      product: product[0],
      count: history.length,
      history,
    });
  } catch (error) {
    console.error(
      "Get Stock History Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};