const drive = require("../config/drive");
const { Readable } = require("stream");
const logger = require("../config/logger");

// ============================================================
// FOLDER OPERATIONS
// ============================================================

/**
 * Buat folder baru di Google Drive.
 * @param {string} name - Nama folder
 * @param {string} parentFolderId - ID folder parent
 * @returns {string} ID folder yang baru dibuat
 */
const createFolder = async (name, parentFolderId) => {
  const response = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentFolderId],
    },
    fields: "id",
  });

  const folderId = response.data.id;
  logger.info("Drive folder created", { name, parentFolderId, folderId });
  return folderId;
};

// ============================================================
// FILE OPERATIONS
// ============================================================

/**
 * Upload file ke Google Drive.
 * @param {object} options
 * @param {Buffer|string} options.buffer - Konten file
 * @param {string} options.fileName - Nama file di Drive
 * @param {string} options.mimeType - MIME type file
 * @param {string} options.folderId - ID folder tujuan
 * @returns {{ fileId: string, fileName: string, webViewLink: string }}
 */
const uploadFile = async ({ buffer, fileName, mimeType, folderId }) => {
  const readable = Readable.from(buffer);

  const response = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
    },
    media: {
      mimeType,
      body: readable,
    },
    fields: "id, name, webViewLink",
  });

  const { id: fileId, name, webViewLink } = response.data;

  logger.info("Drive file uploaded", { fileId, fileName: name, folderId });

  return { fileId, fileName: name, webViewLink };
};

/**
 * Hapus file dari Google Drive.
 * @param {string} fileId
 */
const deleteFile = async (fileId) => {
  await drive.files.delete({ fileId });
  logger.info("Drive file deleted", { fileId });
};

/**
 * Ambil metadata file dari Google Drive.
 * @param {string} fileId
 * @returns {{ fileId, fileName, mimeType, size, webViewLink }}
 */
const getFileMetadata = async (fileId) => {
  const response = await drive.files.get({
    fileId,
    fields: "id, name, mimeType, size, webViewLink",
  });

  const { id, name, mimeType, size, webViewLink } = response.data;
  return { fileId: id, fileName: name, mimeType, size, webViewLink };
};

// ============================================================
// CENTER FOLDER
// ============================================================

/**
 * Buat folder center di root Drive folder.
 * Dipanggil oleh super_admin saat membuat center baru.
 * @param {string} centerName
 * @returns {string} ID folder center
 */
const createCenterFolder = async (centerName) => {
  return createFolder(centerName, process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
};

/**
 * Buat folder teacher di dalam folder center.
 * Dipanggil otomatis saat teacher pertama kali login.
 * @param {string} teacherName
 * @param {string} centerFolderId
 * @returns {string} ID folder teacher
 */
const createTeacherFolder = async (teacherName, centerFolderId) => {
  return createFolder(teacherName, centerFolderId);
};

module.exports = {
  createFolder,
  uploadFile,
  deleteFile,
  getFileMetadata,
  createCenterFolder,
  createTeacherFolder,
};
