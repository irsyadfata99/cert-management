// [FIX] Sebelumnya kemungkinan: const drive = require("../config/drive")
// atau const { getDrive } = require("../config/drive") tapi drive.js belum export getDrive.
// Sekarang drive.js sudah export getDrive() — import disesuaikan.
const { getDrive } = require("../config/drive");
const { Readable } = require("stream");
const logger = require("../config/logger");

// ============================================================
// RETRY HELPER — exponential backoff
// ============================================================

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Jalankan fn dengan retry + exponential backoff.
 * Hanya retry untuk error yang bersifat transient (429, 5xx).
 *
 * @param {Function} fn        - Async function yang akan dijalankan
 * @param {number}   retries   - Maksimal jumlah retry (default: 3)
 * @param {number}   baseDelay - Delay awal dalam ms (default: 500)
 * @returns {Promise<any>}
 */
const withRetry = async (fn, retries = 3, baseDelay = 500) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === retries;
      const statusCode = err.code ?? err.status ?? err.response?.status;
      const isRetryable = statusCode === 429 || (statusCode >= 500 && statusCode < 600);

      if (isLast || !isRetryable) {
        throw err;
      }

      const delay = baseDelay * 2 ** attempt; // 500, 1000, 2000 ms
      logger.warn("Drive API error, retrying...", {
        attempt: attempt + 1,
        retries,
        statusCode,
        error: err.message,
        delayMs: delay,
      });

      await sleep(delay);
    }
  }
};

// ============================================================
// FOLDER OPERATIONS
// ============================================================

/**
 * Buat folder baru di Google Drive.
 */
const createFolder = async (name, parentFolderId) => {
  const drive = getDrive();

  const response = await withRetry(() =>
    drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      },
      fields: "id",
    }),
  );

  const folderId = response.data.id;
  logger.info("Drive folder created", { name, parentFolderId, folderId });
  return folderId;
};

// ============================================================
// FILE OPERATIONS
// ============================================================

/**
 * Upload file ke Google Drive.
 */
const uploadFile = async ({ buffer, fileName, mimeType, folderId }) => {
  const drive = getDrive();

  const response = await withRetry(() => {
    // Buat Readable baru di setiap attempt agar stream tidak habis
    const readable = Readable.from(buffer);

    return drive.files.create({
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
  });

  const { id: fileId, name, webViewLink } = response.data;

  logger.info("Drive file uploaded", { fileId, fileName: name, folderId });

  return { fileId, fileName: name, webViewLink };
};

/**
 * Hapus file dari Google Drive.
 */
const deleteFile = async (fileId) => {
  const drive = getDrive();
  await withRetry(() => drive.files.delete({ fileId }));
  logger.info("Drive file deleted", { fileId });
};

/**
 * Ambil metadata file dari Google Drive.
 */
const getFileMetadata = async (fileId) => {
  const drive = getDrive();

  const response = await withRetry(() =>
    drive.files.get({
      fileId,
      fields: "id, name, mimeType, size, webViewLink",
    }),
  );

  const { id, name, mimeType, size, webViewLink } = response.data;
  return { fileId: id, fileName: name, mimeType, size, webViewLink };
};

// ============================================================
// CENTER FOLDER
// ============================================================

const createCenterFolder = async (centerName) => {
  return createFolder(centerName, process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
};

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
