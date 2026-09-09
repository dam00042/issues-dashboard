const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const {
  clearSessionRecord,
  createEncryptedSessionRecord,
  decryptSessionToken,
  readSessionRecord,
  writeSessionRecord,
} = require("./session-store.ts");

function encryptString(value) {
  return Buffer.from(value.split("").reverse().join(""), "utf8");
}

function decryptString(value) {
  return Buffer.from(value).toString("utf8").split("").reverse().join("");
}

test("encrypts and decrypts a GitHub token through safe-storage adapters", () => {
  const record = createEncryptedSessionRecord({
    encryptString,
    token: "ghp_example_token",
    username: "octocat",
  });

  assert.equal(decryptSessionToken(record, decryptString), "ghp_example_token");
  assert.equal(record.username, "octocat");
  assert.equal(record.version, 2);
});

test("persists and clears the current session record atomically", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "issues-dashboard-session-"),
  );
  const sessionPath = path.join(temporaryDirectory, "session.json");
  const record = createEncryptedSessionRecord({
    encryptString,
    token: "ghp_example_token",
    username: "octocat",
  });

  writeSessionRecord(sessionPath, record);
  assert.equal(readSessionRecord(sessionPath)?.username, "octocat");
  clearSessionRecord(sessionPath);
  assert.equal(readSessionRecord(sessionPath), null);
});

test("rejects obsolete session formats instead of keeping a legacy fallback", () => {
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "issues-dashboard-session-"),
  );
  const sessionPath = path.join(temporaryDirectory, "session.json");
  fs.writeFileSync(sessionPath, JSON.stringify({ version: 1 }));

  assert.equal(readSessionRecord(sessionPath), null);
});
