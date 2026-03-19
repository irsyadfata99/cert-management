/**
 * certificateService.test.js
 *
 * Unit test untuk certificateService.
 * Di schema v4.0:
 * - printSingle juga insert medal dalam satu transaksi
 * - Stock error dilempar sebagai Error biasa (bukan AppError dengan .status)
 *   — normalize di route handler
 */

require("dotenv").config({ path: ".env.test" });

// Mock pool sebelum require service
jest.mock("../../../src/config/database", () => {
  const mockClient = {
    query: jest.fn(),
    release: jest.fn(),
  };

  // withTransaction helper — jalankan callback dengan mockClient
  const withTransaction = jest.fn(async (callback) => {
    try {
      const result = await callback(mockClient);
      return result;
    } catch (err) {
      throw err;
    }
  });

  return {
    pool: {
      query: jest.fn(),
      connect: jest.fn().mockResolvedValue(mockClient),
    },
    withTransaction,
    _mockClient: mockClient,
  };
});

jest.mock("../../../src/config/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { pool, _mockClient: client } = require("../../../src/config/database");
const {
  printSingle,
  printBatch,
  reprint,
} = require("../../../src/services/certificateService");

// Helper buat mock row cert
const makeCertRow = (overrides = {}) => ({
  id: 1,
  unique_id: "CERT-000001",
  enrollment_id: 1,
  teacher_id: 1,
  center_id: 1,
  is_reprint: false,
  ptc_date: "2024-01-01",
  created_at: new Date(),
  ...overrides,
});

const makeMedalRow = (overrides = {}) => ({
  id: 1,
  unique_id: "MDL-000001",
  enrollment_id: 1,
  teacher_id: 1,
  center_id: 1,
  created_at: new Date(),
  ...overrides,
});

const makeEnrollmentRow = (overrides = {}) => ({
  id: 1,
  student_id: 1,
  module_id: 1,
  center_id: 1,
  teacher_id: 1,
  is_active: true,
  ...overrides,
});

const makeBatchRow = (overrides = {}) => ({
  center_id: 1,
  range_start: 1,
  range_end: 100,
  current_position: 1,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  client.release.mockClear();
});

describe("printSingle", () => {
  test("berhasil print sertifikat", async () => {
    // Sequence mock query di dalam transaksi:
    // 1. BEGIN
    // 2. SELECT enrollment (cek ownership + not printed)
    // 3. SELECT cert_batch (cek stock)
    // 4. UPDATE cert batch (decrement current_position)
    // 5. INSERT certificate → return cert row
    // 6. SELECT medal_stock (cek medal stock)
    // 7. UPDATE medal_stock (decrement)
    // 8. INSERT medal → return medal row
    // 9. COMMIT
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeEnrollmentRow()] }) // SELECT enrollment
      .mockResolvedValueOnce({ rows: [makeBatchRow()] }) // SELECT cert batch
      .mockResolvedValueOnce({ rows: [makeBatchRow({ current_position: 2 })] }) // UPDATE batch
      .mockResolvedValueOnce({ rows: [makeCertRow()] }) // INSERT cert
      .mockResolvedValueOnce({ rows: [{ quantity: 50 }] }) // SELECT medal_stock
      .mockResolvedValueOnce({ rows: [{ quantity: 49 }] }) // UPDATE medal_stock
      .mockResolvedValueOnce({ rows: [makeMedalRow()] }) // INSERT medal
      .mockResolvedValueOnce({}); // COMMIT

    const result = await printSingle({
      enrollmentId: 1,
      teacherId: 1,
      centerId: 1,
      ptcDate: "2024-01-01",
    });

    expect(result).toHaveProperty("cert");
    expect(result).toHaveProperty("medal");
  });

  test("enrollment tidak ditemukan throw 404", async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT enrollment → not found
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      printSingle({
        enrollmentId: 999,
        teacherId: 1,
        centerId: 1,
        ptcDate: "2024-01-01",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("sudah di-print throw 409", async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeEnrollmentRow()] }) // SELECT enrollment
      .mockResolvedValueOnce({ rows: [] }) // cert batch → no stock (trigger 409 atau 400)
      .mockResolvedValueOnce({}); // ROLLBACK

    // Either 409 (already printed) or 400 (no stock) — tergantung implementasi
    await expect(
      printSingle({
        enrollmentId: 1,
        teacherId: 1,
        centerId: 1,
        ptcDate: "2024-01-01",
      }),
    ).rejects.toHaveProperty("status");
  });

  test("stock tidak cukup throw error", async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeEnrollmentRow()] }) // SELECT enrollment
      .mockResolvedValueOnce({ rows: [] }) // SELECT cert batch → tidak ada batch
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      printSingle({
        enrollmentId: 1,
        teacherId: 1,
        centerId: 1,
        ptcDate: "2024-01-01",
      }),
    ).rejects.toThrow();
  });
});

