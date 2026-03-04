const { query, withTransaction } = require("../config/database");
const logger = require("../config/logger");

// ============================================================
// HELPERS
// ============================================================

/**
 * Normalize error dari DB function agar pesan internal tidak bocor ke client.
 */
const normalizeDbError = (err) => {
  if (err.message?.includes("Stock sertifikat tidak mencukupi")) {
    const normalized = new Error("Insufficient certificate stock");
    normalized.status = 400;
    return normalized;
  }
  return err;
};

// ============================================================
// PRINT CERTIFICATE
// ============================================================

/**
 * Print sertifikat satuan.
 */
const printSingle = async ({ enrollmentId, teacherId, centerId, ptcDate }) => {
  return withTransaction(async (client) => {
    const enrollment = await client.query(
      `SELECT id FROM enrollments
       WHERE id = $1 AND teacher_id = $2 AND center_id = $3 AND is_active = TRUE`,
      [enrollmentId, teacherId, centerId],
    );

    if (enrollment.rows.length === 0) {
      const err = new Error("Enrollment not found or not assigned to you");
      err.status = 404;
      throw err;
    }

    const existingCert = await client.query(
      `SELECT id FROM certificates
       WHERE enrollment_id = $1 AND is_reprint = FALSE`,
      [enrollmentId],
    );

    if (existingCert.rows.length > 0) {
      const err = new Error(
        "Certificate already printed for this enrollment. Use reprint instead.",
      );
      err.status = 409;
      throw err;
    }

    try {
      await client.query(`SELECT fn_decrement_certificate_stock($1, 1)`, [
        centerId,
      ]);
    } catch (err) {
      throw normalizeDbError(err);
    }

    const result = await client.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint)
       VALUES ($1, $2, $3, $4, FALSE)
       RETURNING id, cert_unique_id, enrollment_id, teacher_id, center_id, ptc_date, is_reprint, printed_at`,
      [enrollmentId, teacherId, centerId, ptcDate],
    );

    const cert = result.rows[0];
    logger.info("Certificate printed", {
      certId: cert.id,
      certUniqueId: cert.cert_unique_id,
      enrollmentId,
      teacherId,
    });

    return cert;
  });
};

/**
 * Print sertifikat batch — menggunakan bulk INSERT.
 */
const printBatch = async ({ items, teacherId, centerId }) => {
  if (!items?.length) {
    const err = new Error("No items provided for batch print");
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    const enrollmentIds = items.map((i) => i.enrollmentId);

    // Validasi semua enrollment sekaligus
    const enrollmentCheck = await client.query(
      `SELECT id FROM enrollments
       WHERE id = ANY($1) AND teacher_id = $2 AND center_id = $3 AND is_active = TRUE`,
      [enrollmentIds, teacherId, centerId],
    );

    if (enrollmentCheck.rows.length !== enrollmentIds.length) {
      const err = new Error(
        "One or more enrollments not found or not assigned to you",
      );
      err.status = 404;
      throw err;
    }

    // Cek duplikat
    const alreadyPrinted = await client.query(
      `SELECT enrollment_id FROM certificates
       WHERE enrollment_id = ANY($1) AND is_reprint = FALSE`,
      [enrollmentIds],
    );

    if (alreadyPrinted.rows.length > 0) {
      const ids = alreadyPrinted.rows.map((r) => r.enrollment_id);
      const err = new Error(
        `Certificates already printed for enrollment IDs: ${ids.join(", ")}`,
      );
      err.status = 409;
      throw err;
    }

    // Kurangi stock sekaligus
    try {
      await client.query(`SELECT fn_decrement_certificate_stock($1, $2)`, [
        centerId,
        items.length,
      ]);
    } catch (err) {
      throw normalizeDbError(err);
    }

    // Generate batch_id
    const batchIdResult = await client.query(
      `SELECT gen_random_uuid() AS batch_id`,
    );
    const batchId = batchIdResult.rows[0].batch_id;

    // --------------------------------------------------------
    // BULK INSERT — satu query untuk semua item
    // --------------------------------------------------------
    const valuePlaceholders = items
      .map(
        (_, i) =>
          `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, FALSE, $${i * 5 + 5})`,
      )
      .join(", ");

    const flatValues = items.flatMap((item) => [
      item.enrollmentId,
      teacherId,
      centerId,
      item.ptcDate,
      batchId,
    ]);

    const result = await client.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint, batch_id)
       VALUES ${valuePlaceholders}
       RETURNING id, cert_unique_id, enrollment_id, teacher_id, center_id, ptc_date, is_reprint, batch_id, printed_at`,
      flatValues,
    );

    const certs = result.rows;

    logger.info("Batch certificate printed", {
      batchId,
      count: certs.length,
      teacherId,
      centerId,
    });

    return { batchId, certs };
  });
};

// ============================================================
// REPRINT
// ============================================================

const reprint = async ({ originalCertId, teacherId, centerId, ptcDate }) => {
  return withTransaction(async (client) => {
    const original = await client.query(
      `SELECT c.id, c.enrollment_id, c.is_reprint
       FROM certificates c
       JOIN enrollments e ON e.id = c.enrollment_id
       WHERE c.id = $1 AND e.teacher_id = $2 AND c.center_id = $3 AND c.is_reprint = FALSE`,
      [originalCertId, teacherId, centerId],
    );

    if (original.rows.length === 0) {
      const err = new Error(
        "Original certificate not found or not assigned to you",
      );
      err.status = 404;
      throw err;
    }

    const { enrollment_id: enrollmentId } = original.rows[0];

    try {
      await client.query(`SELECT fn_decrement_certificate_stock($1, 1)`, [
        centerId,
      ]);
    } catch (err) {
      throw normalizeDbError(err);
    }

    const result = await client.query(
      `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint, original_cert_id)
       VALUES ($1, $2, $3, $4, TRUE, $5)
       RETURNING id, cert_unique_id, enrollment_id, teacher_id, center_id, ptc_date, is_reprint, original_cert_id, printed_at`,
      [enrollmentId, teacherId, centerId, ptcDate, originalCertId],
    );

    const cert = result.rows[0];
    logger.info("Certificate reprinted", {
      newCertId: cert.id,
      newCertUniqueId: cert.cert_unique_id,
      originalCertId,
      teacherId,
    });

    return cert;
  });
};

// ============================================================
// QUERIES
// ============================================================

const getByTeacher = async ({
  teacherId,
  centerId,
  limit,
  offset,
  isReprint,
}) => {
  const conditions = ["c.teacher_id = $1", "c.center_id = $2"];
  const values = [teacherId, centerId];
  let idx = 3;

  if (isReprint !== undefined) {
    conditions.push(`c.is_reprint = $${idx++}`);
    values.push(isReprint);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const [dataResult, countResult] = await Promise.all([
    query(
      `SELECT c.id, c.cert_unique_id, c.enrollment_id, s.name AS student_name,
              m.name AS module_name, c.ptc_date, c.is_reprint,
              c.scan_file_id, c.scan_file_name, c.scan_uploaded_at,
              c.report_id, c.printed_at
       FROM certificates c
       JOIN enrollments e ON e.id = c.enrollment_id
       JOIN students s    ON s.id = e.student_id
       JOIN modules m     ON m.id = e.module_id
       ${whereClause}
       ORDER BY c.printed_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset],
    ),
    query(
      `SELECT COUNT(*)::int AS total FROM certificates c ${whereClause}`,
      values,
    ),
  ]);

  return { rows: dataResult.rows, total: countResult.rows[0].total };
};

module.exports = { printSingle, printBatch, reprint, getByTeacher };
