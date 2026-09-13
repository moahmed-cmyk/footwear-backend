const db = require("../config/db");

/*
|--------------------------------------------------------------------------
| AVAILABLE STAFF PERMISSIONS
|--------------------------------------------------------------------------
*/

const AVAILABLE_PERMISSIONS = [
  "create_bill",
  "bill_history",
  "products",
  "purchase",
  "expenses",
  "reports",
  "staff_management",
  "settings",
  "stock",
];

/*
|--------------------------------------------------------------------------
| CHECK OWNER
|--------------------------------------------------------------------------
*/

const checkOwner = (req, res) => {
  if (
    !req.user ||
    String(req.user.role || "").toLowerCase() !== "owner"
  ) {
    res.status(403).json({
      success: false,
      message: "Only shop owner can manage staff permissions",
    });

    return false;
  }

  return true;
};

/*
|--------------------------------------------------------------------------
| CHECK STAFF BELONGS TO OWNER'S SHOP
|--------------------------------------------------------------------------
*/

const getStaffForOwner = async (staffId, shopId) => {
  const [rows] = await db.query(
    `
    SELECT
      id,
      shop_id,
      username,
      phone,
      role,
      status
    FROM users
    WHERE id = ?
      AND shop_id = ?
      AND role = 'staff'
    LIMIT 1
    `,
    [staffId, shopId]
  );

  return rows[0] || null;
};

/*
|--------------------------------------------------------------------------
| GET STAFF PERMISSIONS - OWNER
|--------------------------------------------------------------------------
|
| GET /staff/:id/permissions
|
*/

exports.getStaffPermissions = async (req, res) => {
  try {
    if (!checkOwner(req, res)) {
      return;
    }

    const staffId = Number(req.params.id);
    const shopId = Number(req.user.shop_id);

    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid staff ID",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CHECK STAFF
    |--------------------------------------------------------------------------
    */

    const staff = await getStaffForOwner(
      staffId,
      shopId
    );

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff member not found",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | GET PERMISSIONS
    |--------------------------------------------------------------------------
    */

    const [rows] = await db.query(
      `
      SELECT
        permission,
        enabled
      FROM staff_permissions
      WHERE staff_id = ?
        AND shop_id = ?
      ORDER BY permission ASC
      `,
      [staffId, shopId]
    );

    /*
    |--------------------------------------------------------------------------
    | RETURN ALL AVAILABLE PERMISSIONS
    |--------------------------------------------------------------------------
    |
    | If a permission doesn't exist in DB yet,
    | return false.
    |
    */

    const permissions = {};

    for (const permission of AVAILABLE_PERMISSIONS) {
      permissions[permission] = false;
    }

    for (const row of rows) {
      if (
        AVAILABLE_PERMISSIONS.includes(
          row.permission
        )
      ) {
        permissions[row.permission] =
          Boolean(row.enabled);
      }
    }

    return res.json({
      success: true,

      staff: {
        id: staff.id,
        username: staff.username,
        phone: staff.phone,
        role: staff.role,
        status: staff.status,
      },

      permissions,
    });
  } catch (error) {
    console.error(
      "GET STAFF PERMISSIONS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to get staff permissions",
      error: error.message,
    });
  }
};

/*
|--------------------------------------------------------------------------
| UPDATE STAFF PERMISSIONS - OWNER
|--------------------------------------------------------------------------
|
| PUT /staff/:id/permissions
|
| Body:
|
| {
|   "permissions": {
|     "create_bill": true,
|     "bill_history": true,
|     "products": true,
|     "purchase": false
|   }
| }
|
*/

