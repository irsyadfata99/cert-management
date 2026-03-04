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
// Pastikan admin/teacher hanya bisa akses data center mereka sendiri.
// Super admin dibebaskan.
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

  if (!targetCenterId) return next();

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
