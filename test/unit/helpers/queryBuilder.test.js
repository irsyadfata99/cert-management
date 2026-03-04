const {
  buildWhere,
  buildSet,
  buildOrderBy,
} = require("../../../src/helpers/queryBuilder");

describe("buildWhere", () => {
  test("filter kosong menghasilkan whereClause kosong", () => {
    const { whereClause, values } = buildWhere([]);
    expect(whereClause).toBe("");
    expect(values).toEqual([]);
  });

  test("satu filter menghasilkan WHERE clause", () => {
    const { whereClause, values } = buildWhere([{ col: "center_id", val: 1 }]);
    expect(whereClause).toBe("WHERE center_id = $1");
    expect(values).toEqual([1]);
  });

  test("dua filter menghasilkan AND", () => {
    const { whereClause, values } = buildWhere([
      { col: "center_id", val: 1 },
      { col: "is_active", val: true },
    ]);
    expect(whereClause).toBe("WHERE center_id = $1 AND is_active = $2");
    expect(values).toEqual([1, true]);
  });

  test("val null/undefined di-skip", () => {
    const { whereClause, values } = buildWhere([
      { col: "center_id", val: null },
      { col: "is_active", val: undefined },
      { col: "role", val: "teacher" },
    ]);
    expect(whereClause).toBe("WHERE role = $1");
    expect(values).toEqual(["teacher"]);
  });

  test("val string kosong di-skip", () => {
    const { whereClause, values } = buildWhere([{ col: "name", val: "" }]);
    expect(whereClause).toBe("");
    expect(values).toEqual([]);
  });

  test("ILIKE operator dengan transform", () => {
    const { whereClause, values } = buildWhere([
      { col: "name", val: "ali", op: "ILIKE", transform: (v) => `%${v}%` },
    ]);
    expect(whereClause).toBe("WHERE name ILIKE $1");
    expect(values).toEqual(["%ali%"]);
  });

  test("startIndex custom", () => {
    const { whereClause, values, nextIndex } = buildWhere(
      [{ col: "role", val: "admin" }],
      3,
    );
    expect(whereClause).toBe("WHERE role = $3");
    expect(nextIndex).toBe(4);
  });
});

describe("buildSet", () => {
  test("satu field menghasilkan SET clause", () => {
    const { setClause, values } = buildSet({ name: "Budi" });
    expect(setClause).toContain("SET name = $1");
    expect(setClause).toContain("updated_at = NOW()");
    expect(values).toEqual(["Budi"]);
  });

  test("undefined di-skip, null boleh", () => {
    const { setClause, values } = buildSet({
      name: "Budi",
      description: null,
      avatar: undefined,
    });
    expect(setClause).toContain("name = $1");
    expect(setClause).toContain("description = $2");
    expect(setClause).not.toContain("avatar");
    expect(values).toEqual(["Budi", null]);
  });

  test("tidak ada field yang valid throw error", () => {
    expect(() => buildSet({ avatar: undefined })).toThrow();
  });

  test("selalu tambah updated_at", () => {
    const { setClause } = buildSet({ name: "Test" });
    expect(setClause).toContain("updated_at = NOW()");
  });
});

describe("buildOrderBy", () => {
  const allowed = ["name", "created_at"];

  test("kolom valid dan asc", () => {
    const result = buildOrderBy("name", "asc", allowed);
    expect(result).toBe("ORDER BY name ASC");
  });

  test("kolom valid dan desc", () => {
    const result = buildOrderBy("created_at", "desc", allowed);
    expect(result).toBe("ORDER BY created_at DESC");
  });

  test("kolom tidak valid fallback ke default", () => {
    const result = buildOrderBy("password", "asc", allowed, "created_at");
    expect(result).toBe("ORDER BY created_at ASC");
  });

  test("sortOrder tidak valid default ke DESC", () => {
    const result = buildOrderBy("name", "invalid", allowed);
    expect(result).toBe("ORDER BY name DESC");
  });

  test("sortBy undefined fallback ke default", () => {
    const result = buildOrderBy(undefined, "asc", allowed, "name");
    expect(result).toBe("ORDER BY name ASC");
  });
});
