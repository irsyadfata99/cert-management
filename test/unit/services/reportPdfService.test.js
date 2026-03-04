// Mock fs dan pdf-lib sebelum require service
jest.mock("fs", () => ({
  existsSync: jest.fn().mockReturnValue(true),
  readFileSync: jest.fn().mockReturnValue(Buffer.from("mock_template")),
}));

jest.mock("pdf-lib", () => {
  const mockPage = {
    drawRectangle: jest.fn(),
    drawText: jest.fn(),
  };
  const mockDoc = {
    embedFont: jest.fn().mockResolvedValue({
      widthOfTextAtSize: jest.fn().mockReturnValue(50),
    }),
    getPages: jest.fn().mockReturnValue([mockPage]),
    save: jest.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  };
  return {
    PDFDocument: {
      load: jest.fn().mockResolvedValue(mockDoc),
    },
    rgb: jest.fn().mockReturnValue({}),
    StandardFonts: {
      Helvetica: "Helvetica",
      HelveticaBold: "Helvetica-Bold",
    },
  };
});

const { generateReportPdf } = require("../../../src/services/reportPdfService");

const validData = {
  studentName: "Budi Santoso",
  teacherName: "Pak Guru",
  academicYear: "2024/2025",
  period: "Semester 1",
  scoreCreativity: "A",
  scoreCriticalThinking: "B+",
  scoreAttention: "A+",
  scoreResponsibility: "B",
  scoreCodingSkills: "A",
  content: Array(200).fill("kata").join(" "),
};

describe("generateReportPdf", () => {
  test("return Buffer", async () => {
    const result = await generateReportPdf(validData);
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  test("berhasil dengan score null", async () => {
    const result = await generateReportPdf({
      ...validData,
      scoreCreativity: null,
      scoreCriticalThinking: null,
    });
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  test("berhasil dengan academicYear dan period null", async () => {
    const result = await generateReportPdf({
      ...validData,
      academicYear: null,
      period: null,
    });
    expect(Buffer.isBuffer(result)).toBe(true);
  });

  test("template tidak ditemukan throw error", async () => {
    const fs = require("fs");
    fs.existsSync.mockReturnValueOnce(false);

    // Reset cache dengan cara re-require module
    jest.resetModules();
    jest.mock("fs", () => ({
      existsSync: jest.fn().mockReturnValue(false),
      readFileSync: jest.fn(),
    }));

    const {
      generateReportPdf: generateFresh,
    } = require("../../../src/services/reportPdfService");

    await expect(generateFresh(validData)).rejects.toThrow(
      "PDF template not found",
    );
  });
});
