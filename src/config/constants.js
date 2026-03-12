const BATCH_MAX_SIZE = 100;

const REPORT_MIN_WORD_COUNT = 120;

const SCORE_VALUES = ["A+", "A", "B+", "B"];

const USER_ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  TEACHER: "teacher",
};

const ENROLLMENT_STATUSES = {
  NOT_STARTED: "not_started",
  PRINTED: "printed",
  SCAN_UPLOADED: "scan_uploaded",
  REPORT_DRAFTED: "report_drafted",
  COMPLETE: "complete",
};

const STOCK_TYPES = {
  CERTIFICATE: "certificate",
  MEDAL: "medal",
};

const SESSION_CACHE_REVALIDATE_INTERVAL_MS = 30 * 1000;

module.exports = {
  BATCH_MAX_SIZE,
  REPORT_MIN_WORD_COUNT,
  SCORE_VALUES,
  USER_ROLES,
  ENROLLMENT_STATUSES,
  STOCK_TYPES,
  SESSION_CACHE_REVALIDATE_INTERVAL_MS,
};
