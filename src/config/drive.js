const { google } = require("googleapis");
const logger = require("./logger");

// ============================================================
// SERVICE ACCOUNT AUTH
// ============================================================

// Private key dari env menggunakan literal \n — perlu di-replace ke newline asli
const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(/\\n/g, "\n");

if (!privateKey) {
  logger.error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set.");
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: privateKey,
  },
  scopes: ["https://www.googleapis.com/auth/drive"],
});

// Drive client singleton
const drive = google.drive({ version: "v3", auth });

module.exports = drive;
