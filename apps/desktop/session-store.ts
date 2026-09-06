const fs = require("node:fs");
const path = require("node:path");

export {};

const SESSION_FILE_VERSION = 2;

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createEncryptedSessionRecord({ token, username, encryptString }) {
  if (typeof encryptString !== "function") {
    throw new TypeError("encryptString must be provided.");
  }

  return {
    encryptedToken: encryptString(token).toString("base64"),
    updatedAt: new Date().toISOString(),
    username,
    version: SESSION_FILE_VERSION,
  };
}

function decryptSessionToken(record, decryptString) {
  if (!record || record.version !== SESSION_FILE_VERSION) {
    throw new Error("Unsupported encrypted session record.");
  }
  if (typeof decryptString !== "function") {
    throw new TypeError("decryptString must be provided.");
  }

  return decryptString(Buffer.from(record.encryptedToken, "base64"));
}

function readSessionRecord(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (record?.version !== SESSION_FILE_VERSION) {
    return null;
  }
  return record;
}

function writeSessionRecord(filePath, record) {
  ensureParentDirectory(filePath);
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify(record, null, 2));
  fs.renameSync(temporaryPath, filePath);
}

function clearSessionRecord(filePath) {
  fs.rmSync(filePath, { force: true });
  fs.rmSync(`${filePath}.tmp`, { force: true });
}

module.exports = {
  SESSION_FILE_VERSION,
  clearSessionRecord,
  createEncryptedSessionRecord,
  decryptSessionToken,
  readSessionRecord,
  writeSessionRecord,
};
