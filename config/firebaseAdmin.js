const {
  initializeApp,
  cert,
  getApps,
} = require("firebase-admin/app");

const path = require("path");
const fs = require("fs");

let serviceAccount;

try {
  // 1. Render / Production
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );
  }

  // 2. Local development
  else {
    const serviceAccountPath = path.join(
      __dirname,
      "..",
      "firebase-service-account.json"
    );

    if (!fs.existsSync(serviceAccountPath)) {
      throw new Error(
        "Firebase service account file not found: " +
          serviceAccountPath
      );
    }

    serviceAccount = require(serviceAccountPath);
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert(serviceAccount),
    });
  }
} catch (error) {
  console.error("FIREBASE ADMIN INITIALIZATION ERROR:");
  console.error(error.message);
  throw error;
}

module.exports = getApps()[0];