const express = require("express");
const { authorize } = require("../middleware/authorize");
const { apiLimiter } = require("../middleware/rateLimiter");
const { parsePagination, paginateResponse } = require("../helpers/paginate");
const {
  buildWhere,
  buildSet,
  buildOrderBy,
} = require("../helpers/queryBuilder");
const { query, withTransaction } = require("../config/database");
const {
  validate,
  createStudentBody,
  updateStudentBody,
  listStudentsQuery,
  createModuleBody,
  updateModuleBody,
  createTeacherBody,
  updateTeacherBody,
  listTeachersQuery,
  assignTeacherCenterBody,
  createEnrollmentBody,
  listEnrollmentsQuery,
  monitoringReprintsQuery,
  idParam,
  paginationQuery,
} = require("../validators");
const logger = require("../config/logger");

const router = express.Router();

router.use(authorize("admin", "super_admin"));
router.use(apiLimiter);

const resolveCenterId = (req, paramCenterId) => {
  if (paramCenterId) return parseInt(paramCenterId);
  return undefined;
};

router.get(
  "/students",
  validate(listStudentsQuery, "query"),
  async (req, res, next) => {
    try {
      const centerId = resolveCenterId(req, req.query.center_id);
      const { page, limit, offset } = parsePagination(req.query);

      const { whereClause, values } = buildWhere([
        { col: "s.center_id", val: centerId },
        {
          col: "s.is_active",
          val:
            req.query.is_active === undefined
              ? undefined
              : req.query.is_active === "true",
        },
        {
          col: "s.name",
          val: req.query.search,
          op: "ILIKE",
          transform: (v) => `%${v}%`,
        },
      ]);

      const orderBy = buildOrderBy(
        req.query.sort_by,
        req.query.sort_order,
        ["name", "created_at"],
        "name",
      );

      const [dataResult, countResult] = await Promise.all([
        query(
          `SELECT s.id, s.name, s.center_id, c.name AS center_name, s.is_active, s.created_at, s.updated_at
         FROM students s
         JOIN centers c ON c.id = s.center_id
         ${whereClause} ${orderBy}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, limit, offset],
        ),
        query(
          `SELECT COUNT(*)::int AS total FROM students s ${whereClause}`,
          values,
        ),
      ]);

      res.status(200).json({
        success: true,
        ...paginateResponse(
          dataResult.rows,
          countResult.rows[0].total,
          page,
          limit,
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/students/:id",
  validate(idParam, "params"),
  async (req, res, next) => {
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
        return res
          .status(404)
          .json({ success: false, message: "Student not found" });
      }

      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/students",
  validate(createStudentBody),
  async (req, res, next) => {
    try {
      const { name, center_id } = req.body;
      const centerId = center_id;

      if (!centerId) {
        return res
          .status(400)
          .json({ success: false, message: "center_id is required" });
      }

      const centerCheck = await query(
        `SELECT id FROM centers WHERE id = $1 AND is_active = TRUE`,
        [centerId],
      );
      if (centerCheck.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Center not found or inactive" });
      }

      const result = await query(
        `INSERT INTO students (name, center_id)
       VALUES ($1, $2)
       RETURNING id, name, center_id, is_active, created_at`,
        [name, centerId],
      );

      logger.info("Student created", {
        studentId: result.rows[0].id,
        name,
        centerId,
        createdBy: req.user.id,
      });

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/students/:id",
  validate(idParam, "params"),
  validate(updateStudentBody),
  async (req, res, next) => {
    try {
      const { name, center_id } = req.body;
      const studentId = req.params.id;

      if (center_id !== undefined) {
        const centerCheck = await query(
          `SELECT id FROM centers WHERE id = $1 AND is_active = TRUE`,
          [center_id],
        );
        if (centerCheck.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Target center not found or inactive",
          });
        }

        const activeEnrollment = await query(
          `SELECT id FROM enrollments WHERE student_id = $1 AND is_active = TRUE`,
          [studentId],
        );
        if (activeEnrollment.rows.length > 0) {
          return res.status(400).json({
            success: false,
            message:
              "Cannot move student to another center while they have an active enrollment. Deactivate the enrollment first.",
          });
        }
      }

      const fields = {};
      if (name !== undefined) fields.name = name;
      if (center_id !== undefined) fields.center_id = center_id;

      const { setClause, values, nextIndex } = buildSet(fields);

      const result = await query(
        `UPDATE students
       ${setClause}
       WHERE id = $${nextIndex} AND is_active = TRUE
       RETURNING id, name, center_id, is_active, updated_at`,
        [...values, studentId],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Student not found or inactive" });
      }

      logger.info("Student updated", {
        studentId,
        centerChanged: center_id !== undefined,
        updatedBy: req.user.id,
      });

      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/students/:id/deactivate",
  validate(idParam, "params"),
  async (req, res, next) => {
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
        return res.status(404).json({
          success: false,
          message: "Student not found or already inactive",
        });
      }

      logger.info("Student deactivated", {
        studentId: req.params.id,
        deactivatedBy: req.user.id,
      });
      res.status(200).json({
        success: true,
        message: `Student "${result.rows[0].name}" deactivated`,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/centers",
  validate(paginationQuery, "query"),
  async (req, res, next) => {
    try {
      const { page, limit, offset } = parsePagination(req.query);

      const { whereClause, values } = buildWhere([
        { col: "is_active", val: true },
        {
          col: "name",
          val: req.query.search,
          op: "ILIKE",
          transform: (v) => `%${v}%`,
        },
      ]);

      const orderBy = buildOrderBy(
        req.query.sort_by,
        req.query.sort_order,
        ["name", "created_at"],
        "name",
      );

      const [dataResult, countResult] = await Promise.all([
        query(
          `SELECT id, name, address, is_active, created_at
         FROM centers ${whereClause} ${orderBy}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, limit, offset],
        ),
        query(
          `SELECT COUNT(*)::int AS total FROM centers ${whereClause}`,
          values,
        ),
      ]);

      res.status(200).json({
        success: true,
        ...paginateResponse(
          dataResult.rows,
          countResult.rows[0].total,
          page,
          limit,
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

// ── [UPDATED] /admin/stock — now queries vw_stock_alerts which
// includes certificate batch data (range_start, range_end, current_position)
router.get("/stock", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         center_id,
         center_name,
         cert_quantity,
         cert_threshold,
         cert_low_stock,
         cert_range_start,
         cert_range_end,
         cert_current_position,
         medal_quantity,
         medal_threshold,
         medal_low_stock,
         has_alert
       FROM vw_stock_alerts
       ORDER BY center_name`,
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/modules",
  validate(paginationQuery, "query"),
  async (req, res, next) => {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      const { whereClause, values } = buildWhere([
        {
          col: "is_active",
          val:
            req.query.is_active === undefined
              ? undefined
              : req.query.is_active === "true",
        },
        {
          col: "name",
          val: req.query.search,
          op: "ILIKE",
          transform: (v) => `%${v}%`,
        },
      ]);

      const orderBy = buildOrderBy(
        req.query.sort_by,
        req.query.sort_order,
        ["name", "created_at"],
        "name",
      );

      const [dataResult, countResult] = await Promise.all([
        query(
          `SELECT id, name, description, is_active, created_at, updated_at
         FROM modules ${whereClause} ${orderBy}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, limit, offset],
        ),
        query(
          `SELECT COUNT(*)::int AS total FROM modules ${whereClause}`,
          values,
        ),
      ]);

      res.status(200).json({
        success: true,
        ...paginateResponse(
          dataResult.rows,
          countResult.rows[0].total,
          page,
          limit,
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post("/modules", validate(createModuleBody), async (req, res, next) => {
  try {
    const { name, description } = req.body;

    const result = await query(
      `INSERT INTO modules (name, description)
       VALUES ($1, $2)
       RETURNING id, name, description, is_active, created_at`,
      [name, description ?? null],
    );

    logger.info("Module created", {
      moduleId: result.rows[0].id,
      name,
      createdBy: req.user.id,
    });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/modules/:id",
  validate(idParam, "params"),
  validate(updateModuleBody),
  async (req, res, next) => {
    try {
      const { name, description } = req.body;

      const fields = {};
      if (name) fields.name = name;
      if (description !== undefined) fields.description = description ?? null;

      const { setClause, values, nextIndex } = buildSet(fields);

      const result = await query(
        `UPDATE modules ${setClause}
       WHERE id = $${nextIndex} AND is_active = TRUE
       RETURNING id, name, description, is_active, updated_at`,
        [...values, req.params.id],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Module not found or inactive" });
      }

      logger.info("Module updated", {
        moduleId: req.params.id,
        updatedBy: req.user.id,
      });
      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/modules/:id/deactivate",
  validate(idParam, "params"),
  async (req, res, next) => {
    try {
      const result = await query(
        `UPDATE modules SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND is_active = TRUE
       RETURNING id, name`,
        [req.params.id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Module not found or already inactive",
        });
      }

      logger.info("Module deactivated", {
        moduleId: req.params.id,
        deactivatedBy: req.user.id,
      });
      res.status(200).json({
        success: true,
        message: `Module "${result.rows[0].name}" deactivated`,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/teachers",
  validate(listTeachersQuery, "query"),
  async (req, res, next) => {
    try {
      const centerId = resolveCenterId(req, req.query.center_id);
      const { page, limit, offset } = parsePagination(req.query);

      const { whereClause, values } = buildWhere(
        centerId
          ? [
              { col: "u.role", val: "teacher" },
              {
                col: "u.is_active",
                val:
                  req.query.is_active === undefined
                    ? undefined
                    : req.query.is_active === "true",
              },
              {
                col: "u.name",
                val: req.query.search,
                op: "ILIKE",
                transform: (v) => `%${v}%`,
              },
            ]
          : [
              { col: "u.role", val: "teacher" },
              {
                col: "u.is_active",
                val:
                  req.query.is_active === undefined
                    ? undefined
                    : req.query.is_active === "true",
              },
              {
                col: "u.name",
                val: req.query.search,
                op: "ILIKE",
                transform: (v) => `%${v}%`,
              },
            ],
      );

      const centerJoin = centerId
        ? `JOIN teacher_centers tc_filter ON tc_filter.teacher_id = u.id AND tc_filter.center_id = $${values.length + 1}`
        : "";

      const centerValues = centerId ? [centerId] : [];

      const orderBy = buildOrderBy(
        req.query.sort_by,
        req.query.sort_order,
        ["name", "created_at"],
        "name",
      );

      const baseFrom = `FROM users u LEFT JOIN centers c ON c.id = u.center_id ${centerJoin} ${whereClause}`;
      const allValues = [...values, ...centerValues];

      const [dataResult, countResult] = await Promise.all([
        query(
          `SELECT u.id, u.email, u.name, u.avatar, u.center_id, c.name AS center_name,
                u.drive_folder_id, u.is_active, u.created_at, u.updated_at
         ${baseFrom} ${orderBy}
         LIMIT $${allValues.length + 1} OFFSET $${allValues.length + 2}`,
          [...allValues, limit, offset],
        ),
        query(`SELECT COUNT(*)::int AS total ${baseFrom}`, allValues),
      ]);

      const teacherIds = dataResult.rows.map((t) => t.id);
      let centersMap = {};

      if (teacherIds.length > 0) {
        const centersResult = await query(
          `SELECT tc.teacher_id, tc.center_id, tc.is_primary, c.name AS center_name
         FROM teacher_centers tc
         JOIN centers c ON c.id = tc.center_id
         WHERE tc.teacher_id = ANY($1)
         ORDER BY tc.is_primary DESC, c.name`,
          [teacherIds],
        );

        for (const row of centersResult.rows) {
          if (!centersMap[row.teacher_id]) centersMap[row.teacher_id] = [];
          centersMap[row.teacher_id].push({
            center_id: row.center_id,
            center_name: row.center_name,
            is_primary: row.is_primary,
          });
        }
      }

      const data = dataResult.rows.map((t) => ({
        ...t,
        centers: centersMap[t.id] ?? [],
      }));

      res.status(200).json({
        success: true,
        ...paginateResponse(data, countResult.rows[0].total, page, limit),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/teachers",
  validate(createTeacherBody),
  async (req, res, next) => {
    try {
      const { email, name, center_id } = req.body;
      const centerId = center_id;

      if (!centerId) {
        return res
          .status(400)
          .json({ success: false, message: "center_id is required" });
      }

      const centerCheck = await query(
        `SELECT id FROM centers WHERE id = $1 AND is_active = TRUE`,
        [centerId],
      );
      if (centerCheck.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Center not found or inactive" });
      }

      const result = await withTransaction(async (client) => {
        const userResult = await client.query(
          `INSERT INTO users (email, name, role, center_id, is_active)
         VALUES ($1, $2, 'teacher', $3, FALSE)
         ON CONFLICT (email) DO NOTHING
         RETURNING id, email, name, role, center_id, is_active, created_at`,
          [email.toLowerCase(), name, centerId],
        );

        if (userResult.rows.length === 0) {
          const err = new Error("Email already registered");
          err.status = 409;
          throw err;
        }

        const teacher = userResult.rows[0];

        await client.query(
          `INSERT INTO teacher_centers (teacher_id, center_id, is_primary)
         VALUES ($1, $2, TRUE)
         ON CONFLICT (teacher_id, center_id) DO NOTHING`,
          [teacher.id, centerId],
        );

        return teacher;
      });

      logger.info("Teacher pre-registered", {
        teacherId: result.id,
        email,
        centerId,
        createdBy: req.user.id,
      });

      res.status(201).json({ success: true, data: result });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

router.patch(
  "/teachers/:id",
  validate(idParam, "params"),
  validate(updateTeacherBody),
  async (req, res, next) => {
    try {
      const { name, email } = req.body;
      const centerId = resolveCenterId(req, null);

      const teacherCheckParams = centerId
        ? [req.params.id, centerId]
        : [req.params.id];

      const teacherCheckQuery = centerId
        ? `SELECT u.id, u.email FROM users u
           WHERE u.id = $1 AND u.role = 'teacher'
             AND EXISTS (
               SELECT 1 FROM teacher_centers tc
               WHERE tc.teacher_id = u.id AND tc.center_id = $2
             )`
        : `SELECT u.id, u.email FROM users u WHERE u.id = $1 AND u.role = 'teacher'`;

      const teacherCheck = await query(teacherCheckQuery, teacherCheckParams);

      if (teacherCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Teacher not found or not in your center",
        });
      }

      const currentTeacher = teacherCheck.rows[0];
      const emailChanged =
        email && email.toLowerCase() !== currentTeacher.email;

      if (emailChanged) {
        const emailConflict = await query(
          `SELECT id FROM users WHERE email = $1 AND id != $2`,
          [email.toLowerCase(), req.params.id],
        );
        if (emailConflict.rows.length > 0) {
          return res.status(409).json({
            success: false,
            message: "Email already used by another user",
          });
        }
      }

      const fields = {};
      if (name) fields.name = name;
      if (email) fields.email = email.toLowerCase();
      if (emailChanged) {
        fields.google_id = null;
        fields.avatar = null;
        fields.is_active = false;
      }

      const { setClause, values, nextIndex } = buildSet(fields);

      const result = await query(
        `UPDATE users ${setClause}
       WHERE id = $${nextIndex} AND role = 'teacher'
       RETURNING id, email, name, avatar, role, center_id, is_active, updated_at`,
        [...values, req.params.id],
      );

      logger.info("Teacher updated", {
        teacherId: req.params.id,
        emailChanged,
        updatedBy: req.user.id,
      });

      res.status(200).json({
        success: true,
        data: result.rows[0],
        ...(emailChanged && {
          warning:
            "Email changed. Teacher account has been deactivated and must re-login with new email.",
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/teachers/:id/centers",
  validate(idParam, "params"),
  validate(assignTeacherCenterBody),
  async (req, res, next) => {
    try {
      const { center_id, is_primary } = req.body;
      const adminCenterId = resolveCenterId(req, null);

      if (adminCenterId && center_id !== adminCenterId) {
        return res.status(404).json({
          success: false,
          message: "Center not found or inactive",
        });
      }

      const teacherCheck = await query(
        adminCenterId
          ? `SELECT id FROM users
             WHERE id = $1 AND role = 'teacher'
               AND (center_id = $2 OR center_id IS NULL)`
          : `SELECT id FROM users WHERE id = $1 AND role = 'teacher'`,
        adminCenterId ? [req.params.id, adminCenterId] : [req.params.id],
      );
      if (teacherCheck.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Teacher not found" });
      }

      const centerCheck = await query(
        `SELECT id FROM centers WHERE id = $1 AND is_active = TRUE`,
        [center_id],
      );
      if (centerCheck.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Center not found or inactive" });
      }

      const result = await withTransaction(async (client) => {
        if (is_primary) {
          await client.query(
            `UPDATE teacher_centers SET is_primary = FALSE
           WHERE teacher_id = $1 AND is_primary = TRUE`,
            [req.params.id],
          );
          await client.query(
            `UPDATE users SET center_id = $1, updated_at = NOW() WHERE id = $2`,
            [center_id, req.params.id],
          );
        }

        const insertResult = await client.query(
          `INSERT INTO teacher_centers (teacher_id, center_id, is_primary)
         VALUES ($1, $2, $3)
         ON CONFLICT (teacher_id, center_id)
         DO UPDATE SET is_primary = EXCLUDED.is_primary
         RETURNING teacher_id, center_id, is_primary, created_at`,
          [req.params.id, center_id, is_primary ?? false],
        );

        return insertResult.rows[0];
      });

      logger.info("Teacher assigned to center", {
        teacherId: req.params.id,
        centerId: center_id,
        isPrimary: is_primary,
        assignedBy: req.user.id,
      });

      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  },
);

router.delete("/teachers/:id/centers/:centerId", async (req, res, next) => {
  try {
    const teacherId = parseInt(req.params.id);
    const centerId = parseInt(req.params.centerId);
    const adminCenterId = resolveCenterId(req, null);

    if (adminCenterId && centerId !== adminCenterId) {
      return res.status(404).json({
        success: false,
        message: "Teacher is not assigned to this center",
      });
    }

    const assignCheck = await query(
      `SELECT teacher_id, center_id, is_primary FROM teacher_centers
       WHERE teacher_id = $1 AND center_id = $2`,
      [teacherId, centerId],
    );

    if (assignCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Teacher is not assigned to this center",
      });
    }

    const countResult = await query(
      `SELECT COUNT(*)::int AS total FROM teacher_centers WHERE teacher_id = $1`,
      [teacherId],
    );

    if (countResult.rows[0].total <= 1) {
      return res.status(400).json({
        success: false,
        message:
          "Cannot remove the only center assignment. Deactivate the teacher instead.",
      });
    }

    const isPrimary = assignCheck.rows[0].is_primary;

    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM teacher_centers WHERE teacher_id = $1 AND center_id = $2`,
        [teacherId, centerId],
      );

      if (isPrimary) {
        const newPrimary = await client.query(
          `UPDATE teacher_centers
           SET is_primary = TRUE
           WHERE teacher_id = $1
             AND center_id = (
               SELECT center_id FROM teacher_centers
               WHERE teacher_id = $1
               ORDER BY created_at ASC
               LIMIT 1
             )
           RETURNING center_id`,
          [teacherId],
        );

        if (newPrimary.rows.length > 0) {
          await client.query(
            `UPDATE users SET center_id = $1, updated_at = NOW() WHERE id = $2`,
            [newPrimary.rows[0].center_id, teacherId],
          );
        }
      }
    });

    logger.info("Teacher removed from center", {
      teacherId,
      centerId,
      wasPrimary: isPrimary,
      removedBy: req.user.id,
    });

    res.status(200).json({
      success: true,
      message: "Teacher removed from center",
      ...(isPrimary && {
        note: "Primary center has been reassigned to the next oldest center.",
      }),
    });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/teachers/:id/centers",
  validate(idParam, "params"),
  async (req, res, next) => {
    try {
      const teacherId = parseInt(req.params.id);
      const adminCenterId = resolveCenterId(req, null);

      if (adminCenterId) {
        const accessCheck = await query(
          `SELECT 1 FROM users
           WHERE id = $1 AND role = 'teacher'
             AND (
               center_id = $2
               OR EXISTS (
                 SELECT 1 FROM teacher_centers
                 WHERE teacher_id = $1 AND center_id = $2
               )
             )`,
          [teacherId, adminCenterId],
        );
        if (accessCheck.rows.length === 0) {
          return res.status(404).json({
            success: false,
            message: "Teacher not found in your center",
          });
        }
      }

      const result = await query(
        `SELECT tc.center_id, c.name AS center_name, tc.is_primary, tc.created_at
       FROM teacher_centers tc
       JOIN centers c ON c.id = tc.center_id
       WHERE tc.teacher_id = $1
       ORDER BY tc.is_primary DESC, c.name`,
        [teacherId],
      );

      res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
      next(err);
    }
  },
);

router.patch(
  "/teachers/:id/deactivate",
  validate(idParam, "params"),
  async (req, res, next) => {
    try {
      const centerId = resolveCenterId(req, null);

      const params = centerId ? [req.params.id, centerId] : [req.params.id];
      const centerCondition = centerId
        ? `AND EXISTS (
             SELECT 1 FROM teacher_centers tc
             WHERE tc.teacher_id = users.id AND tc.center_id = $2
           )`
        : "";

      const result = await query(
        `UPDATE users
       SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND role = 'teacher'
       ${centerCondition} AND is_active = TRUE
       RETURNING id, email, name`,
        params,
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Teacher not found or already inactive",
        });
      }

      logger.info("Teacher deactivated", {
        teacherId: req.params.id,
        deactivatedBy: req.user.id,
      });
      res.status(200).json({
        success: true,
        message: `Teacher "${result.rows[0].name}" deactivated`,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/enrollments",
  validate(listEnrollmentsQuery, "query"),
  async (req, res, next) => {
    try {
      const centerId = resolveCenterId(req, req.query.center_id);
      const { page, limit, offset } = parsePagination(req.query);

      const { whereClause, values } = buildWhere([
        { col: "e.center_id", val: centerId },
        {
          col: "e.teacher_id",
          val: req.query.teacher_id
            ? parseInt(req.query.teacher_id)
            : undefined,
        },
        {
          col: "e.module_id",
          val: req.query.module_id ? parseInt(req.query.module_id) : undefined,
        },
        {
          col: "es.enrollment_status",
          val: req.query.enrollment_status,
        },
        {
          col: "s.name",
          val: req.query.search,
          op: "ILIKE",
          transform: (v) => `%${v}%`,
        },
      ]);

      const orderBy = buildOrderBy(
        req.query.sort_by,
        req.query.sort_order,
        ["enrolled_at", "student_name"],
        "enrolled_at",
      );

      const [dataResult, countResult] = await Promise.all([
        query(
          `SELECT e.id, s.name AS student_name, m.name AS module_name,
                  u.name AS teacher_name, c.name AS center_name,
                  e.is_active, e.enrolled_at, e.updated_at,
                  es.enrollment_status
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
           JOIN modules m  ON m.id = e.module_id
           JOIN users u    ON u.id = e.teacher_id
           JOIN centers c  ON c.id = e.center_id
           LEFT JOIN vw_enrollment_status es ON es.enrollment_id = e.id
           ${whereClause} ${orderBy}
           LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, limit, offset],
        ),
        query(
          `SELECT COUNT(*)::int AS total
           FROM enrollments e
           JOIN students s ON s.id = e.student_id
           LEFT JOIN vw_enrollment_status es ON es.enrollment_id = e.id
           ${whereClause}`,
          values,
        ),
      ]);

      res.status(200).json({
        success: true,
        ...paginateResponse(
          dataResult.rows,
          countResult.rows[0].total,
          page,
          limit,
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  "/enrollments",
  validate(createEnrollmentBody),
  async (req, res, next) => {
    try {
      const { student_id, module_id, teacher_id } = req.body;

      const result = await withTransaction(async (client) => {
        const [studentCheck, moduleCheck, teacherCheck] = await Promise.all([
          client.query(
            `SELECT id, center_id FROM students
           WHERE id = $1 AND is_active = TRUE
           FOR SHARE`,
            [student_id],
          ),
          client.query(
            `SELECT id FROM modules
           WHERE id = $1 AND is_active = TRUE
           FOR SHARE`,
            [module_id],
          ),
          client.query(
            `SELECT u.id FROM users u
           WHERE u.id = $1
             AND u.role = 'teacher'
             AND u.is_active = TRUE
           FOR SHARE`,
            [teacher_id],
          ),
        ]);

        if (studentCheck.rows.length === 0) {
          const err = new Error("Student not found or inactive");
          err.status = 404;
          throw err;
        }
        if (moduleCheck.rows.length === 0) {
          const err = new Error("Module not found or inactive");
          err.status = 404;
          throw err;
        }
        if (teacherCheck.rows.length === 0) {
          const err = new Error(
            "Teacher not found, inactive, or not assigned to this center",
          );
          err.status = 404;
          throw err;
        }

        const centerId = studentCheck.rows[0].center_id;

        return client.query(
          `INSERT INTO enrollments (student_id, module_id, center_id, teacher_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, student_id, module_id, center_id, teacher_id, is_active, enrolled_at`,
          [student_id, module_id, centerId, teacher_id],
        );
      });

      logger.info("Enrollment created", {
        enrollmentId: result.rows[0].id,
        studentId: student_id,
        moduleId: module_id,
        teacherId: teacher_id,
        createdBy: req.user.id,
      });

      res.status(201).json({ success: true, data: result.rows[0] });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      if (err.code === "23505") {
        return res.status(409).json({
          success: false,
          message: "Student already has an active enrollment",
        });
      }
      next(err);
    }
  },
);

router.patch(
  "/enrollments/:id/deactivate",
  validate(idParam, "params"),
  async (req, res, next) => {
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
        return res.status(404).json({
          success: false,
          message: "Enrollment not found or already inactive",
        });
      }

      logger.info("Enrollment deactivated", {
        enrollmentId: req.params.id,
        deactivatedBy: req.user.id,
      });
      res
        .status(200)
        .json({ success: true, message: "Enrollment deactivated" });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/enrollments/:id/pair-status",
  validate(idParam, "params"),
  async (req, res, next) => {
    try {
      const centerId = resolveCenterId(req, null);

      const result = await query(
        `SELECT
         e.id                                        AS enrollment_id,
         s.name                                      AS student_name,
         m.name                                      AS module_name,
         cert.id                                     AS cert_id,
         cert.cert_unique_id,
         cert.scan_file_id,
         cert.scan_uploaded_at,
         r.id                                        AS report_id,
         r.drive_file_id,
         r.drive_uploaded_at  AS report_uploaded_at,
         (cert.scan_file_id IS NOT NULL)             AS scan_complete,
         (r.drive_file_id   IS NOT NULL)             AS report_complete,
         (cert.scan_file_id IS NOT NULL AND
          r.drive_file_id   IS NOT NULL)             AS pair_complete
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       JOIN modules  m ON m.id = e.module_id
       LEFT JOIN LATERAL (
         SELECT id, cert_unique_id, scan_file_id, scan_uploaded_at
         FROM certificates
         WHERE enrollment_id = e.id AND is_reprint = FALSE
         ORDER BY printed_at DESC LIMIT 1
       ) cert ON TRUE
       LEFT JOIN reports r ON r.enrollment_id = e.id
       WHERE e.id = $1
         ${centerId ? "AND e.center_id = $2" : ""}`,
        centerId ? [req.params.id, centerId] : [req.params.id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Enrollment not found or inactive",
        });
      }

      const data = result.rows[0];
      const missing = [];
      if (!data.scan_complete) missing.push("certificate scan");
      if (!data.report_complete) missing.push("final report on Drive");

      res
        .status(200)
        .json({ success: true, data: { ...data, missing_items: missing } });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// MONITORING
// ============================================================

router.get("/monitoring/upload-status", async (req, res, next) => {
  try {
    const centerId = resolveCenterId(req, req.query.center_id);
    const { page, limit, offset } = parsePagination(req.query);

    const { whereClause, values } = buildWhere([
      { col: "e.center_id", val: centerId },
      { col: "vu.upload_status", val: req.query.status },
    ]);

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT vu.teacher_id, vu.teacher_name, vu.teacher_email,
                vu.center_id, vu.center_name, vu.enrollment_id,
                vu.student_name, vu.module_name,
                vu.scan_file_id, vu.scan_uploaded_at,
                vu.report_id, vu.report_drive_file_id,
                vu.report_uploaded_at, vu.upload_status
         FROM vw_teacher_upload_status vu
         JOIN enrollments e ON e.id = vu.enrollment_id
         ${whereClause}
         ORDER BY vu.upload_status, vu.teacher_name
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
      query(
        `SELECT COUNT(*)::int AS total
         FROM vw_teacher_upload_status vu
         JOIN enrollments e ON e.id = vu.enrollment_id
         ${whereClause}`,
        values,
      ),
    ]);

    res.status(200).json({
      success: true,
      ...paginateResponse(
        dataResult.rows,
        countResult.rows[0].total,
        page,
        limit,
      ),
    });
  } catch (err) {
    next(err);
  }
});

router.get("/monitoring/activity", async (req, res, next) => {
  try {
    const centerId = resolveCenterId(req, req.query.center_id);

    const { whereClause, values } = buildWhere([
      { col: "center_id", val: centerId },
    ]);

    const result = await query(
      `SELECT center_id, center_name, month,
              cert_printed, cert_reprinted, cert_scan_uploaded,
              medal_printed, total_issued
       FROM vw_monthly_center_activity
       ${whereClause}
       ORDER BY month DESC, center_name
       LIMIT 120`,
      values,
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get("/monitoring/stock-alerts", async (req, res, next) => {
  try {
    const centerId = resolveCenterId(req, null);

    const { whereClause, values } = buildWhere([
      { col: "center_id", val: centerId },
    ]);

    const hasAlertClause = whereClause
      ? `${whereClause} AND has_alert = TRUE`
      : `WHERE has_alert = TRUE`;

    const result = await query(
      `SELECT
         center_id,
         center_name,
         cert_quantity,
         cert_threshold,
         cert_low_stock,
         cert_range_start,
         cert_range_end,
         cert_current_position,
         medal_quantity,
         medal_threshold,
         medal_low_stock,
         has_alert
       FROM vw_stock_alerts
       ${hasAlertClause}
       ORDER BY center_name`,
      values,
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/monitoring/reprints",
  validate(monitoringReprintsQuery, "query"),
  async (req, res, next) => {
    try {
      const { page, limit, offset } = parsePagination(req.query);

      const centerId = req.query.center_id
        ? parseInt(req.query.center_id)
        : (req.user.center_id ?? null);

      const filters = [
        { col: "c.center_id", val: centerId },
        {
          col: "c.printed_at",
          val: req.query.date_from,
          op: ">=",
          transform: (v) => new Date(v),
        },
        {
          col: "c.printed_at",
          val: req.query.date_to,
          op: "<=",
          transform: (v) => new Date(`${v}T23:59:59`),
        },
      ];

      const { whereClause, values } = buildWhere(filters);

      const reprintWhere = whereClause
        ? `${whereClause} AND c.is_reprint = TRUE`
        : `WHERE c.is_reprint = TRUE`;

      const [dataResult, countResult] = await Promise.all([
        query(
          `SELECT
             c.id                  AS reprint_cert_id,
             c.cert_unique_id      AS reprint_cert_unique_id,
             c.printed_at          AS reprinted_at,
             c.ptc_date,
             u.id                  AS teacher_id,
             u.name                AS teacher_name,
             u.email               AS teacher_email,
             s.name                AS student_name,
             m.name                AS module_name,
             cn.id                 AS center_id,
             cn.name               AS center_name,
             oc.id                 AS original_cert_id,
             oc.cert_unique_id     AS original_cert_unique_id,
             oc.printed_at         AS original_printed_at
           FROM certificates c
           JOIN enrollments e      ON e.id  = c.enrollment_id
           JOIN users u            ON u.id  = c.teacher_id
           JOIN students s         ON s.id  = e.student_id
           JOIN modules m          ON m.id  = e.module_id
           JOIN centers cn         ON cn.id = c.center_id
           LEFT JOIN certificates oc ON oc.id = c.original_cert_id
           ${reprintWhere}
           ORDER BY c.printed_at DESC
           LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, limit, offset],
        ),
        query(
          `SELECT COUNT(*)::int AS total
           FROM certificates c
           JOIN enrollments e ON e.id = c.enrollment_id
           JOIN centers cn    ON cn.id = c.center_id
           ${reprintWhere}`,
          values,
        ),
      ]);

      res.status(200).json({
        success: true,
        ...paginateResponse(
          dataResult.rows,
          countResult.rows[0].total,
          page,
          limit,
        ),
      });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
