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
  createCenterBody,
  updateCenterBody,
  createAdminBody,
  updateAdminBody,
  monitoringUploadQuery,
  monitoringActivityQuery,
  downloadEnrollmentsQuery,
  idParam,
  paginationQuery,
} = require("../validators");
const logger = require("../config/logger");

const router = express.Router();

router.use(authorize("super_admin"));
router.use(apiLimiter);

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

router.post("/centers", validate(createCenterBody), async (req, res, next) => {
  try {
    const { name, address } = req.body;

    const result = await withTransaction(async (client) => {
      const center = await client.query(
        `INSERT INTO centers (name, address)
         VALUES ($1, $2)
         RETURNING id, name, address, is_active, created_at`,
        [name, address ?? null],
      );

      const centerId = center.rows[0].id;

      await client.query(
        `INSERT INTO certificate_stock (center_id) VALUES ($1)
         ON CONFLICT DO NOTHING`,
        [centerId],
      );
      await client.query(
        `INSERT INTO medal_stock (center_id) VALUES ($1)
         ON CONFLICT DO NOTHING`,
        [centerId],
      );

      return center.rows[0];
    });

    logger.info("Center created", {
      centerId: result.id,
      name,
      createdBy: req.user.id,
    });
    res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/centers/:id",
  validate(idParam, "params"),
  validate(updateCenterBody),
  async (req, res, next) => {
    try {
      const { name, address } = req.body;

      const fields = {};
      if (name !== undefined) fields.name = name;
      if (address !== undefined) fields.address = address ?? null;

      const { setClause, values, nextIndex } = buildSet(fields);

      const result = await query(
        `UPDATE centers ${setClause}
       WHERE id = $${nextIndex} AND is_active = TRUE
       RETURNING id, name, address, drive_folder_id, is_active, updated_at`,
        [...values, req.params.id],
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Center not found or inactive" });
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

router.get(
  "/admins",
  validate(paginationQuery, "query"),
  async (req, res, next) => {
    try {
      const { page, limit, offset } = parsePagination(req.query);

      const { whereClause, values } = buildWhere([
        { col: "u.role", val: "admin" },
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
      centerId: center_id,
      createdBy: req.user.id,
    });
    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch(
  "/admins/:id",
  validate(idParam, "params"),
  validate(updateAdminBody),
  async (req, res, next) => {
    try {
      const { name, email } = req.body;

      const existing = await query(
        `SELECT id, email FROM users WHERE id = $1 AND role = 'admin'`,
        [req.params.id],
      );

      if (existing.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Admin not found" });
      }

      const currentAdmin = existing.rows[0];
      const emailChanged = email && email.toLowerCase() !== currentAdmin.email;

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
       WHERE id = $${nextIndex} AND role = 'admin'
       RETURNING id, email, name, avatar, role, center_id, is_active, updated_at`,
        [...values, req.params.id],
      );

      logger.info("Admin updated", {
        adminId: req.params.id,
        emailChanged,
        updatedBy: req.user.id,
      });

      res.status(200).json({
        success: true,
        data: result.rows[0],
        ...(emailChanged && {
          warning:
            "Email changed. Admin account has been deactivated and must re-login with new email.",
        }),
      });
    } catch (err) {
      next(err);
    }
  },
);

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

router.get(
  "/monitoring/uploads",
  validate(monitoringUploadQuery, "query"),
  async (req, res, next) => {
    try {
      const { page, limit, offset } = parsePagination(req.query);

      const { whereClause, values } = buildWhere([
        {
          col: "e.center_id",
          val: req.query.center_id ? parseInt(req.query.center_id) : undefined,
        },
        {
          col: "vu.upload_status",
          val: req.query.status,
        },
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
  },
);

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
  },
);

router.get("/monitoring/stock", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT center_id, center_name,
              cert_quantity, cert_threshold, cert_low_stock,
              medal_quantity, medal_threshold, medal_low_stock,
              has_alert
       FROM vw_stock_alerts
       ORDER BY has_alert DESC, center_name`,
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/download/enrollments",
  validate(downloadEnrollmentsQuery, "query"),
  async (req, res, next) => {
    try {
      const { center_id, module_id, date_from, date_to } = req.query;

      const { whereClause, values } = buildWhere([
        {
          col: "e.center_id",
          val: center_id ? parseInt(center_id) : undefined,
        },
        {
          col: "e.module_id",
          val: module_id ? parseInt(module_id) : undefined,
        },
        {
          col: "e.enrolled_at",
          val: date_from,
          op: ">=",
          transform: (v) => new Date(v),
        },
        {
          col: "e.enrolled_at",
          val: date_to,
          op: "<=",
          transform: (v) => new Date(`${v}T23:59:59`),
        },
      ]);

      const result = await query(
        `SELECT
         e.id              AS enrollment_id,
         s.name            AS student_name,
         m.name            AS module_name,
         u.name            AS teacher_name,
         c.name            AS center_name,
         es.enrollment_status,
         es.cert_printed_count,
         es.cert_reprint_count,
         es.cert_scan_uploaded,
         es.report_id      IS NOT NULL  AS has_report,
         es.report_uploaded_at          IS NOT NULL AS report_uploaded,
         es.medal_printed_count,
         e.enrolled_at
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       JOIN modules m  ON m.id = e.module_id
       JOIN users u    ON u.id = e.teacher_id
       JOIN centers c  ON c.id = e.center_id
       JOIN vw_enrollment_status es ON es.enrollment_id = e.id
       ${whereClause}
       ORDER BY c.name, e.enrolled_at DESC`,
        values,
      );

      const rows = result.rows;
      const COLUMNS = [
        { key: "enrollment_id", label: "Enrollment ID" },
        { key: "student_name", label: "Student Name" },
        { key: "module_name", label: "Module" },
        { key: "teacher_name", label: "Teacher" },
        { key: "center_name", label: "Center" },
        { key: "enrollment_status", label: "Status" },
        { key: "cert_printed_count", label: "Cert Printed" },
        { key: "cert_reprint_count", label: "Cert Reprint" },
        { key: "cert_scan_uploaded", label: "Scan Uploaded" },
        { key: "medal_printed_count", label: "Medal Printed" },
        { key: "has_report", label: "Has Report" },
        { key: "report_uploaded", label: "Report on Drive" },
        { key: "enrolled_at", label: "Enrolled At" },
      ];

      const escape = (val) => {
        if (val === null || val === undefined) return "";
        const str = String(val);
        if (str.includes(",") || str.includes("\n") || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };

      const header = COLUMNS.map((c) => escape(c.label)).join(",");
      const csvRows = rows.map((row) =>
        COLUMNS.map((col) => {
          let val = row[col.key];
          if (typeof val === "boolean") val = val ? "Yes" : "No";
          if (val instanceof Date)
            val = val.toISOString().replace("T", " ").split(".")[0];
          return escape(val);
        }).join(","),
      );

      const csv = [header, ...csvRows].join("\n");

      const today = new Date().toISOString().split("T")[0];
      const filename = `enrollments_${today}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.setHeader("Content-Length", Buffer.byteLength(csv, "utf-8"));

      logger.info("Enrollment CSV downloaded", {
        rows: rows.length,
        filters: { center_id, module_id, date_from, date_to },
        downloadedBy: req.user.id,
      });

      res.status(200).send(csv);
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
