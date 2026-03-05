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

// Spread actualFs agar fs.stat milik winston tetap berfungsi.
jest.mock("fs", () => {
  const actualFs = jest.requireActual("fs");
  return {
    ...actualFs,
    existsSync: jest.fn().mockReturnValue(true),
    readFileSync: jest.fn().mockReturnValue(Buffer.from("mock_template")),
  };
});

const fs = require("fs");
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
  beforeEach(() => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(Buffer.from("mock_template"));
  });

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

  test("PDFDocument.load error di-propagate sebagai rejection", async () => {
    const { PDFDocument } = require("pdf-lib");
    PDFDocument.load.mockRejectedValueOnce(new Error("corrupt PDF"));

    await expect(generateReportPdf(validData)).rejects.toThrow("corrupt PDF");
  });
});
