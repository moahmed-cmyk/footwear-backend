exports.addStaff = async (req, res) => {
  try {
    // ============================================================
    // OWNER CHECK
    // ============================================================

    if ((req.user.role || "").toLowerCase() !== "owner") {
      return res.status(403).json({
        success: false,
        message: "Only shop owner can add staff",
      });
    }

    const staffName = String(
      req.body.staff_name || ""
    ).trim();

    const normalizedPhone = normalizePhone(
      req.body.phone
    );

    const shopId = Number(
      req.user.shop_id
    );

    // ============================================================
    // DEBUG
    // ============================================================

    console.log("ADD STAFF DEBUG:", {
      userId: req.user.user_id,
      shopId: shopId,
      phoneFromRequest: req.body.phone,
      normalizedPhone: normalizedPhone,
      role: req.user.role,
    });

    // ============================================================
    // VALIDATION
    // ============================================================

    if (!staffName || !normalizedPhone) {
      return res.status(400).json({
        success: false,
        message: "Staff name and phone are required",
      });
    }

    if (!/^[6-9]\d{9}$/.test(normalizedPhone)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid Indian mobile number",
      });
    }

    if (!shopId) {
      return res.status(400).json({
        success: false,
        message: "Invalid shop",
      });
    }

    // ============================================================
    // CHECK SAME SHOP + SAME PHONE
    // ============================================================

    const [existingStaff] = await db.query(
      `
      SELECT
        id,
        shop_id,
        name,
        phone,
        role,
        status
      FROM users
      WHERE shop_id = ?
        AND phone = ?
        AND role = 'staff'
      `,
      [
        shopId,
        normalizedPhone,
      ]
    );

    console.log(
      "EXISTING STAFF DEBUG:",
      existingStaff
    );

    if (existingStaff.length > 0) {
      console.log(
        "DUPLICATE STAFF BLOCKED:",
        normalizedPhone
      );

      return res.status(409).json({
        success: false,
        message:
          "This staff member is already added to this shop",
      });
    }

    // ============================================================
    // CHECK PHONE USED BY ANY ACCOUNT
    // ============================================================

    const [existingAccount] = await db.query(
      `
      SELECT
        id,
        shop_id,
        name,
        phone,
        role,
        status
      FROM users
      WHERE phone = ?
      `,
      [normalizedPhone]
    );

    console.log(
      "EXISTING ACCOUNT DEBUG:",
      existingAccount
    );

    if (existingAccount.length > 0) {
      const account =
        existingAccount[0];

      if (account.role === "owner") {
        return res.status(409).json({
          success: false,
          message:
            "This mobile number is already linked to an owner account",
        });
      }

      if (account.role === "staff") {
        return res.status(409).json({
          success: false,
          message:
            "This mobile number is already linked to a staff account",
        });
      }

      return res.status(409).json({
        success: false,
        message:
          "This mobile number is already linked to an account",
      });
    }

    // ============================================================
    // USERNAME
    // ============================================================

    const staffUsername =
      normalizedPhone;

    // ============================================================
    // RANDOM PASSWORD
    // ============================================================

    const randomPassword =
      generateRandomPassword();

    const hashedPassword =
      await bcrypt.hash(
        randomPassword,
        10
      );

    // ============================================================
    // TIDB SEQUENCE
    // ============================================================

    const [staffSequence] =
      await db.query(
        `
        SELECT NEXT VALUE FOR users_id_seq AS user_id
        `
      );

    const staffId = Number(
      staffSequence[0].user_id
    );

    // ============================================================
    // CREATE STAFF
    // ============================================================

    await db.query(
      `
      INSERT INTO users
      (
        id,
        shop_id,
        username,
        name,
        password,
        role,
        status,
        phone
      )
      VALUES
      (
        ?,
        ?,
        ?,
        ?,
        ?,
        'staff',
        'inactive',
        ?
      )
      `,
      [
        staffId,
        shopId,
        staffUsername,
        staffName,
        hashedPassword,
        normalizedPhone,
      ]
    );

    // ============================================================
    // CREATE OTP
    // ============================================================

    const otp =
      generateOtp();

    const otpHash =
      await bcrypt.hash(
        otp,
        10
      );

    const expiresAt =
      new Date(
        Date.now() +
          5 * 60 * 1000
      );

    await db.query(
      `
      DELETE FROM otp_verifications
      WHERE phone = ?
        AND purpose = 'staff_invite'
      `,
      [normalizedPhone]
    );

    await db.query(
      `
      INSERT INTO otp_verifications
      (
        phone,
        otp_hash,
        purpose,
        expires_at
      )
      VALUES
      (
        ?,
        ?,
        'staff_invite',
        ?
      )
      `,
      [
        normalizedPhone,
        otpHash,
        expiresAt,
      ]
    );

    // ============================================================
    // DEVELOPMENT OTP
    // ============================================================

    console.log(
      `NIFORA STAFF INVITE OTP | ${normalizedPhone} | ${otp}`
    );

    const response = {
      success: true,
      message:
        "Staff created. OTP sent to staff mobile number",
      staff_id: staffId,
    };

    if (
      process.env.NODE_ENV !==
      "production"
    ) {
      response.devOtp = otp;
    }

    return res.status(201).json(
      response
    );

  } catch (error) {
    console.error(
      "ADD STAFF ERROR:",
      error
    );

    return res.status(500).json({
      success: false,
      message: "Failed to add staff",
      error: error.message,
    });
  }
};