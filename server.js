require("dotenv").config();
const app = require("./src/app");
const logger = require("./src/config/logger");
const { pool } = require("./src/config/database");

const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || "development";

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
  logger.error("Missing required environment variables", {
    missing: missingEnv,
  });
  process.exit(1);
}

const server = app.listen(PORT, () => {
  logger.info(`Server running`, { port: PORT, env: NODE_ENV });
});

const shutdown = (signal) => {
  logger.info(`${signal} received. Shutting down gracefully...`);

  const forceTimer = setTimeout(() => {
    logger.error("Forcing shutdown after timeout");
    process.exit(1);
  }, 10000);

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

process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception", { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection", { reason });
  process.exit(1);
});

module.exports = server;
