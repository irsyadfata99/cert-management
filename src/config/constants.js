// ============================================================
// CONSTANTS
// [FIX 3] Konstanta yang sebelumnya duplikat antara service layer
// dan validator (BATCH_MAX_SIZE = 100 di dua tempat) dipindahkan
// ke sini sebagai satu sumber kebenaran.
//
// Cara pakai:
//   const { BATCH_MAX_SIZE } = require("../config/constants");
// ============================================================

const BATCH_MAX_SIZE = 100;

const REPORT_MIN_WORD_COUNT = 200;

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

// Interval revalidasi session cache dalam milidetik.
// Harus konsisten dengan nilai di authorize.js.
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