exports.updateStaffPermissions = async (
  req,
  res
) => {
  let connection;

  try {
    if (!checkOwner(req, res)) {
      return;
    }

    const staffId = Number(req.params.id);
    const shopId = Number(req.user.shop_id);

    if (!Number.isInteger(staffId) || staffId <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid staff ID",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | CHECK STAFF
    |--------------------------------------------------------------------------
    */

    const staff = await getStaffForOwner(
      staffId,
      shopId
    );

    if (!staff) {
      return res.status(404).json({
        success: false,
        message: "Staff member not found",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | VALIDATE BODY
    |--------------------------------------------------------------------------
    */

    const incomingPermissions =
      req.body.permissions;

    if (
      !incomingPermissions ||
      typeof incomingPermissions !== "object" ||
      Array.isArray(incomingPermissions)
    ) {
      return res.status(400).json({
        success: false,
        message:
          "permissions object is required",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | NORMALIZE PERMISSIONS
    |--------------------------------------------------------------------------
    */

    const finalPermissions = {};

    for (const permission of AVAILABLE_PERMISSIONS) {
      finalPermissions[permission] =
        incomingPermissions[permission] === true;
    }

    /*
    |--------------------------------------------------------------------------
    | DATABASE TRANSACTION
    |--------------------------------------------------------------------------
    */

    connection =
      await db.getConnection();

    await connection.beginTransaction();

    /*
    |--------------------------------------------------------------------------
    | SAVE EACH PERMISSION
    |--------------------------------------------------------------------------
    */

    for (const permission of AVAILABLE_PERMISSIONS) {
      const enabled =
        finalPermissions[permission];

      /*
      | Get a new ID from TiDB sequence
      */

      const [existing] =
        await connection.query(
          `
          SELECT id
          FROM staff_permissions
          WHERE staff_id = ?
            AND permission = ?
          LIMIT 1
          `,
          [
            staffId,
            permission,
          ]
        );

      if (existing.length > 0) {
        /*
        |--------------------------------------------------------------------------
        | UPDATE EXISTING
        |--------------------------------------------------------------------------
        */

        await connection.query(
          `
          UPDATE staff_permissions
          SET
            enabled = ?,
            shop_id = ?,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          `,
          [
            enabled,
            shopId,
            existing[0].id,
          ]
        );
      } else {
        /*
        |--------------------------------------------------------------------------
        | CREATE NEW ID FROM SEQUENCE
        |--------------------------------------------------------------------------
        */

        const [sequenceRows] =
          await connection.query(
            `
            SELECT
              NEXT VALUE FOR staff_permissions_id_seq
              AS permission_id
            `
          );

        const permissionId =
          Number(
            sequenceRows[0]
              .permission_id
          );

        await connection.query(
          `
          INSERT INTO staff_permissions
          (
            id,
            shop_id,
            staff_id,
            permission,
            enabled
          )
          VALUES (?, ?, ?, ?, ?)
          `,
          [
            permissionId,
            shopId,
            staffId,
            permission,
            enabled,
          ]
        );
      }
    }

    await connection.commit();

    /*
    |--------------------------------------------------------------------------
    | RESPONSE
    |--------------------------------------------------------------------------
    */

    return res.json({
      success: true,
      message:
        "Staff permissions updated successfully",

      staff_id: staffId,

      permissions:
        finalPermissions,
    });
  } catch (error) {
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error(
          "PERMISSION ROLLBACK ERROR:",
          rollbackError
        );
      }
    }

    console.error(
      "UPDATE STAFF PERMISSIONS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to update staff permissions",
      error: error.message,
    });
  } finally {
    if (connection) {
      connection.release();
    }
  }
};

/*
|--------------------------------------------------------------------------
| GET MY PERMISSIONS - STAFF
|--------------------------------------------------------------------------
|
| GET /staff/my-permissions
|
*/

exports.getMyPermissions = async (
  req,
  res
) => {
  try {
    /*
    |--------------------------------------------------------------------------
    | STAFF CHECK
    |--------------------------------------------------------------------------
    */

    if (
      !req.user ||
      String(req.user.role || "").toLowerCase() !==
        "staff"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "Only staff can access staff permissions",
      });
    }

    const staffId =
      Number(req.user.user_id);

    const shopId =
      Number(req.user.shop_id);

    /*
    |--------------------------------------------------------------------------
    | GET STAFF
    |--------------------------------------------------------------------------
    */

    const [staffRows] =
      await db.query(
        `
        SELECT
          id,
          shop_id,
          username,
          phone,
          role,
          status
        FROM users
        WHERE id = ?
          AND shop_id = ?
          AND role = 'staff'
        LIMIT 1
        `,
        [
          staffId,
          shopId,
        ]
      );

    const staff =
      staffRows[0];

    if (!staff) {
      return res.status(404).json({
        success: false,
        message:
          "Staff account not found",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | STATUS CHECK
    |--------------------------------------------------------------------------
    */

    if (staff.status !== "active") {
      return res.status(403).json({
        success: false,
        message:
          "Staff account is inactive",
      });
    }

    /*
    |--------------------------------------------------------------------------
    | GET PERMISSIONS
    |--------------------------------------------------------------------------
    */

    const [rows] =
      await db.query(
        `
        SELECT
          permission,
          enabled
        FROM staff_permissions
        WHERE staff_id = ?
          AND shop_id = ?
        `,
        [
          staffId,
          shopId,
        ]
      );

    /*
    |--------------------------------------------------------------------------
    | DEFAULT ALL TO FALSE
    |--------------------------------------------------------------------------
    */

    const permissions = {};

    for (const permission of AVAILABLE_PERMISSIONS) {
      permissions[permission] = false;
    }

    for (const row of rows) {
      if (
        AVAILABLE_PERMISSIONS.includes(
          row.permission
        )
      ) {
        permissions[row.permission] =
          Boolean(row.enabled);
      }
    }

    /*
    |--------------------------------------------------------------------------
    | RESPONSE
    |--------------------------------------------------------------------------
    */

    return res.json({
      success: true,

      staff: {
        id: staff.id,
        shop_id: staff.shop_id,
        username: staff.username,
        phone: staff.phone,
        role: staff.role,
      },

      permissions,
    });
  } catch (error) {
    console.error(
      "GET MY PERMISSIONS ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message:
        "Failed to get staff permissions",
      error: error.message,
    });
  }
};