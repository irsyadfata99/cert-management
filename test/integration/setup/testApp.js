require("dotenv").config({ path: ".env.test" });
process.env.NODE_ENV = "test";

// Mock Google Drive agar test tidak perlu credentials asli
jest.mock("../../../src/services/driveService", () => ({
  createFolder: jest.fn().mockResolvedValue("mock_folder_id"),
  createCenterFolder: jest.fn().mockResolvedValue("mock_center_folder_id"),
  createTeacherFolder: jest.fn().mockResolvedValue("mock_teacher_folder_id"),
  uploadFile: jest.fn().mockResolvedValue({
    fileId: "mock_file_id",
    fileName: "mock_file_name.pdf",
    webViewLink: "https://drive.google.com/mock",
  }),
  deleteFile: jest.fn().mockResolvedValue(undefined),
  getFileMetadata: jest.fn().mockResolvedValue({
    fileId: "mock_file_id",
    fileName: "mock_file_name.pdf",
  }),
}));

jest.mock("../../../src/services/reportPdfService", () => ({
  generateReportPdf: jest.fn().mockResolvedValue(Buffer.from("mock_pdf")),
}));

// [FIX] Route /__test/login sudah dipindah ke app.js di dalam blok
// `if (process.env.NODE_ENV === "test")`, tepat sebelum 404 handler.
//
// Sebelumnya route didaftarkan di sini (setelah require app), sehingga
// 404 handler di app.js selalu menangkap request lebih dulu karena
// Express memproses middleware secara berurutan — route ini tidak
// pernah tercapai → loginAs() selalu dapat 404 → semua test dapat 401.
const app = require("../../../src/app");

module.exports = app;
