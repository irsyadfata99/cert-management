const express = require("express");
const multer = require("multer");
const { isAuthenticated, authorize } = require("../middleware/authorize");
const { apiLimiter, uploadLimiter } = require("../middleware/rateLimiter");
const {
  validate,
  addCertificateBatchBody,
  transferCertificateBatchBody,
  addMedalStockBody,
  transferMedalStockBody,
  updateThresholdBody,
  idParam,
} = require("../validators");
const stockService = require("../services/stockService");
const driveService = require("../services/driveService");
const { query } = require("../config/database");
const logger = require("../config/logger");

const router = express.Router();

router.use(isAuthenticated);
router.use(apiLimiter);

const ALLOWED_SCAN_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const ALLOWED_REPORT_TYPES = ["application/pdf"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const storage = multer.memoryStorage();

const scanUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_SCAN_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Allowed: jpg, png, pdf"));
    }
  },
});

const reportUpload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_REPORT_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only PDF is allowed"));
    }
  },
});

const handleMulterError = (err, req, res, next) => {
  if (
    err instanceof multer.MulterError ||
    err.message?.includes("Invalid file type")
  ) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
};

// ── Helper: resolve center_id ──────────────────────────────
const resolveStockCenterId = (req, paramCenterId) => {
  if (paramCenterId) return parseInt(paramCenterId);
  return req.user.center_id ?? undefined;
};

// ============================================================
// STOCK ENDPOINTS
// ============================================================

