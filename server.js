require("dotenv").config();
const app = require("./src/app");
const logger = require("./src/config/logger");
// [FIX] Import pool agar bisa ditutup saat graceful shutdown.
// Sebelumnya pool tidak ditutup — koneksi DB menggantung sampai timeout
// setelah process exit, yang bisa menyebabkan "too many connections" di
// restart cepat (mis. rolling deploy atau crash loop).
const { pool } = require("./src/config/database");

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

// Validasi env variables wajib sebelum server start
const REQUIRED_ENV = [
  "DB_HOST",
  "DB_PORT",
  "DB_NAME",
  "DB_USER",
  "DB_PASSWORD",
  "SESSION_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_CALLBACK_URL",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
  "GOOGLE_DRIVE_ROOT_FOLDER_ID",
  "CLIENT_URL",
];

const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  logger.error("Missing required environment variables", { missing: missingEnv });
  process.exit(1);
}

const server = app.listen(PORT, () => {
  logger.info(`Server running`, { port: PORT, env: NODE_ENV });
});

// Graceful shutdown
const shutdown = (signal) => {
  logger.info(`${signal} received. Shutting down gracefully...`);

  // Force shutdown jika tidak selesai dalam 10 detik
  const forceTimer = setTimeout(() => {
    logger.error("Forcing shutdown after timeout");
    process.exit(1);
  }, 10000);

  // [FIX] Urutan shutdown yang benar:
  // 1. Stop terima request baru (server.close)
  // 2. Tunggu request yang sedang berjalan selesai
  // 3. Tutup DB pool agar koneksi tidak menggantung
  // 4. Exit
  server.close(async () => {
    logger.info("HTTP server closed");

    try {
      await pool.end();
      logger.info("Database pool closed");
    } catch (err) {
      logger.error("Error closing database pool", { error: err.message });
    }

    clearTimeout(forceTimer);
    process.exit(0);
  });
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Handle uncaught exceptions & unhandled rejections
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason });
  process.exit(1);
});

module.exports = server;
