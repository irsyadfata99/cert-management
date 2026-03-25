const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const { query, withTransaction } = require("./database");
const logger = require("./logger");

passport.serializeUser((user, done) => {
  done(null, user.id);
});

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

        if (!user.is_active) {
          // ── First login: activate account ─────────────────────────────

          if (user.role === "teacher") {
            const missingFolders = await query(
              `SELECT tc.center_id, c.name AS center_name
               FROM teacher_centers tc
               JOIN centers c ON c.id = tc.center_id
               WHERE tc.teacher_id = $1
                 AND tc.drive_folder_id IS NULL
                 AND c.is_active = TRUE`,
              [user.id],
            );

            if (missingFolders.rows.length > 0) {
              const centerNames = missingFolders.rows
                .map((r) => r.center_name)
                .join(", ");
              logger.warn(
                "Teacher has centers without Drive folder. Admin must re-assign centers to create folders.",
                {
                  userId: user.id,
                  email,
                  centersWithoutFolder: centerNames,
                },
              );
            }
          }

          // Ambil drive_folder_id dari primary center (untuk backward compat)
          let driveFolderId = user.drive_folder_id;

          if (user.role === "teacher" && !driveFolderId) {
            const primaryCenter = await query(
              `SELECT tc.drive_folder_id
               FROM teacher_centers tc
               WHERE tc.teacher_id = $1
                 AND tc.is_primary = TRUE`,
              [user.id],
            );

            if (
              primaryCenter.rows.length > 0 &&
              primaryCenter.rows[0].drive_folder_id
            ) {
              driveFolderId = primaryCenter.rows[0].drive_folder_id;
            }
          }

          let activatedUser;
          try {
            activatedUser = await withTransaction(async (client) => {
              const result = await client.query(
                `UPDATE users
                 SET google_id        = $1,
                     avatar           = $2,
                     drive_folder_id  = $3,
                     is_active        = TRUE,
                     updated_at       = NOW()
                 WHERE id = $4
                 RETURNING id, email, name, avatar, role, center_id, drive_folder_id, is_active`,
                [
                  profile.id,
                  profile.photos?.[0]?.value ?? null,
                  driveFolderId,
                  user.id,
                ],
              );
              return result.rows[0];
            });
          } catch (txErr) {
            logger.error(
              "DB transaction failed during first login activation",
              {
                userId: user.id,
                error: txErr.message,
              },
            );
            throw txErr;
          }

          logger.info("User account activated on first login", {
            userId: user.id,
            email,
            role: user.role,
          });

          if (req.session) req.session.cachedUser = activatedUser;
          return done(null, activatedUser);
        }

        // ── Returning active user: refresh avatar / google_id if changed ──
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
