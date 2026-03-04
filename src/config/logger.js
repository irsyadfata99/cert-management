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

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  transports: [
    new winston.transports.Console({
      format: consoleFormat,
    }),
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      format: fileFormat,
      level: "info",
      maxsize: 10 * 1024 * 1024, // 10MB per file
      maxFiles: 7, // simpan 7 file terakhir
      tailable: true,
    }),
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
