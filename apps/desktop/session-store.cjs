const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const nacl = require("tweetnacl");

const SESSION_FILE_VERSION = 1;

function toBase64(value) {
  return Buffer.from(value).toString("base64");
}

function fromBase64(value) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function ensureParentDirectory(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function createEncryptedSessionRecord({
  token,
  username,
  wrapKey,
  generateRandomBytes = crypto.randomBytes,
}) {
  const masterKey = generateRandomBytes(nacl.secretbox.keyLength);
  const nonce = generateRandomBytes(nacl.secretbox.nonceLength);
  const wrappedKey = wrapKey(toBase64(masterKey));
  const encryptedToken = nacl.secretbox(
    new Uint8Array(Buffer.from(token, "utf8")),
    new Uint8Array(nonce),
    new Uint8Array(masterKey),
  );

  return {
    encryptedToken: toBase64(encryptedToken),
    nonce: toBase64(nonce),
    protection: wrappedKey.protection,
    updatedAt: new Date().toISOString(),
    username,
    version: SESSION_FILE_VERSION,
    wrappedMasterKey: wrappedKey.value,
  };
}

function decryptSessionToken(record, unwrapKey) {
  if (!record || record.version !== SESSION_FILE_VERSION) {
    throw new Error("Unsupported encrypted session record.");
  }

  const masterKey = fromBase64(
    unwrapKey({
      protection: record.protection,
      value: record.wrappedMasterKey,
    }),
  );
  const nonce = fromBase64(record.nonce);
  const encryptedToken = fromBase64(record.encryptedToken);
  const decryptedToken = nacl.secretbox.open(encryptedToken, nonce, masterKey);

  if (!decryptedToken) {
    throw new Error("Unable to decrypt the stored GitHub token.");
  }

  return Buffer.from(decryptedToken).toString("utf8");
}

function readSessionRecord(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeSessionRecord(filePath, record) {
  ensureParentDirectory(filePath);
  fs.writeFileSync(filePath, JSON.stringify(record, null, 2));
}

function clearSessionRecord(filePath) {
  fs.rmSync(filePath, { force: true });
}

module.exports = {
  clearSessionRecord,
  createEncryptedSessionRecord,
  decryptSessionToken,
  readSessionRecord,
  writeSessionRecord,
};
