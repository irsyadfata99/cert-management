const { query, withTransaction } = require("../config/database");
const logger = require("../config/logger");

// ============================================================
// CONSTANTS
// ============================================================

// [FIX] Satu konstanta yang dipakai di service layer.
// Export agar bisa dipakai di validator jika perlu,
// menghindari drift nilai antara service dan validator.
const BATCH_MAX_SIZE = 100;

// ============================================================
// HELPERS
// ============================================================

/**
 * Normalize error dari DB function agar pesan internal tidak bocor ke client.
 */
const normalizeDbError = (err) => {
  if (err.message?.includes("Stock medali tidak mencukupi")) {
    const normalized = new Error("Insufficient medal stock");
    normalized.status = 400;
    return normalized;
  }
  return err;
};

// ============================================================
// PRINT MEDAL
// ============================================================

/**
 * Print medali satuan.
 *
 * [MULTI-CENTER] centerId adalah center dari enrollment/student,
 * bukan center utama teacher. Validasi akses teacher menggunakan
 * teacher_centers — teacher boleh print selama dia di-assign ke
 * center tersebut.
 */
const printSingle = async ({ enrollmentId, teacherId, centerId, ptcDate }) => {
  return withTransaction(async (client) => {
    // [MULTI-CENTER] Validasi:
    // 1. Enrollment ada dan active di center ini
    // 2. Teacher di-assign ke center ini (via teacher_centers)
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

    const existing = await client.query(
      `SELECT id FROM medals WHERE enrollment_id = $1`,
      [enrollmentId],
    );

    if (existing.rows.length > 0) {
      const err = new Error("Medal already printed for this enrollment");
      err.status = 409;
      throw err;
    }

    try {
      await client.query(`SELECT fn_decrement_medal_stock($1, 1)`, [centerId]);
    } catch (err) {
      throw normalizeDbError(err);
    }

    const result = await client.query(
      `INSERT INTO medals (enrollment_id, teacher_id, center_id, ptc_date)
       VALUES ($1, $2, $3, $4)
       RETURNING id, medal_unique_id, enrollment_id, teacher_id, center_id, ptc_date, printed_at`,
      [enrollmentId, teacherId, centerId, ptcDate],
    );

    const medal = result.rows[0];
    logger.info("Medal printed", {
      medalId: medal.id,
      medalUniqueId: medal.medal_unique_id,
      enrollmentId,
      teacherId,
      centerId,
    });

    return medal;
  });
};

/**
 * Print medali batch — menggunakan bulk INSERT.
 *
 * [MULTI-CENTER] Semua enrollment dalam batch harus berada di
 * center yang sama dan teacher harus di-assign ke center tersebut.
 */
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
    // [MULTI-CENTER] Validasi teacher punya akses ke center ini
    const teacherAccess = await client.query(
      `SELECT 1 FROM teacher_centers
       WHERE teacher_id = $1 AND center_id = $2`,
      [teacherId, centerId],
    );

    if (teacherAccess.rows.length === 0) {
      const err = new Error("You are not assigned to this center");
      err.status = 403;
      throw err;
    }

    const enrollmentIds = items.map((i) => i.enrollmentId);

    // Validasi semua enrollment
    const enrollmentCheck = await client.query(
      `SELECT id FROM enrollments
       WHERE id = ANY($1)
         AND teacher_id = $2
         AND center_id = $3
         AND is_active = TRUE`,
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
      `SELECT enrollment_id FROM medals WHERE enrollment_id = ANY($1)`,
      [enrollmentIds],
    );

    if (alreadyPrinted.rows.length > 0) {
      const ids = alreadyPrinted.rows.map((r) => r.enrollment_id);
      const err = new Error(
        `Medals already printed for enrollment IDs: ${ids.join(", ")}`,
      );
      err.status = 409;
      throw err;
    }

    // Kurangi stock sekaligus
    try {
      await client.query(`SELECT fn_decrement_medal_stock($1, $2)`, [
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
          `($${i * 5 + 1}, $${i * 5 + 2}, $${i * 5 + 3}, $${i * 5 + 4}, $${i * 5 + 5})`,
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
      `INSERT INTO medals (enrollment_id, teacher_id, center_id, ptc_date, batch_id)
       VALUES ${valuePlaceholders}
       RETURNING id, medal_unique_id, enrollment_id, teacher_id, center_id, ptc_date, batch_id, printed_at`,
      flatValues,
    );

    const medals = result.rows;
    logger.info("Batch medal printed", {
      batchId,
      count: medals.length,
      teacherId,
      centerId,
    });

    return { batchId, medals };
  });
};

// ============================================================
// QUERIES
// ============================================================

/**
 * [MULTI-CENTER] centerId bisa null untuk menampilkan medal
 * dari semua center yang di-assign ke teacher.
 */
const getByTeacher = async ({ teacherId, centerId, limit, offset }) => {
  const conditions = ["med.teacher_id = $1"];
  const values = [teacherId];
  let idx = 2;

  // Jika centerId null, tampilkan semua center milik teacher
  if (centerId !== null && centerId !== undefined) {
    conditions.push(`med.center_id = $${idx++}`);
    values.push(centerId);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const [dataResult, countResult] = await Promise.all([
    query(
      `SELECT med.id, med.medal_unique_id, med.enrollment_id,
              s.name AS student_name, m.name AS module_name,
              c.name AS center_name,
              med.ptc_date, med.report_id, med.printed_at
       FROM medals med
       JOIN enrollments e ON e.id = med.enrollment_id
       JOIN students s    ON s.id = e.student_id
       JOIN modules m     ON m.id = e.module_id
       JOIN centers c     ON c.id = med.center_id
       ${whereClause}
       ORDER BY med.printed_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...values, limit, offset],
    ),
    query(
      `SELECT COUNT(*)::int AS total FROM medals med ${whereClause}`,
      values,
    ),
  ]);

  return { rows: dataResult.rows, total: countResult.rows[0].total };
};

module.exports = { printSingle, printBatch, getByTeacher, BATCH_MAX_SIZE };
