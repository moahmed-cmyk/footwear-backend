const db = require("../config/db");

exports.createBill = async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const shop_id = req.user.shop_id;
    const created_by = req.user.user_id;

    const {
      customer_name,
      discount,
      items,
    } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      await connection.rollback();
      return res.status(400).json({
        success: false,
        message: "Bill items are required",
      });
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
       (shop_id, customer_name, total, discount, created_by)
       VALUES (?, ?, ?, ?, ?)`,
      [
        shop_id,
        customer_name || "",
        finalTotal < 0 ? 0 : finalTotal,
        discountAmount,
        created_by,
      ]
    );

    const billId = billResult.insertId;

    for (const item of items) {
      const productId = item.product_id;
      const quantity = Number(item.quantity || 0);
      const sellingPrice = Number(item.selling_price || 0);
      const buyingPrice = Number(item.buying_price || 0);
      const total = quantity * sellingPrice;
      const profit = (sellingPrice - buyingPrice) * quantity;

      const [productRows] = await connection.query(
        `SELECT id, name, stock FROM products
         WHERE id = ? AND shop_id = ?`,
        [productId, shop_id]
      );

      if (productRows.length === 0) {
        await connection.rollback();
        return res.status(404).json({
          success: false,
          message: `Product not found: ${productId}`,
        });
      }

      const product = productRows[0];

      if (product.stock < quantity) {
        await connection.rollback();
        return res.status(400).json({
          success: false,
          message: `Only ${product.stock} stock available for ${product.name}`,
        });
      }

      await connection.query(
        `INSERT INTO bill_items
         (bill_id, product_id, product_name, quantity, selling_price, buying_price, total, profit)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
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

      await connection.query(
        `UPDATE products
         SET stock = stock - ?
         WHERE id = ? AND shop_id = ?`,
        [quantity, productId, shop_id]
      );
    }

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

    return res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    connection.release();
  }
};

exports.getBills = async (req, res) => {
  try {
    const shop_id = req.user.shop_id;

    const [bills] = await db.query(
      `SELECT 
        b.*,
        u.username AS created_by_name
       FROM bills b
       LEFT JOIN users u ON b.created_by = u.id
       WHERE b.shop_id = ?
       ORDER BY b.id DESC`,
      [shop_id]
    );

    for (const bill of bills) {
      const [items] = await db.query(
        `SELECT * FROM bill_items
         WHERE bill_id = ?
         ORDER BY id ASC`,
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
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};