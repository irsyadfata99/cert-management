const { query, withTransaction } = require("../config/database");
const logger = require("../config/logger");
const BATCH_MAX_SIZE = 100;

const normalizeDbError = (err) => {
  // Certificate batch errors
  if (
    err.message?.includes("Certificate stock exhausted") ||
    err.message?.includes("No certificate batch found")
  ) {
    const normalized = new Error(
      err.message.includes("exhausted")
        ? "Certificate stock exhausted for this center"
        : "No certificate batch found for this center. Contact admin to add stock.",
    );
    normalized.status = 400;
    return normalized;
  }

  // Medal stock errors
  if (
    err.message?.includes("Insufficient medal stock") ||
    err.message?.includes("Stock medali tidak mencukupi")
  ) {
    const normalized = new Error("Insufficient medal stock");
    normalized.status = 400;
    return normalized;
  }

  return err;
};

const printSingle = async ({ enrollmentId, teacherId, centerId, ptcDate }) => {
  return withTransaction(async (client) => {
    const enrollment = await client.query(
      `SELECT e.id FROM enrollments e
       WHERE e.id = $1
         AND e.teacher_id = $2
         AND e.center_id = $3
         AND e.is_active = TRUE
         AND EXISTS (
           SELECT 1 FROM teacher_centers tc
           WHERE tc.teacher_id = $2 AND tc.center_id = $3
         )`,
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

    // Cek certificate batch tersedia (sebelum insert)
    // Lock batch row untuk prevent race condition
    const batchCheck = await client.query(
      `SELECT current_position, range_end
       FROM certificate_stock_batches
       WHERE center_id = $1
       FOR UPDATE`,
      [centerId],
    );

    if (batchCheck.rows.length === 0) {
      const err = new Error(
        "No certificate batch found for this center. Contact admin to add stock.",
      );
      err.status = 400;
      throw err;
    }

    if (batchCheck.rows[0].current_position > batchCheck.rows[0].range_end) {
      const err = new Error("Certificate stock exhausted for this center");
      err.status = 400;
      throw err;
    }

    // Kurangi medal stock
    try {
      await client.query(`SELECT fn_decrement_medal_stock($1, 1)`, [centerId]);
    } catch (err) {
      throw normalizeDbError(err);
    }

    // Insert certificate — cert_unique_id di-assign otomatis oleh trigger
    // trigger fn_set_cert_unique_id -> fn_assign_cert_from_batch
    let certResult;
    try {
      certResult = await client.query(
        `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint)
         VALUES ($1, $2, $3, $4, FALSE)
         RETURNING id, cert_unique_id, enrollment_id, teacher_id, center_id, ptc_date, is_reprint, printed_at`,
        [enrollmentId, teacherId, centerId, ptcDate],
      );
    } catch (err) {
      throw normalizeDbError(err);
    }

    const cert = certResult.rows[0];

    const medalResult = await client.query(
      `INSERT INTO medals (enrollment_id, teacher_id, center_id, ptc_date)
       VALUES ($1, $2, $3, $4)
       RETURNING id, medal_unique_id`,
      [enrollmentId, teacherId, centerId, ptcDate],
    );

    const medal = medalResult.rows[0];

    logger.info("Certificate and medal printed", {
      certId: cert.id,
      certUniqueId: cert.cert_unique_id,
      medalId: medal.id,
      medalUniqueId: medal.medal_unique_id,
      enrollmentId,
      teacherId,
      centerId,
    });

    return { ...cert, medal };
  });
};

const printBatch = async ({ items, teacherId, centerId }) => {
  if (!items?.length) {
    const err = new Error("No items provided for batch print");
    err.status = 400;
    throw err;
  }

  if (items.length > BATCH_MAX_SIZE) {
    const err = new Error(
      `Batch size cannot exceed ${BATCH_MAX_SIZE}. Got: ${items.length}`,
    );
    err.status = 400;
    throw err;
  }

  return withTransaction(async (client) => {
    const enrollmentIds = items.map((i) => i.enrollmentId);

    // Lock enrollment rows
    const enrollmentCheck = await client.query(
      `SELECT id FROM enrollments
       WHERE id = ANY($1)
         AND teacher_id = $2
         AND center_id = $3
         AND is_active = TRUE
       FOR UPDATE`,
      [enrollmentIds, teacherId, centerId],
    );

    if (enrollmentCheck.rows.length !== enrollmentIds.length) {
      const err = new Error(
        "One or more enrollments not found or not assigned to you",
      );
      err.status = 404;
      throw err;
    }

    const alreadyPrintedCert = await client.query(
      `SELECT enrollment_id FROM certificates
       WHERE enrollment_id = ANY($1) AND is_reprint = FALSE`,
      [enrollmentIds],
    );

    if (alreadyPrintedCert.rows.length > 0) {
      const ids = alreadyPrintedCert.rows.map((r) => r.enrollment_id);
      const err = new Error(
        `Certificates already printed for enrollment IDs: ${ids.join(", ")}`,
      );
      err.status = 409;
      throw err;
    }

    // Lock & cek certificate batch
    const batchCheck = await client.query(
      `SELECT current_position, range_end
       FROM certificate_stock_batches
       WHERE center_id = $1
       FOR UPDATE`,
      [centerId],
    );

    if (batchCheck.rows.length === 0) {
      const err = new Error(
        "No certificate batch found for this center. Contact admin to add stock.",
      );
      err.status = 400;
      throw err;
    }

    const available =
      batchCheck.rows[0].range_end - batchCheck.rows[0].current_position + 1;

    if (items.length > available) {
      const err = new Error(
        `Insufficient certificate stock. Available: ${available}, Requested: ${items.length}`,
      );
      err.status = 400;
      throw err;
    }

    // Kurangi medal stock
    try {
      await client.query(`SELECT fn_decrement_medal_stock($1, $2)`, [
        centerId,
        items.length,
      ]);
    } catch (err) {
      throw normalizeDbError(err);
    }

    const batchIdResult = await client.query(
      `SELECT gen_random_uuid() AS batch_id`,
    );
    const batchId = batchIdResult.rows[0].batch_id;

    // Insert certificates satu per satu agar trigger assign ID berurutan
    const certs = [];
    for (const item of items) {
      let certResult;
      try {
        certResult = await client.query(
          `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint, batch_id)
           VALUES ($1, $2, $3, $4, FALSE, $5)
           RETURNING id, cert_unique_id, enrollment_id, teacher_id, center_id, ptc_date, is_reprint, batch_id, printed_at`,
          [item.enrollmentId, teacherId, centerId, item.ptcDate, batchId],
        );
      } catch (err) {
        throw normalizeDbError(err);
      }
      certs.push(certResult.rows[0]);
    }

    // Insert medals
    const medalPlaceholders = items
      .map(
        (_, i) =>
          `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`,
      )
      .join(", ");

    const medalValues = items.flatMap((item) => [
      item.enrollmentId,
      teacherId,
      centerId,
      item.ptcDate,
      batchId,
    ]);

    let medalResult;
    try {
      medalResult = await client.query(
        `INSERT INTO medals (enrollment_id, teacher_id, center_id, ptc_date, batch_id)
         VALUES ${medalPlaceholders}
         RETURNING id, medal_unique_id, enrollment_id`,
        medalValues,
      );
    } catch (err) {
      if (err.code === "23505") {
        const conflict = new Error(
          "One or more medals already exist for the requested enrollments.",
        );
        conflict.status = 409;
        throw conflict;
      }
      throw err;
    }

    const medals = medalResult.rows;

    logger.info("Batch certificate and medal printed", {
      batchId,
      count: certs.length,
      teacherId,
      centerId,
      certIds: certs.map((c) => c.cert_unique_id),
    });

    return { batchId, certs, medals };
  });
};

const reprint = async ({ originalCertId, teacherId, centerId, ptcDate }) => {
  return withTransaction(async (client) => {
    const original = await client.query(
      `SELECT c.id, c.enrollment_id, c.is_reprint, c.center_id
       FROM certificates c
       JOIN enrollments e ON e.id = c.enrollment_id
       WHERE c.id = $1
         AND e.teacher_id = $2
         AND c.center_id = $3
         AND c.is_reprint = FALSE
         AND EXISTS (
           SELECT 1 FROM teacher_centers tc
           WHERE tc.teacher_id = $2 AND tc.center_id = $3
         )`,
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

    // Lock & cek certificate batch untuk reprint
    const batchCheck = await client.query(
      `SELECT current_position, range_end
       FROM certificate_stock_batches
       WHERE center_id = $1
       FOR UPDATE`,
      [centerId],
    );

    if (batchCheck.rows.length === 0) {
      const err = new Error(
        "No certificate batch found for this center. Contact admin to add stock.",
      );
      err.status = 400;
      throw err;
    }

    if (batchCheck.rows[0].current_position > batchCheck.rows[0].range_end) {
      const err = new Error("Certificate stock exhausted for this center");
      err.status = 400;
      throw err;
    }

    // Insert reprint — cert_unique_id di-assign oleh trigger (ID baru dari batch)
    let result;
    try {
      result = await client.query(
        `INSERT INTO certificates (enrollment_id, teacher_id, center_id, ptc_date, is_reprint, original_cert_id)
         VALUES ($1, $2, $3, $4, TRUE, $5)
         RETURNING id, cert_unique_id, enrollment_id, teacher_id, center_id, ptc_date, is_reprint, original_cert_id, printed_at`,
        [enrollmentId, teacherId, centerId, ptcDate, originalCertId],
      );
    } catch (err) {
      throw normalizeDbError(err);
    }

    const cert = result.rows[0];
    logger.info("Certificate reprinted", {
      newCertId: cert.id,
      newCertUniqueId: cert.cert_unique_id,
      originalCertId,
      teacherId,
      centerId,
    });

    return cert;
  });
};

const getByTeacher = async ({
  teacherId,
  centerId,
  limit,
  offset,
  isReprint,
}) => {
  const conditions = ["c.teacher_id = $1"];
  const values = [teacherId];
  let idx = 2;

  if (centerId !== null && centerId !== undefined) {
    conditions.push(`c.center_id = $${idx++}`);
    values.push(centerId);
  }

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

module.exports = {
  printSingle,
  printBatch,
  reprint,
  getByTeacher,
  BATCH_MAX_SIZE,
};
