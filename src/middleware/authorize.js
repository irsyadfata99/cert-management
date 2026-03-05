const logger = require("../config/logger");

// ============================================================
// AUTHENTICATION CHECK
// ============================================================

const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) return next();

  logger.warn("Unauthenticated access attempt", {
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
  });

  res.status(401).json({
    success: false,
    message: "Authentication required",
  });
};

// ============================================================
// ROLE-BASED ACCESS
// ============================================================

/**
 * Izinkan akses hanya untuk role tertentu.
 * @param {...string} roles - Role yang diizinkan, contoh: authorize("super_admin", "admin")
 */
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.isAuthenticated()) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    if (!roles.includes(req.user.role)) {
      logger.warn("Unauthorized access attempt", {
        userId: req.user.id,
        role: req.user.role,
        requiredRoles: roles,
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
      });

      return res.status(403).json({
        success: false,
        message: "You do not have permission to access this resource",
      });
    }

    next();
  };
};

// ============================================================
// CENTER SCOPE GUARD
//
// Pastikan admin/teacher hanya bisa akses data center mereka sendiri.
// Super admin dibebaskan.
//
// KAPAN DIPAKAI:
// Gunakan middleware ini pada route yang menerima center_id secara
// eksplisit di params atau body, dan resource-nya harus dibatasi
// per center. Contoh:
//
//   router.get("/centers/:centerId/students",
//     isAuthenticated,
//     requireSameCenter,   // ← pastikan user punya akses ke centerId ini
//     async (req, res) => { ... }
//   );
//
// TIDAK perlu dipakai jika center scoping sudah dilakukan implisit
// via req.user.center_id di dalam handler (pola resolveCenterId).
// Kedua pola boleh dipakai, tapi jangan campur keduanya di route
// yang sama untuk menghindari kebingungan.
//
// [FIX] Versi sebelumnya langsung next() jika targetCenterId tidak
// ditemukan di params maupun body. Ini berbahaya karena route yang
// lupa menyertakan center_id akan lolos tanpa validasi apapun.
//
// Fix: jika centerId tidak ditemukan dan user bukan super_admin,
// tolak request dengan 400 agar developer sadar ada yang salah,
// daripada diam-diam membiarkan akses tanpa validasi.
// ============================================================

const requireSameCenter = (req, res, next) => {
  if (!req.isAuthenticated()) {
    return res.status(401).json({
      success: false,
      message: "Authentication required",
    });
  }

  // Super admin bisa akses semua center
  if (req.user.role === "super_admin") return next();

  const targetCenterId = parseInt(req.params.centerId || req.body.center_id);

  // [FIX] Sebelumnya: langsung next() jika targetCenterId NaN/0
  // Sekarang: tolak dengan 400 agar tidak ada silent pass-through
  if (!targetCenterId) {
    logger.warn("requireSameCenter: center_id missing from request", {
      userId: req.user.id,
      method: req.method,
      url: req.originalUrl,
    });

    return res.status(400).json({
      success: false,
      message: "center_id is required",
    });
  }

  if (req.user.center_id !== targetCenterId) {
    logger.warn("Cross-center access attempt", {
      userId: req.user.id,
      userCenterId: req.user.center_id,
      targetCenterId,
      method: req.method,
      url: req.originalUrl,
    });

    return res.status(403).json({
      success: false,
      message: "Access denied: resource belongs to a different center",
    });
  }

  next();
};

module.exports = { isAuthenticated, authorize, requireSameCenter };
