const express = require("express");
const { authorize } = require("../middleware/authorize");
const { apiLimiter, printLimiter } = require("../middleware/rateLimiter");
const { parsePagination, paginateResponse } = require("../helpers/paginate");
const { buildSet } = require("../helpers/queryBuilder");
const { validateWordCount } = require("../helpers/wordCount");
const {
  validate,
  printCertBody,
  printCertBatchBody,
  reprintCertBody,
  listCertsQuery,
  printMedalBody,
  printMedalBatchBody,
  createReportBody,
  updateReportBody,
  idParam,
} = require("../validators");
const certificateService = require("../services/certificateService");
const medalService = require("../services/medalService");
const driveService = require("../services/driveService");
const { generateReportPdf } = require("../services/reportPdfService");
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
  driveFolderId: req.user.drive_folder_id,
  teacherName: req.user.name,
});

// ============================================================
// ENROLLMENTS
// ============================================================

// GET /api/teacher/enrollments
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

// ============================================================
// CERTIFICATE — PRINT
// ============================================================

// POST /api/teacher/certificates/print
router.post(
  "/certificates/print",
  printLimiter,
  validate(printCertBody),
  async (req, res, next) => {
    try {
      const { teacherId, centerId } = teacherContext(req);
      const { enrollment_id, ptc_date } = req.body;

      const cert = await certificateService.printSingle({
        enrollmentId: enrollment_id,
        teacherId,
        centerId,
        ptcDate: ptc_date,
      });

      res.status(201).json({ success: true, data: cert });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// POST /api/teacher/certificates/print/batch
router.post(
  "/certificates/print/batch",
  printLimiter,
  validate(printCertBatchBody),
  async (req, res, next) => {
    try {
      const { teacherId, centerId } = teacherContext(req);
      const { items } = req.body;

      const result = await certificateService.printBatch({
        items: items.map((i) => ({
          enrollmentId: i.enrollment_id,
          ptcDate: i.ptc_date,
        })),
        teacherId,
        centerId,
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

// POST /api/teacher/certificates/reprint
router.post(
  "/certificates/reprint",
  printLimiter,
  validate(reprintCertBody),
  async (req, res, next) => {
    try {
      const { teacherId, centerId } = teacherContext(req);
      const { original_cert_id, ptc_date } = req.body;

      const cert = await certificateService.reprint({
        originalCertId: original_cert_id,
        teacherId,
        centerId,
        ptcDate: ptc_date,
      });

      res.status(201).json({ success: true, data: cert });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// GET /api/teacher/certificates
router.get(
  "/certificates",
  validate(listCertsQuery, "query"),
  async (req, res, next) => {
    try {
      const { teacherId, centerId } = teacherContext(req);
      const { page, limit, offset } = parsePagination(req.query);
      const isReprint =
        req.query.is_reprint === undefined
          ? undefined
          : req.query.is_reprint === "true";

      const { rows, total } = await certificateService.getByTeacher({
        teacherId,
        centerId,
        page,
        limit,
        offset,
        isReprint,
      });

      res
        .status(200)
        .json({ success: true, ...paginateResponse(rows, total, page, limit) });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// MEDAL — PRINT
// ============================================================

// POST /api/teacher/medals/print
router.post(
  "/medals/print",
  printLimiter,
  validate(printMedalBody),
  async (req, res, next) => {
    try {
      const { teacherId, centerId } = teacherContext(req);
      const { enrollment_id, ptc_date } = req.body;

      const medal = await medalService.printSingle({
        enrollmentId: enrollment_id,
        teacherId,
        centerId,
        ptcDate: ptc_date,
      });

      res.status(201).json({ success: true, data: medal });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// POST /api/teacher/medals/print/batch
router.post(
  "/medals/print/batch",
  printLimiter,
  validate(printMedalBatchBody),
  async (req, res, next) => {
    try {
      const { teacherId, centerId } = teacherContext(req);
      const { items } = req.body;

      const result = await medalService.printBatch({
        items: items.map((i) => ({
          enrollmentId: i.enrollment_id,
          ptcDate: i.ptc_date,
        })),
        teacherId,
        centerId,
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

    res
      .status(200)
      .json({ success: true, ...paginateResponse(rows, total, page, limit) });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// REPORTS
// ============================================================

// GET /api/teacher/reports
// FIX (WARNING): tambah score_* ke SELECT agar teacher bisa lihat scores yang sudah diisi
router.get("/reports", async (req, res, next) => {
  try {
    const { teacherId } = teacherContext(req);
    const { page, limit, offset } = parsePagination(req.query);

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT r.id, r.enrollment_id,
                s.name AS student_name,
                m.name AS module_name,
                r.academic_year, r.period, r.word_count,
                r.score_creativity, r.score_critical_thinking,
                r.score_attention, r.score_responsibility, r.score_coding_skills,
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
      query(
        `SELECT COUNT(*)::int AS total FROM reports WHERE teacher_id = $1`,
        [teacherId],
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

// POST /api/teacher/reports
// Validation order:
//   1. enrollment exists & assigned to teacher
//   2. cert scan uploaded
//   3. report not already exists   ← FIX: dipindah ke sini agar 409 didahulukan dari 400
//   4. word count >= 200
//   5. insert DB
//   6. generate PDF + auto-upload Drive
router.post("/reports", validate(createReportBody), async (req, res, next) => {
  try {
    const { teacherId, centerId, driveFolderId, teacherName } =
      teacherContext(req);
    const {
      enrollment_id,
      academic_year,
      period,
      content,
      score_creativity,
      score_critical_thinking,
      score_attention,
      score_responsibility,
      score_coding_skills,
    } = req.body;

    // 1. Validasi enrollment
    const enrollment = await query(
      `SELECT e.id, s.name AS student_name
         FROM enrollments e
         JOIN students s ON s.id = e.student_id
         WHERE e.id = $1 AND e.teacher_id = $2 AND e.center_id = $3 AND e.is_active = TRUE`,
      [enrollment_id, teacherId, centerId],
    );

    if (enrollment.rows.length === 0) {
      return res
        .status(404)
        .json({
          success: false,
          message: "Enrollment not found or not assigned to you",
        });
    }

    const { student_name: studentName } = enrollment.rows[0];

    // 2. Cek scan certificate sudah di-upload
    const scanCheck = await query(
      `SELECT id FROM certificates WHERE enrollment_id = $1 AND scan_file_id IS NOT NULL LIMIT 1`,
      [enrollment_id],
    );

    if (scanCheck.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Certificate scan must be uploaded before creating a report",
      });
    }

    // 3. FIX: Cek report sudah ada — SEBELUM word count agar 409 > 400
    const existingReport = await query(
      `SELECT id FROM reports WHERE enrollment_id = $1`,
      [enrollment_id],
    );
    if (existingReport.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message:
          "Report already exists for this enrollment. Use PATCH to update.",
      });
    }

    // 4. Validasi word count min 200
    const wordCountResult = validateWordCount(content);
    if (!wordCountResult.valid) {
      return res.status(400).json({
        success: false,
        message: `Report content must be at least ${wordCountResult.min} words. Current: ${wordCountResult.count} words.`,
      });
    }

    // 5. Insert report ke DB
    const result = await query(
      `INSERT INTO reports (
           enrollment_id, teacher_id, academic_year, period,
           score_creativity, score_critical_thinking, score_attention,
           score_responsibility, score_coding_skills, content, word_count
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, enrollment_id, academic_year, period, word_count,
                   score_creativity, score_critical_thinking, score_attention,
                   score_responsibility, score_coding_skills,
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

    const report = result.rows[0];

    logger.info("Report created", {
      reportId: report.id,
      enrollmentId: enrollment_id,
      teacherId,
      wordCount: wordCountResult.count,
    });

    // 6. AUTO GENERATE PDF + UPLOAD KE DRIVE
    if (!driveFolderId) {
      logger.warn("Auto upload skipped: teacher has no Drive folder", {
        teacherId,
        reportId: report.id,
      });
      return res.status(201).json({
        success: true,
        data: {
          ...report,
          drive_upload_failed: true,
          drive_upload_error: "Drive folder not set up yet. Contact admin.",
        },
      });
    }

    try {
      const pdfBuffer = await generateReportPdf({
        studentName,
        teacherName,
        academicYear: academic_year ?? null,
        period: period ?? null,
        scoreCreativity: score_creativity ?? null,
        scoreCriticalThinking: score_critical_thinking ?? null,
        scoreAttention: score_attention ?? null,
        scoreResponsibility: score_responsibility ?? null,
        scoreCodingSkills: score_coding_skills ?? null,
        content,
      });

      const today = new Date().toISOString().split("T")[0];
      const safeName = studentName.replace(/[^a-zA-Z0-9]/g, "_");
      const fileName = `FinalReport_${safeName}_${today}`;

      const { fileId, fileName: uploadedName } = await driveService.uploadFile({
        buffer: pdfBuffer,
        fileName,
        mimeType: "application/pdf",
        folderId: driveFolderId,
      });

      await query(
        `UPDATE reports SET drive_file_id = $1, drive_file_name = $2, drive_uploaded_at = NOW(), updated_at = NOW() WHERE id = $3`,
        [fileId, uploadedName, report.id],
      );

      logger.info("Report PDF auto-uploaded to Drive", {
        reportId: report.id,
        studentName,
        fileId,
        teacherId,
      });

      return res.status(201).json({
        success: true,
        data: {
          ...report,
          drive_file_id: fileId,
          drive_file_name: uploadedName,
          drive_uploaded_at: new Date().toISOString(),
        },
      });
    } catch (driveErr) {
      logger.error("Report PDF auto-upload failed", {
        reportId: report.id,
        teacherId,
        error: driveErr.message,
      });

      return res.status(201).json({
        success: true,
        data: {
          ...report,
          drive_upload_failed: true,
          drive_upload_error: driveErr.message,
        },
      });
    }
  } catch (err) {
    next(err);
  }
});

// PATCH /api/teacher/reports/:id
// Hanya bisa update jika drive_file_id masih NULL.
// Setelah update, otomatis coba re-generate PDF + re-upload.
router.patch(
  "/reports/:id",
  validate(idParam, "params"),
  validate(updateReportBody),
  async (req, res, next) => {
    try {
      const { teacherId, driveFolderId, teacherName } = teacherContext(req);
      const {
        academic_year,
        period,
        content,
        score_creativity,
        score_critical_thinking,
        score_attention,
        score_responsibility,
        score_coding_skills,
      } = req.body;

      // Ambil report + info student untuk re-generate PDF
      const existing = await query(
        `SELECT r.id, r.drive_file_id, r.content, r.academic_year, r.period,
                r.score_creativity, r.score_critical_thinking, r.score_attention,
                r.score_responsibility, r.score_coding_skills,
                s.name AS student_name
         FROM reports r
         JOIN enrollments e ON e.id = r.enrollment_id
         JOIN students s    ON s.id = e.student_id
         WHERE r.id = $1 AND r.teacher_id = $2`,
        [req.params.id, teacherId],
      );

      if (existing.rows.length === 0) {
        return res
          .status(404)
          .json({ success: false, message: "Report not found" });
      }

      if (existing.rows[0].drive_file_id) {
        return res.status(400).json({
          success: false,
          message: "Report already uploaded to Drive and cannot be edited",
        });
      }

      const existingData = existing.rows[0];

      // Validasi word count jika content di-update
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

      // FIX: Kumpulkan dirty fields, pastikan ada setidaknya satu
      const dirtyFields = {
        content,
        word_count: wordCount,
        academic_year,
        period,
        score_creativity,
        score_critical_thinking,
        score_attention,
        score_responsibility,
        score_coding_skills,
      };

      // Hapus undefined (field tidak dikirim), tapi pertahankan null (user sengaja clear)
      Object.keys(dirtyFields).forEach((k) => {
        if (dirtyFields[k] === undefined) delete dirtyFields[k];
      });

      // FIX (BUG): guard jika tidak ada field yang berubah (seharusnya sudah dicegah Zod refine,
      // tapi double-check di sini untuk keamanan)
      if (Object.keys(dirtyFields).length === 0) {
        return res
          .status(400)
          .json({
            success: false,
            message: "At least one field must be provided",
          });
      }

      const { setClause, values, nextIndex } = buildSet(dirtyFields);

      const updateResult = await query(
        `UPDATE reports ${setClause}
         WHERE id = $${nextIndex}
         RETURNING id, enrollment_id, academic_year, period, word_count,
                   score_creativity, score_critical_thinking, score_attention,
                   score_responsibility, score_coding_skills,
                   drive_file_id, drive_uploaded_at, updated_at`,
        [...values, req.params.id],
      );

      const updatedReport = updateResult.rows[0];
      logger.info("Report updated", { reportId: req.params.id, teacherId });

      // RE-GENERATE PDF + RE-UPLOAD
      if (!driveFolderId) {
        return res.status(200).json({
          success: true,
          data: {
            ...updatedReport,
            drive_upload_failed: true,
            drive_upload_error: "Drive folder not set up yet.",
          },
        });
      }

      try {
        const finalData = {
          studentName: existingData.student_name,
          teacherName,
          academicYear: academic_year ?? existingData.academic_year,
          period: period ?? existingData.period,
          scoreCreativity: score_creativity ?? existingData.score_creativity,
          scoreCriticalThinking:
            score_critical_thinking ?? existingData.score_critical_thinking,
          scoreAttention: score_attention ?? existingData.score_attention,
          scoreResponsibility:
            score_responsibility ?? existingData.score_responsibility,
          scoreCodingSkills:
            score_coding_skills ?? existingData.score_coding_skills,
          content: content ?? existingData.content,
        };

        const pdfBuffer = await generateReportPdf(finalData);

        const today = new Date().toISOString().split("T")[0];
        const safeName = existingData.student_name.replace(
          /[^a-zA-Z0-9]/g,
          "_",
        );
        const fileName = `FinalReport_${safeName}_${today}`;

        const { fileId, fileName: uploadedName } =
          await driveService.uploadFile({
            buffer: pdfBuffer,
            fileName,
            mimeType: "application/pdf",
            folderId: driveFolderId,
          });

        await query(
          `UPDATE reports SET drive_file_id = $1, drive_file_name = $2, drive_uploaded_at = NOW(), updated_at = NOW() WHERE id = $3`,
          [fileId, uploadedName, req.params.id],
        );

        logger.info("Report PDF re-uploaded after patch", {
          reportId: req.params.id,
          fileId,
          teacherId,
        });

        return res.status(200).json({
          success: true,
          data: {
            ...updatedReport,
            drive_file_id: fileId,
            drive_file_name: uploadedName,
            drive_uploaded_at: new Date().toISOString(),
          },
        });
      } catch (driveErr) {
        logger.error("Report PDF re-upload failed after patch", {
          reportId: req.params.id,
          teacherId,
          error: driveErr.message,
        });

        return res.status(200).json({
          success: true,
          data: {
            ...updatedReport,
            drive_upload_failed: true,
            drive_upload_error: driveErr.message,
          },
        });
      }
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// STOCK INFO (read-only)
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
      return res
        .status(404)
        .json({
          success: false,
          message: "Stock data not found for your center",
        });
    }

    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
