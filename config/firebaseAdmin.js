const { initializeApp, cert, getApps } = require("firebase-admin/app");
const path = require("path");

const serviceAccount = require(
  path.join(__dirname, "..", "firebase-service-account.json")
);

const firebaseApp =
  getApps().length === 0
    ? initializeApp({
        credential: cert(serviceAccount),
      })
    : getApps()[0];

module.exports = firebaseApp;