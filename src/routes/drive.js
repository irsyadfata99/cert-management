const express = require("express");
const multer = require("multer");
const { authorize } = require("../middleware/authorize");
const { uploadLimiter } = require("../middleware/rateLimiter");
const driveService = require("../services/driveService");
const { query } = require("../config/database");
const logger = require("../config/logger");

const router = express.Router();

router.use(authorize("teacher"));
router.use(uploadLimiter);

// ============================================================
// MULTER — memory storage (file tidak disimpan ke disk)
// ============================================================

const ALLOWED_SCAN_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const ALLOWED_REPORT_TYPES = ["application/pdf"];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    // Validasi MIME type ditangani per route di bawah
    cb(null, true);
  },
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
// UPLOAD SCAN CERTIFICATE
// POST /api/drive/certificates/:certId/scan
// ============================================================

router.post("/certificates/:certId/scan", upload.single("file"), async (req, res, next) => {
  try {
    const teacherId = req.user.id;
    const centerId = req.user.center_id;
    const { certId } = req.params;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "File is required" });
    }

    if (!validateMimeType(req.file, ALLOWED_SCAN_TYPES, res)) return;

    // Validasi certificate milik teacher ini
    const certResult = await query(
      `SELECT c.id, c.cert_unique_id, c.scan_file_id, u.drive_folder_id
         FROM certificates c
         JOIN enrollments e ON e.id = c.enrollment_id
         JOIN users u       ON u.id = c.teacher_id
         WHERE c.id = $1 AND c.teacher_id = $2 AND c.center_id = $3`,
      [certId, teacherId, centerId],
    );

    if (certResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Certificate not found or not assigned to you" });
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

    // Nama file: Certificate_CERT-000001_YYYY-MM-DD
    const today = new Date().toISOString().split("T")[0];
    const fileName = `Certificate_${cert.cert_unique_id}_${today}`;

    const { fileId, fileName: uploadedName } = await driveService.uploadFile({
      buffer: req.file.buffer,
      fileName,
      mimeType: req.file.mimetype,
      folderId: cert.drive_folder_id,
    });

    // Simpan scan_file_id ke DB
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
      data: { cert_id: certId, scan_file_id: fileId, scan_file_name: uploadedName },
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// UPLOAD FINAL REPORT PDF
// POST /api/drive/reports/:reportId/upload
// ============================================================

router.post("/reports/:reportId/upload", upload.single("file"), async (req, res, next) => {
  try {
    const teacherId = req.user.id;
    const { reportId } = req.params;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "File is required" });
    }

    if (!validateMimeType(req.file, ALLOWED_REPORT_TYPES, res)) return;

    // Validasi report milik teacher ini
    const reportResult = await query(
      `SELECT r.id, r.enrollment_id, r.drive_file_id,
                e.center_id, u.drive_folder_id,
                s.name AS student_name
         FROM reports r
         JOIN enrollments e ON e.id = r.enrollment_id
         JOIN users u       ON u.id = r.teacher_id
         JOIN students s    ON s.id = e.student_id
         WHERE r.id = $1 AND r.teacher_id = $2`,
      [reportId, teacherId],
    );

    if (reportResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Report not found or not assigned to you" });
    }

    const report = reportResult.rows[0];

    if (!report.drive_folder_id) {
      return res.status(400).json({
        success: false,
        message: "Your Drive folder is not set up yet. Please contact admin.",
      });
    }

    // Hapus file lama jika ada (replace report)
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

    // Nama file: FinalReport_NamaSiswa_YYYY-MM-DD
    const today = new Date().toISOString().split("T")[0];
    const safeName = report.student_name.replace(/[^a-zA-Z0-9]/g, "_");
    const fileName = `FinalReport_${safeName}_${today}`;

    const { fileId, fileName: uploadedName } = await driveService.uploadFile({
      buffer: req.file.buffer,
      fileName,
      mimeType: "application/pdf",
      folderId: report.drive_folder_id,
    });

    // Simpan drive_file_id ke DB
    await query(
      `UPDATE reports
         SET drive_file_id = $1, drive_file_name = $2, drive_uploaded_at = NOW(), updated_at = NOW()
         WHERE id = $3`,
      [fileId, uploadedName, reportId],
    );

    logger.info("Final report uploaded", {
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
});

// ============================================================
// STOCK MANAGEMENT (admin & super_admin)
// POST /api/drive/stock/add
// POST /api/drive/stock/transfer
// ============================================================

// Re-mount dengan role yang berbeda untuk stock endpoints
const stockRouter = express.Router();
stockRouter.use(authorize("admin", "super_admin"));
stockRouter.use(uploadLimiter);

const stockService = require("../services/stockService");

// GET /api/drive/stock
stockRouter.get("/", authorize("admin", "super_admin"), async (req, res, next) => {
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
stockRouter.post("/add", async (req, res, next) => {
  try {
    const { center_id, type, quantity } = req.body;

    const centerId = req.user.role === "super_admin" ? center_id : req.user.center_id;

    if (!centerId || !type || !quantity) {
      return res.status(400).json({ success: false, message: "center_id, type, and quantity are required" });
    }

    const data = await stockService.addStock({
      centerId,
      type,
      quantity: parseInt(quantity),
      addedBy: req.user.id,
    });

    res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// POST /api/drive/stock/transfer
stockRouter.post("/transfer", authorize("super_admin"), async (req, res, next) => {
  try {
    const { type, from_center_id, to_center_id, quantity } = req.body;

    if (!type || !from_center_id || !to_center_id || !quantity) {
      return res.status(400).json({
        success: false,
        message: "type, from_center_id, to_center_id, and quantity are required",
      });
    }

    const data = await stockService.transferStock({
      type,
      fromCenterId: parseInt(from_center_id),
      toCenterId: parseInt(to_center_id),
      quantity: parseInt(quantity),
      transferredBy: req.user.id,
    });

    res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

// PATCH /api/drive/stock/threshold
stockRouter.patch("/threshold", async (req, res, next) => {
  try {
    const { center_id, type, threshold } = req.body;

    const centerId = req.user.role === "super_admin" ? center_id : req.user.center_id;

    if (!centerId || !type || threshold === undefined) {
      return res.status(400).json({ success: false, message: "center_id, type, and threshold are required" });
    }

    const data = await stockService.updateThreshold({
      centerId,
      type,
      threshold: parseInt(threshold),
      updatedBy: req.user.id,
    });

    res.status(200).json({ success: true, data });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ success: false, message: err.message });
    next(err);
  }
});

router.use("/stock", stockRouter);

module.exports = router;
