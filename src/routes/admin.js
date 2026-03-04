const express = require("express");
const { authorize } = require("../middleware/authorize");
const { apiLimiter } = require("../middleware/rateLimiter");
const { parsePagination, paginateResponse } = require("../helpers/paginate");
const { buildWhere, buildOrderBy } = require("../helpers/queryBuilder");
const { query } = require("../config/database");
const logger = require("../config/logger");

const router = express.Router();

// Semua route di sini untuk admin dan super_admin
router.use(authorize("admin", "super_admin"));
router.use(apiLimiter);

// ============================================================
// HELPER: resolve center_id berdasarkan role
// Admin hanya bisa akses center sendiri, super_admin bisa semua
// ============================================================

const resolveCenterId = (req, paramCenterId) => {
  if (req.user.role === "super_admin") {
    return paramCenterId ? parseInt(paramCenterId) : undefined;
  }
  return req.user.center_id;
};

// ============================================================
// STUDENTS
// ============================================================

// GET /api/admin/students
router.get("/students", async (req, res, next) => {
  try {
    const centerId = resolveCenterId(req, req.query.center_id);
    const { page, limit, offset } = parsePagination(req.query);

    const { whereClause, values } = buildWhere([
      { col: "s.center_id", val: centerId },
      { col: "s.is_active", val: req.query.is_active === undefined ? undefined : req.query.is_active === "true" },
      { col: "s.name", val: req.query.search, op: "ILIKE", transform: (v) => `%${v}%` },
    ]);

    const orderBy = buildOrderBy(req.query.sort_by, req.query.sort_order, ["name", "created_at"], "name");

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT s.id, s.name, s.center_id, c.name AS center_name, s.is_active, s.created_at, s.updated_at
         FROM students s
         JOIN centers c ON c.id = s.center_id
         ${whereClause} ${orderBy}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
      query(`SELECT COUNT(*)::int AS total FROM students s ${whereClause}`, values),
    ]);

    res.status(200).json({
      success: true,
      ...paginateResponse(dataResult.rows, countResult.rows[0].total, page, limit),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/admin/students/:id
router.get("/students/:id", async (req, res, next) => {
  try {
    const centerId = resolveCenterId(req, null);

    const result = await query(
      `SELECT s.id, s.name, s.center_id, c.name AS center_name, s.is_active, s.created_at, s.updated_at
       FROM students s
       JOIN centers c ON c.id = s.center_id
       WHERE s.id = $1 ${centerId ? "AND s.center_id = $2" : ""}`,
      centerId ? [req.params.id, centerId] : [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Student not found" });
    }

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/students
router.post("/students", async (req, res, next) => {
  try {
    const { name, center_id } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: "Student name is required" });
    }

    const centerId = req.user.role === "super_admin" ? center_id : req.user.center_id;

    if (!centerId) {
      return res.status(400).json({ success: false, message: "center_id is required" });
    }

    // Pastikan center aktif
    const centerCheck = await query(`SELECT id FROM centers WHERE id = $1 AND is_active = TRUE`, [centerId]);
    if (centerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Center not found or inactive" });
    }

    const result = await query(
      `INSERT INTO students (name, center_id)
       VALUES ($1, $2)
       RETURNING id, name, center_id, is_active, created_at`,
      [name.trim(), centerId],
    );

    logger.info("Student created", { studentId: result.rows[0].id, name, centerId, createdBy: req.user.id });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/students/:id
router.patch("/students/:id", async (req, res, next) => {
  try {
    const { name } = req.body;
    const centerId = resolveCenterId(req, null);

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: "Student name is required" });
    }

    const result = await query(
      `UPDATE students
       SET name = $1, updated_at = NOW()
       WHERE id = $2 ${centerId ? "AND center_id = $3" : ""} AND is_active = TRUE
       RETURNING id, name, center_id, is_active, updated_at`,
      centerId ? [name.trim(), req.params.id, centerId] : [name.trim(), req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Student not found or inactive" });
    }

    logger.info("Student updated", { studentId: req.params.id, updatedBy: req.user.id });

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/students/:id/deactivate
router.patch("/students/:id/deactivate", async (req, res, next) => {
  try {
    const centerId = resolveCenterId(req, null);

    const result = await query(
      `UPDATE students
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 ${centerId ? "AND center_id = $2" : ""} AND is_active = TRUE
       RETURNING id, name`,
      centerId ? [req.params.id, centerId] : [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Student not found or already inactive" });
    }

    logger.info("Student deactivated", { studentId: req.params.id, deactivatedBy: req.user.id });

    res.status(200).json({ success: true, message: `Student "${result.rows[0].name}" deactivated` });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// MODULES
// ============================================================

// GET /api/admin/modules
router.get("/modules", async (req, res, next) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const { whereClause, values } = buildWhere([
      { col: "is_active", val: req.query.is_active === undefined ? undefined : req.query.is_active === "true" },
      { col: "name", val: req.query.search, op: "ILIKE", transform: (v) => `%${v}%` },
    ]);

    const orderBy = buildOrderBy(req.query.sort_by, req.query.sort_order, ["name", "created_at"], "name");

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT id, name, description, is_active, created_at, updated_at
         FROM modules ${whereClause} ${orderBy}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
      query(`SELECT COUNT(*)::int AS total FROM modules ${whereClause}`, values),
    ]);

    res.status(200).json({
      success: true,
      ...paginateResponse(dataResult.rows, countResult.rows[0].total, page, limit),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/modules
router.post("/modules", async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ success: false, message: "Module name is required" });
    }

    const result = await query(
      `INSERT INTO modules (name, description)
       VALUES ($1, $2)
       RETURNING id, name, description, is_active, created_at`,
      [name.trim(), description?.trim() ?? null],
    );

    logger.info("Module created", { moduleId: result.rows[0].id, name, createdBy: req.user.id });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/modules/:id
router.patch("/modules/:id", async (req, res, next) => {
  try {
    const { name, description } = req.body;

    if (!name?.trim() && description === undefined) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (name?.trim()) {
      fields.push(`name = $${idx++}`);
      values.push(name.trim());
    }
    if (description !== undefined) {
      fields.push(`description = $${idx++}`);
      values.push(description?.trim() ?? null);
    }
    fields.push("updated_at = NOW()");
    values.push(req.params.id);

    const result = await query(
      `UPDATE modules SET ${fields.join(", ")}
       WHERE id = $${idx} AND is_active = TRUE
       RETURNING id, name, description, is_active, updated_at`,
      values,
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Module not found or inactive" });
    }

    logger.info("Module updated", { moduleId: req.params.id, updatedBy: req.user.id });

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/modules/:id/deactivate
router.patch("/modules/:id/deactivate", async (req, res, next) => {
  try {
    const result = await query(
      `UPDATE modules SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND is_active = TRUE
       RETURNING id, name`,
      [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Module not found or already inactive" });
    }

    logger.info("Module deactivated", { moduleId: req.params.id, deactivatedBy: req.user.id });

    res.status(200).json({ success: true, message: `Module "${result.rows[0].name}" deactivated` });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// TEACHERS
// ============================================================

// GET /api/admin/teachers
router.get("/teachers", async (req, res, next) => {
  try {
    const centerId = resolveCenterId(req, req.query.center_id);
    const { page, limit, offset } = parsePagination(req.query);

    const { whereClause, values } = buildWhere([
      { col: "u.role", val: "teacher" },
      { col: "u.center_id", val: centerId },
      { col: "u.is_active", val: req.query.is_active === undefined ? undefined : req.query.is_active === "true" },
      { col: "u.name", val: req.query.search, op: "ILIKE", transform: (v) => `%${v}%` },
    ]);

    const orderBy = buildOrderBy(req.query.sort_by, req.query.sort_order, ["name", "created_at"], "name");

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT u.id, u.email, u.name, u.avatar, u.center_id, c.name AS center_name,
                u.drive_folder_id, u.is_active, u.created_at, u.updated_at
         FROM users u
         LEFT JOIN centers c ON c.id = u.center_id
         ${whereClause} ${orderBy}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
      query(`SELECT COUNT(*)::int AS total FROM users u ${whereClause}`, values),
    ]);

    res.status(200).json({
      success: true,
      ...paginateResponse(dataResult.rows, countResult.rows[0].total, page, limit),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/teachers — pre-register teacher
router.post("/teachers", async (req, res, next) => {
  try {
    const { email, name, center_id } = req.body;

    if (!email?.trim() || !name?.trim()) {
      return res.status(400).json({ success: false, message: "email and name are required" });
    }

    const centerId = req.user.role === "super_admin" ? center_id : req.user.center_id;

    if (!centerId) {
      return res.status(400).json({ success: false, message: "center_id is required" });
    }

    // Pastikan center aktif
    const centerCheck = await query(`SELECT id, drive_folder_id FROM centers WHERE id = $1 AND is_active = TRUE`, [centerId]);
    if (centerCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Center not found or inactive" });
    }

    const result = await query(
      `INSERT INTO users (email, name, role, center_id, is_active)
       VALUES ($1, $2, 'teacher', $3, FALSE)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, name, role, center_id, is_active, created_at`,
      [email.trim().toLowerCase(), name.trim(), centerId],
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ success: false, message: "Email already registered" });
    }

    logger.info("Teacher pre-registered", {
      teacherId: result.rows[0].id,
      email,
      centerId,
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/admin/teachers/:id/deactivate
router.patch("/teachers/:id/deactivate", async (req, res, next) => {
  try {
    const centerId = resolveCenterId(req, null);

    const result = await query(
      `UPDATE users
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND role = 'teacher' ${centerId ? "AND center_id = $2" : ""} AND is_active = TRUE
       RETURNING id, email, name`,
      centerId ? [req.params.id, centerId] : [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Teacher not found or already inactive" });
    }

    logger.info("Teacher deactivated", { teacherId: req.params.id, deactivatedBy: req.user.id });

    res.status(200).json({ success: true, message: `Teacher "${result.rows[0].name}" deactivated` });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// ENROLLMENTS
// ============================================================

// GET /api/admin/enrollments
router.get("/enrollments", async (req, res, next) => {
  try {
    const centerId = resolveCenterId(req, req.query.center_id);
    const { page, limit, offset } = parsePagination(req.query);

    const { whereClause, values } = buildWhere([
      { col: "e.center_id", val: centerId },
      { col: "e.teacher_id", val: req.query.teacher_id ? parseInt(req.query.teacher_id) : undefined },
      { col: "e.module_id", val: req.query.module_id ? parseInt(req.query.module_id) : undefined },
      { col: "e.is_active", val: req.query.is_active === undefined ? true : req.query.is_active === "true" },
    ]);

    const orderBy = buildOrderBy(req.query.sort_by, req.query.sort_order, ["enrolled_at", "student_name"], "enrolled_at");

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT e.id, s.name AS student_name, m.name AS module_name,
                u.name AS teacher_name, c.name AS center_name,
                e.is_active, e.enrolled_at, e.updated_at
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         JOIN modules m  ON m.id = e.module_id
         JOIN users u    ON u.id = e.teacher_id
         JOIN centers c  ON c.id = e.center_id
         ${whereClause} ${orderBy}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
      query(`SELECT COUNT(*)::int AS total FROM enrollments e ${whereClause}`, values),
    ]);

    res.status(200).json({
      success: true,
      ...paginateResponse(dataResult.rows, countResult.rows[0].total, page, limit),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/admin/enrollments
router.post("/enrollments", async (req, res, next) => {
  try {
    const { student_id, module_id, teacher_id } = req.body;

    if (!student_id || !module_id || !teacher_id) {
      return res.status(400).json({ success: false, message: "student_id, module_id, and teacher_id are required" });
    }

    const centerId = resolveCenterId(req, null);

    // Validasi student, module, teacher aktif dan sesuai center
    const [studentCheck, moduleCheck, teacherCheck] = await Promise.all([
      query(`SELECT id FROM students WHERE id = $1 AND center_id = $2 AND is_active = TRUE`, [student_id, centerId]),
      query(`SELECT id FROM modules WHERE id = $1 AND is_active = TRUE`, [module_id]),
      query(`SELECT id FROM users WHERE id = $1 AND center_id = $2 AND role = 'teacher' AND is_active = TRUE`, [teacher_id, centerId]),
    ]);

    if (studentCheck.rows.length === 0) return res.status(404).json({ success: false, message: "Student not found or inactive" });
    if (moduleCheck.rows.length === 0) return res.status(404).json({ success: false, message: "Module not found or inactive" });
    if (teacherCheck.rows.length === 0) return res.status(404).json({ success: false, message: "Teacher not found or inactive" });

    const result = await query(
      `INSERT INTO enrollments (student_id, module_id, center_id, teacher_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, student_id, module_id, center_id, teacher_id, is_active, enrolled_at`,
      [student_id, module_id, centerId, teacher_id],
    );

    logger.info("Enrollment created", {
      enrollmentId: result.rows[0].id,
      studentId: student_id,
      moduleId: module_id,
      teacherId: teacher_id,
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    // Unique index violation — student sudah punya enrollment aktif
    if (err.code === "23505") {
      return res.status(409).json({ success: false, message: "Student already has an active enrollment" });
    }
    next(err);
  }
});

// PATCH /api/admin/enrollments/:id/deactivate
router.patch("/enrollments/:id/deactivate", async (req, res, next) => {
  try {
    const centerId = resolveCenterId(req, null);

    const result = await query(
      `UPDATE enrollments
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 ${centerId ? "AND center_id = $2" : ""} AND is_active = TRUE
       RETURNING id`,
      centerId ? [req.params.id, centerId] : [req.params.id],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Enrollment not found or already inactive" });
    }

    logger.info("Enrollment deactivated", { enrollmentId: req.params.id, deactivatedBy: req.user.id });

    res.status(200).json({ success: true, message: "Enrollment deactivated" });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
