const db = require("../config/db");

exports.createBill = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const shop_id = req.user.shop_id;
    const created_by = req.user.user_id;
   const { customer_name, discount, payment_type, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Bill items are required" });
    }

    let grandTotal = 0;
    let totalProfit = 0;

    for (const item of items) {
      const quantity = Number(item.quantity || 0);
      const sellingPrice = Number(item.selling_price || 0);
      const buyingPrice = Number(item.buying_price || 0);

      grandTotal += quantity * sellingPrice;
      totalProfit += (sellingPrice - buyingPrice) * quantity;
    }

    const discountAmount = Number(discount || 0);
    const finalTotal = grandTotal - discountAmount;

    const [billResult] = await connection.query(
      `INSERT INTO bills
(shop_id, customer_name, total, discount, payment_type, created_by)
VALUES (?, ?, ?, ?, ?, ?)`,
     [
  shop_id,
  customer_name || "",
  finalTotal < 0 ? 0 : finalTotal,
  discountAmount,
  payment_type || "cash",
  created_by
]
    );

    const billId = billResult.insertId;

    for (const item of items) {
      const productId = item.product_id;
      const quantity = Number(item.quantity || 0);
      const sellingPrice = Number(item.selling_price || 0);
      const buyingPrice = Number(item.buying_price || 0);

      const [productRows] = await connection.query(
        `SELECT id, name, stock FROM products WHERE id = ? AND shop_id = ?`,
        [productId, shop_id]
      );

      if (productRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: `Product not found: ${productId}` });
      }

      const product = productRows[0];

      if (product.stock < quantity) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} stock available for ${product.name}`,
        });
      }

      const total = quantity * sellingPrice;
      const profit = (sellingPrice - buyingPrice) * quantity;

      await connection.query(
        `INSERT INTO bill_items
         (bill_id, product_id, product_name, quantity, selling_price, buying_price, total, profit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [billId, productId, product.name, quantity, sellingPrice, buyingPrice, total, profit]
      );

      await connection.query(
        `UPDATE products SET stock = stock - ? WHERE id = ? AND shop_id = ?`,
        [quantity, productId, shop_id]
      );
      const newStock = product.stock - quantity;

