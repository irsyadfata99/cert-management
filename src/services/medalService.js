const { query, withTransaction } = require("../config/database");
const logger = require("../config/logger");
const BATCH_MAX_SIZE = 100;

// NOTE: medalService.printSingle has been removed.
// Medals are always printed bundled with certificates via certificateService.
// If a standalone medal reprint is ever needed in the future, add it here.

const normalizeDbError = (err) => {
  if (err.message?.includes("Stock medali tidak mencukupi")) {
    const normalized = new Error("Insufficient medal stock");
    normalized.status = 400;
    return normalized;
  }
  return err;
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

    // Lock rows to serialise concurrent requests for the same enrollments.
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

    // Rely on the DB unique constraint on medals(enrollment_id) instead of a
    // separate pre-check, eliminating the TOCTOU race condition.
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

    let result;
    try {
      result = await client.query(
        `INSERT INTO medals (enrollment_id, teacher_id, center_id, ptc_date, batch_id)
         VALUES ${valuePlaceholders}
         RETURNING id, medal_unique_id, enrollment_id, teacher_id, center_id, ptc_date, batch_id, printed_at`,
        flatValues,
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

const getByTeacher = async ({ teacherId, centerId, limit, offset }) => {
  const conditions = ["med.teacher_id = $1"];
  const values = [teacherId];
  let idx = 2;

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

module.exports = { printBatch, getByTeacher, BATCH_MAX_SIZE };
