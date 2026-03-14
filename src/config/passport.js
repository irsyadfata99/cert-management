const passport = require("passport");
const { Strategy: GoogleStrategy } = require("passport-google-oauth20");
const { query, withTransaction } = require("./database");
const driveService = require("../services/driveService");
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
          // ── First login: activate account ──────────────────────────────
          //
          // Drive folder creation is attempted BEFORE the DB transaction so
          // that we never end up with an activated account that has a
          // partially-written Drive folder ID.  If Drive fails we still
          // activate the account — the admin can set up the folder later via
          // the "Setup Drive" action in the dashboard.
          //
          // Sequence:
          //   1. Try to create Drive folder (outside transaction — side effect)
          //   2. Open transaction → activate user + store folder ID atomically
          //   3. If transaction fails, log that a dangling Drive folder may
          //      exist so an admin can clean it up.

          let driveFolderId = user.drive_folder_id;
          let driveCreatedFolderId = null;

          if (user.role === "teacher" && !driveFolderId) {
            try {
              const centersResult = await query(
                `SELECT tc.center_id, tc.is_primary, c.drive_folder_id AS center_drive_folder_id
                 FROM teacher_centers tc
                 JOIN centers c ON c.id = tc.center_id
                 WHERE tc.teacher_id = $1
                   AND c.is_active = TRUE
                 ORDER BY tc.is_primary DESC`,
                [user.id],
              );

              const primaryCenter = centersResult.rows[0];
              const centerFolderId = primaryCenter?.center_drive_folder_id;

              if (!centerFolderId) {
                logger.warn("Teacher center has no Drive folder yet", {
                  userId: user.id,
                  email,
                });
              } else {
                driveCreatedFolderId = await driveService.createFolder(
                  profile.displayName,
                  centerFolderId,
                );
                driveFolderId = driveCreatedFolderId;
                logger.info("Drive folder created for teacher", {
                  userId: user.id,
                  folderId: driveFolderId,
                  basedOnCenter: primaryCenter.center_id,
                });
              }
            } catch (driveErr) {
              // Drive failure is non-fatal — account will still be activated.
              // Admin can create the folder manually later.
              logger.error("Failed to create Drive folder for teacher", {
                userId: user.id,
                error: driveErr.message,
              });
            }
          }

          // Activate account inside a transaction.  If this fails after
          // driveCreatedFolderId was set, log a warning so the orphaned
          // Drive folder can be identified and cleaned up.
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
            if (driveCreatedFolderId) {
              logger.error(
                "DB transaction failed after Drive folder was created. " +
                  "Orphaned Drive folder may need manual cleanup.",
                {
                  userId: user.id,
                  orphanedFolderId: driveCreatedFolderId,
                  error: txErr.message,
                },
              );
            }
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
