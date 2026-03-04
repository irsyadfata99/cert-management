const { Pool } = require("pg");
const logger = require("./logger");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// Test koneksi saat server start
pool.connect((err, client, release) => {
  if (err) {
    logger.error("Database connection failed", { error: err.message });
    process.exit(1);
  }
  logger.info("Database connected successfully");
  release();
});

// Event listener untuk unexpected errors pada idle client
pool.on("error", (err) => {
  logger.error("Unexpected database error on idle client", {
    error: err.message,
  });
});

// Shorthand query dengan error logging
const query = (text, params) => {
  return pool.query(text, params).catch((err) => {
    logger.error("Database query error", { query: text, error: err.message });
    throw err;
  });
};

// Helper transaksi
const withTransaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error("Transaction rolled back", { error: err.message });
    throw err;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, withTransaction };
