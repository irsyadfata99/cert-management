const { query, withTransaction } = require("../config/database");
const logger = require("../config/logger");

// ============================================================
// PRINT CERTIFICATE
// ============================================================

/**
 * Print sertifikat satuan.
 * Flow: validasi enrollment → kurangi stock → insert certificate
 * @param {object} options
 * @param {number} options.enrollmentId
 * @param {number} options.teacherId
 * @param {number} options.centerId
 * @param {string} options.ptcDate - format YYYY-MM-DD
 * @returns {object} certificate row
 */
const printSingle = async ({ enrollmentId, teacherId, centerId, ptcDate }) => {
  return withTransaction(async (client) => {
    // Validasi enrollment aktif dan milik teacher & center yang benar
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

    // Cek apakah sudah pernah print (bukan reprint)
    const existingCert = await client.query(
      `SELECT id FROM certificates
       WHERE enrollment_id = $1 AND is_reprint = FALSE`,
      [enrollmentId],
    );

    if (existingCert.rows.length > 0) {
      const err = new Error("Certificate already printed for this enrollment. Use reprint instead.");
      err.status = 409;
      throw err;
    }

    // Kurangi stock
    await client.query(`SELECT fn_decrement_certificate_stock($1, 1)`, [centerId]);

    // Insert certificate
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
 * Print sertifikat batch (banyak enrollment sekaligus).
 * @param {object} options
 * @param {Array<{enrollmentId, ptcDate}>} options.items
 * @param {number} options.teacherId
 * @param {number} options.centerId
 * @returns {Array} array certificate rows
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
      const err = new Error("One or more enrollments not found or not assigned to you");
      err.status = 404;
      throw err;
    }

    // Cek duplikat — enrollment yang sudah pernah di-print
    const alreadyPrinted = await client.query(
      `SELECT enrollment_id FROM certificates
       WHERE enrollment_id = ANY($1) AND is_reprint = FALSE`,
      [enrollmentIds],
    );

    if (alreadyPrinted.rows.length > 0) {
      const ids = alreadyPrinted.rows.map((r) => r.enrollment_id);
      const err = new Error(`Certificates already printed for enrollment IDs: ${ids.join(", ")}`);
      err.status = 409;
      throw err;
    }

    // Kurangi stock sekaligus (batch)
    await client.query(`SELECT fn_decrement_certificate_stock($1, $2)`, [centerId, items.length]);

    // Generate batch_id
    const batchIdResult = await client.query(`SELECT gen_random_uuid() AS batch_id`);
    const batchId = batchIdResult.rows[0].batch_id;

    // Insert semua certificate
    const certs = [];
    for (const item of items) {
      const result = await client.query(
        `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint, batch_id)
         VALUES ($1, $2, $3, $4, FALSE, $5)
         RETURNING id, cert_unique_id, enrollment_id, teacher_id, center_id, ptc_date, is_reprint, batch_id, printed_at`,
        [item.enrollmentId, teacherId, centerId, item.ptcDate, batchId],
      );
      certs.push(result.rows[0]);
    }

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

/**
 * Reprint sertifikat — menghasilkan cert_unique_id baru.
 * @param {object} options
 * @param {number} options.originalCertId - ID certificate asli
 * @param {number} options.teacherId
 * @param {number} options.centerId
 * @param {string} options.ptcDate
 * @returns {object} certificate reprint row
 */
const reprint = async ({ originalCertId, teacherId, centerId, ptcDate }) => {
  return withTransaction(async (client) => {
    // Validasi certificate asli
    const original = await client.query(
      `SELECT c.id, c.enrollment_id, c.is_reprint
       FROM certificates c
       JOIN enrollments e ON e.id = c.enrollment_id
       WHERE c.id = $1 AND e.teacher_id = $2 AND c.center_id = $3 AND c.is_reprint = FALSE`,
      [originalCertId, teacherId, centerId],
    );

    if (original.rows.length === 0) {
      const err = new Error("Original certificate not found or not assigned to you");
      err.status = 404;
      throw err;
    }

    const { enrollment_id: enrollmentId } = original.rows[0];

    // Kurangi stock
    await client.query(`SELECT fn_decrement_certificate_stock($1, 1)`, [centerId]);

    // Insert reprint dengan referensi ke original
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

/**
 * Ambil daftar certificate milik teacher.
 * @param {object} options
 * @param {number} options.teacherId
 * @param {number} options.centerId
 * @param {number} options.page
 * @param {number} options.limit
 * @param {number} options.offset
 * @param {boolean|undefined} options.isReprint
 * @returns {{ rows, total }}
 */
const getByTeacher = async ({ teacherId, centerId, limit, offset, isReprint }) => {
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
    query(`SELECT COUNT(*)::int AS total FROM certificates c ${whereClause}`, values),
  ]);

  return { rows: dataResult.rows, total: countResult.rows[0].total };
};

module.exports = { printSingle, printBatch, reprint, getByTeacher };
