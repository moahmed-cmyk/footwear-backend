const { initializeApp, cert, getApps } = require("firebase-admin/app");

let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
  try {
    serviceAccount = JSON.parse(
      process.env.FIREBASE_SERVICE_ACCOUNT_JSON
    );
  } catch (error) {
    console.error(
      "FIREBASE SERVICE ACCOUNT JSON ERROR:",
      error.message
    );
    throw error;
  }
} else {
  throw new Error(
    "FIREBASE_SERVICE_ACCOUNT_JSON environment variable is missing"
  );
}

const firebaseApp =
  getApps().length === 0
    ? initializeApp({
        credential: cert(serviceAccount),
      })
    : getApps()[0];

console.log("Firebase Admin initialized successfully");

module.exports = firebaseApp;