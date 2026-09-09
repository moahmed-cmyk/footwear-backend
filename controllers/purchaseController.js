  const db = require("../config/db");

  const ALLOWED_STATUS = [
    "draft",
    "in_progress",
    "completed",
    "cancelled",
  ];

  // =====================================================
  // BASIC HELPERS
  // =====================================================

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

    if (
      status === "in progress" ||
      status === "inprogress"
    ) {
      return "in_progress";
    }

    return ALLOWED_STATUS.includes(status)
      ? status
      : "completed";
  }

  // =====================================================
  // VALIDATE PURCHASE
  // =====================================================

  function validatePurchase(body) {
    const supplierName = cleanText(body.supplier_name);
    const invoiceNumber = cleanText(body.invoice_number);
    const purchaseDate = cleanText(body.purchase_date);

    const status = normalizeStatus(body.status);

    const items = Array.isArray(body.items)
      ? body.items
      : [];

    if (!supplierName) {
      return "Supplier name is required";
    }

    if (!invoiceNumber) {
      return "Invoice number is required";
    }

    if (!purchaseDate) {
      return "Purchase date is required";
    }

    // Completed purchase must contain products
    if (
      status === "completed" &&
      items.length === 0
    ) {
      return "At least one product is required";
    }

    for (
      let index = 0;
      index < items.length;
      index += 1
    ) {
      const item = items[index];

      if (!cleanText(item.product_name)) {
        return `Product name is required for item ${
          index + 1
        }`;
      }

      if (
        numberValue(item.purchase_price) < 0
      ) {
        return `Invalid purchase price for item ${
          index + 1
        }`;
      }

      if (
        intValue(item.quantity) <= 0
      ) {
        return `Invalid quantity for item ${
          index + 1
        }`;
      }
    }

    return null;
  }

  // =====================================================
  // FIND EXISTING PRODUCT
  //
  // IMPORTANT:
  // This function NEVER creates a product.
  //
  // Used for DRAFT.
  // If product doesn't already exist,
  // it returns null.
  // =====================================================
  async function findExistingProduct(
    connection,
    shopId,
    item
  ) {
    const productName = cleanText(item.product_name);
    const mrp = numberValue(item.mrp);

    const normalizedName = productName
      .toLowerCase()
      .replace(/\s+/g, "");

    if (!normalizedName || mrp <= 0) {
      return null;
    }

    const [rows] = await connection.query(
      `SELECT id
      FROM products
      WHERE shop_id = ?
      AND REPLACE(
        LOWER(TRIM(name)),
        ' ',
        ''
      ) = ?
      AND mrp = ?
      ORDER BY id ASC
      LIMIT 1`,
      [
        shopId,
        normalizedName,
        mrp,
      ]
    );

    if (rows.length === 0) {
      return null;
    }

    return intValue(rows[0].id);
  }

  // =====================================================
  // FIND EXISTING PRODUCT OR CREATE NEW
  //
  // Used ONLY when purchase is COMPLETED.
  //
  // If product exists -> return product ID.
  // If product doesn't exist -> create product.
  // =====================================================
