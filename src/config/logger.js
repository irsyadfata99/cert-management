const winston = require("winston");
const path = require("path");

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Format untuk console (development)
const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    return stack ? `[${timestamp}] ${level}: ${message}${metaStr}\n${stack}` : `[${timestamp}] ${level}: ${message}${metaStr}`;
  }),
);

// Format untuk file (tanpa warna)
const fileFormat = combine(
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const base = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    return stack ? `${base}${metaStr}\n${stack}` : `${base}${metaStr}`;
  }),
);

// Pakai process.cwd() agar path log konsisten dari manapun server dijalankan
const logDir = path.join(process.cwd(), "logs");

// Custom levels agar "http" masuk ke hierarchy antara info dan debug.
// Winston default tidak include "http" — harus didefinisikan manual,
// jika tidak logger.http() akan silent dan morgan log tidak tersimpan.
const customLevels = {
  levels: {
    error: 0,
    warn: 1,
    info: 2,
    http: 3,
    debug: 4,
  },
  colors: {
    error: "red",
    warn: "yellow",
    info: "green",
    http: "magenta",
    debug: "cyan",
  },
};

winston.addColors(customLevels.colors);

const logger = winston.createLogger({
  levels: customLevels.levels,
  // Set ke "http" agar morgan request log masuk di semua environment.
  // "http" lebih rendah dari "info" sehingga info/warn/error tetap masuk.
  level: process.env.NODE_ENV === "production" ? "http" : "debug",
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // combined.log: info ke atas saja (tidak include http request spam)
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      format: fileFormat,
      level: "info",
      maxsize: 10 * 1024 * 1024,
      maxFiles: 7,
      tailable: true,
    }),
    // http.log: khusus request log dari morgan
    new winston.transports.File({
      filename: path.join(logDir, "http.log"),
      format: fileFormat,
      level: "http",
      maxsize: 10 * 1024 * 1024,
      maxFiles: 7,
      tailable: true,
    }),
    // error.log: khusus error
    new winston.transports.File({
      filename: path.join(logDir, "error.log"),
      format: fileFormat,
      level: "error",
      maxsize: 10 * 1024 * 1024,
      maxFiles: 7,
      tailable: true,
    }),
  ],
});

module.exports = logger;
