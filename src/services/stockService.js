const { query } = require("../config/database");
const logger = require("../config/logger");

// ============================================================
// GET STOCK
// ============================================================

/**
 * Ambil stock certificate & medal untuk satu center.
 * @param {number} centerId
 * @returns {object}
 */
const getStockByCenter = async (centerId) => {
  const result = await query(
    `SELECT
       c.id AS center_id, c.name AS center_name,
       cs.quantity AS cert_quantity, cs.low_stock_threshold AS cert_threshold,
       cs.quantity <= cs.low_stock_threshold AS cert_low_stock,
       ms.quantity AS medal_quantity, ms.low_stock_threshold AS medal_threshold,
       ms.quantity <= ms.low_stock_threshold AS medal_low_stock
     FROM centers c
     LEFT JOIN certificate_stock cs ON cs.center_id = c.id
     LEFT JOIN medal_stock ms       ON ms.center_id = c.id
     WHERE c.id = $1 AND c.is_active = TRUE`,
    [centerId],
  );

  if (result.rows.length === 0) {
    const err = new Error("Center not found or inactive");
    err.status = 404;
    throw err;
  }

  return result.rows[0];
};

/**
 * Ambil stock semua center (untuk super_admin).
 * @returns {Array}
 */
const getAllStock = async () => {
  const result = await query(`SELECT * FROM vw_stock_alerts ORDER BY center_name`);
  return result.rows;
};

// ============================================================
// ADD STOCK
// ============================================================

/**
 * Tambah stock (top-up) untuk center tertentu.
 * @param {object} options
 * @param {number} options.centerId
 * @param {"certificate"|"medal"} options.type
 * @param {number} options.quantity
 * @param {number} options.addedBy - user ID yang melakukan top-up
 * @returns {object} stock terbaru
 */
const addStock = async ({ centerId, type, quantity, addedBy }) => {
  if (!["certificate", "medal"].includes(type)) {
    const err = new Error("Invalid stock type. Use: certificate or medal");
    err.status = 400;
    throw err;
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    const err = new Error("Quantity must be a positive integer");
    err.status = 400;
    throw err;
  }

  const table = type === "certificate" ? "certificate_stock" : "medal_stock";

  const result = await query(
    `UPDATE ${table}
     SET quantity = quantity + $1, updated_at = NOW()
     WHERE center_id = $2
     RETURNING quantity, low_stock_threshold`,
    [quantity, centerId],
  );

  if (result.rows.length === 0) {
    const err = new Error("Center stock record not found");
    err.status = 404;
    throw err;
  }

  logger.info("Stock added", { centerId, type, quantity, addedBy });

  return {
    center_id: centerId,
    type,
    quantity: result.rows[0].quantity,
    low_stock_threshold: result.rows[0].low_stock_threshold,
    low_stock: result.rows[0].quantity <= result.rows[0].low_stock_threshold,
  };
};

// ============================================================
// UPDATE THRESHOLD
// ============================================================

/**
 * Update low stock threshold untuk center tertentu.
 * @param {object} options
 * @param {number} options.centerId
 * @param {"certificate"|"medal"} options.type
 * @param {number} options.threshold
 * @param {number} options.updatedBy
 * @returns {object}
 */
const updateThreshold = async ({ centerId, type, threshold, updatedBy }) => {
  if (!["certificate", "medal"].includes(type)) {
    const err = new Error("Invalid stock type. Use: certificate or medal");
    err.status = 400;
    throw err;
  }

  if (!Number.isInteger(threshold) || threshold < 0) {
    const err = new Error("Threshold must be a non-negative integer");
    err.status = 400;
    throw err;
  }

  const table = type === "certificate" ? "certificate_stock" : "medal_stock";

  const result = await query(
    `UPDATE ${table}
     SET low_stock_threshold = $1, updated_at = NOW()
     WHERE center_id = $2
     RETURNING quantity, low_stock_threshold`,
    [threshold, centerId],
  );

  if (result.rows.length === 0) {
    const err = new Error("Center stock record not found");
    err.status = 404;
    throw err;
  }

  logger.info("Stock threshold updated", { centerId, type, threshold, updatedBy });

  return {
    center_id: centerId,
    type,
    quantity: result.rows[0].quantity,
    low_stock_threshold: result.rows[0].low_stock_threshold,
  };
};

// ============================================================
// TRANSFER STOCK
// ============================================================

/**
 * Transfer stock antar center menggunakan DB function.
 * @param {object} options
 * @param {"certificate"|"medal"} options.type
 * @param {number} options.fromCenterId
 * @param {number} options.toCenterId
 * @param {number} options.quantity
 * @param {number} options.transferredBy
 * @returns {object}
 */
const transferStock = async ({ type, fromCenterId, toCenterId, quantity, transferredBy }) => {
  if (!["certificate", "medal"].includes(type)) {
    const err = new Error("Invalid stock type. Use: certificate or medal");
    err.status = 400;
    throw err;
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    const err = new Error("Quantity must be a positive integer");
    err.status = 400;
    throw err;
  }

  if (fromCenterId === toCenterId) {
    const err = new Error("Source and destination centers must be different");
    err.status = 400;
    throw err;
  }

  try {
    const result = await query(`SELECT fn_transfer_stock($1, $2, $3, $4) AS result`, [type, fromCenterId, toCenterId, quantity]);

    const transferResult = result.rows[0].result;
    logger.info("Stock transferred", { ...transferResult, transferredBy });

    return transferResult;
  } catch (err) {
    // DB function melempar exception jika stock tidak cukup
    if (err.message?.includes("Stock tidak mencukupi")) {
      err.status = 400;
    }
    throw err;
  }
};

module.exports = {
  getStockByCenter,
  getAllStock,
  addStock,
  updateThreshold,
  transferStock,
};
