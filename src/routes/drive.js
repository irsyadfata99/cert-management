const express = require("express");
const multer = require("multer");
const { authorize } = require("../middleware/authorize");
const { uploadLimiter, apiLimiter } = require("../middleware/rateLimiter");
const {
  validate,
  addStockBody,
  transferStockBody,
  updateThresholdBody,
  idParam,
} = require("../validators");
const driveService = require("../services/driveService");
const stockService = require("../services/stockService");
const { query } = require("../config/database");
const logger = require("../config/logger");

// ============================================================
// MULTER — memory storage (file tidak disimpan ke disk)
// ============================================================

const ALLOWED_SCAN_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const ALLOWED_REPORT_TYPES = ["application/pdf"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (_req, _file, cb) => cb(null, true),
});

// ============================================================
// HELPER
// ============================================================

const validateMimeType = (file, allowedTypes, res) => {
  if (!allowedTypes.includes(file.mimetype)) {
    res.status(400).json({
      success: false,
      message: `Invalid file type. Allowed: ${allowedTypes.join(", ")}`,
    });
    return false;
  }
  return true;
};

// ============================================================
// STOCK ROUTER — admin & super_admin
// Di-mount LEBIH DULU agar tidak terblokir oleh teacherRouter
// ============================================================

const stockRouter = express.Router();
stockRouter.use(authorize("admin", "super_admin"));
stockRouter.use(apiLimiter);

// GET /api/drive/stock
stockRouter.get("/", async (req, res, next) => {
  try {
    if (req.user.role === "super_admin") {
      const data = await stockService.getAllStock();
      return res.status(200).json({ success: true, data });
    }

    const data = await stockService.getStockByCenter(req.user.center_id);
    res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.status)
      return res
        .status(err.status)
        .json({ success: false, message: err.message });
    next(err);
  }
});

