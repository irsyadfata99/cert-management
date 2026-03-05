const winston = require("winston");
const path = require("path");
const fs = require("fs");

const { combine, timestamp, printf, colorize, errors } = winston.format;

const consoleFormat = combine(
  colorize({ all: true }),
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    return stack
      ? `[${timestamp}] ${level}: ${message}${metaStr}\n${stack}`
      : `[${timestamp}] ${level}: ${message}${metaStr}`;
  }),
);

const fileFormat = combine(
  timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  errors({ stack: true }),
  printf(({ level, message, timestamp, stack, ...meta }) => {
    const base = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    const metaStr = Object.keys(meta).length ? " " + JSON.stringify(meta) : "";
    return stack ? `${base}${metaStr}\n${stack}` : `${base}${metaStr}`;
  }),
);

const logDir = path.join(process.cwd(), "logs");

if (process.env.NODE_ENV !== "test") {
  fs.mkdirSync(logDir, { recursive: true });
}

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

const exactLevel = (targetLevel) =>
  winston.format((info) => (info.level === targetLevel ? info : false))();

const transports = [
  new winston.transports.Console({
    format: consoleFormat,
  }),
];

if (process.env.NODE_ENV !== "test") {
  transports.push(
    new winston.transports.File({
      filename: path.join(logDir, "combined.log"),
      format: fileFormat,
      level: "info",
      maxsize: 10 * 1024 * 1024,
      maxFiles: 7,
      tailable: true,
    }),
    new winston.transports.File({
      filename: path.join(logDir, "http.log"),
      format: combine(exactLevel("http"), fileFormat),
      level: "http",
      maxsize: 10 * 1024 * 1024,
      maxFiles: 7,
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
  );
}

const logger = winston.createLogger({
  levels: customLevels.levels,
  level: process.env.NODE_ENV === "production" ? "http" : "debug",
  transports,
});

module.exports = logger;