async function findOrCreateProduct(
  connection,
  shopId,
  item
) {
  const productName =
    cleanText(item.product_name);

  const mrp =
    numberValue(item.mrp);

  const purchasePrice =
    numberValue(item.purchase_price);

  const size =
    cleanText(item.size);

  const barcode =
    cleanText(item.barcode);

  const normalizedName =
    productName
      .toLowerCase()
      .replace(/\s+/g, "");

  // ============================================
  // PRODUCT IDENTITY
  // ONLY PRODUCT NAME + MRP
  // ============================================

  if (!normalizedName) {
    throw new Error(
      "Product name is required"
    );
  }

  if (mrp <= 0) {
    throw new Error(
      "Valid MRP is required"
    );
  }

  // ============================================
  // 1. FIND EXISTING PRODUCT
  // SAME NAME + SAME MRP
  // ============================================

  const [existing] =
    await connection.query(
      `SELECT
         id,
         name,
         mrp,
         stock
       FROM products
       WHERE shop_id = ?
       AND REPLACE(
         LOWER(TRIM(name)),
         ' ',
         ''
       ) = ?
       AND mrp = ?
       ORDER BY id ASC
       LIMIT 1`,
      [
        shopId,
        normalizedName,
        mrp,
      ]
    );

  // ============================================
  // 2. EXISTING PRODUCT
  // ============================================

  if (existing.length > 0) {
    const productId =
      intValue(existing[0].id);

    if (!productId) {
      throw new Error(
        "Existing product has invalid ID"
      );
    }

    // Only update latest buying price.
    // Do NOT change name / MRP / size.
    await connection.query(
      `UPDATE products
       SET buying_price = ?
       WHERE id = ?
       AND shop_id = ?`,
      [
        purchasePrice,
        productId,
        shopId,
      ]
    );

    return productId;
  }

  // ============================================
  // 3. CREATE NEW PRODUCT
  // NAME SAME + MRP DIFFERENT
  // = NEW PRODUCT
  // ============================================

  await connection.query(
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

  // ============================================
  // 4. GET NEW PRODUCT ID DIRECTLY FROM DB
  // Do NOT depend on insertId
  // ============================================

  const [created] =
    await connection.query(
      `SELECT id
       FROM products
       WHERE shop_id = ?
       AND REPLACE(
         LOWER(TRIM(name)),
         ' ',
         ''
       ) = ?
       AND mrp = ?
       ORDER BY id DESC
       LIMIT 1`,
      [
        shopId,
        normalizedName,
        mrp,
      ]
    );

  if (created.length === 0) {
    throw new Error(
      "New product was inserted but could not be resolved"
    );
  }

  const newProductId =
    intValue(created[0].id);

  if (!newProductId) {
    throw new Error(
      "New product has invalid ID"
    );
  }

  return newProductId;
}
  // =====================================================
  // CHANGE STOCK
  // =====================================================

  async function changeStock(
    connection,
    shopId,
    productId,
    quantityChange
  ) {
    if (
      !productId ||
      quantityChange === 0
    ) {
      return 0;
    }

    await connection.query(
      `UPDATE products
      SET stock = GREATEST(
        stock + ?,
        0
      )
      WHERE id = ?
      AND shop_id = ?`,
      [
        quantityChange,
        productId,
        shopId,
      ]
    );

    const [rows] =
      await connection.query(
        `SELECT stock
        FROM products
        WHERE id = ?
        AND shop_id = ?
        LIMIT 1`,
        [
          productId,
          shopId,
        ]
      );

    if (rows.length === 0) {
      throw new Error(
        "Product not found while updating stock"
      );
    }

    return intValue(
      rows[0].stock
    );
  }

  // =====================================================
  // STOCK HISTORY
  // =====================================================

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
    // Never create history without a real product
    if (!productId) {
      return;
    }

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
        cleanText(referenceNo),
        cleanText(note),
      ]
    );
  }

  // =====================================================
  // REVERSE COMPLETED PURCHASE STOCK
  // =====================================================

  async function reverseExistingCompletedStock(
    connection,
    purchaseEntryId,
    shopId
  ) {
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

    if (
      entries.length === 0 ||
      entries[0].status !== "completed"
    ) {
      return;
    }

    const referenceNo =
      cleanText(
        entries[0].invoice_number
      );

    const [items] =
      await connection.query(
        `SELECT
          product_id,
          quantity
        FROM purchase_entry_items
        WHERE purchase_entry_id = ?`,
        [
          purchaseEntryId,
        ]
      );

    for (const item of items) {
      const productId =
        intValue(
          item.product_id,
          0
        );

      const quantity =
        intValue(
          item.quantity
        );

      // Safety:
      // completed purchase should always
      // have a real product.
      if (!productId) {
        continue;
      }

      const balanceStock =
        await changeStock(
          connection,
          shopId,
          productId,
          -quantity
        );

      await insertStockHistory(
        connection,
        {
          shopId,
          productId,
          type: "PURCHASE",
          quantity: -quantity,
          balanceStock,
          referenceId:
            purchaseEntryId,
          referenceNo,
          note:
            "Purchase stock reversed",
        }
      );
    }
  }

  // =====================================================
  // INSERT ITEMS
  //
  // DRAFT:
  //   - Existing product -> product_id saved
  //   - New product -> product_id NULL
  //   - No stock
  //   - No history
  //
  // COMPLETED:
  //   - Existing product -> use it
  //   - New product -> create it
  //   - Add stock
  //   - Add history
  // =====================================================

  async function insertItemsAndApplyStock({
    connection,
    purchaseEntryId,
    shopId,
    status,
    invoiceNumber,
    items,
  }) {
    for (const rawItem of items) {
      let productId = null;

      // -----------------------------------------------
      // DRAFT / IN PROGRESS / CANCELLED
      // -----------------------------------------------

      if (status !== "completed") {
        productId =
          await findExistingProduct(
            connection,
            shopId,
            rawItem
          );
      }

      // -----------------------------------------------
      // COMPLETED
      // -----------------------------------------------

      if (status === "completed") {
        productId =
          await findOrCreateProduct(
            connection,
            shopId,
            rawItem
          );
      }

      const quantity =
        intValue(
          rawItem.quantity
        );

      const purchasePrice =
        numberValue(
          rawItem.purchase_price
        );

      const total =
        numberValue(
          rawItem.total
        ) ||
        purchasePrice * quantity;

      // -----------------------------------------------
      // Save purchase item
      //
      // productId can be NULL for draft new product.
      // -----------------------------------------------

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
          cleanText(
            rawItem.barcode
          ),
          cleanText(
            rawItem.product_name
          ),
          cleanText(
            rawItem.size
          ),
          numberValue(
            rawItem.mrp
          ),
          purchasePrice,
          quantity,
          total,
        ]
      );

      // -----------------------------------------------
      // Draft / other non-completed statuses
      //
      // STOP HERE.
      // No stock.
      // No history.
      // -----------------------------------------------

      if (status !== "completed") {
        continue;
      }

      // -----------------------------------------------
      // Completed purchase must have product
      // -----------------------------------------------

      if (!productId) {
        throw new Error(
          "Product could not be resolved for completed purchase"
        );
      }

      // -----------------------------------------------
      // Add stock
      // -----------------------------------------------

      const balanceStock =
        await changeStock(
          connection,
          shopId,
          productId,
          quantity
        );

      // -----------------------------------------------
      // Add stock history
      // -----------------------------------------------

      await insertStockHistory(
        connection,
        {
          shopId,
          productId,
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

  // =====================================================
  // CREATE PURCHASE ENTRY
  // =====================================================

  exports.createPurchaseEntry =
    async (req, res) => {
      const connection =
        await db.getConnection();

      let transactionStarted = false;

      try {
        const validationError =
          validatePurchase(
            req.body
          );

        if (validationError) {
          return res.status(400).json({
            success: false,
            message: validationError,
          });
        }

        const shopId =
          req.user.shop_id;

        const userId =
          req.user.user_id;

        const supplierName =
          cleanText(
            req.body.supplier_name
          );

        const invoiceNumber =
          cleanText(
            req.body.invoice_number
          );

        const purchaseDate =
          cleanText(
            req.body.purchase_date
          );

        const notes =
          cleanText(
            req.body.notes
          );

        const status =
          normalizeStatus(
            req.body.status
          );

        const items =
          Array.isArray(
            req.body.items
          )
            ? req.body.items
            : [];

        const totalProducts =
          items.length;

        const totalQuantity =
          items.reduce(
            (sum, item) =>
              sum +
              intValue(
                item.quantity
              ),
            0
          );

        const totalAmount =
          items.reduce(
            (sum, item) => {
              const quantity =
                intValue(
                  item.quantity
                );

              const price =
                numberValue(
                  item.purchase_price
                );

              return (
                sum +
                (
                  numberValue(
                    item.total
                  ) ||
                  price * quantity
                )
              );
            },
            0
          );

        await connection.beginTransaction();
        transactionStarted = true;

        // -----------------------------------------------
        // Duplicate invoice check
        // -----------------------------------------------

        const [duplicate] =
          await connection.query(
            `SELECT id
            FROM purchase_entries
            WHERE shop_id = ?
            AND invoice_number = ?
            LIMIT 1`,
            [
              shopId,
              invoiceNumber,
            ]
          );

        if (duplicate.length > 0) {
          await connection.rollback();
          transactionStarted = false;

          return res.status(409).json({
            success: false,
            message:
              "This invoice number already exists for your shop",
          });
        }

        // -----------------------------------------------
        // Create purchase entry
        // -----------------------------------------------

        const [result] =
          await connection.query(
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

        // -----------------------------------------------
        // Insert items
        // -----------------------------------------------

        await insertItemsAndApplyStock({
          connection,
          purchaseEntryId:
            result.insertId,
          shopId,
          status,
          invoiceNumber,
          items,
        });

        await connection.commit();
        transactionStarted = false;

        return res.status(201).json({
          success: true,
          message:
            status === "draft"
              ? "Purchase draft saved successfully"
              : "Purchase entry saved successfully",
          purchase_entry_id:
            result.insertId,
        });
      } catch (error) {
        if (transactionStarted) {
          await connection.rollback();
        }

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

  // =====================================================
  // GET PRODUCT BY BARCODE
  //
  // Used by Purchase Entry barcode scanner.
  // Barcode identifies the existing product/article.
  // This function ONLY reads the product.
  // It does NOT create or change stock.
  // =====================================================

  exports.getProductByBarcode =
    async (req, res) => {
      try {
        const shopId =
          req.user.shop_id;

        const barcode =
          cleanText(req.params.barcode);

        if (!barcode) {
          return res.status(400).json({
            success: false,
            message: "Barcode is required",
          });
        }

        const [rows] =
          await db.query(
            `SELECT
              id,
              barcode,
              name,
              size,
              mrp,
              buying_price,
              stock
            FROM products
            WHERE shop_id = ?
            AND TRIM(
              COALESCE(barcode, '')
            ) = ?
            LIMIT 1`,
            [
              shopId,
              barcode,
            ]
          );

        if (rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Product not found for this barcode",
          });
        }

        const product = rows[0];

        return res.json({
          success: true,
          product: {
            id: product.id,
            barcode: product.barcode,
            product_name: product.name,
            size: product.size,
            mrp: product.mrp,
            purchase_price: product.buying_price,
            stock: product.stock,
          },
        });
      } catch (error) {
        console.error(
          "Get Product By Barcode Error:",
          error
        );

        return res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    };

  // =====================================================
  // GET PURCHASE ENTRIES
  // =====================================================

  exports.getPurchaseEntries =
    async (req, res) => {
      try {
        const shopId =
          req.user.shop_id;

        const status =
          cleanText(
            req.query.status
          );

        const search =
          cleanText(
            req.query.search
          );

        const startDate =
          cleanText(
            req.query.start_date
          );

        const endDate =
          cleanText(
            req.query.end_date
          );

        let where =
          "WHERE pe.shop_id = ?";

        const params = [
          shopId,
        ];

        if (
          status &&
          status !== "all"
        ) {
          where +=
            " AND pe.status = ?";

          params.push(
            normalizeStatus(
              status
            )
          );
        }

        if (search) {
          where += `
            AND (
              pe.supplier_name LIKE ?
              OR pe.invoice_number LIKE ?
            )
          `;

          const searchValue =
            `%${search}%`;

          params.push(
            searchValue,
            searchValue
          );
        }

        if (startDate) {
          where +=
            " AND pe.purchase_date >= ?";

          params.push(
            startDate
          );
        }

        if (endDate) {
          where +=
            " AND pe.purchase_date <= ?";

          params.push(
            endDate
          );
        }

        const [rows] =
          await db.query(
            `SELECT
              pe.*,
              creator.username
                AS created_by_name,
              updater.username
                AS updated_by_name
            FROM purchase_entries pe
            LEFT JOIN users creator
              ON creator.id = pe.created_by
            LEFT JOIN users updater
              ON updater.id = pe.updated_by
            ${where}
            ORDER BY
              pe.purchase_date DESC,
              pe.id DESC`,
            params
          );

        return res.json({
          success: true,
          count: rows.length,
          purchase_entries:
            rows,
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    };

  // =====================================================
  // GET PURCHASE ENTRY DETAILS
  // =====================================================

  exports.getPurchaseEntryDetails =
    async (req, res) => {
      try {
        const shopId =
          req.user.shop_id;

        const purchaseEntryId =
          req.params.id;

        const [entries] =
          await db.query(
            `SELECT
              pe.*,
              creator.username
                AS created_by_name,
              updater.username
                AS updated_by_name
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

        const [items] =
          await db.query(
            `SELECT *
            FROM purchase_entry_items
            WHERE purchase_entry_id = ?
            ORDER BY id ASC`,
            [
              purchaseEntryId,
            ]
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

  // =====================================================
  // UPDATE PURCHASE ENTRY
  // =====================================================

  exports.updatePurchaseEntry =
    async (req, res) => {
      const connection =
        await db.getConnection();

      let transactionStarted = false;

      try {
        const validationError =
          validatePurchase(
            req.body
          );

        if (validationError) {
          return res.status(400).json({
            success: false,
            message:
              validationError,
          });
        }

        const shopId =
          req.user.shop_id;

        const userId =
          req.user.user_id;

        const purchaseEntryId =
          req.params.id;

        // -----------------------------------------------
        // Check purchase exists
        // -----------------------------------------------

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

        const supplierName =
          cleanText(
            req.body.supplier_name
          );

        const invoiceNumber =
          cleanText(
            req.body.invoice_number
          );

        const purchaseDate =
          cleanText(
            req.body.purchase_date
          );

        const notes =
          cleanText(
            req.body.notes
          );

        const status =
          normalizeStatus(
            req.body.status
          );

        const items =
          Array.isArray(
            req.body.items
          )
            ? req.body.items
            : [];

        const totalProducts =
          items.length;

        const totalQuantity =
          items.reduce(
            (sum, item) =>
              sum +
              intValue(
                item.quantity
              ),
            0
          );

        const totalAmount =
          items.reduce(
            (sum, item) => {
              const quantity =
                intValue(
                  item.quantity
                );

              const price =
                numberValue(
                  item.purchase_price
                );

              return (
                sum +
                (
                  numberValue(
                    item.total
                  ) ||
                  price * quantity
                )
              );
            },
            0
          );

        await connection.beginTransaction();
        transactionStarted = true;

        // -----------------------------------------------
        // Duplicate invoice check
        // -----------------------------------------------

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
          transactionStarted = false;

          return res.status(409).json({
            success: false,
            message:
              "This invoice number already exists for your shop",
          });
        }

        // -----------------------------------------------
        // If OLD purchase was completed,
        // reverse its stock first.
        // -----------------------------------------------

        await reverseExistingCompletedStock(
          connection,
          purchaseEntryId,
          shopId
        );

        // -----------------------------------------------
        // Delete old purchase items
        // -----------------------------------------------

        await connection.query(
          `DELETE FROM purchase_entry_items
          WHERE purchase_entry_id = ?`,
          [
            purchaseEntryId,
          ]
        );

        // -----------------------------------------------
        // Update purchase entry
        // -----------------------------------------------

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

        // -----------------------------------------------
        // Insert new items
        // -----------------------------------------------

        await insertItemsAndApplyStock({
          connection,
          purchaseEntryId,
          shopId,
          status,
          invoiceNumber,
          items,
        });

        await connection.commit();
        transactionStarted = false;

        return res.json({
          success: true,
          message:
            status === "draft"
              ? "Purchase draft updated successfully"
              : "Purchase entry updated successfully",
        });
      } catch (error) {
        if (transactionStarted) {
          await connection.rollback();
        }

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

  // =====================================================
  // UPDATE PURCHASE STATUS
  //
  // Important:
  // Draft -> Completed:
  //   If product_id NULL:
  //   create/find product now,
  //   save product_id,
  //   add stock,
  //   add history.
  //
  // Draft itself:
  //   no stock.
  // =====================================================

  exports.updatePurchaseStatus =
    async (req, res) => {
      const connection =
        await db.getConnection();

      let transactionStarted = false;

      try {
        const shopId =
          req.user.shop_id;

        const userId =
          req.user.user_id;

        const purchaseEntryId =
          req.params.id;

        const newStatus =
          normalizeStatus(
            req.body.status
          );

        // -----------------------------------------------
        // Get purchase
        // -----------------------------------------------

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

        if (
          oldStatus === newStatus
        ) {
          return res.json({
            success: true,
            message:
              "Purchase status is already updated",
          });
        }

        await connection.beginTransaction();
        transactionStarted = true;

        // -----------------------------------------------
        // Get complete purchase items
        // -----------------------------------------------

        const [items] =
          await connection.query(
            `SELECT
              id,
              product_id,
              barcode,
              product_name,
              size,
              mrp,
              purchase_price,
              quantity,
              total
            FROM purchase_entry_items
            WHERE purchase_entry_id = ?
            ORDER BY id ASC`,
            [
              purchaseEntryId,
            ]
          );

        // -----------------------------------------------
        // COMPLETED -> DRAFT / OTHER
        //
        // Reverse old stock.
        // -----------------------------------------------

        if (
          oldStatus === "completed"
        ) {
          for (const item of items) {
            const productId =
              intValue(
                item.product_id,
                0
              );

            const quantity =
              intValue(
                item.quantity
              );

            if (!productId) {
              continue;
            }

            const balanceStock =
              await changeStock(
                connection,
                shopId,
                productId,
                -quantity
              );

            await insertStockHistory(
              connection,
              {
                shopId,
                productId,
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

        // -----------------------------------------------
        // DRAFT / OTHER -> COMPLETED
        //
        // Resolve/create products NOW.
        // -----------------------------------------------

        if (
          newStatus === "completed"
        ) {
          for (const item of items) {
            let productId =
              intValue(
                item.product_id,
                0
              );

            // ---------------------------------------------
            // New product from draft:
            // product_id is NULL.
            //
            // Create product NOW.
            // ---------------------------------------------

            if (!productId) {
              productId =
                await findOrCreateProduct(
                  connection,
                  shopId,
                  item
                );

              if (!productId) {
                throw new Error(
                  `Product could not be created for item ${item.id}`
                );
              }

              // Save newly resolved product ID
              await connection.query(
                `UPDATE purchase_entry_items
                SET product_id = ?
                WHERE id = ?
                AND purchase_entry_id = ?`,
                [
                  productId,
                  item.id,
                  purchaseEntryId,
                ]
              );
            } else {
              // Existing product:
              // Update product master details.
              await findOrCreateProduct(
                connection,
                shopId,
                {
                  ...item,
                  product_id:
                    productId,
                }
              );
            }

            const quantity =
              intValue(
                item.quantity
              );

            // ---------------------------------------------
            // Add stock
            // ---------------------------------------------

            const balanceStock =
              await changeStock(
                connection,
                shopId,
                productId,
                quantity
              );

            // ---------------------------------------------
            // Add history
            // ---------------------------------------------

            await insertStockHistory(
              connection,
              {
                shopId,
                productId,
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

        // -----------------------------------------------
        // Update purchase status
        // -----------------------------------------------

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
        transactionStarted = false;

        return res.json({
          success: true,
          message:
            "Purchase status updated successfully",
        });
      } catch (error) {
        if (transactionStarted) {
          await connection.rollback();
        }

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

  // =====================================================
  // DELETE PURCHASE ENTRY
  // =====================================================

  exports.deletePurchaseEntry =
    async (req, res) => {
      const connection =
        await db.getConnection();

      let transactionStarted = false;

      try {
        const role =
          cleanText(
            req.user.role
          ).toLowerCase();

        if (
          role !== "owner"
        ) {
          return res.status(403).json({
            success: false,
            message:
              "Only owner can delete purchase entry",
          });
        }

        const shopId =
          req.user.shop_id;

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
        transactionStarted = true;

        // Only completed purchase reverses stock.
        // Draft has no stock to reverse.
        await reverseExistingCompletedStock(
          connection,
          purchaseEntryId,
          shopId
        );

        // Delete purchase items
        await connection.query(
          `DELETE FROM purchase_entry_items
          WHERE purchase_entry_id = ?`,
          [
            purchaseEntryId,
          ]
        );

        // Delete purchase entry
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
        transactionStarted = false;

        return res.json({
          success: true,
          message:
            "Purchase entry deleted successfully",
        });
      } catch (error) {
        if (transactionStarted) {
          await connection.rollback();
        }

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

  // =====================================================
  // PURCHASE SUMMARY
  // =====================================================

  exports.getPurchaseSummary =
    async (req, res) => {
      try {
        const shopId =
          req.user.shop_id;

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

        const params = [
          shopId,
        ];

        if (
          filter === "today"
        ) {
          dateWhere =
            " AND purchase_date = CURDATE()";
        } else if (
          filter === "month"
        ) {
          dateWhere = `
            AND MONTH(purchase_date)
                = MONTH(CURDATE())
            AND YEAR(purchase_date)
                = YEAR(CURDATE())
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
              COALESCE(
                SUM(total_products),
                0
              ) AS total_products,
              COALESCE(
                SUM(total_quantity),
                0
              ) AS total_quantity,
              COALESCE(
                SUM(total_amount),
                0
              ) AS total_amount
            FROM purchase_entries
            WHERE shop_id = ?
            AND status = 'completed'
            ${dateWhere}`,
            params
          );

        return res.json({
          success: true,
          summary:
            rows[0],
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: error.message,
        });
      }
    };