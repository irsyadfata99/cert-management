// ============================================================
// DYNAMIC QUERY BUILDER HELPER
// ============================================================

/**
 * Builder untuk WHERE clause dinamis dengan parameterized query.
 * Mencegah SQL injection sekaligus menghindari query string concatenation manual.
 *
 * Contoh pemakaian:
 *   const { whereClause, values, nextIndex } = buildWhere([
 *     { col: "center_id", val: 1 },
 *     { col: "is_active", val: true },
 *     { col: "role", val: "teacher", op: "=" },
 *     { col: "name", val: "ali", op: "ILIKE", transform: (v) => `%${v}%` },
 *   ]);
 *   // WHERE center_id = $1 AND is_active = $2 AND role = $3 AND name ILIKE $4
 *   // values: [1, true, "teacher", "%ali%"]
 */
const buildWhere = (filters = [], startIndex = 1) => {
  const conditions = [];
  const values = [];
  let idx = startIndex;

  for (const filter of filters) {
    const { col, val, op = "=", transform } = filter;

    // Skip jika val null/undefined (filter tidak aktif)
    if (val === null || val === undefined || val === "") continue;

    const finalVal = transform ? transform(val) : val;
    conditions.push(`${col} ${op} $${idx}`);
    values.push(finalVal);
    idx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return { whereClause, values, nextIndex: idx };
};

/**
 * Builder untuk SET clause dinamis pada UPDATE query.
 *
 * Contoh pemakaian:
 *   const { setClause, values, nextIndex } = buildSet({
 *     name: "Budi",
 *     is_active: false,
 *     avatar: undefined, // akan diskip
 *   });
 *   // SET name = $1, is_active = $2
 *   // values: ["Budi", false]
 */
const buildSet = (fields = {}, startIndex = 1) => {
  const assignments = [];
  const values = [];
  let idx = startIndex;

  for (const [col, val] of Object.entries(fields)) {
    // Skip undefined — null boleh (untuk clear field)
    if (val === undefined) continue;

    assignments.push(`${col} = $${idx}`);
    values.push(val);
    idx++;
  }

  if (assignments.length === 0) {
    throw new Error("buildSet: no fields provided for update");
  }

  // Selalu tambah updated_at
  assignments.push(`updated_at = NOW()`);

  const setClause = `SET ${assignments.join(", ")}`;

  return { setClause, values, nextIndex: idx };
};

/**
 * Builder untuk ORDER BY clause dengan whitelist kolom.
 * Mencegah SQL injection pada dynamic sorting.
 *
 * @param {string} sortBy - Nama kolom dari req.query
 * @param {string} sortOrder - "asc" atau "desc" dari req.query
 * @param {string[]} allowedCols - Whitelist kolom yang boleh di-sort
 * @param {string} defaultCol - Kolom default jika sortBy tidak valid
 * @returns {string} ORDER BY clause
 */
const buildOrderBy = (sortBy, sortOrder, allowedCols = [], defaultCol = "created_at") => {
  const col = allowedCols.includes(sortBy) ? sortBy : defaultCol;
  const order = sortOrder?.toLowerCase() === "asc" ? "ASC" : "DESC";
  return `ORDER BY ${col} ${order}`;
};

module.exports = { buildWhere, buildSet, buildOrderBy };
