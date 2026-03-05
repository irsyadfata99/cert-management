const buildWhere = (filters = [], startIndex = 1) => {
  const conditions = [];
  const values = [];
  let idx = startIndex;

  for (const filter of filters) {
    const { col, val, op = "=", transform } = filter;

    if (val === null || val === undefined || val === "") continue;

    const finalVal = transform ? transform(val) : val;
    conditions.push(`${col} ${op} $${idx}`);
    values.push(finalVal);
    idx++;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return { whereClause, values, nextIndex: idx };
};

const buildSet = (fields = {}, startIndex = 1) => {
  const assignments = [];
  const values = [];
  let idx = startIndex;

  for (const [col, val] of Object.entries(fields)) {
    if (val === undefined) continue;

    assignments.push(`${col} = $${idx}`);
    values.push(val);
    idx++;
  }

  if (assignments.length === 0) {
    throw new Error("buildSet: no fields provided for update");
  }

  assignments.push(`updated_at = NOW()`);

  const setClause = `SET ${assignments.join(", ")}`;

  return { setClause, values, nextIndex: idx };
};

const buildOrderBy = (
  sortBy,
  sortOrder,
  allowedCols = [],
  defaultCol = "created_at",
) => {
  const col = allowedCols.includes(sortBy) ? sortBy : defaultCol;
  const order = sortOrder?.toLowerCase() === "asc" ? "ASC" : "DESC";
  return `ORDER BY ${col} ${order}`;
};

module.exports = { buildWhere, buildSet, buildOrderBy };
