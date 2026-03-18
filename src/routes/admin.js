const express = require("express");
const multer = require("multer");
const ExcelJS = require("exceljs");
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

// ── Multer for Excel import ───────────────────────────────────
const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls) are allowed"));
    }
  },
});

const handleXlsxUpload = (req, res, next) => {
  xlsxUpload.single("file")(req, res, (err) => {
    if (
      err instanceof multer.MulterError ||
      err?.message?.includes("Only Excel")
    ) {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err) return next(err);
    next();
  });
};

const resolveCenterId = (req, paramCenterId) => {
  if (paramCenterId) return parseInt(paramCenterId);
  return undefined;
};

// ============================================================
// STUDENTS
// ============================================================

// IMPORTANT: /students/template and /students/import must be defined
// BEFORE /students/:id to prevent Express matching them as :id param.

// GET /admin/students/template
router.get("/students/template", async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Students");

    sheet.columns = [
      { header: "name", key: "name", width: 35 },
      { header: "center", key: "center", width: 30 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2EAFF" },
    };
    headerRow.alignment = { vertical: "middle" };

    sheet.addRow({ name: "THALIA EDELINE KODIAT", center: "Sunda" });
    sheet.addRow({ name: "BUDI SANTOSO", center: "Sunda" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=students_template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// POST /admin/students/import
router.post("/students/import", handleXlsxUpload, async (req, res, next) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const MAX_ROWS = 20;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];

    if (!sheet) {
      return res
        .status(400)
        .json({ success: false, message: "No worksheet found in file" });
    }

    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const name = row.getCell(1).value?.toString().trim().toUpperCase();
      const centerName = row.getCell(2).value?.toString().trim();
      if (name && centerName) rows.push({ name, centerName });
    });

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No valid data found in file. Make sure columns are name and center.",
      });
    }

    if (rows.length > MAX_ROWS) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_ROWS} rows allowed per import. File contains ${rows.length} data rows.`,
      });
    }

    const imported = [];
    const skipped = [];

    for (const row of rows) {
      // Lookup center by name (case-insensitive)
      const centerResult = await query(
        `SELECT id, name FROM centers
         WHERE UPPER(name) = UPPER($1) AND is_active = TRUE`,
        [row.centerName],
      );

      if (centerResult.rows.length === 0) {
        skipped.push({
          ...row,
          reason: `Center "${row.centerName}" not found or inactive`,
        });
        continue;
      }

      const centerId = centerResult.rows[0].id;
      const centerName = centerResult.rows[0].name;

      // Check duplicate: same name + same center (active only)
      const dupCheck = await query(
        `SELECT id FROM students
         WHERE UPPER(name) = $1 AND center_id = $2 AND is_active = TRUE`,
        [row.name, centerId],
      );

      if (dupCheck.rows.length > 0) {
        skipped.push({
          ...row,
          reason: "Student with same name already exists in this center",
        });
        continue;
      }

      const result = await query(
        `INSERT INTO students (name, center_id)
         VALUES ($1, $2)
         RETURNING id, name, center_id, is_active, created_at`,
        [row.name, centerId],
      );

      imported.push({
        ...result.rows[0],
        center_name: centerName,
      });
    }

    logger.info("Students imported via Excel", {
      total: rows.length,
      imported: imported.length,
      skipped: skipped.length,
      importedBy: req.user.id,
    });

    res.status(200).json({
      success: true,
      data: {
        imported,
        skipped,
        summary: {
          total: rows.length,
          imported: imported.length,
          skipped: skipped.length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

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

// ── Stock ─────────────────────────────────────────────────────

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

// ============================================================
// MODULES
// ============================================================

// IMPORTANT: /modules/template and /modules/import must be defined
// BEFORE /modules/:id to prevent Express matching them as :id param.

router.get("/modules/template", async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Modules");

    sheet.columns = [
      { header: "module_code", key: "code", width: 20 },
      { header: "module_name", key: "name", width: 40 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2EAFF" },
    };
    headerRow.alignment = { vertical: "middle" };

    sheet.addRow({ code: "SCR-001", name: "SCRATCH BEGINNER" });
    sheet.addRow({ code: "PY-ADV", name: "PYTHON ADVANCED" });
    sheet.addRow({ code: "RBX-001", name: "2D GAMES WITH ROBLOX" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=modules_template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

router.post("/modules/import", handleXlsxUpload, async (req, res, next) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const MAX_ROWS = 20;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];

    if (!sheet) {
      return res
        .status(400)
        .json({ success: false, message: "No worksheet found in file" });
    }

    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const code = row.getCell(1).value?.toString().trim().toUpperCase();
      const name = row.getCell(2).value?.toString().trim().toUpperCase();
      if (code && name) rows.push({ code, name });
    });

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No valid data found in file. Make sure columns are module_code and module_name.",
      });
    }

    if (rows.length > MAX_ROWS) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_ROWS} rows allowed per import. File contains ${rows.length} data rows.`,
      });
    }

    const imported = [];
    const skipped = [];

    for (const row of rows) {
      const dupCode = await query(
        `SELECT id FROM modules WHERE UPPER(code) = $1`,
        [row.code],
      );
      if (dupCode.rows.length > 0) {
        skipped.push({ ...row, reason: "Module code already exists" });
        continue;
      }

      const dupName = await query(
        `SELECT id FROM modules WHERE UPPER(name) = $1`,
        [row.name],
      );
      if (dupName.rows.length > 0) {
        skipped.push({ ...row, reason: "Module name already exists" });
        continue;
      }

      const result = await query(
        `INSERT INTO modules (code, name)
         VALUES ($1, $2)
         RETURNING id, code, name, is_active, created_at`,
        [row.code, row.name],
      );
      imported.push(result.rows[0]);
    }

    logger.info("Modules imported via Excel", {
      total: rows.length,
      imported: imported.length,
      skipped: skipped.length,
      importedBy: req.user.id,
    });

    res.status(200).json({
      success: true,
      data: {
        imported,
        skipped,
        summary: {
          total: rows.length,
          imported: imported.length,
          skipped: skipped.length,
        },
      },
    });
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
        ["code", "name", "created_at"],
        "name",
      );

      const [dataResult, countResult] = await Promise.all([
        query(
          `SELECT id, code, name, description, is_active, created_at, updated_at
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
    const { code, name, description } = req.body;

    const dupCode = await query(
      `SELECT id FROM modules WHERE UPPER(code) = UPPER($1)`,
      [code],
    );
    if (dupCode.rows.length > 0) {
      return res
        .status(409)
        .json({ success: false, message: "Module code already exists" });
    }

    const dupName = await query(
      `SELECT id FROM modules WHERE UPPER(name) = UPPER($1)`,
      [name],
    );
    if (dupName.rows.length > 0) {
      return res
        .status(409)
        .json({ success: false, message: "Module name already exists" });
    }

    const result = await query(
      `INSERT INTO modules (code, name, description)
       VALUES ($1, $2, $3)
       RETURNING id, code, name, description, is_active, created_at`,
      [code.toUpperCase(), name.toUpperCase(), description ?? null],
    );

    logger.info("Module created", {
      moduleId: result.rows[0].id,
      code,
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
      const { code, name, description } = req.body;

      if (code !== undefined) {
        const dupCode = await query(
          `SELECT id FROM modules WHERE UPPER(code) = UPPER($1) AND id != $2`,
          [code, req.params.id],
        );
        if (dupCode.rows.length > 0) {
          return res
            .status(409)
            .json({ success: false, message: "Module code already exists" });
        }
      }

      if (name !== undefined) {
        const dupName = await query(
          `SELECT id FROM modules WHERE UPPER(name) = UPPER($1) AND id != $2`,
          [name, req.params.id],
        );
        if (dupName.rows.length > 0) {
          return res
            .status(409)
            .json({ success: false, message: "Module name already exists" });
        }
      }

      const fields = {};
      if (code !== undefined) fields.code = code.toUpperCase();
      if (name !== undefined) fields.name = name.toUpperCase();
      if (description !== undefined) fields.description = description ?? null;

      const { setClause, values, nextIndex } = buildSet(fields);

      const result = await query(
        `UPDATE modules ${setClause}
         WHERE id = $${nextIndex} AND is_active = TRUE
         RETURNING id, code, name, description, is_active, updated_at`,
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

// ============================================================
// TEACHERS
// ============================================================

// IMPORTANT: /teachers/template and /teachers/import must be defined
// BEFORE /teachers/:id to prevent Express matching them as :id param.

// GET /admin/teachers/template
router.get("/teachers/template", async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Teachers");

    sheet.columns = [
      { header: "email", key: "email", width: 35 },
      { header: "center", key: "center", width: 30 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFE2EAFF" },
    };
    headerRow.alignment = { vertical: "middle" };

    sheet.addRow({ email: "ady@kodingnext.com", center: "Sunda" });
    sheet.addRow({ email: "kevin.renaldo@kodingnext.com", center: "Sunda" });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=teachers_template.xlsx",
    );

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    next(err);
  }
});

// POST /admin/teachers/import
router.post("/teachers/import", handleXlsxUpload, async (req, res, next) => {
  try {
    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "No file uploaded" });
    }

    const MAX_ROWS = 20;

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(req.file.buffer);
    const sheet = workbook.worksheets[0];

    if (!sheet) {
      return res
        .status(400)
        .json({ success: false, message: "No worksheet found in file" });
    }

    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const email = row.getCell(1).value?.toString().trim().toLowerCase();
      const centerName = row.getCell(2).value?.toString().trim() ?? null;
      if (email) rows.push({ email, centerName });
    });

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message:
          "No valid data found in file. Make sure columns are email and center.",
      });
    }

    if (rows.length > MAX_ROWS) {
      return res.status(400).json({
        success: false,
        message: `Maximum ${MAX_ROWS} rows allowed per import. File contains ${rows.length} data rows.`,
      });
    }

    const imported = [];
    const skipped = [];

    for (const row of rows) {
      // Check duplicate email
      const dupEmail = await query(`SELECT id FROM users WHERE email = $1`, [
        row.email,
      ]);
      if (dupEmail.rows.length > 0) {
        skipped.push({ ...row, reason: "Email already registered" });
        continue;
      }

      // Lookup center if provided
      let centerId = null;
      let centerName = null;

      if (row.centerName) {
        const centerResult = await query(
          `SELECT id, name FROM centers
           WHERE UPPER(name) = UPPER($1) AND is_active = TRUE`,
          [row.centerName],
        );

        if (centerResult.rows.length === 0) {
          skipped.push({
            ...row,
            reason: `Center "${row.centerName}" not found or inactive`,
          });
          continue;
        }

        centerId = centerResult.rows[0].id;
        centerName = centerResult.rows[0].name;
      }

      // Insert teacher + assign center in transaction
      const result = await withTransaction(async (client) => {
        const userResult = await client.query(
          `INSERT INTO users (email, name, role, center_id, is_active)
           VALUES ($1, $2, 'teacher', $3, FALSE)
           RETURNING id, email, name, role, center_id, is_active, created_at`,
          [row.email, row.email, centerId],
        );

        const teacher = userResult.rows[0];

        if (centerId) {
          await client.query(
            `INSERT INTO teacher_centers (teacher_id, center_id, is_primary)
             VALUES ($1, $2, TRUE)
             ON CONFLICT (teacher_id, center_id) DO NOTHING`,
            [teacher.id, centerId],
          );
        }

        return teacher;
      });

      imported.push({
        ...result,
        center_name: centerName,
      });
    }

    logger.info("Teachers imported via Excel", {
      total: rows.length,
      imported: imported.length,
      skipped: skipped.length,
      importedBy: req.user.id,
    });

    res.status(200).json({
      success: true,
      data: {
        imported,
        skipped,
        summary: {
          total: rows.length,
          imported: imported.length,
          skipped: skipped.length,
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

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

// ============================================================
// ENROLLMENTS
// ============================================================

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
        `SELECT
           vu.teacher_id,
           vu.teacher_name,
           vu.teacher_email,
           vu.center_id,
           vu.center_name,
           vu.enrollment_id,
           vu.student_name,
           vu.module_name,
           vu.scan_file_id,
           vu.scan_uploaded_at,
           vu.report_id,
           vu.report_drive_file_id,
           vu.report_uploaded_at,
           vu.upload_status,
           u.drive_folder_id                               AS teacher_drive_folder_id,
           -- All cert IDs for this enrollment (print + reprints), comma-separated
           (
             SELECT STRING_AGG(c2.cert_unique_id, ', ' ORDER BY c2.printed_at ASC)
             FROM certificates c2
             WHERE c2.enrollment_id = vu.enrollment_id
           )                                               AS all_cert_ids,
           -- Original (non-reprint) cert ID only
           (
             SELECT c3.cert_unique_id
             FROM certificates c3
             WHERE c3.enrollment_id = vu.enrollment_id
               AND c3.is_reprint = FALSE
             ORDER BY c3.printed_at ASC
             LIMIT 1
           )                                               AS print_cert_id,
           -- Reprint cert IDs only, comma-separated
           (
             SELECT STRING_AGG(c4.cert_unique_id, ', ' ORDER BY c4.printed_at ASC)
             FROM certificates c4
             WHERE c4.enrollment_id = vu.enrollment_id
               AND c4.is_reprint = TRUE
           )                                               AS reprint_cert_ids
         FROM vw_teacher_upload_status vu
         JOIN enrollments e ON e.id = vu.enrollment_id
         JOIN users u ON u.id = vu.teacher_id
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
             u.drive_folder_id     AS teacher_drive_folder_id,
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
