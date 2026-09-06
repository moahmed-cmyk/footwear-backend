const db = require("../config/db");

const ALLOWED_STATUS = [
  "draft",
  "in_progress",
  "completed",
  "cancelled",
];

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function intValue(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cleanText(value) {
  return (value || "").toString().trim();
}

function normalizeStatus(value) {
  const status = cleanText(value).toLowerCase();

  if (status === "in progress" || status === "inprogress") {
    return "in_progress";
  }

  return ALLOWED_STATUS.includes(status) ? status : "completed";
}

function validatePurchase(body) {
  const supplierName = cleanText(body.supplier_name);
  const invoiceNumber = cleanText(body.invoice_number);
  const purchaseDate = cleanText(body.purchase_date);
  const status = normalizeStatus(body.status);
  const items = Array.isArray(body.items) ? body.items : [];

  if (!supplierName) {
    return "Supplier name is required";
  }

  if (!invoiceNumber) {
    return "Invoice number is required";
  }

  if (!purchaseDate) {
    return "Purchase date is required";
  }

  if (status === "completed" && items.length === 0) {
    return "At least one product is required";
  }

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];

    if (!cleanText(item.product_name)) {
      return `Product name is required for item ${index + 1}`;
    }

    if (numberValue(item.purchase_price) < 0) {
      return `Invalid purchase price for item ${index + 1}`;
    }

    if (intValue(item.quantity) <= 0) {
      return `Invalid quantity for item ${index + 1}`;
    }
  }

  return null;
}

async function findOrCreateProduct(connection, shopId, item) {
  const suppliedProductId = intValue(item.product_id, 0);
  const productName = cleanText(item.product_name);
  const size = cleanText(item.size);
  const barcode = cleanText(item.barcode);
  const mrp = numberValue(item.mrp);
  const purchasePrice = numberValue(item.purchase_price);

  if (suppliedProductId > 0) {
    const [byId] = await connection.query(
      `SELECT id
       FROM products
       WHERE id = ? AND shop_id = ?
       LIMIT 1`,
      [suppliedProductId, shopId]
    );

    if (byId.length > 0) {
      await connection.query(
        `UPDATE products
         SET barcode = ?,
             name = ?,
             size = ?,
             mrp = ?,
             buying_price = ?
         WHERE id = ? AND shop_id = ?`,
        [
          barcode,
          productName,
          size,
          mrp,
          purchasePrice,
          suppliedProductId,
          shopId,
        ]
      );

      return suppliedProductId;
    }
  }

  let existing = [];

  // Product identity:
  // 1. Barcode, when provided
  // 2. Product name + size, when barcode is not provided
  if (barcode) {
    [existing] = await connection.query(
      `SELECT id
       FROM products
       WHERE shop_id = ?
         AND TRIM(COALESCE(barcode, '')) = ?
       LIMIT 1`,
      [shopId, barcode]
    );
  } else {
    const normalizedName = productName
      .toLowerCase()
      .replace(/\s+/g, "");

    const normalizedSize = size
      .toLowerCase()
      .replace(/\s+/g, "");

    [existing] = await connection.query(
      `SELECT id
       FROM products
       WHERE shop_id = ?
         AND REPLACE(LOWER(TRIM(name)), ' ', '') = ?
         AND REPLACE(LOWER(TRIM(size)), ' ', '') = ?
       LIMIT 1`,
      [shopId, normalizedName, normalizedSize]
    );
  }

  if (existing.length > 0) {
    const productId = existing[0].id;

    await connection.query(
      `UPDATE products
       SET barcode = ?,
           name = ?,
           size = ?,
           mrp = ?,
           buying_price = ?
       WHERE id = ? AND shop_id = ?`,
      [
        barcode,
        productName,
        size,
        mrp,
        purchasePrice,
        productId,
        shopId,
      ]
    );

    return productId;
  }

  const [result] = await connection.query(
    `INSERT INTO products
     (shop_id, barcode, name, size, mrp, buying_price, stock)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [
      shopId,
      barcode,
      productName,
      size,
      mrp,
      purchasePrice,
    ]
  );

  return result.insertId;
}

async function changeStock(
  connection,
  shopId,
  productId,
  quantityChange
) {
  if (!productId || quantityChange === 0) {
    return 0;
  }

  await connection.query(
    `UPDATE products
     SET stock = GREATEST(stock + ?, 0)
     WHERE id = ? AND shop_id = ?`,
    [quantityChange, productId, shopId]
  );

  const [rows] = await connection.query(
    `SELECT stock
     FROM products
     WHERE id = ? AND shop_id = ?
     LIMIT 1`,
    [productId, shopId]
  );

  return rows.length > 0 ? intValue(rows[0].stock) : 0;
}

async function insertStockHistory(
  connection,
  {
    shopId,
    productId,
    type,
    quantity,
    balanceStock,
    referenceId = null,
    referenceNo = "",
    note = "",
  }
) {
  await connection.query(
    `INSERT INTO stock_history
     (
       shop_id,
       product_id,
       type,
       quantity,
       balance_stock,
       reference_id,
       reference_no,
       note
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      shopId,
      productId,
      type,
      quantity,
      balanceStock,
      referenceId,
      referenceNo,
      note,
    ]
  );
}

