const express = require("express");
const { authorize } = require("../middleware/authorize");
const { apiLimiter, printLimiter } = require("../middleware/rateLimiter");
const { parsePagination, paginateResponse } = require("../helpers/paginate");
const { validateWordCount } = require("../helpers/wordCount");
const certificateService = require("../services/certificateService");
const medalService = require("../services/medalService");
const { query } = require("../config/database");
const logger = require("../config/logger");

const router = express.Router();

router.use(authorize("teacher"));
router.use(apiLimiter);

// ============================================================
// HELPER
// ============================================================

const teacherContext = (req) => ({
  teacherId: req.user.id,
  centerId: req.user.center_id,
});

// ============================================================
// ENROLLMENT & STUDENT LIST
// ============================================================

// GET /api/teacher/enrollments
// List enrollment milik teacher yang sedang login
router.get("/enrollments", async (req, res, next) => {
  try {
    const { teacherId, centerId } = teacherContext(req);
    const { page, limit, offset } = parsePagination(req.query);

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT
           e.id AS enrollment_id,
           s.name AS student_name,
           m.name AS module_name,
           es.enrollment_status,
           es.cert_printed_count,
           es.cert_scan_uploaded,
           es.report_id,
           es.report_uploaded_at,
           e.enrolled_at
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         JOIN modules m  ON m.id = e.module_id
         JOIN vw_enrollment_status es ON es.enrollment_id = e.id
         WHERE e.teacher_id = $1 AND e.center_id = $2 AND e.is_active = TRUE
         ORDER BY e.enrolled_at DESC
         LIMIT $3 OFFSET $4`,
        [teacherId, centerId, limit, offset],
      ),
      query(
        `SELECT COUNT(*)::int AS total FROM enrollments
         WHERE teacher_id = $1 AND center_id = $2 AND is_active = TRUE`,
        [teacherId, centerId],
      ),
    ]);

    res.status(200).json({
      success: true,
      ...paginateResponse(dataResult.rows, countResult.rows[0].total, page, limit),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// CERTIFICATE — PRINT
// ============================================================

// POST /api/teacher/certificates/print
router.post("/certificates/print", printLimiter, async (req, res, next) => {
  try {
    const { teacherId, centerId } = teacherContext(req);
    const { enrollment_id, ptc_date } = req.body;

    if (!enrollment_id || !ptc_date) {
      return res.status(400).json({ success: false, message: "enrollment_id and ptc_date are required" });
    }

    const cert = await certificateService.printSingle({
      enrollmentId: enrollment_id,
      teacherId,
      centerId,
      ptcDate: ptc_date,
    });

    res.status(201).json({ success: true, data: cert });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// POST /api/teacher/certificates/print/batch
router.post("/certificates/print/batch", printLimiter, async (req, res, next) => {
  try {
    const { teacherId, centerId } = teacherContext(req);
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "items array is required" });
    }

    // Validasi setiap item
    for (const item of items) {
      if (!item.enrollment_id || !item.ptc_date) {
        return res.status(400).json({
          success: false,
          message: "Each item must have enrollment_id and ptc_date",
        });
      }
    }

    const result = await certificateService.printBatch({
      items: items.map((i) => ({ enrollmentId: i.enrollment_id, ptcDate: i.ptc_date })),
      teacherId,
      centerId,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// POST /api/teacher/certificates/reprint
router.post("/certificates/reprint", printLimiter, async (req, res, next) => {
  try {
    const { teacherId, centerId } = teacherContext(req);
    const { original_cert_id, ptc_date } = req.body;

    if (!original_cert_id || !ptc_date) {
      return res.status(400).json({ success: false, message: "original_cert_id and ptc_date are required" });
    }

    const cert = await certificateService.reprint({
      originalCertId: original_cert_id,
      teacherId,
      centerId,
      ptcDate: ptc_date,
    });

    res.status(201).json({ success: true, data: cert });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// GET /api/teacher/certificates
router.get("/certificates", async (req, res, next) => {
  try {
    const { teacherId, centerId } = teacherContext(req);
    const { page, limit, offset } = parsePagination(req.query);

    const isReprint = req.query.is_reprint === undefined ? undefined : req.query.is_reprint === "true";

    const { rows, total } = await certificateService.getByTeacher({
      teacherId,
      centerId,
      page,
      limit,
      offset,
      isReprint,
    });

    res.status(200).json({
      success: true,
      ...paginateResponse(rows, total, page, limit),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// MEDAL — PRINT
// ============================================================

// POST /api/teacher/medals/print
router.post("/medals/print", printLimiter, async (req, res, next) => {
  try {
    const { teacherId, centerId } = teacherContext(req);
    const { enrollment_id, ptc_date } = req.body;

    if (!enrollment_id || !ptc_date) {
      return res.status(400).json({ success: false, message: "enrollment_id and ptc_date are required" });
    }

    const medal = await medalService.printSingle({
      enrollmentId: enrollment_id,
      teacherId,
      centerId,
      ptcDate: ptc_date,
    });

    res.status(201).json({ success: true, data: medal });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// POST /api/teacher/medals/print/batch
router.post("/medals/print/batch", printLimiter, async (req, res, next) => {
  try {
    const { teacherId, centerId } = teacherContext(req);
    const { items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: "items array is required" });
    }

    for (const item of items) {
      if (!item.enrollment_id || !item.ptc_date) {
        return res.status(400).json({
          success: false,
          message: "Each item must have enrollment_id and ptc_date",
        });
      }
    }

    const result = await medalService.printBatch({
      items: items.map((i) => ({ enrollmentId: i.enrollment_id, ptcDate: i.ptc_date })),
      teacherId,
      centerId,
    });

    res.status(201).json({ success: true, data: result });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// GET /api/teacher/medals
router.get("/medals", async (req, res, next) => {
  try {
    const { teacherId, centerId } = teacherContext(req);
    const { page, limit, offset } = parsePagination(req.query);

    const { rows, total } = await medalService.getByTeacher({
      teacherId,
      centerId,
      limit,
      offset,
    });

    res.status(200).json({
      success: true,
      ...paginateResponse(rows, total, page, limit),
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// REPORTS
// ============================================================

// GET /api/teacher/reports
router.get("/reports", async (req, res, next) => {
  try {
    const { teacherId } = teacherContext(req);
    const { page, limit, offset } = parsePagination(req.query);

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT r.id, r.enrollment_id, s.name AS student_name, m.name AS module_name,
                r.academic_year, r.period, r.word_count,
                r.drive_file_id, r.drive_file_name, r.drive_uploaded_at,
                r.created_at, r.updated_at
         FROM reports r
         JOIN enrollments e ON e.id = r.enrollment_id
         JOIN students s    ON s.id = e.student_id
         JOIN modules m     ON m.id = e.module_id
         WHERE r.teacher_id = $1
         ORDER BY r.created_at DESC
         LIMIT $2 OFFSET $3`,
        [teacherId, limit, offset],
      ),
      query(`SELECT COUNT(*)::int AS total FROM reports WHERE teacher_id = $1`, [teacherId]),
    ]);

    res.status(200).json({
      success: true,
      ...paginateResponse(dataResult.rows, countResult.rows[0].total, page, limit),
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/teacher/reports
// Restriction: tidak bisa buat report sebelum scan certificate di-upload
router.post("/reports", async (req, res, next) => {
  try {
    const { teacherId, centerId } = teacherContext(req);
    const { enrollment_id, academic_year, period, score_creativity, score_critical_thinking, score_attention, score_responsibility, score_coding_skills, content } = req.body;

    if (!enrollment_id || !content) {
      return res.status(400).json({ success: false, message: "enrollment_id and content are required" });
    }

    // Validasi enrollment milik teacher ini
    const enrollment = await query(
      `SELECT id FROM enrollments
       WHERE id = $1 AND teacher_id = $2 AND center_id = $3 AND is_active = TRUE`,
      [enrollment_id, teacherId, centerId],
    );

    if (enrollment.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Enrollment not found or not assigned to you" });
    }

    // Cek scan certificate sudah di-upload
    const scanCheck = await query(
      `SELECT id FROM certificates
       WHERE enrollment_id = $1 AND scan_file_id IS NOT NULL
       LIMIT 1`,
      [enrollment_id],
    );

    if (scanCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Certificate scan must be uploaded before creating a report",
      });
    }

    // Validasi word count min 200
    const wordCountResult = validateWordCount(content);
    if (!wordCountResult.valid) {
      return res.status(400).json({
        success: false,
        message: `Report content must be at least ${wordCountResult.min} words. Current: ${wordCountResult.count} words.`,
      });
    }

    // Cek report sudah ada
    const existingReport = await query(`SELECT id FROM reports WHERE enrollment_id = $1`, [enrollment_id]);

    if (existingReport.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "Report already exists for this enrollment. Use PATCH to update.",
      });
    }

    const result = await query(
      `INSERT INTO reports (
         enrollment_id, teacher_id, academic_year, period,
         score_creativity, score_critical_thinking, score_attention,
         score_responsibility, score_coding_skills, content, word_count
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, enrollment_id, academic_year, period, word_count,
                 drive_file_id, drive_uploaded_at, created_at`,
      [
        enrollment_id,
        teacherId,
        academic_year ?? null,
        period ?? null,
        score_creativity ?? null,
        score_critical_thinking ?? null,
        score_attention ?? null,
        score_responsibility ?? null,
        score_coding_skills ?? null,
        content,
        wordCountResult.count,
      ],
    );

    logger.info("Report created", {
      reportId: result.rows[0].id,
      enrollmentId: enrollment_id,
      teacherId,
      wordCount: wordCountResult.count,
    });

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/teacher/reports/:id
// Hanya bisa update jika belum di-upload ke Drive
router.patch("/reports/:id", async (req, res, next) => {
  try {
    const { teacherId } = teacherContext(req);
    const { academic_year, period, content, score_creativity, score_critical_thinking, score_attention, score_responsibility, score_coding_skills } = req.body;

    // Pastikan report milik teacher ini dan belum di-upload ke Drive
    const existing = await query(`SELECT id, drive_file_id FROM reports WHERE id = $1 AND teacher_id = $2`, [req.params.id, teacherId]);

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Report not found" });
    }

    if (existing.rows[0].drive_file_id) {
      return res.status(400).json({
        success: false,
        message: "Report already uploaded to Drive and cannot be edited",
      });
    }

    // Validasi word count jika content diupdate
    let wordCount;
    if (content !== undefined) {
      const wordCountResult = validateWordCount(content);
      if (!wordCountResult.valid) {
        return res.status(400).json({
          success: false,
          message: `Report content must be at least ${wordCountResult.min} words. Current: ${wordCountResult.count} words.`,
        });
      }
      wordCount = wordCountResult.count;
    }

    const fields = [];
    const values = [];
    let idx = 1;

    if (content !== undefined) {
      fields.push(`content = $${idx++}`);
      values.push(content);
    }
    if (wordCount !== undefined) {
      fields.push(`word_count = $${idx++}`);
      values.push(wordCount);
    }
    if (academic_year !== undefined) {
      fields.push(`academic_year = $${idx++}`);
      values.push(academic_year);
    }
    if (period !== undefined) {
      fields.push(`period = $${idx++}`);
      values.push(period);
    }
    if (score_creativity !== undefined) {
      fields.push(`score_creativity = $${idx++}`);
      values.push(score_creativity);
    }
    if (score_critical_thinking !== undefined) {
      fields.push(`score_critical_thinking = $${idx++}`);
      values.push(score_critical_thinking);
    }
    if (score_attention !== undefined) {
      fields.push(`score_attention = $${idx++}`);
      values.push(score_attention);
    }
    if (score_responsibility !== undefined) {
      fields.push(`score_responsibility = $${idx++}`);
      values.push(score_responsibility);
    }
    if (score_coding_skills !== undefined) {
      fields.push(`score_coding_skills = $${idx++}`);
      values.push(score_coding_skills);
    }

    if (fields.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    fields.push("updated_at = NOW()");
    values.push(req.params.id);

    const result = await query(
      `UPDATE reports SET ${fields.join(", ")}
       WHERE id = $${idx}
       RETURNING id, enrollment_id, academic_year, period, word_count, updated_at`,
      values,
    );

    logger.info("Report updated", { reportId: req.params.id, teacherId });

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// STOCK INFO (read-only untuk teacher)
// ============================================================

// GET /api/teacher/stock
router.get("/stock", async (req, res, next) => {
  try {
    const { centerId } = teacherContext(req);

    const result = await query(
      `SELECT
         cs.quantity AS cert_quantity,
         cs.low_stock_threshold AS cert_threshold,
         cs.quantity <= cs.low_stock_threshold AS cert_low_stock,
         ms.quantity AS medal_quantity,
         ms.low_stock_threshold AS medal_threshold,
         ms.quantity <= ms.low_stock_threshold AS medal_low_stock
       FROM certificate_stock cs
       JOIN medal_stock ms ON ms.center_id = cs.center_id
       WHERE cs.center_id = $1`,
      [centerId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Stock data not found for your center" });
    }

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
