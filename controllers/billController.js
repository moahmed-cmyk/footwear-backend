const db = require("../config/db");

// ============================================================
// CREATE BILL
// ============================================================

exports.createBill = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const shop_id = req.user.shop_id;
    const created_by = req.user.user_id;

    const role = (req.user.role || "")
      .toString()
      .toLowerCase();

    const {
      customer_name,
      discount,
      payment_type,
      cash_amount,
      upi_amount,
      items,
    } = req.body;

    // ----------------------------------------------------------
    // VALIDATE ITEMS
    // ----------------------------------------------------------

    if (!items || !Array.isArray(items) || items.length === 0) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Bill items are required",
      });
    }

    // ----------------------------------------------------------
    // CALCULATE BILL TOTAL
    // ----------------------------------------------------------

    let grandTotal = 0;
    let totalProfit = 0;

    for (const item of items) {
      const quantity = Number(item.quantity || 0);
      const sellingPrice = Number(item.selling_price || 0);
      const buyingPrice = Number(item.buying_price || 0);

      grandTotal += quantity * sellingPrice;

      totalProfit +=
        (sellingPrice - buyingPrice) * quantity;
    }

    const discountAmount = Number(discount || 0);

    let finalTotal =
      grandTotal - discountAmount;

    if (finalTotal < 0) {
      finalTotal = 0;
    }

    // ----------------------------------------------------------
    // PAYMENT
    // ----------------------------------------------------------

    let cashAmount =
      Number(cash_amount || 0);

    let upiAmount =
      Number(upi_amount || 0);

    if (cashAmount < 0) {
      cashAmount = 0;
    }

    if (upiAmount < 0) {
      upiAmount = 0;
    }

    const normalizedPaymentType =
      (payment_type || "cash")
        .toString()
        .toLowerCase();

    // CASH
    if (normalizedPaymentType === "cash") {
      cashAmount = finalTotal;
      upiAmount = 0;
    }

    // UPI
    else if (normalizedPaymentType === "upi") {
      cashAmount = 0;
      upiAmount = finalTotal;
    }

    // SPLIT
    else if (normalizedPaymentType === "split") {
      const totalPaid =
        cashAmount + upiAmount;

      if (
        Math.abs(totalPaid - finalTotal) > 0.01
      ) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "Cash + UPI amount must equal the bill total",
        });
      }
    }

    // INVALID PAYMENT
    else {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Invalid payment type",
      });
    }

    // ==========================================================
    // GENERATE INTERNAL DATABASE ID
    // ==========================================================
    //
    // bills.id is ONLY internal database ID.
    // It is NOT the customer Bill Number.
    //
    // TiDB sequence can jump. That is okay.
    //
    // ==========================================================

    const [sequenceRows] =
      await connection.query(
        `SELECT NEXTVAL(bills_id_seq) AS id`
      );

    const billId = Number(
      sequenceRows[0]?.id || 0
    );

    if (!billId || billId <= 0) {
      await connection.rollback();

      return res.status(500).json({
        success: false,
        message: "Failed to generate internal bill ID",
      });
    }

    // ==========================================================
    // GENERATE CUSTOMER BILL NUMBER
    // ==========================================================
    //
    // Example:
    // 48 -> 49 -> 50 -> 51
    //
    // Each shop has its own counter.
    //
    // ==========================================================

    const [counterRows] =
      await connection.query(
        `
        SELECT last_bill_number
        FROM bill_counters
        WHERE shop_id = ?
        FOR UPDATE
        `,
        [shop_id]
      );

    let billNumber = 0;

    if (counterRows.length === 0) {
      billNumber = 1;

      await connection.query(
        `
        INSERT INTO bill_counters
        (
          shop_id,
          last_bill_number
        )
        VALUES (?, ?)
        `,
        [
          shop_id,
          billNumber,
        ]
      );
    } else {
      billNumber =
        Number(
          counterRows[0].last_bill_number || 0
        ) + 1;

      await connection.query(
        `
        UPDATE bill_counters
        SET last_bill_number = ?
        WHERE shop_id = ?
        `,
        [
          billNumber,
          shop_id,
        ]
      );
    }

    if (!billNumber || billNumber <= 0) {
      await connection.rollback();

      return res.status(500).json({
        success: false,
        message: "Failed to generate Bill Number",
      });
    }

    // ==========================================================
    // INSERT BILL
    // ==========================================================

    await connection.query(
      `
      INSERT INTO bills
      (
        id,
        bill_number,
        shop_id,
        customer_name,
        total,
        discount,
        payment_type,
        cash_amount,
        upi_amount,
        created_by
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        billId,
        billNumber,
        shop_id,
        customer_name || "",
        finalTotal,
        discountAmount,
        normalizedPaymentType,
        cashAmount,
        upiAmount,
        created_by,
      ]
    );

    // ==========================================================
    // INSERT BILL ITEMS + REDUCE STOCK
    // ==========================================================

    for (const item of items) {
      const productId =
        item.product_id;

      const quantity =
        Number(item.quantity || 0);

      const sellingPrice =
        Number(item.selling_price || 0);

      const buyingPrice =
        Number(item.buying_price || 0);

      if (!productId) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message: "Product ID is required",
        });
      }

      if (quantity <= 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "Quantity must be greater than 0",
        });
      }

      // --------------------------------------------------------
      // GET PRODUCT
      // --------------------------------------------------------

      const [productRows] =
        await connection.query(
          `
          SELECT id, name, stock
          FROM products
          WHERE id = ?
            AND shop_id = ?
          `,
          [
            productId,
            shop_id,
          ]
        );

      if (productRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            `Product not found: ${productId}`,
        });
      }

      const product =
        productRows[0];

      // --------------------------------------------------------
      // STOCK CHECK
      // --------------------------------------------------------

      if (product.stock < quantity) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Only ${product.stock} stock available for ${product.name}`,
        });
      }

      const total =
        quantity * sellingPrice;

      const profit =
        (sellingPrice - buyingPrice) *
        quantity;

      // --------------------------------------------------------
      // INSERT BILL ITEM
      // --------------------------------------------------------

      await connection.query(
        `
        INSERT INTO bill_items
        (
          bill_id,
          product_id,
          product_name,
          quantity,
          selling_price,
          buying_price,
          total,
          profit
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          billId,
          productId,
          product.name,
          quantity,
          sellingPrice,
          buyingPrice,
          total,
          profit,
        ]
      );

      // --------------------------------------------------------
      // REDUCE STOCK
      // --------------------------------------------------------

      await connection.query(
        `
        UPDATE products
        SET stock = stock - ?
        WHERE id = ?
          AND shop_id = ?
        `,
        [
          quantity,
          productId,
          shop_id,
        ]
      );

      // --------------------------------------------------------
      // LOW STOCK NOTIFICATION
      // --------------------------------------------------------

      const newStock =
        product.stock - quantity;

      if (newStock <= 5) {
        await connection.query(
          `
          INSERT INTO notifications
          (
            shop_id,
            title,
            message,
            type
          )
          VALUES (?, ?, ?, ?)
          `,
          [
            shop_id,
            "Low Stock Alert",
            `${product.name} stock only ${newStock} left`,
            "low_stock",
          ]
        );
      }
    }

    // ==========================================================
    // STAFF BILL NOTIFICATION
    // ==========================================================

    if (role === "staff") {
      let creatorName = "Staff";

      try {
        const [userRows] =
          await connection.query(
            `
            SELECT name
            FROM users
            WHERE id = ?
              AND shop_id = ?
            LIMIT 1
            `,
            [
              created_by,
              shop_id,
            ]
          );

        if (userRows.length > 0) {
          creatorName =
            userRows[0].name
              ?.toString()
              .trim() || "Staff";
        }
      } catch (userError) {
        console.error(
          "CREATOR NAME FETCH ERROR:",
          userError
        );
      }

      await connection.query(
        `
        INSERT INTO notifications
        (
          shop_id,
          title,
          message,
          type
        )
        VALUES (?, ?, ?, ?)
        `,
        [
          shop_id,
          "New Bill Created",
          `Bill #${billNumber} created by ${creatorName}. Amount ₹${finalTotal}`,
          "bill",
        ]
      );
    }

    // ==========================================================
    // COMMIT
    // ==========================================================

    await connection.commit();

    return res.json({
      success: true,
      message: "Bill Created",

      // INTERNAL DATABASE ID
      bill_id: billId,

      // CUSTOMER BILL NUMBER
      bill_number: billNumber,

      total: finalTotal,
      profit: totalProfit,
      payment_type: normalizedPaymentType,
      cash_amount: cashAmount,
      upi_amount: upiAmount,
    });

  } catch (error) {
    await connection.rollback();

    console.error(
      "CREATE BILL ERROR:",
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


// ============================================================
// UPDATE BILL
// ============================================================

exports.updateBill = async (req, res) => {
  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    const billId =
      req.params.id;

    const shop_id =
      req.user.shop_id;

    // Person who edits
    const edited_by =
      req.user.user_id;

    const {
      customer_name,
      discount,
      payment_type,
      cash_amount,
      upi_amount,
      items,
    } = req.body;

    // ----------------------------------------------------------
    // VALIDATE
    // ----------------------------------------------------------

    if (
      !items ||
      !Array.isArray(items) ||
      items.length === 0
    ) {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Bill items are required",
      });
    }

    // ----------------------------------------------------------
    // GET OLD BILL
    // ----------------------------------------------------------

    const [oldBills] =
      await connection.query(
        `
        SELECT *
        FROM bills
        WHERE id = ?
          AND shop_id = ?
        `,
        [
          billId,
          shop_id,
        ]
      );

    if (oldBills.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message: "Bill not found",
      });
    }

    const oldBill =
      oldBills[0];

    // ----------------------------------------------------------
    // STAFF CAN EDIT ONLY OWN BILL
    // OWNER CAN EDIT ANY BILL
    // ----------------------------------------------------------

    const role =
      (req.user.role || "")
        .toString()
        .toLowerCase();

    if (
      role !== "owner" &&
      Number(oldBill.created_by) !==
        Number(req.user.user_id)
    ) {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message:
          "You can edit only your own bill",
      });
    }

    // ----------------------------------------------------------
    // RESTORE OLD STOCK
    // ----------------------------------------------------------

    const [oldItems] =
      await connection.query(
        `
        SELECT product_id, quantity
        FROM bill_items
        WHERE bill_id = ?
        `,
        [billId]
      );

    for (const item of oldItems) {
      if (item.product_id) {
        await connection.query(
          `
          UPDATE products
          SET stock = stock + ?
          WHERE id = ?
            AND shop_id = ?
          `,
          [
            item.quantity,
            item.product_id,
            shop_id,
          ]
        );
      }
    }

    // ----------------------------------------------------------
    // DELETE OLD ITEMS
    // ----------------------------------------------------------

    await connection.query(
      `
      DELETE FROM bill_items
      WHERE bill_id = ?
      `,
      [billId]
    );

    // ----------------------------------------------------------
    // CALCULATE NEW TOTAL
    // ----------------------------------------------------------

    let grandTotal = 0;
    let totalProfit = 0;

    for (const item of items) {
      const quantity =
        Number(item.quantity || 0);

      const sellingPrice =
        Number(item.selling_price || 0);

      const buyingPrice =
        Number(item.buying_price || 0);

      grandTotal +=
        quantity * sellingPrice;

      totalProfit +=
        (sellingPrice - buyingPrice) *
        quantity;
    }

    const discountAmount =
      Number(discount || 0);

    let finalTotal =
      grandTotal - discountAmount;

    if (finalTotal < 0) {
      finalTotal = 0;
    }

    // ----------------------------------------------------------
    // PAYMENT
    // ----------------------------------------------------------

    let cashAmount =
      Number(cash_amount || 0);

    let upiAmount =
      Number(upi_amount || 0);

    if (cashAmount < 0) {
      cashAmount = 0;
    }

    if (upiAmount < 0) {
      upiAmount = 0;
    }

    const normalizedPaymentType =
      (payment_type || "cash")
        .toString()
        .toLowerCase();

    if (
      normalizedPaymentType === "cash"
    ) {
      cashAmount = finalTotal;
      upiAmount = 0;
    }

    else if (
      normalizedPaymentType === "upi"
    ) {
      cashAmount = 0;
      upiAmount = finalTotal;
    }

    else if (
      normalizedPaymentType === "split"
    ) {
      const totalPaid =
        cashAmount + upiAmount;

      if (
        Math.abs(
          totalPaid - finalTotal
        ) > 0.01
      ) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "Cash + UPI amount must equal the bill total",
        });
      }
    }

    else {
      await connection.rollback();

      return res.status(400).json({
        success: false,
        message: "Invalid payment type",
      });
    }

    // ----------------------------------------------------------
    // INSERT NEW ITEMS
    // ----------------------------------------------------------

    for (const item of items) {
      const productId =
        item.product_id;

      const quantity =
        Number(item.quantity || 0);

      const sellingPrice =
        Number(item.selling_price || 0);

      const buyingPrice =
        Number(item.buying_price || 0);

      if (!productId) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "Product ID is required",
        });
      }

      if (quantity <= 0) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            "Quantity must be greater than 0",
        });
      }

      const [productRows] =
        await connection.query(
          `
          SELECT id, name, stock
          FROM products
          WHERE id = ?
            AND shop_id = ?
          `,
          [
            productId,
            shop_id,
          ]
        );

      if (productRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          success: false,
          message:
            `Product not found: ${productId}`,
        });
      }

      const product =
        productRows[0];

      if (product.stock < quantity) {
        await connection.rollback();

        return res.status(400).json({
          success: false,
          message:
            `Only ${product.stock} stock available for ${product.name}`,
        });
      }

      const total =
        quantity * sellingPrice;

      const profit =
        (sellingPrice - buyingPrice) *
        quantity;

      // INSERT ITEM

      await connection.query(
        `
        INSERT INTO bill_items
        (
          bill_id,
          product_id,
          product_name,
          quantity,
          selling_price,
          buying_price,
          total,
          profit
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          billId,
          productId,
          product.name,
          quantity,
          sellingPrice,
          buyingPrice,
          total,
          profit,
        ]
      );

      // REDUCE STOCK

      await connection.query(
        `
        UPDATE products
        SET stock = stock - ?
        WHERE id = ?
          AND shop_id = ?
        `,
        [
          quantity,
          productId,
          shop_id,
        ]
      );
    }

    // ----------------------------------------------------------
    // UPDATE BILL
    // ----------------------------------------------------------
    //
    // IMPORTANT:
    // bill_number is NOT changed.
    //
    // Example:
    // Bill 49 remains Bill 49 after editing.
    //
    // edited_by stores whoever edited it.
    // ----------------------------------------------------------

    await connection.query(
      `
      UPDATE bills
      SET customer_name = ?,
          total = ?,
          discount = ?,
          payment_type = ?,
          cash_amount = ?,
          upi_amount = ?,
          edited_by = ?,
          edited_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND shop_id = ?
      `,
      [
        customer_name || "",
        finalTotal,
        discountAmount,
        normalizedPaymentType,
        cashAmount,
        upiAmount,
        edited_by,
        billId,
        shop_id,
      ]
    );

    // ----------------------------------------------------------
    // COMMIT
    // ----------------------------------------------------------

    await connection.commit();

    return res.json({
      success: true,
      message: "Bill Updated",
      bill_id: billId,
      bill_number:
        oldBill.bill_number,
      total: finalTotal,
      profit: totalProfit,
      payment_type:
        normalizedPaymentType,
      cash_amount: cashAmount,
      upi_amount: upiAmount,
      edited_by,
    });

  } catch (error) {
    await connection.rollback();

    console.error(
      "UPDATE BILL ERROR:",
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


// ============================================================
// GET BILLS
// ============================================================

exports.getBills = async (req, res) => {
  try {
    const shop_id =
      req.user.shop_id;

    const user_id =
      req.user.user_id;

    const role =
      (req.user.role || "")
        .toString()
        .toLowerCase();

    // ----------------------------------------------------------
    // CREATED BY / EDITED BY NAMES
    // ----------------------------------------------------------

    let query = `
      SELECT
        b.*,
        u.name AS created_by_name,
        eu.name AS edited_by_name
      FROM bills b

      LEFT JOIN users u
        ON b.created_by = u.id

      LEFT JOIN users eu
        ON b.edited_by = eu.id

      WHERE b.shop_id = ?
    `;

    const params = [
      shop_id,
    ];

    // ----------------------------------------------------------
    // STAFF -> OWN BILLS ONLY
    // OWNER -> ALL SHOP BILLS
    // ----------------------------------------------------------

    if (role !== "owner") {
      query += `
        AND b.created_by = ?
      `;

      params.push(user_id);
    }

    // ----------------------------------------------------------
    // ORDER
    // ----------------------------------------------------------
    //
    // IMPORTANT:
    // Bill History should use bill_number order,
    // NOT the internal database ID.
    //
    // ----------------------------------------------------------

    query += `
      ORDER BY
        b.bill_number DESC
    `;

    const [bills] =
      await db.query(
        query,
        params
      );

    // ----------------------------------------------------------
    // LOAD BILL ITEMS
    // ----------------------------------------------------------

    for (const bill of bills) {
      const [items] =
        await db.query(
          `
          SELECT *
          FROM bill_items
          WHERE bill_id = ?
          ORDER BY id ASC
          `,
          [bill.id]
        );

      bill.items = items;
    }

    return res.json({
      success: true,
      count: bills.length,
      bills,
    });

  } catch (error) {
    console.error(
      "GET BILLS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};


// ============================================================
// DELETE BILL
// ============================================================

exports.deleteBill = async (req, res) => {
  const connection =
    await db.getConnection();

  try {
    await connection.beginTransaction();

    const billId =
      req.params.id;

    const shop_id =
      req.user.shop_id;

    const role =
      (req.user.role || "")
        .toString()
        .toLowerCase();

    // ----------------------------------------------------------
    // OWNER ONLY
    // ----------------------------------------------------------

    if (role !== "owner") {
      await connection.rollback();

      return res.status(403).json({
        success: false,
        message:
          "Only owner can delete bills",
      });
    }

    // ----------------------------------------------------------
    // GET BILL
    // ----------------------------------------------------------

    const [billRows] =
      await connection.query(
        `
        SELECT *
        FROM bills
        WHERE id = ?
          AND shop_id = ?
        `,
        [
          billId,
          shop_id,
        ]
      );

    if (billRows.length === 0) {
      await connection.rollback();

      return res.status(404).json({
        success: false,
        message:
          "Bill not found",
      });
    }

    // ----------------------------------------------------------
    // GET ITEMS
    // ----------------------------------------------------------

    const [items] =
      await connection.query(
        `
        SELECT product_id, quantity
        FROM bill_items
        WHERE bill_id = ?
        `,
        [billId]
      );

    // ----------------------------------------------------------
    // RESTORE STOCK
    // ----------------------------------------------------------

    for (const item of items) {
      if (item.product_id) {
        await connection.query(
          `
          UPDATE products
          SET stock = stock + ?
          WHERE id = ?
            AND shop_id = ?
          `,
          [
            item.quantity,
            item.product_id,
            shop_id,
          ]
        );
      }
    }

    // ----------------------------------------------------------
    // DELETE BILL ITEMS
    // ----------------------------------------------------------

    await connection.query(
      `
      DELETE FROM bill_items
      WHERE bill_id = ?
      `,
      [billId]
    );

    // ----------------------------------------------------------
    // DELETE BILL
    // ----------------------------------------------------------

    await connection.query(
      `
      DELETE FROM bills
      WHERE id = ?
        AND shop_id = ?
      `,
      [
        billId,
        shop_id,
      ]
    );

    // ----------------------------------------------------------
    // IMPORTANT
    // ----------------------------------------------------------
    //
    // We DO NOT decrease bill_counters.
    //
    // Example:
    // Bills 1...49 exist
    // Bill 49 deleted
    // Next bill = 50
    //
    // This prevents duplicate Bill Numbers.
    //
    // ----------------------------------------------------------

    await connection.commit();

    return res.json({
      success: true,
      message:
        "Bill Deleted and Stock Restored",
    });

  } catch (error) {
    await connection.rollback();

    console.error(
      "DELETE BILL ERROR:",
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