const { google } = require("googleapis");
const logger = require("./logger");

const privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.replace(
  /\\n/g,
  "\n",
);

if (!privateKey) {
  logger.error("GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not set.");
  process.exit(1);
}

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: privateKey,
  },
  scopes: ["https://www.googleapis.com/auth/drive"],
});

let _drive = null;

const getDrive = () => {
  if (!_drive) {
    _drive = google.drive({ version: "v3", auth });
  }
  return _drive;
};

module.exports = { getDrive };
