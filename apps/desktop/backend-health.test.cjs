const assert = require("node:assert/strict");
const test = require("node:test");

const {
  BackendContractError,
  assertCompatibleBackendHealth,
} = require("./dist/backend-health.js");

test("accepts the bundled API contract", () => {
  const health = assertCompatibleBackendHealth({
    apiVersion: "0.1.0",
    contractVersion: 1,
    schemaVersion: 2,
    status: "ok",
  });

  assert.equal(health.schemaVersion, 2);
});

test("rejects a frontend and backend contract mismatch", () => {
  assert.throws(
    () =>
      assertCompatibleBackendHealth({
        apiVersion: "0.2.0",
        contractVersion: 2,
        schemaVersion: 3,
        status: "ok",
      }),
    BackendContractError,
  );
});
