const {
  parsePagination,
  paginateResponse,
} = require("../../../src/helpers/paginate");

describe("parsePagination", () => {
  test("default values jika query kosong", () => {
    const result = parsePagination({});
    expect(result).toEqual({ page: 1, limit: 20, offset: 0 });
  });

  test("parse page dan limit dari query", () => {
    const result = parsePagination({ page: "2", limit: "10" });
    expect(result).toEqual({ page: 2, limit: 10, offset: 10 });
  });

  test("page < 1 di-reset ke 1", () => {
    const result = parsePagination({ page: "0" });
    expect(result.page).toBe(1);
  });

  test("limit < 1 di-reset ke default 20", () => {
    const result = parsePagination({ limit: "0" });
    expect(result.limit).toBe(20);
  });

  test("limit > 100 di-cap ke 100", () => {
    const result = parsePagination({ limit: "999" });
    expect(result.limit).toBe(100);
  });

  test("offset dihitung dengan benar", () => {
    const result = parsePagination({ page: "3", limit: "5" });
    expect(result.offset).toBe(10);
  });

  test("query undefined tidak error", () => {
    const result = parsePagination(undefined);
    expect(result).toEqual({ page: 1, limit: 20, offset: 0 });
  });
});

describe("paginateResponse", () => {
  const data = [{ id: 1 }, { id: 2 }];

  test("struktur response benar", () => {
    const result = paginateResponse(data, 50, 1, 20);
    expect(result).toMatchObject({
      data,
      pagination: {
        total: 50,
        page: 1,
        limit: 20,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: false,
      },
    });
  });

  test("halaman terakhir: hasNextPage false", () => {
    const result = paginateResponse(data, 20, 2, 10);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.hasPrevPage).toBe(true);
  });

  test("total 0: totalPages 0", () => {
    const result = paginateResponse([], 0, 1, 20);
    expect(result.pagination.totalPages).toBe(0);
    expect(result.pagination.hasNextPage).toBe(false);
  });

  test("data dikembalikan utuh", () => {
    const result = paginateResponse(data, 2, 1, 20);
    expect(result.data).toBe(data);
  });
});
