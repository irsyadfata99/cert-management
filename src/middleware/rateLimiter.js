const rateLimit = require("express-rate-limit");
const logger = require("../config/logger");

const onLimitReached = (req, res, options) => {
  logger.warn("Rate limit exceeded", {
    ip: req.ip,
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id ?? null,
  });

  res.status(429).json({
    success: false,
    message: options.message,
  });
};

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many login attempts. Please try again after 15 minutes.",
  handler: onLimitReached,
});

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests. Please slow down.",
  handler: onLimitReached,
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many upload requests. Please slow down.",
  handler: onLimitReached,
});

const printLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many print requests. Please slow down.",
  handler: onLimitReached,
});

module.exports = { authLimiter, apiLimiter, uploadLimiter, printLimiter };
