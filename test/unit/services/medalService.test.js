jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

const {
  printSingle,
  printBatch,
} = require("../../../src/services/medalService");
const { withTransaction } = require("../../../src/config/database");

beforeEach(() => {
  jest.clearAllMocks();
});

const mockTransaction = (clientQueryMap) => {
  withTransaction.mockImplementation(async (callback) => {
    const client = { query: jest.fn() };
    clientQueryMap(client);
    return callback(client);
  });
};

describe("printSingle medal", () => {
  test("berhasil print medali", async () => {
    mockTransaction((client) => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // enrollment check
        .mockResolvedValueOnce({ rows: [] }) // belum ada medal
        .mockResolvedValueOnce({ rows: [{}] }) // decrement stock
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              medal_unique_id: "MEDAL-000001",
              enrollment_id: 1,
              teacher_id: 1,
              center_id: 1,
              ptc_date: "2024-01-01",
              printed_at: new Date(),
            },
          ],
        });
    });

    const result = await printSingle({
      enrollmentId: 1,
      teacherId: 1,
      centerId: 1,
      ptcDate: "2024-01-01",
    });
    expect(result.medal_unique_id).toBe("MEDAL-000001");
  });

  test("enrollment tidak ditemukan throw 404", async () => {
    mockTransaction((client) => {
      client.query.mockResolvedValueOnce({ rows: [] });
    });

    await expect(
      printSingle({
        enrollmentId: 999,
        teacherId: 1,
        centerId: 1,
        ptcDate: "2024-01-01",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("medal sudah pernah di-print throw 409", async () => {
    mockTransaction((client) => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // enrollment ada
        .mockResolvedValueOnce({ rows: [{ id: 3 }] }); // medal sudah ada
    });

    await expect(
      printSingle({
        enrollmentId: 1,
        teacherId: 1,
        centerId: 1,
        ptcDate: "2024-01-01",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  test("stock tidak cukup throw 400", async () => {
    mockTransaction((client) => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockRejectedValueOnce(new Error("Stock medali tidak mencukupi"));
    });

    await expect(
      printSingle({
        enrollmentId: 1,
        teacherId: 1,
        centerId: 1,
        ptcDate: "2024-01-01",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("printBatch medal", () => {
  test("items kosong throw 400", async () => {
    await expect(
      printBatch({ items: [], teacherId: 1, centerId: 1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("berhasil print batch", async () => {
    mockTransaction((client) => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }) // enrollment valid
        .mockResolvedValueOnce({ rows: [] }) // tidak ada duplikat
        .mockResolvedValueOnce({ rows: [{}] }) // decrement stock
        .mockResolvedValueOnce({ rows: [{ batch_id: "uuid-456" }] }) // gen uuid
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              medal_unique_id: "MEDAL-000001",
              enrollment_id: 1,
              batch_id: "uuid-456",
              printed_at: new Date(),
            },
            {
              id: 2,
              medal_unique_id: "MEDAL-000002",
              enrollment_id: 2,
              batch_id: "uuid-456",
              printed_at: new Date(),
            },
          ],
        });
    });

    const result = await printBatch({
      items: [
        { enrollmentId: 1, ptcDate: "2024-01-01" },
        { enrollmentId: 2, ptcDate: "2024-01-01" },
      ],
      teacherId: 1,
      centerId: 1,
    });

    expect(result.medals).toHaveLength(2);
    expect(result.batchId).toBe("uuid-456");
  });

  test("duplikat medal throw 409", async () => {
    mockTransaction((client) => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rows: [{ enrollment_id: 1 }] });
    });

    await expect(
      printBatch({
        items: [{ enrollmentId: 1, ptcDate: "2024-01-01" }],
        teacherId: 1,
        centerId: 1,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
