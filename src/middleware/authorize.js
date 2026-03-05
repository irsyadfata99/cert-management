const { query } = require("../config/database");
const logger = require("../config/logger");

// ============================================================
// SESSION CACHE TTL
// [FIX 2] cachedUser disimpan di session agar tidak query DB
// setiap request. Tapi jika admin mengubah role/center/status
// user, cache lama akan basi (stale).
//
// Solusi: simpan timestamp cache, lalu bandingkan dengan
// users.updated_at dari DB. Jika updated_at lebih baru dari
// cache, refresh otomatis.
//
// Tradeoff: tetap ada 1 query ringan (SELECT id, updated_at)
// per request, tapi jauh lebih murah dari SELECT * setiap saat.
// ============================================================
const SESSION_CACHE_REVALIDATE_INTERVAL_MS = 30 * 1000; // 30 detik

// ============================================================
// MIDDLEWARE: authorize
// ============================================================

/**
 * Middleware factory untuk autentikasi + otorisasi berbasis role.
 *
 * @param {...string} roles - Role yang diizinkan mengakses route ini.
 *                            Jika kosong, semua role yang sudah login diizinkan.
 *
 * Alur:
 * 1. Cek session ada dan user sudah login
 * 2. Cek cachedUser di session:
 *    a. Jika tidak ada → ambil dari DB, simpan ke cache
 *    b. Jika ada tapi sudah melewati interval revalidasi →
 *       cek updated_at di DB. Jika berubah → refresh cache.
 *    c. Jika ada dan masih fresh → pakai langsung
 * 3. Cek user masih aktif
 * 4. Cek role sesuai
 */
const authorize = (...roles) => {
  return async (req, res, next) => {
    // 1. Cek session
    if (!req.session?.userId) {
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
        // 2a. Cache kosong — ambil dari DB
        user = await fetchUserFromDb(req.session.userId);

        if (!user) {
          req.session.destroy(() => {});
          return res
            .status(401)
            .json({ success: false, message: "User not found" });
        }

        req.session.cachedUser = user;
        req.session.cachedUserCheckedAt = now;
      } else if (needsRevalidate) {
        // 2b. Cache ada tapi sudah waktunya revalidasi
        // Cek apakah user berubah sejak cache dibuat
        const freshCheck = await query(
          `SELECT id, updated_at, is_active FROM users WHERE id = $1`,
          [cached.id],
        );

        if (freshCheck.rows.length === 0) {
          // User dihapus
          req.session.destroy(() => {});
          return res
            .status(401)
            .json({ success: false, message: "User not found" });
        }

        const dbRow = freshCheck.rows[0];
        const cachedAt = new Date(cached.cached_at ?? 0).getTime();
        const updatedAt = new Date(dbRow.updated_at).getTime();

        if (updatedAt > cachedAt || !dbRow.is_active) {
          // Data berubah atau user di-deactivate — refresh cache penuh
          logger.info("Session cache stale, refreshing", { userId: cached.id });

          if (!dbRow.is_active) {
            req.session.destroy(() => {});
            return res
              .status(401)
              .json({ success: false, message: "Account deactivated" });
          }

          user = await fetchUserFromDb(cached.id);
          req.session.cachedUser = user;
        } else {
          // Tidak ada perubahan — pakai cache, update timestamp saja
          user = cached;
        }

        req.session.cachedUserCheckedAt = now;
      } else {
        // 2c. Cache masih fresh — pakai langsung tanpa DB query
        user = cached;
      }

      // 3. Cek aktif (double-check dari cache)
      if (!user.is_active) {
        req.session.destroy(() => {});
        return res
          .status(401)
          .json({ success: false, message: "Account deactivated" });
      }

      // 4. Cek role
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

// ============================================================
// HELPER: Ambil user lengkap dari DB + semua center-nya
// [MULTI-CENTER] Sertakan center_ids array di cachedUser
// ============================================================
const fetchUserFromDb = async (userId) => {
  const [userResult, centersResult] = await Promise.all([
    query(
      `SELECT id, email, name, avatar, role, center_id,
              drive_folder_id, is_active, updated_at
       FROM users
       WHERE id = $1`,
      [userId],
    ),
    // Ambil semua center yang di-assign (untuk teacher)
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
    // [MULTI-CENTER] Array semua center_id yang di-assign ke teacher ini.
    // Untuk admin/super_admin, array ini kosong — mereka pakai center_id saja.
    center_ids: centersResult.rows.map((r) => r.center_id),
    // Timestamp kapan cache ini dibuat — dipakai untuk stale check
    cached_at: new Date().toISOString(),
  };
};

// ============================================================
// HELPER: Invalidate session cache secara eksplisit
//
// [FIX 2] Panggil ini setelah admin mengubah data user
// (role, center, is_active, email) agar cache di semua session
// aktif user tersebut akan di-refresh pada request berikutnya.
//
// Cara kerja: set cachedUser.updated_at ke masa depan di session
// store. Karena kita tidak bisa langsung akses session user lain
// dari middleware, cara terbaik adalah update users.updated_at
// di DB — revalidasi interval akan mendeteksi perubahan ini.
//
// Catatan: ini sudah di-handle otomatis oleh trigger
// trg_users_updated_at di PostgreSQL setiap kali ada UPDATE
// pada tabel users. Fungsi ini tersedia jika perlu invalidasi
// manual di luar UPDATE users.
// ============================================================
const invalidateUserCache = async (userId) => {
  await query(`UPDATE users SET updated_at = NOW() WHERE id = $1`, [userId]);
  logger.info("User session cache invalidated", { userId });
};

module.exports = { authorize, invalidateUserCache };
