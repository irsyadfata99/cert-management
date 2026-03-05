const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const morgan = require("morgan");
const passport = require("passport");

const sessionConfig = require("./config/session");
const logger = require("./config/logger");

const app = express();

// ============================================================
// SECURITY MIDDLEWARE
// ============================================================

app.use(helmet());

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

// ============================================================
// GENERAL MIDDLEWARE
// ============================================================

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

app.use(
  morgan("combined", {
    stream: {
      write: (message) => logger.http(message.trim()),
    },
    skip: (req) => req.url === "/health",
  }),
);

// ============================================================
// SESSION & AUTH
// ============================================================

app.use(sessionConfig);
app.use(passport.initialize());
app.use(passport.session());

require("./config/passport");

// ============================================================
// CACHED USER MIDDLEWARE
//
// Tujuan: menghindari query DB di setiap request melalui deserializeUser.
//
// Skenario A — session.cachedUser sudah ada:
//   Gunakan langsung. Terjadi pada request ke-2 dst setelah login,
//   atau setelah OAuth callback (passport.js sudah set cachedUser).
//
// Skenario B — session.cachedUser kosong tapi req.user sudah di-set:
//   Terjadi saat server restart / session lama dari cookie masih valid.
//   deserializeUser sudah query DB dan populate req.user.
//   → Write-back ke session.cachedUser agar request berikutnya skip DB.
//
// [BUG FIX] Versi sebelumnya hanya handle skenario A (read cache).
// Skenario B tidak pernah di-write → cache tidak pernah efektif setelah
// server restart → setiap request terus query DB via deserializeUser.
//
// Invalidasi: set req.session.cachedUser = null (misal setelah role update).
// ============================================================

app.use((req, res, next) => {
  if (!req.isAuthenticated()) return next();

  if (req.session?.cachedUser) {
    // Skenario A: gunakan cache
    req.user = req.session.cachedUser;
  } else if (req.user) {
    // Skenario B: write-back hasil deserializeUser ke cache
    req.session.cachedUser = req.user;
  }

  next();
});

// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// ROUTES
// ============================================================

app.use("/auth", require("./routes/auth"));
app.use("/api/super-admin", require("./routes/superAdmin"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/teacher", require("./routes/teacher"));
app.use("/api/drive", require("./routes/drive"));

// ============================================================
// TEST-ONLY ROUTE — inject session tanpa Google OAuth
//
// [FIX] Route ini HARUS berada di sini, sebelum 404 handler.
//
// Bug sebelumnya: route didaftarkan di testApp.js SETELAH
// require("../../../src/app") — tapi saat require() dijalankan,
// seluruh app.js sudah dieksekusi termasuk 404 handler.
// Express mendaftarkan middleware secara berurutan, sehingga
// request ke /__test/login selalu ditangkap 404 handler duluan
// → loginAs() selalu dapat 404 → semua test dapat 401.
//
// Solusi: daftarkan route di sini, di dalam blok NODE_ENV === "test",
// sehingga tidak ada overhead di production/development.
// ============================================================

if (process.env.NODE_ENV === "test") {
  const { query } = require("./config/database");

  app.post("/__test/login", async (req, res) => {
    try {
      const { userId } = req.body;

      const result = await query(
        `SELECT id, email, name, avatar, role, center_id, drive_folder_id, is_active
         FROM users WHERE id = $1 AND is_active = TRUE`,
        [userId],
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: "User not found" });
      }

      const user = result.rows[0];

      req.session.passport = { user: user.id };
      req.session.cachedUser = user;

      await new Promise((resolve, reject) =>
        req.session.save((err) => (err ? reject(err) : resolve())),
      );

      res.status(200).json({ success: true, user });
    } catch (err) {
      res.status(500).json({ message: err.message });
    }
  });
}

// ============================================================
// 404 HANDLER
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// ============================================================
// GLOBAL ERROR HANDLER
// ============================================================

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;
  const isDev = process.env.NODE_ENV === "development";

  logger.error("Unhandled error", {
    method: req.method,
    url: req.originalUrl,
    status,
    error: err.message,
    stack: isDev ? err.stack : undefined,
  });

  res.status(status).json({
    success: false,
    message: isDev ? err.message : "Internal server error",
    ...(isDev && { stack: err.stack }),
  });
});

module.exports = app;
