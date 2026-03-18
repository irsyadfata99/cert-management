const { query } = require("../config/database");
const logger = require("../config/logger");

// ============================================================
// STOCK SERVICE
// ============================================================

const getCertificateBatch = async (centerId) => {
  const result = await query(
    `SELECT
       b.id,
       b.center_id,
       c.name AS center_name,
       b.range_start,
       b.range_end,
       b.current_position,
       b.range_end - b.current_position + 1 AS available,
       b.current_position - b.range_start   AS used,
       b.created_at,
       b.updated_at
     FROM certificate_stock_batches b
     JOIN centers c ON c.id = b.center_id
     WHERE b.center_id = $1`,
    [centerId],
  );
  return result.rows[0] ?? null;
};

const addCertificateBatch = async ({
  centerId,
  rangeStart,
  rangeEnd,
  addedBy,
}) => {
  if (!Number.isInteger(rangeStart) || rangeStart <= 0) {
    const err = new Error("range_start must be a positive integer");
    err.status = 400;
    throw err;
  }

  if (!Number.isInteger(rangeEnd) || rangeEnd <= 0) {
    const err = new Error("range_end must be a positive integer");
    err.status = 400;
    throw err;
  }

  if (rangeStart > rangeEnd) {
    const err = new Error("range_start must be <= range_end");
    err.status = 400;
    throw err;
  }

  try {
    const result = await query(
      `SELECT fn_add_certificate_batch($1, $2, $3) AS result`,
      [centerId, rangeStart, rangeEnd],
    );

    const data = result.rows[0].result;
    logger.info("Certificate batch added", {
      centerId,
      rangeStart,
      rangeEnd,
      action: data.action,
      addedBy,
    });

    return data;
  } catch (err) {
    throw normalizeBatchError(err);
  }
};

const transferCertificateBatch = async ({
  fromCenterId,
  toCenterId,
  quantity,
  transferredBy,
}) => {
  if (fromCenterId === toCenterId) {
    const err = new Error("Source and destination centers must be different");
    err.status = 400;
    throw err;
  }

  if (!Number.isInteger(quantity) || quantity <= 0) {
    const err = new Error("Quantity must be a positive integer");
    err.status = 400;
    throw err;
  }

  try {
    const result = await query(
      `SELECT fn_transfer_certificate_batch($1, $2, $3) AS result`,
      [fromCenterId, toCenterId, quantity],
    );

    const data = result.rows[0].result;
    logger.info("Certificate batch transferred", {
      fromCenterId,
      toCenterId,
      quantity,
      transferStart: data.transfer_start,
      transferEnd: data.transfer_end,
      transferredBy,
    });

    return data;
  } catch (err) {
    throw normalizeBatchError(err);
  }
};

const normalizeBatchError = (err) => {
  const msg = err.message ?? "";

  if (msg.includes("range_start must be")) {
    const e = new Error(msg);
    e.status = 400;
    return e;
  }

  if (msg.includes("range_start and range_end must be positive")) {
    const e = new Error(msg);
    e.status = 400;
    return e;
  }

  if (msg.includes("New range_end")) {
    const e = new Error(msg);
    e.status = 400;
    return e;
  }

  if (msg.includes("Insufficient stock")) {
    const e = new Error(msg);
    e.status = 400;
    return e;
  }

  if (
    msg.includes("No batch found") ||
    msg.includes("No certificate batch found")
  ) {
    const e = new Error(msg);
    e.status = 404;
    return e;
  }

  if (msg.includes("Certificate stock exhausted")) {
    const e = new Error("Certificate stock exhausted for this center");
    e.status = 400;
    return e;
  }

  if (msg.includes("not contiguous")) {
    const e = new Error(msg);
    e.status = 400;
    return e;
  }

  if (msg.includes("Source and destination centers must be different")) {
    const e = new Error(msg);
    e.status = 400;
    return e;
  }

  return err;
};

// ============================================================
// MEDAL STOCK
// ============================================================

const normalizeTransferError = (err) => {
  const msg = err.message ?? "";

  if (msg.includes("Stock tidak mencukupi")) {
    const normalized = new Error("Insufficient stock in source center");
    normalized.status = 400;
    return normalized;
  }

  if (msg.includes("Center tujuan") && msg.includes("tidak ditemukan")) {
    const normalized = new Error("Destination center not found");
    normalized.status = 404;
    return normalized;
  }

  if (msg.includes("Center asal") && msg.includes("tidak ditemukan")) {
    const normalized = new Error("Source center not found");
    normalized.status = 404;
    return normalized;
  }

  if (msg.includes("Tipe tidak valid")) {
    const normalized = new Error(
      "Invalid stock type. Use: certificate or medal",
    );
    normalized.status = 400;
    return normalized;
  }

  if (msg.includes("Quantity harus lebih dari 0")) {
    const normalized = new Error("Quantity must be greater than 0");
    normalized.status = 400;
    return normalized;
  }

  if (msg.includes("Center asal dan tujuan tidak boleh sama")) {
    const normalized = new Error(
      "Source and destination centers must be different",
    );
    normalized.status = 400;
    return normalized;
  }

  return err;
};

const getAllStock = async () => {
  const result = await query(
    `SELECT * FROM vw_stock_alerts ORDER BY center_name`,
  );
  return result.rows;
};

const addMedalStock = async ({ centerId, quantity, addedBy }) => {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    const err = new Error("Quantity must be a positive integer");
    err.status = 400;
    throw err;
  }

  const result = await query(
    `UPDATE medal_stock
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

  logger.info("Medal stock added", { centerId, quantity, addedBy });

  return {
    center_id: centerId,
    type: "medal",
    quantity: result.rows[0].quantity,
    low_stock_threshold: result.rows[0].low_stock_threshold,
    low_stock: result.rows[0].quantity <= result.rows[0].low_stock_threshold,
  };
};

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

  // Certificate threshold tetap di certificate_stock untuk low stock alert
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

  logger.info("Stock threshold updated", {
    centerId,
    type,
    threshold,
    updatedBy,
  });

  return {
    center_id: centerId,
    type,
    low_stock_threshold: result.rows[0].low_stock_threshold,
  };
};

const transferMedalStock = async ({
  fromCenterId,
  toCenterId,
  quantity,
  transferredBy,
}) => {
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
    const result = await query(
      `SELECT fn_transfer_stock($1, $2, $3, $4) AS result`,
      ["medal", fromCenterId, toCenterId, quantity],
    );

    const transferResult = result.rows[0].result;
    logger.info("Medal stock transferred", {
      ...transferResult,
      transferredBy,
    });

    return transferResult;
  } catch (err) {
    throw normalizeTransferError(err);
  }
};

module.exports = {
  getCertificateBatch,
  addCertificateBatch,
  transferCertificateBatch,
  addMedalStock,
  transferMedalStock,
  updateThreshold,
  getAllStock,
};
