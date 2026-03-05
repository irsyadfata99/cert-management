const { query } = require("../config/database");
const logger = require("../config/logger");

const SESSION_CACHE_REVALIDATE_INTERVAL_MS = 30 * 1000;

const authorize = (...roles) => {
  return async (req, res, next) => {
    // [FIX] Gunakan req.isAuthenticated() dari Passport, bukan req.session.userId
    // yang tidak pernah di-set. Passport menggunakan req.session.passport.user.
    if (!req.isAuthenticated || !req.isAuthenticated()) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    try {
      const now = Date.now();
      const cached = req.session.cachedUser;
      const lastChecked = req.session.cachedUserCheckedAt ?? 0;
      const needsRevalidate =
        now - lastChecked > SESSION_CACHE_REVALIDATE_INTERVAL_MS;

      let user;

      if (!cached) {
        // Tidak ada cache — ambil dari DB
        // req.user sudah di-populate Passport via deserializeUser
        const userId = req.user?.id ?? req.session?.passport?.user;

        if (!userId) {
          return res
            .status(401)
            .json({ success: false, message: "Unauthorized" });
        }

        user = await fetchUserFromDb(userId);

        if (!user) {
          req.session.destroy(() => {});
          return res
            .status(401)
            .json({ success: false, message: "User not found" });
        }

        req.session.cachedUser = user;
        req.session.cachedUserCheckedAt = now;
      } else if (needsRevalidate) {
        const freshCheck = await query(
          `SELECT id, updated_at, is_active FROM users WHERE id = $1`,
          [cached.id],
        );

        if (freshCheck.rows.length === 0) {
          req.session.destroy(() => {});
          return res
            .status(401)
            .json({ success: false, message: "User not found" });
        }

        const dbRow = freshCheck.rows[0];
        const cachedAt = new Date(cached.cached_at ?? 0).getTime();
        const updatedAt = new Date(dbRow.updated_at).getTime();

        if (!dbRow.is_active) {
          req.session.destroy(() => {});
          return res
            .status(401)
            .json({ success: false, message: "Account deactivated" });
        }

        if (updatedAt > cachedAt) {
          logger.info("Session cache stale, refreshing", { userId: cached.id });
          user = await fetchUserFromDb(cached.id);
          req.session.cachedUser = user;
        } else {
          user = cached;
        }

        req.session.cachedUserCheckedAt = now;
      } else {
        user = cached;
      }

      if (!user.is_active) {
        req.session.destroy(() => {});
        return res
          .status(401)
          .json({ success: false, message: "Account deactivated" });
      }

      if (roles.length > 0 && !roles.includes(user.role)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }

      req.user = user;
      next();
    } catch (err) {
      next(err);
    }
  };
};

const fetchUserFromDb = async (userId) => {
  const [userResult, centersResult] = await Promise.all([
    query(
      `SELECT id, email, name, avatar, role, center_id,
              drive_folder_id, is_active, updated_at
       FROM users
       WHERE id = $1`,
      [userId],
    ),
    query(
      `SELECT center_id, is_primary
       FROM teacher_centers
       WHERE teacher_id = $1
       ORDER BY is_primary DESC`,
      [userId],
    ),
  ]);

  if (userResult.rows.length === 0) return null;

  const user = userResult.rows[0];

  return {
    ...user,
    center_ids: centersResult.rows.map((r) => r.center_id),
    cached_at: new Date().toISOString(),
  };
};

const invalidateUserCache = async (userId) => {
  await query(`UPDATE users SET updated_at = NOW() WHERE id = $1`, [userId]);
  logger.info("User session cache invalidated", { userId });
};

const isAuthenticated = authorize();

module.exports = { authorize, isAuthenticated, invalidateUserCache };