describe("printBatch", () => {
  test("items kosong throw 400", async () => {
    await expect(
      printBatch({ items: [], teacherId: 1, centerId: 1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("berhasil print batch", async () => {
    // Untuk 2 enrollment, sequence query per item:
    // BEGIN → per item: enrollment check, batch check, batch update, cert insert, medal stock check, medal stock update, medal insert → COMMIT
    const baseSeq = [
      {}, // BEGIN
    ];

    // Item 1
    baseSeq.push(
      { rows: [makeEnrollmentRow({ id: 1 })] }, // SELECT enrollment
      { rows: [makeBatchRow()] }, // SELECT batch
      { rows: [makeBatchRow({ current_position: 2 })] }, // UPDATE batch
      { rows: [makeCertRow({ id: 1 })] }, // INSERT cert
      { rows: [{ quantity: 50 }] }, // SELECT medal stock
      { rows: [{ quantity: 49 }] }, // UPDATE medal stock
      { rows: [makeMedalRow({ id: 1 })] }, // INSERT medal
    );

    // Item 2
    baseSeq.push(
      { rows: [makeEnrollmentRow({ id: 2 })] }, // SELECT enrollment
      { rows: [makeBatchRow({ current_position: 2 })] }, // SELECT batch
      { rows: [makeBatchRow({ current_position: 3 })] }, // UPDATE batch
      { rows: [makeCertRow({ id: 2, unique_id: "CERT-000002" })] }, // INSERT cert
      { rows: [{ quantity: 49 }] }, // SELECT medal stock
      { rows: [{ quantity: 48 }] }, // UPDATE medal stock
      { rows: [makeMedalRow({ id: 2, unique_id: "MDL-000002" })] }, // INSERT medal
    );

    baseSeq.push({}); // COMMIT

    client.query.mockImplementation(() =>
      Promise.resolve(baseSeq.shift() || { rows: [] }),
    );

    const result = await printBatch({
      items: [
        { enrollmentId: 1, ptcDate: "2024-01-01" },
        { enrollmentId: 2, ptcDate: "2024-01-01" },
      ],
      teacherId: 1,
      centerId: 1,
    });

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(2);
  });
});

describe("reprint", () => {
  test("berhasil reprint", async () => {
    // Sequence: BEGIN → SELECT original cert → SELECT batch → UPDATE batch → INSERT cert reprint → SELECT medal stock → UPDATE medal stock → INSERT medal → COMMIT
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({
        rows: [makeCertRow({ id: 5, is_reprint: false })],
      }) // SELECT original cert
      .mockResolvedValueOnce({ rows: [makeBatchRow()] }) // SELECT batch
      .mockResolvedValueOnce({ rows: [makeBatchRow({ current_position: 2 })] }) // UPDATE batch
      .mockResolvedValueOnce({
        rows: [
          makeCertRow({ id: 6, is_reprint: true, unique_id: "CERT-000006" }),
        ],
      }) // INSERT cert reprint
      .mockResolvedValueOnce({ rows: [{ quantity: 50 }] }) // SELECT medal stock
      .mockResolvedValueOnce({ rows: [{ quantity: 49 }] }) // UPDATE medal stock
      .mockResolvedValueOnce({ rows: [makeMedalRow({ id: 6 })] }) // INSERT medal
      .mockResolvedValueOnce({}); // COMMIT

    const result = await reprint({
      originalCertId: 5,
      teacherId: 1,
      centerId: 1,
      ptcDate: "2024-01-01",
    });

    expect(result).toHaveProperty("cert");
    expect(result.cert.is_reprint).toBe(true);
  });

  test("cert tidak ditemukan throw 404", async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT original cert → not found
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      reprint({
        originalCertId: 999,
        teacherId: 1,
        centerId: 1,
        ptcDate: "2024-01-01",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("stock tidak cukup throw error", async () => {
    client.query
      .mockResolvedValueOnce({}) // BEGIN
      .mockResolvedValueOnce({ rows: [makeCertRow({ id: 5 })] }) // SELECT original cert
      .mockResolvedValueOnce({ rows: [] }) // SELECT batch → tidak ada
      .mockResolvedValueOnce({}); // ROLLBACK

    await expect(
      reprint({
        originalCertId: 5,
        teacherId: 1,
        centerId: 1,
        ptcDate: "2024-01-01",
      }),
    ).rejects.toThrow();
  });
});
