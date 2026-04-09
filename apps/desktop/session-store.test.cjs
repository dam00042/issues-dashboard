const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  clearSessionRecord,
  createEncryptedSessionRecord,
  decryptSessionToken,
  readSessionRecord,
  writeSessionRecord,
} = require("./session-store.cjs");

test("encrypts and decrypts a GitHub token", () => {
  const record = createEncryptedSessionRecord({
    token: "ghp_super_secret",
    username: "octocat",
    wrapKey: (value) => ({
      protection: "plaintext-test",
      value,
    }),
  });

  const token = decryptSessionToken(record, ({ value }) => value);

  assert.equal(token, "ghp_super_secret");
  assert.equal(record.username, "octocat");
});

test("reads, writes and clears the encrypted session record", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "issues-dashboard-session-"),
  );
  const sessionFilePath = path.join(temporaryDirectory, "session.json");
  const record = createEncryptedSessionRecord({
    token: "ghp_file_secret",
    username: "dam00042",
    wrapKey: (value) => ({
      protection: "plaintext-test",
      value,
    }),
  });

  writeSessionRecord(sessionFilePath, record);

  const persistedRecord = readSessionRecord(sessionFilePath);
  const token = decryptSessionToken(persistedRecord, ({ value }) => value);

  assert.equal(token, "ghp_file_secret");
  assert.equal(persistedRecord?.username, "dam00042");

  clearSessionRecord(sessionFilePath);

  assert.equal(readSessionRecord(sessionFilePath), null);
});
