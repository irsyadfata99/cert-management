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
  createReportBody,
  updateReportBody,
  idParam,
} = require("../validators");
const certificateService = require("../services/certificateService");
const driveService = require("../services/driveService");
const { generateReportPdf } = require("../services/reportPdfService");
const { query } = require("../config/database");
const logger = require("../config/logger");

const router = express.Router();

router.use(authorize("teacher"));
router.use(apiLimiter);

const teacherContext = (req) => ({
  teacherId: req.user.id,
  centerId: req.user.center_id,
  driveFolderId: req.user.drive_folder_id,
  teacherName: req.user.name,
});

const resolveEnrollmentCenter = async (enrollmentId, teacherId) => {
  const result = await query(
    `SELECT e.center_id FROM enrollments e
     JOIN teacher_centers tc ON tc.teacher_id = $2 AND tc.center_id = e.center_id
     WHERE e.id = $1 AND e.teacher_id = $2 AND e.is_active = TRUE`,
    [enrollmentId, teacherId],
  );

  if (result.rows.length === 0) return null;
  return result.rows[0].center_id;
};

router.get("/enrollments", async (req, res, next) => {
  try {
    const { teacherId } = teacherContext(req);
    const { page, limit, offset } = parsePagination(req.query);

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT
           e.id AS enrollment_id,
           e.center_id,
           s.name AS student_name,
           m.name AS module_name,
           c.name AS center_name,
           es.enrollment_status,
           es.cert_printed_count,
           es.cert_scan_uploaded,
           es.report_id,
           es.report_uploaded_at,
           e.enrolled_at
         FROM enrollments e
         JOIN students s  ON s.id = e.student_id
         JOIN modules m   ON m.id = e.module_id
         JOIN centers c   ON c.id = e.center_id
         JOIN vw_enrollment_status es ON es.enrollment_id = e.id
         WHERE e.teacher_id = $1
           AND e.is_active = TRUE
           AND EXISTS (
             SELECT 1 FROM teacher_centers tc
             WHERE tc.teacher_id = $1 AND tc.center_id = e.center_id
           )
         ORDER BY e.enrolled_at DESC
         LIMIT $2 OFFSET $3`,
        [teacherId, limit, offset],
      ),
      query(
        `SELECT COUNT(*)::int AS total
         FROM enrollments e
         WHERE e.teacher_id = $1
           AND e.is_active = TRUE
           AND EXISTS (
             SELECT 1 FROM teacher_centers tc
             WHERE tc.teacher_id = $1 AND tc.center_id = e.center_id
           )`,
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

router.post(
  "/certificates/print",
  printLimiter,
  validate(printCertBody),
  async (req, res, next) => {
    try {
      const { teacherId } = teacherContext(req);
      const { enrollment_id, ptc_date } = req.body;

      const centerId = await resolveEnrollmentCenter(enrollment_id, teacherId);
      if (centerId === null) {
        return res.status(404).json({
          success: false,
          message: "Enrollment not found or not assigned to you",
        });
      }

      const result = await certificateService.printSingle({
        enrollmentId: enrollment_id,
        teacherId,
        centerId,
        ptcDate: ptc_date,
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

router.post(
  "/certificates/print/batch",
  printLimiter,
  validate(printCertBatchBody),
  async (req, res, next) => {
    try {
      const { teacherId } = teacherContext(req);
      const { items } = req.body;

      const centerId = await resolveEnrollmentCenter(
        items[0].enrollment_id,
        teacherId,
      );
      if (centerId === null) {
        return res.status(404).json({
          success: false,
          message: "Enrollment not found or not assigned to you",
        });
      }

      const enrollmentIds = items.map((i) => i.enrollment_id);
      const centerCheck = await query(
        `SELECT COUNT(*)::int AS total FROM enrollments
         WHERE id = ANY($1) AND center_id = $2 AND teacher_id = $3 AND is_active = TRUE`,
        [enrollmentIds, centerId, teacherId],
      );

      if (centerCheck.rows[0].total !== items.length) {
        return res.status(400).json({
          success: false,
          message:
            "All enrollments in a batch must belong to the same center. Split into multiple requests.",
        });
      }

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

router.post(
  "/certificates/reprint",
  printLimiter,
  validate(reprintCertBody),
  async (req, res, next) => {
    try {
      const { teacherId } = teacherContext(req);
      const { original_cert_id, ptc_date } = req.body;

      const certResult = await query(
        `SELECT c.center_id FROM certificates c
         JOIN enrollments e ON e.id = c.enrollment_id
         WHERE c.id = $1 AND e.teacher_id = $2 AND c.is_reprint = FALSE`,
        [original_cert_id, teacherId],
      );

      if (certResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Original certificate not found or not assigned to you",
        });
      }

      const centerId = certResult.rows[0].center_id;

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

router.get(
  "/certificates",
  validate(listCertsQuery, "query"),
  async (req, res, next) => {
    try {
      const { teacherId } = teacherContext(req);
      const { page, limit, offset } = parsePagination(req.query);
      const isReprint =
        req.query.is_reprint === undefined
          ? undefined
          : req.query.is_reprint === "true";

      const { rows, total } = await certificateService.getByTeacher({
        teacherId,
        centerId: null,
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

router.get("/reports", async (req, res, next) => {
  try {
    const { teacherId } = teacherContext(req);
    const { page, limit, offset } = parsePagination(req.query);

    const [dataResult, countResult] = await Promise.all([
      query(
        `SELECT r.id, r.enrollment_id,
                s.name AS student_name,
                m.name AS module_name,
                c.name AS center_name,
                r.academic_year, r.period, r.word_count,
                r.score_creativity, r.score_critical_thinking,
                r.score_attention, r.score_responsibility, r.score_coding_skills,
                r.drive_file_id, r.drive_file_name, r.drive_uploaded_at,
                r.created_at, r.updated_at
         FROM reports r
         JOIN enrollments e ON e.id = r.enrollment_id
         JOIN students s    ON s.id = e.student_id
         JOIN modules m     ON m.id = e.module_id
         JOIN centers c     ON c.id = e.center_id
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

router.post("/reports", validate(createReportBody), async (req, res, next) => {
  try {
    const { teacherId, driveFolderId, teacherName } = teacherContext(req);
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

    const enrollment = await query(
      `SELECT e.id, s.name AS student_name
       FROM enrollments e
       JOIN students s ON s.id = e.student_id
       WHERE e.id = $1
         AND e.teacher_id = $2
         AND e.is_active = TRUE
         AND EXISTS (
           SELECT 1 FROM teacher_centers tc
           WHERE tc.teacher_id = $2 AND tc.center_id = e.center_id
         )`,
      [enrollment_id, teacherId],
    );

    if (enrollment.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Enrollment not found or not assigned to you",
      });
    }

    const { student_name: studentName } = enrollment.rows[0];

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

    const wordCountResult = validateWordCount(content);
    if (!wordCountResult.valid) {
      return res.status(400).json({
        success: false,
        message: `Report content must be at least ${wordCountResult.min} words. Current: ${wordCountResult.count} words.`,
      });
    }

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

      // [FIX] Auto-deactivate enrollment setelah report berhasil diupload ke Drive
      await query(
        `UPDATE enrollments SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
        [enrollment_id],
      );

      logger.info("Report PDF auto-uploaded to Drive, enrollment deactivated", {
        reportId: report.id,
        studentName,
        fileId,
        teacherId,
        enrollmentId: enrollment_id,
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

      const existing = await query(
        `SELECT r.id, r.drive_file_id, r.content, r.academic_year, r.period,
                r.enrollment_id,
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
      Object.keys(dirtyFields).forEach((k) => {
        if (dirtyFields[k] === undefined) delete dirtyFields[k];
      });

      if (Object.keys(dirtyFields).length === 0) {
        return res.status(400).json({
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
          academicYear:
            academic_year !== undefined
              ? academic_year
              : existingData.academic_year,
          period: period !== undefined ? period : existingData.period,
          scoreCreativity:
            score_creativity !== undefined
              ? score_creativity
              : existingData.score_creativity,
          scoreCriticalThinking:
            score_critical_thinking !== undefined
              ? score_critical_thinking
              : existingData.score_critical_thinking,
          scoreAttention:
            score_attention !== undefined
              ? score_attention
              : existingData.score_attention,
          scoreResponsibility:
            score_responsibility !== undefined
              ? score_responsibility
              : existingData.score_responsibility,
          scoreCodingSkills:
            score_coding_skills !== undefined
              ? score_coding_skills
              : existingData.score_coding_skills,
          content: content !== undefined ? content : existingData.content,
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

        // [FIX] Auto-deactivate enrollment setelah report patch berhasil diupload ke Drive
        await query(
          `UPDATE enrollments SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
          [existingData.enrollment_id],
        );

        logger.info(
          "Report PDF re-uploaded after patch, enrollment deactivated",
          {
            reportId: req.params.id,
            fileId,
            teacherId,
            enrollmentId: existingData.enrollment_id,
          },
        );

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

// GET /stock — return object untuk single center, array untuk multi-center
router.get("/stock", async (req, res, next) => {
  try {
    const { teacherId } = teacherContext(req);

    const result = await query(
      `SELECT
         c.id    AS center_id,
         c.name  AS center_name,
         COALESCE(cs.quantity, 0)                           AS cert_quantity,
         COALESCE(cs.low_stock_threshold, 10)               AS cert_threshold,
         COALESCE(cs.quantity, 0) <= COALESCE(cs.low_stock_threshold, 10) AS cert_low_stock,
         COALESCE(ms.quantity, 0)                           AS medal_quantity,
         COALESCE(ms.low_stock_threshold, 10)               AS medal_threshold,
         COALESCE(ms.quantity, 0) <= COALESCE(ms.low_stock_threshold, 10) AS medal_low_stock
       FROM teacher_centers tc
       JOIN centers c              ON c.id = tc.center_id
       JOIN certificate_stock cs   ON cs.center_id = c.id
       JOIN medal_stock ms          ON ms.center_id = c.id
       WHERE tc.teacher_id = $1
         AND c.is_active = TRUE
       ORDER BY tc.is_primary DESC, c.name`,
      [teacherId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No center assigned to your account",
      });
    }

    const data = result.rows.length === 1 ? result.rows[0] : result.rows;

    res.status(200).json({ success: true, data });
  } catch (err) {
    next(err);
  }
});

router.get("/activity", async (req, res, next) => {
  try {
    const { teacherId } = teacherContext(req);

    const centersResult = await query(
      `SELECT center_id FROM teacher_centers WHERE teacher_id = $1`,
      [teacherId],
    );

    if (centersResult.rows.length === 0) {
      return res.status(200).json({ success: true, data: [] });
    }

    const centerIds = centersResult.rows.map((r) => r.center_id);

    const result = await query(
      `SELECT center_id, center_name, month,
              cert_printed, cert_reprinted, cert_scan_uploaded,
              medal_printed, total_issued
       FROM vw_monthly_center_activity
       WHERE center_id = ANY($1)
       ORDER BY month DESC, center_name
       LIMIT 120`,
      [centerIds],
    );

    res.status(200).json({ success: true, data: result.rows });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
