const { getDrive } = require("../config/drive");
const { Readable } = require("stream");
const logger = require("../config/logger");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const withRetry = async (fn, retries = 3, baseDelay = 500) => {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isLast = attempt === retries;
      const statusCode = err.code ?? err.status ?? err.response?.status;
      const isRetryable =
        statusCode === 429 || (statusCode >= 500 && statusCode < 600);

      if (isLast || !isRetryable) {
        throw err;
      }

      const delay = baseDelay * 2 ** attempt;
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

const createFolder = async (name, parentFolderId) => {
  const drive = getDrive();

  const response = await withRetry(() =>
    drive.files.create({
      requestBody: {
        name,
        mimeType: "application/vnd.google-apps.folder",
        parents: [parentFolderId],
      },
      supportsAllDrives: true,
      fields: "id",
    }),
  );

  const folderId = response.data.id;
  logger.info("Drive folder created", { name, parentFolderId, folderId });
  return folderId;
};

const uploadFile = async ({ buffer, fileName, mimeType, folderId }) => {
  const drive = getDrive();

  const response = await withRetry(() => {
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
      supportsAllDrives: true,
      fields: "id, name, webViewLink",
    });
  });

  const { id: fileId, name, webViewLink } = response.data;

  logger.info("Drive file uploaded", { fileId, fileName: name, folderId });

  return { fileId, fileName: name, webViewLink };
};

const downloadFile = async (fileId) => {
  const drive = getDrive();

  const response = await withRetry(() =>
    drive.files.get(
      {
        fileId,
        alt: "media",
        supportsAllDrives: true,
      },
      { responseType: "arraybuffer" },
    ),
  );

  const buffer = Buffer.from(response.data);
  logger.info("Drive file downloaded", { fileId, size: buffer.length });
  return buffer;
};

const deleteFile = async (fileId) => {
  const drive = getDrive();
  await withRetry(() =>
    drive.files.delete({
      fileId,
      supportsAllDrives: true,
    }),
  );
  logger.info("Drive file deleted", { fileId });
};

const getFileMetadata = async (fileId) => {
  const drive = getDrive();

  const response = await withRetry(() =>
    drive.files.get({
      fileId,
      supportsAllDrives: true,
      fields: "id, name, mimeType, size, webViewLink",
    }),
  );

  const { id, name, mimeType, size, webViewLink } = response.data;
  return { fileId: id, fileName: name, mimeType, size, webViewLink };
};

const findFolderByName = async (name, parentFolderId) => {
  const drive = getDrive();

  const response = await withRetry(() =>
    drive.files.list({
      q: `name = '${name.replace(/'/g, "\\'")}' and '${parentFolderId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      fields: "files(id, name)",
      pageSize: 1,
    }),
  );

  const files = response.data.files ?? [];
  return files.length > 0 ? files[0].id : null;
};

const createCenterFolder = async (centerName) => {
  return createFolder(centerName, process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID);
};

const createTeacherFolder = async (teacherName, centerFolderId) => {
  return createFolder(teacherName, centerFolderId);
};

module.exports = {
  createFolder,
  uploadFile,
  downloadFile,
  deleteFile,
  getFileMetadata,
  findFolderByName,
  createCenterFolder,
  createTeacherFolder,
};