async function reverseExistingCompletedStock(
  connection,
  purchaseEntryId,
  shopId
) {
  const [entries] = await connection.query(
    `SELECT status, invoice_number
     FROM purchase_entries
     WHERE id = ? AND shop_id = ?
     LIMIT 1`,
    [purchaseEntryId, shopId]
  );

  if (
    entries.length === 0 ||
    entries[0].status !== "completed"
  ) {
    return;
  }

  const referenceNo = cleanText(entries[0].invoice_number);

  const [items] = await connection.query(
    `SELECT product_id, quantity
     FROM purchase_entry_items
     WHERE purchase_entry_id = ?`,
    [purchaseEntryId]
  );

  for (const item of items) {
    const quantity = intValue(item.quantity);

    const balanceStock = await changeStock(
      connection,
      shopId,
      item.product_id,
      -quantity
    );

    await insertStockHistory(connection, {
      shopId,
      productId: item.product_id,
      type: "PURCHASE",
      quantity: -quantity,
      balanceStock,
      referenceId: purchaseEntryId,
      referenceNo,
      note: "Purchase stock reversed",
    });
  }
}

async function insertItemsAndApplyStock({
  connection,
  purchaseEntryId,
  shopId,
  status,
  invoiceNumber,
  items,
}) {
  for (const rawItem of items) {
    const productId = await findOrCreateProduct(
      connection,
      shopId,
      rawItem
    );

    const quantity = intValue(rawItem.quantity);

    const purchasePrice = numberValue(
      rawItem.purchase_price
    );

    const total =
      numberValue(rawItem.total) ||
      purchasePrice * quantity;

    await connection.query(
      `INSERT INTO purchase_entry_items
       (
         purchase_entry_id,
         product_id,
         barcode,
         product_name,
         size,
         mrp,
         purchase_price,
         quantity,
         total
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        purchaseEntryId,
        productId,
        cleanText(rawItem.barcode),
        cleanText(rawItem.product_name),
        cleanText(rawItem.size),
        numberValue(rawItem.mrp),
        purchasePrice,
        quantity,
        total,
      ]
    );

    if (status === "completed") {
      const balanceStock = await changeStock(
        connection,
        shopId,
        productId,
        quantity
      );

      await insertStockHistory(connection, {
        shopId,
        productId,
        type: "PURCHASE",
        quantity,
        balanceStock,
        referenceId: purchaseEntryId,
        referenceNo: invoiceNumber,
        note: "Purchase stock added",
      });
    }
  }
}

// ===============================
// CREATE PURCHASE ENTRY
// ===============================
exports.createPurchaseEntry = async (req, res) => {
  const connection = await db.getConnection();

  try {
    const validationError = validatePurchase(req.body);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const shopId = req.user.shop_id;
    const userId = req.user.user_id;

    const supplierName = cleanText(
      req.body.supplier_name
    );

    const invoiceNumber = cleanText(
      req.body.invoice_number
    );

    const purchaseDate = cleanText(
      req.body.purchase_date
    );

    const notes = cleanText(req.body.notes);

    const status = normalizeStatus(req.body.status);

    const items = Array.isArray(req.body.items)
      ? req.body.items
      : [];

    const totalProducts = items.length;

    const totalQuantity = items.reduce(
      (sum, item) =>
        sum + intValue(item.quantity),
      0
    );

    const totalAmount = items.reduce(
      (sum, item) => {
        const quantity = intValue(item.quantity);

        const price = numberValue(
          item.purchase_price
        );

        return (
          sum +
          (numberValue(item.total) ||
            price * quantity)
        );
      },
      0
    );

    await connection.beginTransaction();

    const [duplicate] = await connection.query(
      `SELECT id
       FROM purchase_entries
       WHERE shop_id = ?
       AND invoice_number = ?
       LIMIT 1`,
      [shopId, invoiceNumber]
    );

    if (duplicate.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "This invoice number already exists for your shop",
      });
    }

    const [result] = await connection.query(
      `INSERT INTO purchase_entries
       (
         shop_id,
         supplier_name,
         invoice_number,
         purchase_date,
         notes,
         status,
         total_products,
         total_quantity,
         total_amount,
         created_by
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shopId,
        supplierName,
        invoiceNumber,
        purchaseDate,
        notes,
        status,
        totalProducts,
        totalQuantity,
        totalAmount,
        userId,
      ]
    );

    await insertItemsAndApplyStock({
      connection,
      purchaseEntryId: result.insertId,
      shopId,
      status,
      invoiceNumber,
      items,
    });

    await connection.commit();

    return res.status(201).json({
      success: true,
      message:
        status === "draft"
          ? "Purchase draft saved successfully"
          : "Purchase entry saved successfully",
      purchase_entry_id: result.insertId,
    });
  } catch (error) {
    await connection.rollback();

    console.error(
      "Create Purchase Entry Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

// ===============================
// GET PURCHASE ENTRIES
// ===============================
exports.getPurchaseEntries = async (req, res) => {
  try {
    const shopId = req.user.shop_id;

    const status = cleanText(
      req.query.status
    );

    const search = cleanText(
      req.query.search
    );

    const startDate = cleanText(
      req.query.start_date
    );

    const endDate = cleanText(
      req.query.end_date
    );

    let where = "WHERE pe.shop_id = ?";

    const params = [shopId];

    if (status && status !== "all") {
      where += " AND pe.status = ?";
      params.push(normalizeStatus(status));
    }

    if (search) {
      where += `
        AND (
          pe.supplier_name LIKE ?
          OR pe.invoice_number LIKE ?
        )
      `;

      const searchValue = `%${search}%`;

      params.push(
        searchValue,
        searchValue
      );
    }

    if (startDate) {
      where +=
        " AND pe.purchase_date >= ?";

      params.push(startDate);
    }

    if (endDate) {
      where +=
        " AND pe.purchase_date <= ?";

      params.push(endDate);
    }

    const [rows] = await db.query(
      `SELECT
         pe.*,
         creator.username AS created_by_name,
         updater.username AS updated_by_name
       FROM purchase_entries pe
       LEFT JOIN users creator
         ON creator.id = pe.created_by
       LEFT JOIN users updater
         ON updater.id = pe.updated_by
       ${where}
       ORDER BY pe.purchase_date DESC, pe.id DESC`,
      params
    );

    return res.json({
      success: true,
      count: rows.length,
      purchase_entries: rows,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ===============================
// GET PURCHASE ENTRY DETAILS
// ===============================
exports.getPurchaseEntryDetails = async (
  req,
  res
) => {
  try {
    const shopId = req.user.shop_id;

    const purchaseEntryId =
      req.params.id;

    const [entries] = await db.query(
      `SELECT
         pe.*,
         creator.username AS created_by_name,
         updater.username AS updated_by_name
       FROM purchase_entries pe
       LEFT JOIN users creator
         ON creator.id = pe.created_by
       LEFT JOIN users updater
         ON updater.id = pe.updated_by
       WHERE pe.id = ?
       AND pe.shop_id = ?
       LIMIT 1`,
      [
        purchaseEntryId,
        shopId,
      ]
    );

    if (entries.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Purchase entry not found",
      });
    }

    const [items] = await db.query(
      `SELECT *
       FROM purchase_entry_items
       WHERE purchase_entry_id = ?
       ORDER BY id ASC`,
      [purchaseEntryId]
    );

    return res.json({
      success: true,
      purchase_entry: {
        ...entries[0],
        items,
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// ===============================
// UPDATE PURCHASE ENTRY
// ===============================
exports.updatePurchaseEntry = async (
  req,
  res
) => {
  const connection = await db.getConnection();

  try {
    const validationError =
      validatePurchase(req.body);

    if (validationError) {
      return res.status(400).json({
        success: false,
        message: validationError,
      });
    }

    const shopId = req.user.shop_id;
    const userId = req.user.user_id;

    const purchaseEntryId =
      req.params.id;

    const [existing] =
      await connection.query(
        `SELECT id
         FROM purchase_entries
         WHERE id = ?
         AND shop_id = ?
         LIMIT 1`,
        [
          purchaseEntryId,
          shopId,
        ]
      );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Purchase entry not found",
      });
    }

    const supplierName = cleanText(
      req.body.supplier_name
    );

    const invoiceNumber = cleanText(
      req.body.invoice_number
    );

    const purchaseDate = cleanText(
      req.body.purchase_date
    );

    const notes = cleanText(
      req.body.notes
    );

    const status = normalizeStatus(
      req.body.status
    );

    const items = Array.isArray(
      req.body.items
    )
      ? req.body.items
      : [];

    const totalProducts = items.length;

    const totalQuantity = items.reduce(
      (sum, item) =>
        sum + intValue(item.quantity),
      0
    );

    const totalAmount = items.reduce(
      (sum, item) => {
        const quantity =
          intValue(item.quantity);

        const price =
          numberValue(
            item.purchase_price
          );

        return (
          sum +
          (numberValue(item.total) ||
            price * quantity)
        );
      },
      0
    );

    await connection.beginTransaction();

    const [duplicate] =
      await connection.query(
        `SELECT id
         FROM purchase_entries
         WHERE shop_id = ?
         AND invoice_number = ?
         AND id <> ?
         LIMIT 1`,
        [
          shopId,
          invoiceNumber,
          purchaseEntryId,
        ]
      );

    if (duplicate.length > 0) {
      await connection.rollback();

      return res.status(409).json({
        success: false,
        message:
          "This invoice number already exists for your shop",
      });
    }

    await reverseExistingCompletedStock(
      connection,
      purchaseEntryId,
      shopId
    );

    await connection.query(
      `DELETE FROM purchase_entry_items
       WHERE purchase_entry_id = ?`,
      [purchaseEntryId]
    );

    await connection.query(
      `UPDATE purchase_entries
       SET supplier_name = ?,
           invoice_number = ?,
           purchase_date = ?,
           notes = ?,
           status = ?,
           total_products = ?,
           total_quantity = ?,
           total_amount = ?,
           updated_by = ?
       WHERE id = ?
       AND shop_id = ?`,
      [
        supplierName,
        invoiceNumber,
        purchaseDate,
        notes,
        status,
        totalProducts,
        totalQuantity,
        totalAmount,
        userId,
        purchaseEntryId,
        shopId,
      ]
    );

    await insertItemsAndApplyStock({
      connection,
      purchaseEntryId,
      shopId,
      status,
      invoiceNumber,
      items,
    });

    await connection.commit();

    return res.json({
      success: true,
      message:
        "Purchase entry updated successfully",
    });
  } catch (error) {
    await connection.rollback();

    console.error(
      "Update Purchase Entry Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

// ===============================
// UPDATE PURCHASE STATUS
// ===============================
exports.updatePurchaseStatus = async (
  req,
  res
) => {
  const connection = await db.getConnection();

  try {
    const shopId = req.user.shop_id;
    const userId = req.user.user_id;

    const purchaseEntryId =
      req.params.id;

    const newStatus =
      normalizeStatus(
        req.body.status
      );

    const [entries] =
      await connection.query(
        `SELECT
           status,
           invoice_number
         FROM purchase_entries
         WHERE id = ?
         AND shop_id = ?
         LIMIT 1`,
        [
          purchaseEntryId,
          shopId,
        ]
      );

    if (entries.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Purchase entry not found",
      });
    }

    const oldStatus =
      entries[0].status;

    const invoiceNumber =
      cleanText(
        entries[0].invoice_number
      );

    if (oldStatus === newStatus) {
      return res.json({
        success: true,
        message:
          "Purchase status is already updated",
      });
    }

    await connection.beginTransaction();

    const [items] =
      await connection.query(
        `SELECT
           product_id,
           quantity
         FROM purchase_entry_items
         WHERE purchase_entry_id = ?`,
        [purchaseEntryId]
      );

    if (oldStatus === "completed") {
      for (const item of items) {
        const quantity =
          intValue(item.quantity);

        const balanceStock =
          await changeStock(
            connection,
            shopId,
            item.product_id,
            -quantity
          );

        await insertStockHistory(
          connection,
          {
            shopId,
            productId:
              item.product_id,
            type: "PURCHASE",
            quantity: -quantity,
            balanceStock,
            referenceId:
              purchaseEntryId,
            referenceNo:
              invoiceNumber,
            note:
              "Purchase stock reversed",
          }
        );
      }
    }

    if (newStatus === "completed") {
      for (const item of items) {
        const quantity =
          intValue(item.quantity);

        const balanceStock =
          await changeStock(
            connection,
            shopId,
            item.product_id,
            quantity
          );

        await insertStockHistory(
          connection,
          {
            shopId,
            productId:
              item.product_id,
            type: "PURCHASE",
            quantity,
            balanceStock,
            referenceId:
              purchaseEntryId,
            referenceNo:
              invoiceNumber,
            note:
              "Purchase stock added",
          }
        );
      }
    }

    await connection.query(
      `UPDATE purchase_entries
       SET status = ?,
           updated_by = ?
       WHERE id = ?
       AND shop_id = ?`,
      [
        newStatus,
        userId,
        purchaseEntryId,
        shopId,
      ]
    );

    await connection.commit();

    return res.json({
      success: true,
      message:
        "Purchase status updated successfully",
    });
  } catch (error) {
    await connection.rollback();

    console.error(
      "Update Purchase Status Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

// ===============================
// DELETE PURCHASE ENTRY
// ===============================
exports.deletePurchaseEntry = async (
  req,
  res
) => {
  const connection = await db.getConnection();

  try {
    const role = cleanText(
      req.user.role
    ).toLowerCase();

    if (role !== "owner") {
      return res.status(403).json({
        success: false,
        message:
          "Only owner can delete purchase entry",
      });
    }

    const shopId = req.user.shop_id;

    const purchaseEntryId =
      req.params.id;

    const [existing] =
      await connection.query(
        `SELECT id
         FROM purchase_entries
         WHERE id = ?
         AND shop_id = ?
         LIMIT 1`,
        [
          purchaseEntryId,
          shopId,
        ]
      );

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "Purchase entry not found",
      });
    }

    await connection.beginTransaction();

    await reverseExistingCompletedStock(
      connection,
      purchaseEntryId,
      shopId
    );

    await connection.query(
      `DELETE FROM purchase_entry_items
       WHERE purchase_entry_id = ?`,
      [purchaseEntryId]
    );

    await connection.query(
      `DELETE FROM purchase_entries
       WHERE id = ?
       AND shop_id = ?`,
      [
        purchaseEntryId,
        shopId,
      ]
    );

    await connection.commit();

    return res.json({
      success: true,
      message:
        "Purchase entry deleted successfully",
    });
  } catch (error) {
    await connection.rollback();

    console.error(
      "Delete Purchase Entry Error:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

// ===============================
// PURCHASE SUMMARY
// ===============================
exports.getPurchaseSummary = async (
  req,
  res
) => {
  try {
    const shopId = req.user.shop_id;

    const filter =
      cleanText(
        req.query.filter
      ) || "month";

    const startDate =
      cleanText(
        req.query.start_date
      );

    const endDate =
      cleanText(
        req.query.end_date
      );

    let dateWhere = "";

    const params = [shopId];

    if (filter === "today") {
      dateWhere =
        " AND purchase_date = CURDATE()";
    } else if (filter === "month") {
      dateWhere = `
        AND MONTH(purchase_date) = MONTH(CURDATE())
        AND YEAR(purchase_date) = YEAR(CURDATE())
      `;
    } else if (
      filter === "custom" &&
      startDate &&
      endDate
    ) {
      dateWhere =
        " AND purchase_date BETWEEN ? AND ?";

      params.push(
        startDate,
        endDate
      );
    }

    const [rows] =
      await db.query(
        `SELECT
           COUNT(*) AS total_invoices,
           COALESCE(SUM(total_products), 0)
             AS total_products,
           COALESCE(SUM(total_quantity), 0)
             AS total_quantity,
           COALESCE(SUM(total_amount), 0)
             AS total_amount
         FROM purchase_entries
         WHERE shop_id = ?
         AND status = 'completed'
         ${dateWhere}`,
        params
      );

    return res.json({
      success: true,
      summary: rows[0],
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};