// POST /api/drive/stock/add
stockRouter.post("/add", validate(addStockBody), async (req, res, next) => {
  try {
    const { center_id, type, quantity } = req.body;
    const centerId =
      req.user.role === "super_admin" ? center_id : req.user.center_id;

    if (!centerId) {
      return res
        .status(400)
        .json({ success: false, message: "center_id is required" });
    }

    const data = await stockService.addStock({
      centerId,
      type,
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
});

// POST /api/drive/stock/transfer — super_admin only
stockRouter.post(
  "/transfer",
  authorize("super_admin"),
  validate(transferStockBody),
  async (req, res, next) => {
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
      if (err.status)
        return res
          .status(err.status)
          .json({ success: false, message: err.message });
      next(err);
    }
  },
);

// PATCH /api/drive/stock/threshold
stockRouter.patch(
  "/threshold",
  validate(updateThresholdBody),
  async (req, res, next) => {
    try {
      const { center_id, type, threshold } = req.body;
      const centerId =
        req.user.role === "super_admin" ? center_id : req.user.center_id;

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
// TEACHER ROUTER — upload scan & report (manual override/retry)
// Di-mount SETELAH stockRouter agar /stock tidak terblokir
// ============================================================

const teacherRouter = express.Router();
teacherRouter.use(authorize("teacher"));
teacherRouter.use(uploadLimiter);

// POST /api/drive/certificates/:certId/scan
teacherRouter.post(
  "/certificates/:certId/scan",
  validate(idParam.shape ? idParam : idParam, "params"),
  upload.single("file"),
  async (req, res, next) => {
    try {
      const teacherId = req.user.id;
      const centerId = req.user.center_id;
      const { certId } = req.params;

      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "File is required" });
      }

      if (!validateMimeType(req.file, ALLOWED_SCAN_TYPES, res)) return;

      // Validasi certificate milik teacher ini
      const certResult = await query(
        `SELECT c.id, c.cert_unique_id, c.scan_file_id, u.drive_folder_id
         FROM certificates c
         JOIN users u ON u.id = c.teacher_id
         WHERE c.id = $1 AND c.teacher_id = $2 AND c.center_id = $3`,
        [certId, teacherId, centerId],
      );

      if (certResult.rows.length === 0) {
        return res
          .status(404)
          .json({
            success: false,
            message: "Certificate not found or not assigned to you",
          });
      }

      const cert = certResult.rows[0];

      if (!cert.drive_folder_id) {
        return res.status(400).json({
          success: false,
          message: "Your Drive folder is not set up yet. Please contact admin.",
        });
      }

      // Hapus file lama jika ada (replace scan)
      if (cert.scan_file_id) {
        try {
          await driveService.deleteFile(cert.scan_file_id);
        } catch (deleteErr) {
          logger.warn("Failed to delete old scan file", {
            fileId: cert.scan_file_id,
            error: deleteErr.message,
          });
        }
      }

      const today = new Date().toISOString().split("T")[0];
      const fileName = `Certificate_${cert.cert_unique_id}_${today}`;

      const { fileId, fileName: uploadedName } = await driveService.uploadFile({
        buffer: req.file.buffer,
        fileName,
        mimeType: req.file.mimetype,
        folderId: cert.drive_folder_id,
      });

      await query(
        `UPDATE certificates
         SET scan_file_id = $1, scan_file_name = $2, scan_uploaded_at = NOW()
         WHERE id = $3`,
        [fileId, uploadedName, certId],
      );

      logger.info("Certificate scan uploaded", {
        certId,
        certUniqueId: cert.cert_unique_id,
        fileId,
        teacherId,
      });

      res.status(200).json({
        success: true,
        data: {
          cert_id: certId,
          scan_file_id: fileId,
          scan_file_name: uploadedName,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/drive/reports/:reportId/upload
// Manual upload/override — digunakan jika auto-upload sebelumnya gagal.
// Jika report sudah punya drive_file_id, file lama akan diganti.
teacherRouter.post(
  "/reports/:reportId/upload",
  upload.single("file"),
  async (req, res, next) => {
    try {
      const teacherId = req.user.id;
      const driveFolderId = req.user.drive_folder_id;
      const { reportId } = req.params;

      if (!req.file) {
        return res
          .status(400)
          .json({ success: false, message: "File is required" });
      }

      if (!validateMimeType(req.file, ALLOWED_REPORT_TYPES, res)) return;

      // Validasi report milik teacher ini
      const reportResult = await query(
        `SELECT r.id, r.drive_file_id, s.name AS student_name
         FROM reports r
         JOIN enrollments e ON e.id = r.enrollment_id
         JOIN students s    ON s.id = e.student_id
         WHERE r.id = $1 AND r.teacher_id = $2`,
        [reportId, teacherId],
      );

      if (reportResult.rows.length === 0) {
        return res
          .status(404)
          .json({
            success: false,
            message: "Report not found or not assigned to you",
          });
      }

      const report = reportResult.rows[0];

      if (!driveFolderId) {
        return res.status(400).json({
          success: false,
          message: "Your Drive folder is not set up yet. Please contact admin.",
        });
      }

      // Hapus file lama jika ada
      if (report.drive_file_id) {
        try {
          await driveService.deleteFile(report.drive_file_id);
        } catch (deleteErr) {
          logger.warn("Failed to delete old report file", {
            fileId: report.drive_file_id,
            error: deleteErr.message,
          });
        }
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

      logger.info("Report manually uploaded to Drive", {
        reportId,
        studentName: report.student_name,
        fileId,
        teacherId,
      });

      res.status(200).json({
        success: true,
        data: {
          report_id: reportId,
          drive_file_id: fileId,
          drive_file_name: uploadedName,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ============================================================
// MAIN ROUTER
// PENTING: stockRouter di-mount SEBELUM teacherRouter.
// ============================================================

const router = express.Router();
router.use("/stock", stockRouter); // spesifik dulu
router.use("/", teacherRouter); // umum belakangan

module.exports = router;
