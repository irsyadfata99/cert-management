jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
}));

// [FIX] Import fungsi sesuai nama export aktual dari stockService.js:
//   addMedalStock, addCertificateBatch, transferCertificateBatch,
//   transferMedalStock, updateThreshold, getAllStock, getCertificateBatch
//
// Fungsi yang sebelumnya di-test (addStock, transferStock, getStockByCenter)
// tidak exist di stockService.js — diganti dengan nama yang benar.
const {
  addMedalStock,
  addCertificateBatch,
  transferCertificateBatch,
  transferMedalStock,
  updateThreshold,
  getCertificateBatch,
  getAllStock,
} = require("../../../src/services/stockService");

const { query } = require("../../../src/config/database");

beforeEach(() => {
  jest.clearAllMocks();
});

// ============================================================
// addMedalStock
// ============================================================

describe("addMedalStock", () => {
  test("berhasil tambah medal stock", async () => {
    query.mockResolvedValueOnce({
      rows: [{ quantity: 130, low_stock_threshold: 10 }],
    });

    const result = await addMedalStock({
      centerId: 1,
      quantity: 30,
      addedBy: 1,
    });

    expect(result.quantity).toBe(130);
    expect(result.type).toBe("medal");
    expect(result.low_stock).toBe(false);
  });

  test("quantity 0 throw error 400", async () => {
    await expect(
      addMedalStock({ centerId: 1, quantity: 0, addedBy: 1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("quantity negatif throw error 400", async () => {
    await expect(
      addMedalStock({ centerId: 1, quantity: -5, addedBy: 1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("center tidak ditemukan throw error 404", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(
      addMedalStock({ centerId: 999, quantity: 10, addedBy: 1 }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("low_stock true jika quantity <= threshold", async () => {
    query.mockResolvedValueOnce({
      rows: [{ quantity: 5, low_stock_threshold: 10 }],
    });

    const result = await addMedalStock({
      centerId: 1,
      quantity: 5,
      addedBy: 1,
    });

    expect(result.low_stock).toBe(true);
  });
});

// ============================================================
// addCertificateBatch
// ============================================================

describe("addCertificateBatch", () => {
  test("berhasil create batch baru", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          result: {
            action: "created",
            center_id: 1,
            range_start: 1,
            range_end: 100,
            current_position: 1,
            available: 100,
          },
        },
      ],
    });

    const result = await addCertificateBatch({
      centerId: 1,
      rangeStart: 1,
      rangeEnd: 100,
      addedBy: 1,
    });

    expect(result.action).toBe("created");
    expect(result.available).toBe(100);
  });

  test("berhasil extend batch yang sudah ada", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          result: {
            action: "extended",
            center_id: 1,
            range_start: 1,
            range_end: 200,
            current_position: 50,
            available: 151,
          },
        },
      ],
    });

    const result = await addCertificateBatch({
      centerId: 1,
      rangeStart: 1,
      rangeEnd: 200,
      addedBy: 1,
    });

    expect(result.action).toBe("extended");
  });

  test("range_start > range_end throw error 400", async () => {
    await expect(
      addCertificateBatch({
        centerId: 1,
        rangeStart: 200,
        rangeEnd: 100,
        addedBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("range_start <= 0 throw error 400", async () => {
    await expect(
      addCertificateBatch({
        centerId: 1,
        rangeStart: 0,
        rangeEnd: 100,
        addedBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("range_end <= 0 throw error 400", async () => {
    await expect(
      addCertificateBatch({
        centerId: 1,
        rangeStart: 1,
        rangeEnd: -1,
        addedBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("DB error 'New range_end' di-normalize ke 400", async () => {
    query.mockRejectedValueOnce(
      new Error(
        "New range_end (50) must be greater than existing range_end (100)",
      ),
    );

    await expect(
      addCertificateBatch({
        centerId: 1,
        rangeStart: 1,
        rangeEnd: 50,
        addedBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("DB error 'No certificate batch found' di-normalize ke 404", async () => {
    query.mockRejectedValueOnce(
      new Error("No certificate batch found for center_id 999"),
    );

    await expect(
      addCertificateBatch({
        centerId: 999,
        rangeStart: 1,
        rangeEnd: 100,
        addedBy: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ============================================================
// transferCertificateBatch
// ============================================================

describe("transferCertificateBatch", () => {
  test("same center throw error 400", async () => {
    await expect(
      transferCertificateBatch({
        fromCenterId: 1,
        toCenterId: 1,
        quantity: 10,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("quantity 0 throw error 400", async () => {
    await expect(
      transferCertificateBatch({
        fromCenterId: 1,
        toCenterId: 2,
        quantity: 0,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("quantity negatif throw error 400", async () => {
    await expect(
      transferCertificateBatch({
        fromCenterId: 1,
        toCenterId: 2,
        quantity: -10,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("berhasil transfer", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          result: {
            from_center_id: 1,
            to_center_id: 2,
            transfer_start: 91,
            transfer_end: 100,
            quantity: 10,
            from_remaining: 90,
          },
        },
      ],
    });

    const result = await transferCertificateBatch({
      fromCenterId: 1,
      toCenterId: 2,
      quantity: 10,
      transferredBy: 1,
    });

    expect(result.quantity).toBe(10);
    expect(result.from_center_id).toBe(1);
    expect(result.to_center_id).toBe(2);
  });

  test("DB error 'Insufficient stock' di-normalize ke 400", async () => {
    query.mockRejectedValueOnce(
      new Error("Insufficient stock. Available: 5, Requested: 50"),
    );

    await expect(
      transferCertificateBatch({
        fromCenterId: 1,
        toCenterId: 2,
        quantity: 50,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("DB error 'not contiguous' di-normalize ke 400", async () => {
    query.mockRejectedValueOnce(
      new Error("Transfer range is not contiguous with destination batch"),
    );

    await expect(
      transferCertificateBatch({
        fromCenterId: 1,
        toCenterId: 2,
        quantity: 10,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("DB error 'No batch found' di-normalize ke 404", async () => {
    query.mockRejectedValueOnce(
      new Error("No batch found for source center_id 1"),
    );

    await expect(
      transferCertificateBatch({
        fromCenterId: 1,
        toCenterId: 2,
        quantity: 10,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ============================================================
// transferMedalStock
// ============================================================

describe("transferMedalStock", () => {
  test("same center throw error 400", async () => {
    await expect(
      transferMedalStock({
        fromCenterId: 1,
        toCenterId: 1,
        quantity: 10,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("quantity 0 throw error 400", async () => {
    await expect(
      transferMedalStock({
        fromCenterId: 1,
        toCenterId: 2,
        quantity: 0,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("berhasil transfer medal", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          result: {
            type: "medal",
            from_center_id: 1,
            to_center_id: 2,
            quantity: 10,
            from_remaining: 90,
            to_new_total: 60,
          },
        },
      ],
    });

    const result = await transferMedalStock({
      fromCenterId: 1,
      toCenterId: 2,
      quantity: 10,
      transferredBy: 1,
    });

    expect(result.quantity).toBe(10);
  });

  test("DB error 'Stock tidak mencukupi' di-normalize ke 400", async () => {
    query.mockRejectedValueOnce(
      new Error("Stock tidak mencukupi atau center_id 1 tidak ditemukan"),
    );

    await expect(
      transferMedalStock({
        fromCenterId: 1,
        toCenterId: 2,
        quantity: 999,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("DB error 'Center tujuan tidak ditemukan' di-normalize ke 404", async () => {
    query.mockRejectedValueOnce(
      new Error("Center tujuan dengan center_id 99 tidak ditemukan"),
    );

    await expect(
      transferMedalStock({
        fromCenterId: 1,
        toCenterId: 99,
        quantity: 10,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ============================================================
// updateThreshold
// ============================================================

describe("updateThreshold", () => {
  test("berhasil update cert threshold", async () => {
    query.mockResolvedValueOnce({
      rows: [{ quantity: 100, low_stock_threshold: 20 }],
    });

    const result = await updateThreshold({
      centerId: 1,
      type: "certificate",
      threshold: 20,
      updatedBy: 1,
    });

    expect(result.low_stock_threshold).toBe(20);
    expect(result.type).toBe("certificate");
  });

  test("berhasil update medal threshold", async () => {
    query.mockResolvedValueOnce({
      rows: [{ quantity: 50, low_stock_threshold: 5 }],
    });

    const result = await updateThreshold({
      centerId: 1,
      type: "medal",
      threshold: 5,
      updatedBy: 1,
    });

    expect(result.low_stock_threshold).toBe(5);
    expect(result.type).toBe("medal");
  });

  test("threshold 0 valid", async () => {
    query.mockResolvedValueOnce({
      rows: [{ quantity: 100, low_stock_threshold: 0 }],
    });

    const result = await updateThreshold({
      centerId: 1,
      type: "medal",
      threshold: 0,
      updatedBy: 1,
    });

    expect(result.low_stock_threshold).toBe(0);
  });

  test("threshold negatif throw error 400", async () => {
    await expect(
      updateThreshold({
        centerId: 1,
        type: "certificate",
        threshold: -1,
        updatedBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("type tidak valid throw error 400", async () => {
    await expect(
      updateThreshold({
        centerId: 1,
        type: "invalid",
        threshold: 10,
        updatedBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("center tidak ditemukan throw error 404", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(
      updateThreshold({
        centerId: 999,
        type: "certificate",
        threshold: 10,
        updatedBy: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

// ============================================================
// getCertificateBatch
// ============================================================

describe("getCertificateBatch", () => {
  test("berhasil return batch data", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          center_id: 1,
          center_name: "Test Center",
          range_start: 1,
          range_end: 100,
          current_position: 20,
          available: 81,
          used: 19,
        },
      ],
    });

    const result = await getCertificateBatch(1);

    expect(result.center_id).toBe(1);
    expect(result.range_start).toBe(1);
    expect(result.range_end).toBe(100);
    expect(result.available).toBe(81);
  });

  test("center tanpa batch return null", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await getCertificateBatch(999);

    expect(result).toBeNull();
  });
});

// ============================================================
// getAllStock
// ============================================================

describe("getAllStock", () => {
  test("berhasil return semua stock dari view", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          center_id: 1,
          center_name: "Center A",
          cert_quantity: 80,
          cert_threshold: 10,
          cert_low_stock: false,
          medal_quantity: 50,
          medal_threshold: 10,
          medal_low_stock: false,
          has_alert: false,
        },
        {
          center_id: 2,
          center_name: "Center B",
          cert_quantity: 5,
          cert_threshold: 10,
          cert_low_stock: true,
          medal_quantity: 3,
          medal_threshold: 10,
          medal_low_stock: true,
          has_alert: true,
        },
      ],
    });

    const result = await getAllStock();

    expect(result).toHaveLength(2);
    expect(result[0].cert_quantity).toBe(80);
    expect(result[1].has_alert).toBe(true);
  });

  test("return array kosong jika tidak ada data", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    const result = await getAllStock();

    expect(result).toEqual([]);
  });
});
