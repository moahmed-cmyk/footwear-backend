const db = require("../config/db");
const XLSX = require("xlsx");
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
    if (!name || name.trim() === "") {
  return res.status(400).json({
    success: false,
    message: "Product name is required",
  });
}

    const cleanName = name.trim();
    const cleanSize = (size || "").trim();
    const cleanBarcode = (barcode || "").trim();

    const newStock = Number(stock || 0);

   const normalizedName = cleanName
  .toLowerCase()
  .replace(/\s+/g, "");

const normalizedSize = cleanSize
  .toLowerCase()
  .replace(/\s+/g, "");

const [existing] = await db.query(
  `SELECT id, stock
   FROM products
   WHERE shop_id = ?
   AND REPLACE(LOWER(name), ' ', '') = ?
   AND REPLACE(LOWER(size), ' ', '') = ?
   AND CAST(mrp AS DECIMAL(10,2)) = CAST(? AS DECIMAL(10,2))
   LIMIT 1`,
  [
    shop_id,
    normalizedName,
    normalizedSize,
    Number(mrp || 0),
  ]
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

exports.importProducts = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Excel file required",
      });
    }

    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);

    const {
  addProduct,
  getProducts,
  updateProduct,
  deleteProduct,
  importProducts,
} = require("../controllers/productController");

    let imported = 0;
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    function getValue(row, keys) {
  const map = {};

  for (const key in row) {
    map[key.toLowerCase().trim()] = row[key];
  }

  for (const key of keys) {
    const value = map[key.toLowerCase().trim()];
    if (value !== undefined) {
      return value;
    }
  }

  return "";
}

const barcode = getValue(row, ["barcode"]).toString().trim();

const name = getValue(row, [
  "product name",
  "name",
]).toString().trim();

const size = getValue(row, [
  "size",
]).toString().trim();

const mrp = Number(
  getValue(row, ["mrp"]) || 0,
);

const buying_price = Number(
  getValue(row, [
    "buying price",
    "buying_price",
    "buyingprice",
  ]) || 0,
);

const stock = Number(
  getValue(row, ["stock"]) || 0,
);

    for (const row of rows) {
      try {
        const barcode = (row.Barcode || row.barcode || "").toString().trim();
        const name = (row["Product Name"] || row.name || row.Name || "").toString().trim();
        const size = (row.Size || row.size || "").toString().trim();
        const mrp = Number(row.MRP || row.mrp || 0);
        const buying_price = Number(row["Buying Price"] || row.buying_price || 0);
        const stock = Number(row.Stock || row.stock || 0);

        if (!name) {
          skipped++;
          continue;
        }

        const normalizedName = name.toLowerCase().replace(/\s+/g, "");
        const normalizedSize = size.toLowerCase().replace(/\s+/g, "");

        const [existing] = await db.query(
          `SELECT id
           FROM products
           WHERE shop_id = ?
           AND REPLACE(LOWER(name), ' ', '') = ?
           AND REPLACE(LOWER(size), ' ', '') = ?
           AND CAST(mrp AS DECIMAL(10,2)) = CAST(? AS DECIMAL(10,2))
           LIMIT 1`,
          [shop_id, normalizedName, normalizedSize, mrp]
        );

        if (existing.length > 0) {
          await db.query(
            `UPDATE products
             SET stock = stock + ?,
                 barcode = ?,
                 buying_price = ?
             WHERE id = ? AND shop_id = ?`,
            [stock, barcode, buying_price, existing[0].id, shop_id]
          );
          updated++;
        } else {
          await db.query(
            `INSERT INTO products
             (shop_id, barcode, name, size, mrp, buying_price, stock)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [shop_id, barcode, name, size, mrp, buying_price, stock]
          );
          imported++;
        }
      } catch (e) {
        failed++;
      }
    }

    res.json({
      success: true,
      message: "Excel import completed",
      imported,
      updated,
      skipped,
      failed,
    });
  } catch (error) {
    res.status(500).json({
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