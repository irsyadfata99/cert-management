const winston = require("winston");
const path = require("path");

const { combine, timestamp, printf, colorize, errors } = winston.format;

// Format untuk console (development — dengan warna)
const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack }) => {
    return stack
      ? `[${timestamp}] ${level}: ${message}\n${stack}`
      : `[${timestamp}] ${level}: ${message}`;
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

const logger = winston.createLogger({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  transports: [
    // Console — semua environment
    new winston.transports.Console({
      format: consoleFormat,
    }),
    // File: semua log level info ke atas
    new winston.transports.File({
      filename: path.join(__dirname, "../../logs/combined.log"),
      format: fileFormat,
      level: "info",
    }),
    // File: khusus error saja
    new winston.transports.File({
      filename: path.join(__dirname, "../../logs/error.log"),
      format: fileFormat,
      level: "error",
    }),
  ],
});

module.exports = logger;
