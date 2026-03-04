const {
  addStock,
  updateThreshold,
  transferStock,
  getStockByCenter,
} = require("../../../src/services/stockService");

// Mock database
jest.mock("../../../src/config/database", () => ({
  query: jest.fn(),
}));

const { query } = require("../../../src/config/database");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("addStock", () => {
  test("berhasil tambah certificate stock", async () => {
    query.mockResolvedValueOnce({
      rows: [{ quantity: 110, low_stock_threshold: 10 }],
    });

    const result = await addStock({
      centerId: 1,
      type: "certificate",
      quantity: 10,
      addedBy: 1,
    });

    expect(result.quantity).toBe(110);
    expect(result.type).toBe("certificate");
    expect(result.low_stock).toBe(false);
  });

  test("berhasil tambah medal stock", async () => {
    query.mockResolvedValueOnce({
      rows: [{ quantity: 50, low_stock_threshold: 10 }],
    });

    const result = await addStock({
      centerId: 1,
      type: "medal",
      quantity: 5,
      addedBy: 1,
    });
    expect(result.type).toBe("medal");
    expect(result.quantity).toBe(50);
  });

  test("type tidak valid throw error 400", async () => {
    await expect(
      addStock({ centerId: 1, type: "invalid", quantity: 10, addedBy: 1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("quantity 0 throw error 400", async () => {
    await expect(
      addStock({ centerId: 1, type: "certificate", quantity: 0, addedBy: 1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("quantity negatif throw error 400", async () => {
    await expect(
      addStock({ centerId: 1, type: "certificate", quantity: -5, addedBy: 1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("center tidak ditemukan throw error 404", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(
      addStock({
        centerId: 999,
        type: "certificate",
        quantity: 10,
        addedBy: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  test("low_stock true jika quantity <= threshold", async () => {
    query.mockResolvedValueOnce({
      rows: [{ quantity: 5, low_stock_threshold: 10 }],
    });

    const result = await addStock({
      centerId: 1,
      type: "certificate",
      quantity: 5,
      addedBy: 1,
    });
    expect(result.low_stock).toBe(true);
  });
});

describe("updateThreshold", () => {
  test("berhasil update threshold", async () => {
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

describe("transferStock", () => {
  test("same center throw error 400", async () => {
    await expect(
      transferStock({
        type: "certificate",
        fromCenterId: 1,
        toCenterId: 1,
        quantity: 10,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("quantity 0 throw error 400", async () => {
    await expect(
      transferStock({
        type: "certificate",
        fromCenterId: 1,
        toCenterId: 2,
        quantity: 0,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("type tidak valid throw error 400", async () => {
    await expect(
      transferStock({
        type: "invalid",
        fromCenterId: 1,
        toCenterId: 2,
        quantity: 10,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  test("berhasil transfer normalkan hasil DB function", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          result: {
            type: "certificate",
            from_center_id: 1,
            to_center_id: 2,
            quantity: 10,
          },
        },
      ],
    });

    const result = await transferStock({
      type: "certificate",
      fromCenterId: 1,
      toCenterId: 2,
      quantity: 10,
      transferredBy: 1,
    });

    expect(result.type).toBe("certificate");
  });

  test("DB error 'Stock tidak mencukupi' di-normalize ke 400", async () => {
    query.mockRejectedValueOnce(
      new Error("Stock tidak mencukupi atau center_id 1 tidak ditemukan"),
    );

    await expect(
      transferStock({
        type: "certificate",
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
      transferStock({
        type: "certificate",
        fromCenterId: 1,
        toCenterId: 99,
        quantity: 10,
        transferredBy: 1,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("getStockByCenter", () => {
  test("berhasil return stock data", async () => {
    query.mockResolvedValueOnce({
      rows: [
        {
          center_id: 1,
          center_name: "Test Center",
          cert_quantity: 100,
          medal_quantity: 50,
        },
      ],
    });

    const result = await getStockByCenter(1);
    expect(result.center_id).toBe(1);
    expect(result.cert_quantity).toBe(100);
  });

  test("center tidak ditemukan throw error 404", async () => {
    query.mockResolvedValueOnce({ rows: [] });

    await expect(getStockByCenter(999)).rejects.toMatchObject({ status: 404 });
  });
});
