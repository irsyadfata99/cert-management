const express = require("express");
const { authorize } = require("../middleware/authorize");
const { apiLimiter } = require("../middleware/rateLimiter");
const { parsePagination, paginateResponse } = require("../helpers/paginate");
const {
  buildWhere,
  buildSet,
  buildOrderBy,
} = require("../helpers/queryBuilder");
const { createCenterFolder } = require("../services/driveService");
const { query } = require("../config/database"); // [FIX 2] withTransaction dihapus karena migrate sudah pindah ke admin
const {
  validate,
  createCenterBody,
  updateCenterBody,
  createAdminBody,
  monitoringUploadQuery,
  monitoringActivityQuery,
  downloadEnrollmentsQuery,
  idParam,
  paginationQuery,
} = require("../validators"); // [FIX 2] migrateBody dihapus dari import
const logger = require("../config/logger");

const router = express.Router();

router.use(authorize("super_admin"));
router.use(apiLimiter);

// ============================================================
// CENTERS
// ============================================================

// GET /api/super-admin/centers
router.get(
  "/centers",
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
          `SELECT id, name, address, drive_folder_id, is_active, created_at, updated_at
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

// POST /api/super-admin/centers
router.post("/centers", validate(createCenterBody), async (req, res, next) => {
  try {
    const { name, address } = req.body;

    let driveFolderId = null;
    try {
      driveFolderId = await createCenterFolder(name);
    } catch (driveErr) {
      logger.error("Failed to create Drive folder for center", {
        name,
        error: driveErr.message,
      });
      return res.status(502).json({
        success: false,
        message: "Failed to create Drive folder. Please try again.",
      });
    }

    const result = await query(
      `INSERT INTO centers (name, address, drive_folder_id)
       VALUES ($1, $2, $3)
       RETURNING id, name, address, drive_folder_id, is_active, created_at`,
      [name, address ?? null, driveFolderId],
    );

    const centerId = result.rows[0].id;

    await Promise.all([
      query(
        `INSERT INTO certificate_stock (center_id) VALUES ($1) ON CONFLICT (center_id) DO NOTHING`,
        [centerId],
      ),
      query(
        `INSERT INTO medal_stock (center_id) VALUES ($1) ON CONFLICT (center_id) DO NOTHING`,
        [centerId],
      ),
    ]);

    logger.info("Center created", { centerId, name, createdBy: req.user.id });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/super-admin/centers/:id
router.patch(
  "/centers/:id",
  validate(idParam, "params"),
  validate(updateCenterBody),
  async (req, res, next) => {
    try {
      const { name, address } = req.body;

      const fields = {};
      if (name) fields.name = name;
      if (address !== undefined) fields.address = address ?? null;

      const { setClause, values, nextIndex } = buildSet(fields);

      const result = await query(
        `UPDATE centers ${setClause}
       WHERE id = $${nextIndex} AND is_active = TRUE
       RETURNING id, name, address, drive_folder_id, is_active, updated_at`,
        [...values, req.params.id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Center not found or already inactive",
        });
      }

      logger.info("Center updated", {
        centerId: req.params.id,
        updatedBy: req.user.id,
      });

      res.status(200).json({ success: true, data: result.rows[0] });
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/super-admin/centers/:id/deactivate
router.patch(
  "/centers/:id/deactivate",
  validate(idParam, "params"),
  async (req, res, next) => {
    try {
      const result = await query(
        `UPDATE centers SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND is_active = TRUE
       RETURNING id, name`,
        [req.params.id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Center not found or already inactive",
        });
      }

      logger.info("Center deactivated", {
        centerId: req.params.id,
        deactivatedBy: req.user.id,
      });

      res.status(200).json({
        success: true,
        message: `Center "${result.rows[0].name}" deactivated`,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// ADMINS
// ============================================================

// GET /api/super-admin/admins
router.get(
  "/admins",
  validate(paginationQuery, "query"),
  async (req, res, next) => {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      const { whereClause, values } = buildWhere([
        { col: "u.role", val: "admin" },
        {
          col: "u.center_id",
          val: req.query.center_id ? parseInt(req.query.center_id) : undefined,
        },
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
      ]);

      const orderBy = buildOrderBy(
        req.query.sort_by,
        req.query.sort_order,
        ["name", "created_at"],
        "name",
      );

      const [dataResult, countResult] = await Promise.all([
        query(
          `SELECT u.id, u.email, u.name, u.avatar, u.center_id, c.name AS center_name,
                u.is_active, u.created_at, u.updated_at
         FROM users u
         LEFT JOIN centers c ON c.id = u.center_id
         ${whereClause} ${orderBy}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, limit, offset],
        ),
        query(
          `SELECT COUNT(*)::int AS total FROM users u ${whereClause}`,
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

// POST /api/super-admin/admins
router.post("/admins", validate(createAdminBody), async (req, res, next) => {
  try {
    const { email, name, center_id } = req.body;

    const centerCheck = await query(
      `SELECT id FROM centers WHERE id = $1 AND is_active = TRUE`,
      [center_id],
    );
    if (centerCheck.rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "Center not found or inactive" });
    }

    const result = await query(
      `INSERT INTO users (email, name, role, center_id, is_active)
       VALUES ($1, $2, 'admin', $3, FALSE)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, name, role, center_id, is_active, created_at`,
      [email.toLowerCase(), name, center_id],
    );

    if (result.rows.length === 0) {
      return res
        .status(409)
        .json({ success: false, message: "Email already registered" });
    }

    logger.info("Admin pre-registered", {
      adminId: result.rows[0].id,
      email,
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/super-admin/admins/:id/deactivate
router.patch(
  "/admins/:id/deactivate",
  validate(idParam, "params"),
  async (req, res, next) => {
    try {
      const result = await query(
        `UPDATE users SET is_active = FALSE, updated_at = NOW()
       WHERE id = $1 AND role = 'admin' AND is_active = TRUE
       RETURNING id, email, name`,
        [req.params.id],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Admin not found or already inactive",
        });
      }

      logger.info("Admin deactivated", {
        adminId: req.params.id,
        deactivatedBy: req.user.id,
      });

      res.status(200).json({
        success: true,
        message: `Admin "${result.rows[0].name}" deactivated`,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// MONITORING
// ============================================================

// GET /api/super-admin/monitoring/centers
router.get("/monitoring/centers", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         c.id                    AS center_id,
         c.name                  AS center_name,
         c.is_active,
         cs.quantity             AS cert_stock,
         ms.quantity             AS medal_stock,
         COUNT(DISTINCT u.id)    AS teacher_count,
         COUNT(DISTINCT s.id)    AS student_count
       FROM centers c
       LEFT JOIN certificate_stock cs ON cs.center_id = c.id
       LEFT JOIN medal_stock ms       ON ms.center_id = c.id
       LEFT JOIN users u              ON u.center_id = c.id AND u.role = 'teacher' AND u.is_active = TRUE
       LEFT JOIN students s           ON s.center_id = c.id AND s.is_active = TRUE
       GROUP BY c.id, c.name, c.is_active, cs.quantity, ms.quantity
       ORDER BY c.name`,
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/super-admin/monitoring/upload-status
router.get(
  "/monitoring/upload-status",
  validate(monitoringUploadQuery, "query"),
  async (req, res, next) => {
    try {
      const { page, limit, offset } = parsePagination(req.query);
      const { whereClause, values } = buildWhere([
        {
          col: "center_id",
          val: req.query.center_id ? parseInt(req.query.center_id) : undefined,
        },
        { col: "upload_status", val: req.query.status },
      ]);

      const orderBy = buildOrderBy(
        req.query.sort_by,
        req.query.sort_order,
        [
          "teacher_name",
          "student_name",
          "scan_uploaded_at",
          "report_uploaded_at",
        ],
        "teacher_name",
      );

      const [dataResult, countResult] = await Promise.all([
        query(
          `SELECT * FROM vw_teacher_upload_status
         ${whereClause} ${orderBy}
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
          [...values, limit, offset],
        ),
        query(
          `SELECT COUNT(*)::int AS total FROM vw_teacher_upload_status ${whereClause}`,
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

// GET /api/super-admin/monitoring/stock-alerts
router.get("/monitoring/stock-alerts", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM vw_stock_alerts WHERE has_alert = TRUE ORDER BY center_name`,
    );
    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/super-admin/monitoring/activity
router.get(
  "/monitoring/activity",
  validate(monitoringActivityQuery, "query"),
  async (req, res, next) => {
    try {
      const { whereClause, values } = buildWhere([
        {
          col: "center_id",
          val: req.query.center_id ? parseInt(req.query.center_id) : undefined,
        },
      ]);

      const result = await query(
        `SELECT * FROM vw_monthly_center_activity ${whereClause} ORDER BY month DESC, center_name`,
        values,
      );

      res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// DOWNLOAD DATA
// ============================================================

// GET /api/super-admin/download/enrollments
router.get(
  "/download/enrollments",
  validate(downloadEnrollmentsQuery, "query"),
  async (req, res, next) => {
    try {
      const { whereClause, values } = buildWhere([
        {
          col: "e.center_id",
          val: req.query.center_id ? parseInt(req.query.center_id) : undefined,
        },
        {
          col: "e.module_id",
          val: req.query.module_id ? parseInt(req.query.module_id) : undefined,
        },
        { col: "cert.ptc_date", val: req.query.date_from, op: ">=" },
        { col: "cert.ptc_date", val: req.query.date_to, op: "<=" },
      ]);

      const result = await query(
        `SELECT
         e.id                              AS enrollment_id,
         s.name                            AS student_name,
         m.name                            AS module_name,
         u.name                            AS teacher_name,
         c.name                            AS center_name,
         cert.cert_unique_id,
         cert.ptc_date,
         cert.is_reprint,
         cert.scan_file_id IS NOT NULL     AS scan_uploaded,
         cert.scan_uploaded_at,
         r.drive_file_id IS NOT NULL       AS report_uploaded,
         r.drive_uploaded_at,
         med.medal_unique_id,
         e.enrolled_at
       FROM enrollments e
       JOIN students s    ON s.id = e.student_id
       JOIN modules m     ON m.id = e.module_id
       JOIN users u       ON u.id = e.teacher_id
       JOIN centers c     ON c.id = e.center_id
       LEFT JOIN certificates cert ON cert.enrollment_id = e.id AND cert.is_reprint = FALSE
       LEFT JOIN medals med        ON med.enrollment_id  = e.id
       LEFT JOIN reports r         ON r.enrollment_id    = e.id
       ${whereClause}
       ORDER BY c.name, u.name, s.name`,
        values,
      );

      res.status(200).json({ success: true, data: result.rows });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
