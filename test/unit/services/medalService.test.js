/**
 * medalService.test.js
 *
 * Di schema v4.0, medal TIDAK lagi di-print secara terpisah.
 * Medal dibuat otomatis sebagai bagian dari transaksi print sertifikat
 * di certificateService.
 *
 * Test ini memverifikasi bahwa medalService hanya berisi
 * fungsi query/list, dan TIDAK export printSingle/printBatch standalone.
 */

require("dotenv").config({ path: ".env.test" });

const medalService = require("../../../src/services/medalService");

describe("medalService — struktur export", () => {
  test("TIDAK export printSingle sebagai fungsi standalone", () => {
    // Medal dicetak otomatis oleh certificateService, bukan oleh medalService
    // Jika ini gagal, berarti medalService masih punya fungsi lama yang perlu dihapus
    expect(typeof medalService.printSingle).not.toBe("function");
  });

  test("TIDAK export printBatch sebagai fungsi standalone", () => {
    expect(typeof medalService.printBatch).not.toBe("function");
  });

  test("medal print terintegrasi di certificateService", () => {
    const certService = require("../../../src/services/certificateService");
    // certificateService harus export printSingle yang juga membuat medal
    expect(typeof certService.printSingle).toBe("function");
    expect(typeof certService.printBatch).toBe("function");
  });
});

describe("medalService — fungsi yang tersedia", () => {
  test("module dapat di-require tanpa error", () => {
    expect(() => require("../../../src/services/medalService")).not.toThrow();
  });

  test("module adalah object", () => {
    expect(typeof medalService).toBe("object");
  });
});
