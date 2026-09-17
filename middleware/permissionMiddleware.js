const db = require("../config/db");

function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      // Must be logged in
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: "Authentication required",
        });
      }

      const userId = req.user.user_id;
      const shopId = req.user.shop_id;
      const role = (req.user.role || "").toLowerCase();

      // Owner always has full access
      if (role === "owner") {
        return next();
      }

      // Only staff needs permission checking
      if (role !== "staff") {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }

      // Check staff permission
      if (
  permission === "create_bill" ||
  permission === "bill_history"
) {
  return next();
}
      const [rows] = await db.query(
        `
        SELECT enabled
        FROM staff_permissions
        WHERE staff_id = ?
          AND shop_id = ?
          AND permission = ?
        LIMIT 1
        `,
        [userId, shopId, permission]
      );

      if (rows.length === 0 || !Boolean(rows[0].enabled)) {
        return res.status(403).json({
          success: false,
          message: `Permission denied: ${permission}`,
        });
      }

      next();
    } catch (error) {
      console.error(
        "PERMISSION MIDDLEWARE ERROR:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Permission check failed",
      });
    }
  };
}

module.exports = requirePermission;