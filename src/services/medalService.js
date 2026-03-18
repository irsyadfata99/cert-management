const { query } = require("../config/database");

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

module.exports = { getByTeacher };
