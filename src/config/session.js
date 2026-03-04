const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { pool } = require("./database");
const logger = require("./logger");

// Validasi SESSION_SECRET wajib ada dan tidak default
if (!process.env.SESSION_SECRET) {
  logger.error("SESSION_SECRET is not set. Server will not start.");
  process.exit(1);
}

if (process.env.SESSION_SECRET === "your_session_secret_here") {
  logger.warn("SESSION_SECRET is using the default placeholder value. Please change it.");
}

const sessionConfig = session({
  store: new pgSession({
    pool,
    tableName: "session",
    createTableIfMissing: false,
    // Bersihkan expired session setiap 1 jam
    pruneSessionInterval: 60 * 60,
  }),

  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 hari
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  },

  // Diperlukan jika di belakang reverse proxy (nginx) di production
  proxy: process.env.NODE_ENV === "production",

  name: "sid",
});

module.exports = sessionConfig;
