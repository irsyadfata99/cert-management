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
// Jika session sudah punya cachedUser, skip query DB.
// deserializeUser tetap berjalan normal untuk first-load,
// lalu hasilnya disimpan ke session.cachedUser.
// Untuk invalidasi (misal role berubah), set req.session.cachedUser = null.
// ============================================================

app.use((req, res, next) => {
  if (req.isAuthenticated() && req.session?.cachedUser) {
    req.user = req.session.cachedUser;
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
