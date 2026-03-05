const express = require("express");
const multer = require("multer");
const { isAuthenticated, authorize } = require("../middleware/authorize");
const { apiLimiter, uploadLimiter } = require("../middleware/rateLimiter");
const { validate, addStockBody, transferStockBody, updateThresholdBody, idParam } = require("../validators");
const stockService = require("../services/stockService");
const driveService = require("../services/driveService");
const { query } = require("../config/database");
const logger = require("../config/logger");

const router = express.Router();

router.use(isAuthenticated);
router.use(apiLimiter);

// ============================================================
// MULTER CONFIG
// ============================================================

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

// ============================================================
// MULTER ERROR HANDLER
// ============================================================

const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes("Invalid file type")) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
};

// ============================================================
// STOCK
// ============================================================

// GET /api/drive/stock
// Admin: return stock center sendiri
// Super Admin: return semua stock
router.get("/stock", authorize("admin", "super_admin"), async (req, res, next) => {
  try {
    if (req.user.role === "super_admin") {
      const data = await stockService.getAllStock();
      return res.status(200).json({ success: true, data });
    }

    const data = await stockService.getStockByCenter(req.user.center_id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// POST /api/drive/stock/add
router.post("/stock/add", authorize("admin", "super_admin"), validate(addStockBody), async (req, res, next) => {
  try {
    const { type, quantity, center_id } = req.body;
    const centerId = req.user.role === "super_admin" ? center_id : req.user.center_id;

    if (!centerId) {
      return res.status(400).json({ success: false, message: "center_id is required" });
    }

    const data = await stockService.addStock({
      centerId,
      type,
      quantity,
      addedBy: req.user.id,
    });

    logger.info("Stock added via API", { centerId, type, quantity, addedBy: req.user.id });

    res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// POST /api/drive/stock/transfer — super_admin only
router.post("/stock/transfer", authorize("super_admin"), validate(transferStockBody), async (req, res, next) => {
  try {
    const { type, from_center_id, to_center_id, quantity } = req.body;

    const data = await stockService.transferStock({
      type,
      fromCenterId: from_center_id,
      toCenterId: to_center_id,
      quantity,
      transferredBy: req.user.id,
    });

    res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// PATCH /api/drive/stock/threshold
router.patch("/stock/threshold", authorize("admin", "super_admin"), validate(updateThresholdBody), async (req, res, next) => {
  try {
    const { type, threshold, center_id } = req.body;
    const centerId = req.user.role === "super_admin" ? center_id : req.user.center_id;

    if (!centerId) {
      return res.status(400).json({ success: false, message: "center_id is required" });
    }

    const data = await stockService.updateThreshold({
      centerId,
      type,
      threshold,
      updatedBy: req.user.id,
    });

    res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// ============================================================
// CERTIFICATE SCAN UPLOAD — Teacher only
// ============================================================

// POST /api/drive/certificates/:id/scan
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
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }

      const certId = parseInt(req.params.id);
      const teacherId = req.user.id;

      // Validasi cert milik teacher ini
      const certCheck = await query(
        `SELECT c.id, c.scan_file_id, c.enrollment_id
         FROM certificates c
         JOIN enrollments e ON e.id = c.enrollment_id
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

      // Hapus file lama jika ada (replace scan)
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

      const ext = req.file.originalname.split(".").pop() || "jpg";
      const fileName = `Scan_CERT_${certId}_${Date.now()}.${ext}`;

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

      logger.info("Certificate scan uploaded", { certId, fileId, teacherId });

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
// REPORT MANUAL UPLOAD — Teacher only
// ============================================================

// POST /api/drive/reports/:id/upload
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
        return res.status(400).json({ success: false, message: "No file uploaded" });
      }

      const reportId = parseInt(req.params.id);
      const teacherId = req.user.id;
      const driveFolderId = req.user.drive_folder_id;

      // Validasi report milik teacher ini
      const reportCheck = await query(
        `SELECT r.id, r.drive_file_id, s.name AS student_name
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

      logger.info("Report manually uploaded to Drive", { reportId, fileId, teacherId });

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

module.exports = router;