if (newStock <= 5) {
  await connection.query(
    `INSERT INTO notifications
     (shop_id, title, message, type)
     VALUES (?, ?, ?, ?)`,
    [
      shop_id,
      "Low Stock Alert",
      `${product.name} stock only ${newStock} left`,
      "low_stock",
    ]
  );
}

    }

    await connection.query(
  `INSERT INTO notifications
   (shop_id, title, message, type)
   VALUES (?, ?, ?, ?)`,
  [
    shop_id,
    "New Bill Created",
    `Bill #${billId} created. Amount ₹${finalTotal}`,
    "bill",
  ]
);

    await connection.commit();

    return res.json({
      success: true,
      message: "Bill Created",
      bill_id: billId,
      total: finalTotal < 0 ? 0 : finalTotal,
      profit: totalProfit,
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

exports.updateBill = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const billId = req.params.id;
    const shop_id = req.user.shop_id;
    const edited_by = req.user.user_id;
    const { customer_name, discount, payment_type, items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({ success: false, message: "Bill items are required" });
    }

    const [oldBills] = await connection.query(
      `SELECT * FROM bills WHERE id = ? AND shop_id = ?`,
      [billId, shop_id]
    );

    if (oldBills.length === 0) {
      await connection.rollback();
      return res.status(404).json({ success: false, message: "Bill not found" });
    }

    const oldBill = oldBills[0];

    if (req.user.role !== "owner" && oldBill.created_by !== req.user.user_id) {
      await connection.rollback();
      return res.status(403).json({ success: false, message: "You can edit only your own bill" });
    }

    const [oldItems] = await connection.query(
      `SELECT product_id, quantity FROM bill_items WHERE bill_id = ?`,
      [billId]
    );

    for (const item of oldItems) {
      if (item.product_id) {
        await connection.query(
          `UPDATE products SET stock = stock + ? WHERE id = ? AND shop_id = ?`,
          [item.quantity, item.product_id, shop_id]
        );
      }
    }

    await connection.query(`DELETE FROM bill_items WHERE bill_id = ?`, [billId]);

    let grandTotal = 0;
    let totalProfit = 0;

    for (const item of items) {
      const productId = item.product_id;
      const quantity = Number(item.quantity || 0);
      const sellingPrice = Number(item.selling_price || 0);
      const buyingPrice = Number(item.buying_price || 0);

      const [productRows] = await connection.query(
        `SELECT id, name, stock FROM products WHERE id = ? AND shop_id = ?`,
        [productId, shop_id]
      );

      if (productRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({ success: false, message: `Product not found: ${productId}` });
      }

      const product = productRows[0];

      if (product.stock < quantity) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} stock available for ${product.name}`,
        });
      }

      const total = quantity * sellingPrice;
      const profit = (sellingPrice - buyingPrice) * quantity;

      grandTotal += total;
      totalProfit += profit;

      await connection.query(
        `INSERT INTO bill_items
         (bill_id, product_id, product_name, quantity, selling_price, buying_price, total, profit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [billId, productId, product.name, quantity, sellingPrice, buyingPrice, total, profit]
      );

      await connection.query(
        `UPDATE products SET stock = stock - ? WHERE id = ? AND shop_id = ?`,
        [quantity, productId, shop_id]
      );
    }

    const discountAmount = Number(discount || 0);
    const finalTotal = grandTotal - discountAmount;

    await connection.query(
      `UPDATE bills
SET customer_name = ?,
    total = ?,
    discount = ?,
    payment_type = ?,
    edited_by = ?,
    edited_at = CURRENT_TIMESTAMP`,
      [
  customer_name || "",
  finalTotal < 0 ? 0 : finalTotal,
  discountAmount,
  payment_type || "cash",
  edited_by,
  billId,
  shop_id
]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "Bill Updated",
      bill_id: billId,
      total: finalTotal < 0 ? 0 : finalTotal,
      profit: totalProfit,
      edited_by,
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};

exports.getBills = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;
    const user_id = req.user.user_id;
    const role = (req.user.role || "").toLowerCase();

    let query = `
      SELECT 
        b.*,
        u.username AS created_by_name,
        eu.username AS edited_by_name
      FROM bills b
      LEFT JOIN users u ON b.created_by = u.id
      LEFT JOIN users eu ON b.edited_by = eu.id
      WHERE b.shop_id = ?
    `;

    const params = [shop_id];

    if (role !== "owner") {
      query += ` AND b.created_by = ?`;
      params.push(user_id);
    }

    query += ` ORDER BY b.id DESC`;

    const [bills] = await db.query(query, params);

    for (const bill of bills) {
      const [items] = await db.query(
        `SELECT * FROM bill_items WHERE bill_id = ? ORDER BY id ASC`,
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
    return res.status(500).json({ success: false, error: error.message });
  }
};

exports.deleteBill = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const billId = req.params.id;
    const shop_id = req.user.shop_id;
    const role = (req.user.role || "").toLowerCase();

    if (role !== "owner") {
      await connection.rollback();
      return res.status(403).json({
        success: false,
        message: "Only owner can delete bills",
      });
    }

    const [billRows] = await connection.query(
      `SELECT * FROM bills WHERE id = ? AND shop_id = ?`,
      [billId, shop_id]
    );

    if (billRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({
        success: false,
        message: "Bill not found",
      });
    }

    const [items] = await connection.query(
      `SELECT product_id, quantity FROM bill_items WHERE bill_id = ?`,
      [billId]
    );

    for (const item of items) {
      if (item.product_id) {
        await connection.query(
          `UPDATE products SET stock = stock + ? WHERE id = ? AND shop_id = ?`,
          [item.quantity, item.product_id, shop_id]
        );
      }
    }

    await connection.query(`DELETE FROM bill_items WHERE bill_id = ?`, [billId]);

    await connection.query(
      `DELETE FROM bills WHERE id = ? AND shop_id = ?`,
      [billId, shop_id]
    );

    await connection.commit();

    return res.json({
      success: true,
      message: "Bill Deleted and Stock Restored",
    });
  } catch (error) {
    await connection.rollback();
    return res.status(500).json({ success: false, error: error.message });
  } finally {
    connection.release();
  }
};