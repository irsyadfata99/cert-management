const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const { query } = require("./database");
const driveService = require("../services/driveService");
const logger = require("./logger");

// ============================================================
// SERIALIZE / DESERIALIZE
// ============================================================

passport.serializeUser((user, done) => {
  done(null, user.id);
});

// Ambil full user dari DB — hanya dipanggil jika session.cachedUser kosong.
// Setelah berhasil, simpan ke session.cachedUser agar request berikutnya
// tidak perlu query DB (lihat middleware di app.js).
passport.deserializeUser(async (id, done) => {
  try {
    const result = await query(
      `SELECT id, email, name, avatar, role, center_id, drive_folder_id, is_active
       FROM users WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      return done(null, false);
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return done(null, false);
    }

    done(null, user);
  } catch (err) {
    logger.error("deserializeUser error", { error: err.message });
    done(err, null);
  }
});

// ============================================================
// GOOGLE STRATEGY
// ============================================================

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL,
      passReqToCallback: true,
    },
    async (req, accessToken, refreshToken, profile, done) => {
      try {
        const email = profile.emails?.[0]?.value;

        if (!email) {
          return done(null, false, {
            message: "No email found in Google profile",
          });
        }

        const existing = await query(
          `SELECT id, email, name, avatar, role, center_id, drive_folder_id, is_active, google_id
           FROM users WHERE email = $1`,
          [email],
        );

        if (existing.rows.length === 0) {
          logger.warn("Login attempt from unregistered email", { email });
          return done(null, false, {
            message: "Email not registered. Please contact your admin.",
          });
        }

        const user = existing.rows[0];

        // ============================================================
        // FIRST LOGIN: aktivasi akun & setup Drive folder (teacher)
        // ============================================================
        if (!user.is_active) {
          let driveFolderId = user.drive_folder_id;

          if (user.role === "teacher" && !driveFolderId) {
            try {
              const centerResult = await query(
                `SELECT drive_folder_id FROM centers WHERE id = $1 AND is_active = TRUE`,
                [user.center_id],
              );

              const centerFolderId = centerResult.rows[0]?.drive_folder_id;

              if (!centerFolderId) {
                logger.warn("Teacher center has no Drive folder yet", {
                  userId: user.id,
                  email,
                });
              } else {
                driveFolderId = await driveService.createFolder(
                  profile.displayName,
                  centerFolderId,
                );
                logger.info("Drive folder created for teacher", {
                  userId: user.id,
                  folderId: driveFolderId,
                });
              }
            } catch (driveErr) {
              logger.error("Failed to create Drive folder for teacher", {
                userId: user.id,
                error: driveErr.message,
              });
            }
          }

          await query(
            `UPDATE users
             SET google_id        = $1,
                 avatar           = $2,
                 drive_folder_id  = $3,
                 is_active        = TRUE,
                 updated_at       = NOW()
             WHERE id = $4`,
            [
              profile.id,
              profile.photos?.[0]?.value ?? null,
              driveFolderId,
              user.id,
            ],
          );

          logger.info("User account activated on first login", {
            userId: user.id,
            email,
            role: user.role,
          });

          const activatedUser = {
            ...user,
            google_id: profile.id,
            avatar: profile.photos?.[0]?.value ?? null,
            drive_folder_id: driveFolderId,
            is_active: true,
          };

          // Simpan ke session cache
          if (req.session) req.session.cachedUser = activatedUser;

          return done(null, activatedUser);
        }

        // ============================================================
        // SUBSEQUENT LOGIN: update avatar jika berubah
        // ============================================================
        const newAvatar = profile.photos?.[0]?.value ?? null;
        if (newAvatar !== user.avatar || !user.google_id) {
          await query(
            `UPDATE users
             SET google_id  = $1,
                 avatar     = $2,
                 updated_at = NOW()
             WHERE id = $3`,
            [profile.id, newAvatar, user.id],
          );
        }

        const finalUser = { ...user, avatar: newAvatar };

        // Simpan ke session cache
        if (req.session) req.session.cachedUser = finalUser;

        done(null, finalUser);
      } catch (err) {
        logger.error("Google OAuth strategy error", { error: err.message });
        done(err, null);
      }
    },
  ),
);

module.exports = passport;
