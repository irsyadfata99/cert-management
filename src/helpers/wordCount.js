const { REPORT_MIN_WORD_COUNT } = require("../config/constants");

/**
 * Hitung jumlah kata dalam string dan validasi minimum.
 *
 * @param {string} text
 * @returns {{ valid: boolean, count: number, min: number }}
 */
const validateWordCount = (text) => {
  if (!text || typeof text !== "string") {
    return { valid: false, count: 0, min: REPORT_MIN_WORD_COUNT };
  }

  const count = text
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;

  return {
    valid: count >= REPORT_MIN_WORD_COUNT,
    count,
    min: REPORT_MIN_WORD_COUNT,
  };
};

module.exports = { validateWordCount };
