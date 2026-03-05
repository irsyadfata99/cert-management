jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
  withTransaction: jest.fn(),
}));

const {
  printSingle,
  printBatch,
  reprint,
} = require("../../../src/services/certificateService");
const { withTransaction } = require("../../../src/config/database");

beforeEach(() => {
  jest.clearAllMocks();
});

// Helper: simulate withTransaction langsung jalankan callback dengan mock client
const mockTransaction = (clientQueryMap) => {
  withTransaction.mockImplementation(async (callback) => {
    const client = { query: jest.fn() };
    clientQueryMap(client);
    return callback(client);
  });
};

describe("printSingle", () => {
  test("berhasil print sertifikat", async () => {
    mockTransaction((client) => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // enrollment check
        .mockResolvedValueOnce({ rows: [] }) // existing cert check
        .mockResolvedValueOnce({ rows: [{}] }) // decrement stock
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              cert_unique_id: "CERT-000001",
              enrollment_id: 1,
              teacher_id: 1,
              center_id: 1,
              ptc_date: "2024-01-01",
              is_reprint: false,
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
    expect(result.cert_unique_id).toBe("CERT-000001");
    expect(result.is_reprint).toBe(false);
  });

  test("enrollment tidak ditemukan throw 404", async () => {
    mockTransaction((client) => {
      client.query.mockResolvedValueOnce({ rows: [] }); // enrollment tidak ada
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

  test("sertifikat sudah pernah di-print throw 409", async () => {
    mockTransaction((client) => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // enrollment ada
        .mockResolvedValueOnce({ rows: [{ id: 5 }] }); // cert sudah ada
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
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // enrollment ada
        .mockResolvedValueOnce({ rows: [] }) // belum pernah print
        .mockRejectedValueOnce(new Error("Stock sertifikat tidak mencukupi"));
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

describe("printBatch", () => {
  test("items kosong throw 400", async () => {
    await expect(
      printBatch({ items: [], teacherId: 1, centerId: 1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("berhasil print batch", async () => {
    mockTransaction((client) => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }, { id: 2 }] }) // enrollment check — 2 rows untuk 2 items
        .mockResolvedValueOnce({ rows: [] }) // tidak ada duplikat
        .mockResolvedValueOnce({ rows: [{}] }) // decrement stock
        .mockResolvedValueOnce({ rows: [{ batch_id: "uuid-123" }] }) // gen uuid
        .mockResolvedValueOnce({
          rows: [
            {
              id: 1,
              cert_unique_id: "CERT-000001",
              enrollment_id: 1,
              is_reprint: false,
              batch_id: "uuid-123",
              printed_at: new Date(),
            },
            {
              id: 2,
              cert_unique_id: "CERT-000002",
              enrollment_id: 2,
              is_reprint: false,
              batch_id: "uuid-123",
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

    expect(result.certs).toHaveLength(2);
    expect(result.batchId).toBe("uuid-123");
  });

  test("salah satu enrollment tidak ditemukan throw 404", async () => {
    mockTransaction((client) => {
      // Hanya return 1 dari 2 enrollment yang diminta
      client.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
    });

    await expect(
      printBatch({
        items: [
          { enrollmentId: 1, ptcDate: "2024-01-01" },
          { enrollmentId: 999, ptcDate: "2024-01-01" },
        ],
        teacherId: 1,
        centerId: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("duplikat cert throw 409", async () => {
    mockTransaction((client) => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 1 }] }) // enrollment valid (1 item)
        .mockResolvedValueOnce({ rows: [{ enrollment_id: 1 }] }); // sudah pernah print
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

describe("reprint", () => {
  test("berhasil reprint", async () => {
    mockTransaction((client) => {
      client.query
        .mockResolvedValueOnce({
          rows: [{ id: 5, enrollment_id: 1, is_reprint: false }],
        }) // original cert
        .mockResolvedValueOnce({ rows: [{}] }) // decrement stock
        .mockResolvedValueOnce({
          rows: [
            {
              id: 6,
              cert_unique_id: "CERT-000006",
              enrollment_id: 1,
              is_reprint: true,
              original_cert_id: 5,
              printed_at: new Date(),
            },
          ],
        });
    });

    const result = await reprint({
      originalCertId: 5,
      teacherId: 1,
      centerId: 1,
      ptcDate: "2024-01-01",
    });
    expect(result.is_reprint).toBe(true);
    expect(result.original_cert_id).toBe(5);
  });

  test("original cert tidak ditemukan throw 404", async () => {
    mockTransaction((client) => {
      client.query.mockResolvedValueOnce({ rows: [] });
    });

    await expect(
      reprint({
        originalCertId: 999,
        teacherId: 1,
        centerId: 1,
        ptcDate: "2024-01-01",
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("stock tidak cukup throw 400", async () => {
    mockTransaction((client) => {
      client.query
        .mockResolvedValueOnce({ rows: [{ id: 5, enrollment_id: 1 }] })
        .mockRejectedValueOnce(new Error("Stock sertifikat tidak mencukupi"));
    });

    await expect(
      reprint({
        originalCertId: 5,
        teacherId: 1,
        centerId: 1,
        ptcDate: "2024-01-01",
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
