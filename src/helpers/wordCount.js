// ============================================================
// WORD COUNT HELPER
// ============================================================

const MIN_WORD_COUNT = 200;

/**
 * Hitung jumlah kata dari string teks.
 * - Strip HTML tags jika ada
 * - Normalize whitespace
 * - Hitung token yang dipisah spasi
 *
 * @param {string} text
 * @returns {number}
 */
const countWords = (text) => {
  if (!text || typeof text !== "string") return 0;

  const stripped = text
    .replace(/<[^>]*>/g, " ") // strip HTML tags
    .replace(/\s+/g, " ") // normalize whitespace
    .trim();

  if (stripped.length === 0) return 0;

  return stripped.split(" ").length;
};

/**
 * Validasi apakah teks memenuhi minimum word count untuk final report.
 *
 * @param {string} text
 * @returns {{ valid: boolean, count: number, min: number }}
 */
const validateWordCount = (text) => {
  const count = countWords(text);
  return {
    valid: count >= MIN_WORD_COUNT,
    count,
    min: MIN_WORD_COUNT,
  };
};

module.exports = { countWords, validateWordCount, MIN_WORD_COUNT };
