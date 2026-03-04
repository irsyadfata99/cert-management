// ============================================================
// PAGINATION HELPER
// ============================================================

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * Parse dan validasi query params pagination dari request.
 * @param {object} query - req.query
 * @returns {{ page, limit, offset }}
 */
const parsePagination = (query = {}) => {
  let page = parseInt(query.page) || DEFAULT_PAGE;
  let limit = parseInt(query.limit) || DEFAULT_LIMIT;

  if (page < 1) page = DEFAULT_PAGE;
  if (limit < 1) limit = DEFAULT_LIMIT;
  if (limit > MAX_LIMIT) limit = MAX_LIMIT;

  const offset = (page - 1) * limit;

  return { page, limit, offset };
};

/**
 * Buat response envelope pagination.
 * @param {Array} data - Array hasil query
 * @param {number} totalCount - Total row dari COUNT query
 * @param {number} page - Halaman saat ini
 * @param {number} limit - Jumlah item per halaman
 * @returns {object}
 */
const paginateResponse = (data, totalCount, page, limit) => {
  const totalPages = Math.ceil(totalCount / limit);

  return {
    data,
    pagination: {
      total: totalCount,
      page,
      limit,
      totalPages,
      hasNextPage: page < totalPages,
      hasPrevPage: page > 1,
    },
  };
};

module.exports = { parsePagination, paginateResponse };
