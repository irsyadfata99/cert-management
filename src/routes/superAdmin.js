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
  listAdminsQuery,
  monitoringUploadQuery,
  monitoringActivityQuery,
  monitoringReprintsQuery,
  downloadEnrollmentsQuery,
  idParam,
  paginationQuery,
} = require("../validators");
const driveService = require("../services/driveService");
const logger = require("../config/logger");

const router = express.Router();

router.use(authorize("super_admin"));
router.use(apiLimiter);

// ============================================================
// CENTERS
// ============================================================

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

      let driveFolderId = null;
      try {
        driveFolderId = await driveService.createCenterFolder(name);
        if (driveFolderId) {
          await client.query(
            `UPDATE centers SET drive_folder_id = $1 WHERE id = $2`,
            [driveFolderId, centerId],
          );
        }
      } catch (driveErr) {
        logger.warn("Failed to create Drive folder for center", {
          centerId,
          name,
          error: driveErr.message,
        });
      }

      return { ...center.rows[0], drive_folder_id: driveFolderId };
    });

    logger.info("Center created", {
      centerId: result.id,
      name,
      driveFolderId: result.drive_folder_id,
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

// ============================================================
// ADMINS
// ============================================================

router.get(
  "/admins",
  validate(listAdminsQuery, "query"),
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
          `SELECT u.id, u.email, u.name, u.avatar,
                  u.is_active, u.created_at, u.updated_at
           FROM users u
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
    const { email, name } = req.body;

    const result = await query(
      `INSERT INTO users (email, name, role, is_active)
       VALUES ($1, $2, 'admin', FALSE)
       ON CONFLICT (email) DO NOTHING
       RETURNING id, email, name, role, is_active, created_at`,
      [email.toLowerCase(), name],
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

// ============================================================
// MONITORING
// ============================================================

router.get("/monitoring/centers", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT
         c.id                                        AS center_id,
         c.name                                      AS center_name,
         COALESCE(cs.quantity, 0)                    AS cert_stock,
         COALESCE(ms.quantity, 0)                    AS medal_stock,
         COALESCE(cs.low_stock_threshold, 10)        AS cert_threshold,
         COALESCE(ms.low_stock_threshold, 10)        AS medal_threshold,
         COUNT(DISTINCT u.id) FILTER (
           WHERE u.role = 'teacher' AND u.is_active = TRUE
         )                                           AS teacher_count,
         COUNT(DISTINCT s.id) FILTER (
           WHERE s.is_active = TRUE
         )                                           AS student_count
       FROM centers c
       LEFT JOIN certificate_stock cs ON cs.center_id = c.id
       LEFT JOIN medal_stock ms       ON ms.center_id = c.id
       LEFT JOIN users u              ON u.center_id  = c.id
       LEFT JOIN students s           ON s.center_id  = c.id
       WHERE c.is_active = TRUE
       GROUP BY c.id, c.name, cs.quantity, ms.quantity,
                cs.low_stock_threshold, ms.low_stock_threshold
       ORDER BY c.name`,
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

router.get(
  "/monitoring/upload-status",
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

router.get("/monitoring/stock-alerts", async (req, res, next) => {
  try {
    const result = await query(
      `SELECT center_id, center_name,
              cert_quantity, cert_threshold, cert_low_stock,
              medal_quantity, medal_threshold, medal_low_stock,
              has_alert
       FROM vw_stock_alerts
       WHERE has_alert = TRUE
       ORDER BY center_name`,
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

// ── [NEW] GET /super-admin/monitoring/reprints ────────────────
// Reprint log: siapa yang reprint, atas nama student siapa
router.get(
  "/monitoring/reprints",
  validate(monitoringReprintsQuery, "query"),
  async (req, res, next) => {
    try {
      const { page, limit, offset } = parsePagination(req.query);

      const filters = [
        {
          col: "c.center_id",
          val: req.query.center_id ? parseInt(req.query.center_id) : undefined,
        },
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

      // Tambahkan is_reprint = TRUE ke WHERE
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
             -- Teacher yang melakukan reprint
             u.id                  AS teacher_id,
             u.name                AS teacher_name,
             u.email               AS teacher_email,
             -- Student atas nama siapa reprint dilakukan
             s.name                AS student_name,
             -- Module
             m.name                AS module_name,
             -- Center
             cn.id                 AS center_id,
             cn.name               AS center_name,
             -- Original certificate
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

// ============================================================
// DOWNLOAD
// ============================================================

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
        { key: "enrollment_id", label: "ID" },
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
        { key: "report_uploaded", label: "Report Uploaded" },
        { key: "enrolled_at", label: "Enrolled At" },
      ];

      const STATUS_LABELS = {
        pending: "Pending",
        cert_printed: "Cert Printed",
        scan_uploaded: "Scan Uploaded",
        report_uploaded: "Report Uploaded",
        complete: "Complete",
      };

      const formatDate = (val) => {
        if (!val) return "";
        const d = val instanceof Date ? val : new Date(val);
        if (isNaN(d)) return String(val);
        return d
          .toLocaleString("en-GB", {
            timeZone: "Asia/Jakarta",
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          })
          .replace(",", "");
      };

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
          if (col.key === "enrollment_status") {
            val = STATUS_LABELS[val] ?? val;
          } else if (typeof val === "boolean") {
            val = val ? "Yes" : "No";
          } else if (
            val instanceof Date ||
            (typeof val === "string" && col.key === "enrolled_at")
          ) {
            val = formatDate(val);
          }
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

router.patch(
  "/centers/:id/setup-drive",
  validate(idParam, "params"),
  async (req, res, next) => {
    try {
      const centerResult = await query(
        `SELECT id, name, drive_folder_id FROM centers WHERE id = $1 AND is_active = TRUE`,
        [req.params.id],
      );

      if (centerResult.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Center not found or inactive" });
      }

      const center = centerResult.rows[0];

      if (center.drive_folder_id) {
        return res.status(400).json({
          success: false,
          message: "Drive folder already set up for this center",
          data: { drive_folder_id: center.drive_folder_id },
        });
      }

      const driveFolderId = await driveService.createCenterFolder(center.name);

      if (!driveFolderId) {
        return res.status(500).json({
          success: false,
          message:
            "Failed to create Drive folder. Check Drive service configuration.",
        });
      }

      await query(
        `UPDATE centers SET drive_folder_id = $1, updated_at = NOW() WHERE id = $2`,
        [driveFolderId, req.params.id],
      );

      logger.info("Drive folder set up for center", {
        centerId: req.params.id,
        centerName: center.name,
        driveFolderId,
        setupBy: req.user.id,
      });

      res.status(200).json({
        success: true,
        message: `Drive folder created for center "${center.name}"`,
        data: { drive_folder_id: driveFolderId },
      });
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
