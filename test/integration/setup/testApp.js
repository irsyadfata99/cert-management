require("dotenv").config({ path: ".env.test" });

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

const app = require("../../../src/app");
const { query } = require("../../../src/config/database");

// ============================================================
// ENDPOINT KHUSUS TEST — inject session tanpa Google OAuth
// Hanya aktif saat NODE_ENV=test
// ============================================================

if (process.env.NODE_ENV === "test") {
  app.post("/__test/login", async (req, res) => {
    const { userId } = req.body;

    const result = await query(
      `SELECT id, email, name, avatar, role, center_id, drive_folder_id, is_active
       FROM users WHERE id = $1 AND is_active = TRUE`,
      [userId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = result.rows[0];

    req.session.passport = { user: user.id };
    req.session.cachedUser = user;

    await new Promise((resolve, reject) =>
      req.session.save((err) => (err ? reject(err) : resolve())),
    );

    res.status(200).json({ success: true, user });
  });
}

module.exports = app;