// GET /drive/stock — all centers stock overview
router.get(
  "/stock",
  authorize("admin", "super_admin"),
  async (req, res, next) => {
    try {
      const data = await stockService.getAllStock();
      res.status(200).json({ success: true, data });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// GET /drive/stock/batch/:centerId — detail batch satu center
router.get(
  "/stock/batch/:centerId",
  authorize("admin", "super_admin"),
  async (req, res, next) => {
    try {
      const centerId = parseInt(req.params.centerId);
      const data = await stockService.getCertificateBatch(centerId);

      if (!data) {
        return res.status(404).json({
          success: false,
          message: "No certificate batch found for this center",
        });
      }

      res.status(200).json({ success: true, data });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// POST /drive/stock/certificate/add — tambah/extend certificate batch
router.post(
  "/stock/certificate/add",
  authorize("admin", "super_admin"),
  validate(addCertificateBatchBody),
  async (req, res, next) => {
    try {
      const { range_start, range_end, center_id } = req.body;
      const centerId = resolveStockCenterId(req, center_id);

      if (!centerId) {
        return res
          .status(400)
          .json({ success: false, message: "center_id is required" });
      }

      const data = await stockService.addCertificateBatch({
        centerId,
        rangeStart: range_start,
        rangeEnd: range_end,
        addedBy: req.user.id,
      });

      logger.info("Certificate batch added via API", {
        centerId,
        rangeStart: range_start,
        rangeEnd: range_end,
        action: data.action,
        addedBy: req.user.id,
      });

      res.status(200).json({ success: true, data });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// POST /drive/stock/certificate/transfer — transfer certificate batch antar center
router.post(
  "/stock/certificate/transfer",
  authorize("admin", "super_admin"),
  validate(transferCertificateBatchBody),
  async (req, res, next) => {
    try {
      const { from_center_id, to_center_id, quantity } = req.body;

      const fromBatch = await stockService.getCertificateBatch(from_center_id);

      if (!fromBatch) {
        return res.status(404).json({
          success: false,
          message: "No certificate batch found for source center",
        });
      }

      const available = fromBatch.range_end - fromBatch.current_position + 1;
      if (quantity > available) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock. Available: ${available}, Requested: ${quantity}`,
          data: {
            available,
            transfer_start: fromBatch.range_end - quantity + 1,
            transfer_end: fromBatch.range_end,
          },
        });
      }

      const data = await stockService.transferCertificateBatch({
        fromCenterId: from_center_id,
        toCenterId: to_center_id,
        quantity,
        transferredBy: req.user.id,
      });

      logger.info("Certificate batch transferred via API", {
        fromCenterId: from_center_id,
        toCenterId: to_center_id,
        quantity,
        transferStart: data.transfer_start,
        transferEnd: data.transfer_end,
        transferredBy: req.user.id,
      });

      res.status(200).json({ success: true, data });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// GET /drive/stock/certificate/transfer/preview
router.get(
  "/stock/certificate/transfer/preview",
  authorize("admin", "super_admin"),
  async (req, res, next) => {
    try {
      const { from_center_id, to_center_id, quantity } = req.query;

      if (!from_center_id || !to_center_id || !quantity) {
        return res.status(400).json({
          success: false,
          message: "from_center_id, to_center_id, and quantity are required",
        });
      }

      const qty = parseInt(quantity);
      const fromId = parseInt(from_center_id);
      const toId = parseInt(to_center_id);

      if (fromId === toId) {
        return res.status(400).json({
          success: false,
          message: "Source and destination centers must be different",
        });
      }

      const [fromBatch, toBatch] = await Promise.all([
        stockService.getCertificateBatch(fromId),
        stockService.getCertificateBatch(toId),
      ]);

      if (!fromBatch) {
        return res.status(404).json({
          success: false,
          message: "No certificate batch found for source center",
        });
      }

      const available = fromBatch.range_end - fromBatch.current_position + 1;

      if (qty > available) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock. Available: ${available}, Requested: ${qty}`,
        });
      }

      const transferStart = fromBatch.range_end - qty + 1;
      const transferEnd = fromBatch.range_end;

      let contiguousWarning = null;
      if (toBatch && transferStart !== toBatch.range_end + 1) {
        contiguousWarning = `Transfer range (CERT-${String(transferStart).padStart(6, "0")}) is not contiguous with destination batch end (CERT-${String(toBatch.range_end).padStart(6, "0")}). Transfer will be rejected.`;
      }

      res.status(200).json({
        success: true,
        data: {
          from_center_id: fromId,
          to_center_id: toId,
          quantity: qty,
          transfer_start: transferStart,
          transfer_end: transferEnd,
          transfer_start_formatted: `CERT-${String(transferStart).padStart(6, "0")}`,
          transfer_end_formatted: `CERT-${String(transferEnd).padStart(6, "0")}`,
          from_remaining_after: available - qty,
          from_batch: {
            range_start: fromBatch.range_start,
            range_end: fromBatch.range_end,
            current_position: fromBatch.current_position,
            available,
          },
          to_batch: toBatch
            ? {
                range_start: toBatch.range_start,
                range_end: toBatch.range_end,
                current_position: toBatch.current_position,
                available: toBatch.available,
              }
            : null,
          contiguous_warning: contiguousWarning,
          can_transfer: !contiguousWarning,
        },
      });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// POST /drive/stock/medal/add
router.post(
  "/stock/medal/add",
  authorize("admin", "super_admin"),
  validate(addMedalStockBody),
  async (req, res, next) => {
    try {
      const { quantity, center_id } = req.body;
      const centerId = resolveStockCenterId(req, center_id);

      if (!centerId) {
        return res
          .status(400)
          .json({ success: false, message: "center_id is required" });
      }

      const data = await stockService.addMedalStock({
        centerId,
        quantity,
        addedBy: req.user.id,
      });

      logger.info("Medal stock added via API", {
        centerId,
        quantity,
        addedBy: req.user.id,
      });

      res.status(200).json({ success: true, data });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// POST /drive/stock/medal/transfer
router.post(
  "/stock/medal/transfer",
  authorize("admin", "super_admin"),
  validate(transferMedalStockBody),
  async (req, res, next) => {
    try {
      const { from_center_id, to_center_id, quantity } = req.body;

      const data = await stockService.transferMedalStock({
        fromCenterId: from_center_id,
        toCenterId: to_center_id,
        quantity,
        transferredBy: req.user.id,
      });

      logger.info("Medal stock transferred via API", {
        fromCenterId: from_center_id,
        toCenterId: to_center_id,
        quantity,
        transferredBy: req.user.id,
      });

      res.status(200).json({ success: true, data });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// PATCH /drive/stock/threshold
router.patch(
  "/stock/threshold",
  authorize("admin", "super_admin"),
  validate(updateThresholdBody),
  async (req, res, next) => {
    try {
      const { type, threshold, center_id } = req.body;
      const centerId = resolveStockCenterId(req, center_id);

      if (!centerId) {
        return res
          .status(400)
          .json({ success: false, message: "center_id is required" });
      }

      const data = await stockService.updateThreshold({
        centerId,
        type,
        threshold,
        updatedBy: req.user.id,
      });

      res.status(200).json({ success: true, data });
    } catch (err) {
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// ============================================================
// CERTIFICATE SCAN UPLOAD
// ============================================================

router.post(
  "/certificates/:id/scan",
  authorize("teacher"),
  uploadLimiter,
  (req, res, next) => {
    scanUpload.single("file")(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  validate(idParam, "params"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No file uploaded" });
      }

      const certId = parseInt(req.params.id);
      const teacherId = req.user.id;

      // is_reprint flag sent from frontend as form field
      const isReprint = req.body.is_reprint === "true";

      const certCheck = await query(
        `SELECT c.id, c.scan_file_id, c.enrollment_id,
                s.name AS student_name,
                m.name AS module_name
         FROM certificates c
         JOIN enrollments e ON e.id = c.enrollment_id
         JOIN students s    ON s.id = e.student_id
         JOIN modules m     ON m.id = e.module_id
         WHERE c.id = $1 AND e.teacher_id = $2`,
        [certId, teacherId],
      );

      if (certCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Certificate not found or not assigned to you",
        });
      }

      const cert = certCheck.rows[0];
      const driveFolderId = req.user.drive_folder_id;

      if (!driveFolderId) {
        return res.status(400).json({
          success: false,
          message: "Drive folder not set up yet. Contact admin.",
        });
      }

      if (cert.scan_file_id) {
        try {
          await driveService.deleteFile(cert.scan_file_id);
        } catch (deleteErr) {
          logger.warn("Failed to delete old scan file", {
            certId,
            oldFileId: cert.scan_file_id,
            error: deleteErr.message,
          });
        }
      }

      const today = new Date().toISOString().split("T")[0];
      const safeName = cert.student_name
        .replace(/[^a-zA-Z0-9]/g, "-")
        .replace(/-+/g, "-");
      const safeModule = cert.module_name
        .replace(/[^a-zA-Z0-9]/g, "-")
        .replace(/-+/g, "-");
      const ext = req.file.originalname.split(".").pop() || "jpg";

      // Append _REPRINT suffix before extension if this is a reprint scan
      const baseName = isReprint
        ? `${today}_${safeName}_${safeModule}_REPRINT`
        : `${today}_${safeName}_${safeModule}`;
      const fileName = `${baseName}.${ext}`;

      const { fileId, fileName: uploadedName } = await driveService.uploadFile({
        buffer: req.file.buffer,
        fileName,
        mimeType: req.file.mimetype,
        folderId: driveFolderId,
      });

      await query(
        `UPDATE certificates
         SET scan_file_id = $1, scan_file_name = $2, scan_uploaded_at = NOW()
         WHERE id = $3`,
        [fileId, uploadedName, certId],
      );

      logger.info("Certificate scan uploaded", {
        certId,
        fileId,
        teacherId,
        isReprint,
      });

      res.status(200).json({
        success: true,
        data: {
          cert_id: certId,
          scan_file_id: fileId,
          scan_file_name: uploadedName,
          scan_uploaded_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// REPORT UPLOAD & DOWNLOAD
// ============================================================

router.post(
  "/reports/:id/upload",
  authorize("teacher"),
  uploadLimiter,
  (req, res, next) => {
    reportUpload.single("file")(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  validate(idParam, "params"),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "No file uploaded" });
      }

      const reportId = parseInt(req.params.id);
      const teacherId = req.user.id;
      const driveFolderId = req.user.drive_folder_id;

      const reportCheck = await query(
        `SELECT r.id, r.drive_file_id, r.enrollment_id, s.name AS student_name
         FROM reports r
         JOIN enrollments e ON e.id = r.enrollment_id
         JOIN students s    ON s.id = e.student_id
         WHERE r.id = $1 AND r.teacher_id = $2`,
        [reportId, teacherId],
      );

      if (reportCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Report not found or not assigned to you",
        });
      }

      const report = reportCheck.rows[0];

      if (report.drive_file_id) {
        return res.status(400).json({
          success: false,
          message: "Report already uploaded to Drive and cannot be replaced",
        });
      }

      if (!driveFolderId) {
        return res.status(400).json({
          success: false,
          message: "Drive folder not set up yet. Contact admin.",
        });
      }

      const today = new Date().toISOString().split("T")[0];
      const safeName = report.student_name.replace(/[^a-zA-Z0-9]/g, "_");
      const fileName = `FinalReport_${safeName}_${today}`;

      const { fileId, fileName: uploadedName } = await driveService.uploadFile({
        buffer: req.file.buffer,
        fileName,
        mimeType: "application/pdf",
        folderId: driveFolderId,
      });

      await query(
        `UPDATE reports
         SET drive_file_id = $1, drive_file_name = $2, drive_uploaded_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
        [fileId, uploadedName, reportId],
      );

      await query(
        `UPDATE enrollments SET is_active = FALSE, updated_at = NOW() WHERE id = $1`,
        [report.enrollment_id],
      );

      logger.info("Report manually uploaded to Drive, enrollment deactivated", {
        reportId,
        fileId,
        teacherId,
        enrollmentId: report.enrollment_id,
      });

      res.status(200).json({
        success: true,
        data: {
          report_id: reportId,
          drive_file_id: fileId,
          drive_file_name: uploadedName,
          drive_uploaded_at: new Date().toISOString(),
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

router.get(
  "/reports/:id/download",
  authorize("teacher"),
  validate(idParam, "params"),
  async (req, res, next) => {
    try {
      const reportId = parseInt(req.params.id);
      const teacherId = req.user.id;

      const reportCheck = await query(
        `SELECT r.id, r.drive_file_id, r.drive_file_name
         FROM reports r
         WHERE r.id = $1 AND r.teacher_id = $2 AND r.drive_file_id IS NOT NULL`,
        [reportId, teacherId],
      );

      if (reportCheck.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Report not found or not yet uploaded to Drive",
        });
      }

      const { drive_file_id: fileId, drive_file_name: fileName } =
        reportCheck.rows[0];

      const buffer = await driveService.downloadFile(fileId);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `inline; filename="${fileName ?? "report"}.pdf"`,
      );
      res.setHeader("Content-Length", buffer.length);

      logger.info("Report PDF downloaded", { reportId, fileId, teacherId });

      res.send(buffer);
    } catch (err) {
      next(err);
    }
  },
);

module.exports = router;
