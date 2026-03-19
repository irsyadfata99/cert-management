/**
 * reportPdfService.test.js
 *
 * Unit test untuk generateReportPdf.
 * Mock pdf-lib dan fontkit karena environment test tidak support
 * binary PDF operations penuh.
 */

require("dotenv").config({ path: ".env.test" });

// Mock fontkit
jest.mock("@pdf-lib/fontkit", () => ({
  create: jest.fn(() => ({})),
}));

// Mock pdf-lib PDFDocument
const mockPdfDoc = {
  registerFontkit: jest.fn(),
  embedFont: jest.fn().mockResolvedValue({
    encodeText: jest.fn((t) => t),
    widthOfTextAtSize: jest.fn(() => 50),
  }),
  getPages: jest.fn(() => [
    {
      drawText: jest.fn(),
      getWidth: jest.fn(() => 595),
      getHeight: jest.fn(() => 842),
    },
  ]),
  save: jest.fn().mockResolvedValue(Buffer.from("mock-pdf-bytes")),
};

jest.mock("pdf-lib", () => ({
  PDFDocument: {
    load: jest.fn().mockResolvedValue(mockPdfDoc),
    create: jest.fn().mockResolvedValue(mockPdfDoc),
  },
  rgb: jest.fn(() => ({ r: 0, g: 0, b: 0 })),
  StandardFonts: { Helvetica: "Helvetica" },
}));

jest.mock("../../../src/config/logger", () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

const { generateReportPdf } = require("../../../src/services/reportPdfService");

const sampleData = {
  studentName: "Budi Santoso",
  moduleName: "Coding Dasar",
  centerName: "Center Jakarta",
  teacherName: "Pak Guru",
  ptcDate: "2024-01-15",
  score: 85,
  academicYear: "2023/2024",
  period: "Semester 1",
};

describe("generateReportPdf", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Re-setup mock setelah clear
    mockPdfDoc.registerFontkit.mockClear();
    mockPdfDoc.embedFont.mockResolvedValue({
      encodeText: jest.fn((t) => t),
      widthOfTextAtSize: jest.fn(() => 50),
    });
    mockPdfDoc.getPages.mockReturnValue([
      {
        drawText: jest.fn(),
        getWidth: jest.fn(() => 595),
        getHeight: jest.fn(() => 842),
      },
    ]);
    mockPdfDoc.save.mockResolvedValue(Buffer.from("mock-pdf-bytes"));
  });

  test("return Buffer", async () => {
    const result = await generateReportPdf(sampleData);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  test("berhasil dengan score null", async () => {
    const result = await generateReportPdf({ ...sampleData, score: null });
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  test("berhasil dengan academicYear dan period null", async () => {
    const result = await generateReportPdf({
      ...sampleData,
      academicYear: null,
      period: null,
    });
    expect(Buffer.isBuffer(result)).toBe(true);
  });
});
