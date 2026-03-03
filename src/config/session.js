const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { pool } = require("./database");

const sessionConfig = session({
  store: new pgSession({
    pool,
    tableName: "session", // tabel yang sudah dibuat di schema.sql
    createTableIfMissing: false,
  }),

  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,

  cookie: {
    httpOnly: true, // tidak bisa diakses via JavaScript di browser
    secure: process.env.NODE_ENV === "production", // HTTPS only di production
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 hari
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  },

  name: "sid", // nama cookie (default 'connect.sid' terlalu obvious)
});

module.exports = sessionConfig;
