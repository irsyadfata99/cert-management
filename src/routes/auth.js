const express = require("express");
const passport = require("passport");
const { authLimiter } = require("../middleware/rateLimiter");
const { isAuthenticated } = require("../middleware/authorize");
const logger = require("../config/logger");

const router = express.Router();

// ============================================================
// GOOGLE OAUTH
// ============================================================

// Redirect ke Google consent screen
router.get(
  "/google",
  authLimiter,
  passport.authenticate("google", {
    scope: ["profile", "email"],
    prompt: "select_account",
  }),
);

// Callback dari Google setelah user login
router.get(
  "/google/callback",
  authLimiter,
  passport.authenticate("google", {
    failureRedirect: `${process.env.CLIENT_URL}/login?error=unauthorized`,
    session: true,
  }),
  (req, res) => {
    logger.info("User logged in", {
      userId: req.user.id,
      email: req.user.email,
      role: req.user.role,
    });

    res.redirect(`${process.env.CLIENT_URL}/dashboard`);
  },
);

// ============================================================
// SESSION
// ============================================================

// Cek status session — dipakai frontend untuk restore auth state
router.get("/me", isAuthenticated, (req, res) => {
  const { id, email, name, avatar, role, center_id, drive_folder_id } = req.user;

  res.status(200).json({
    success: true,
    data: { id, email, name, avatar, role, center_id, drive_folder_id },
  });
});

// Logout
router.post("/logout", isAuthenticated, (req, res, next) => {
  const { id, email, role } = req.user;

  req.logout((err) => {
    if (err) {
      logger.error("Logout error", { userId: id, error: err.message });
      return next(err);
    }

    req.session.destroy((err) => {
      if (err) {
        logger.error("Session destroy error", { userId: id, error: err.message });
        return next(err);
      }

      res.clearCookie("sid");

      logger.info("User logged out", { userId: id, email, role });

      res.status(200).json({
        success: true,
        message: "Logged out successfully",
      });
    });
  });
});

module.exports = router;
