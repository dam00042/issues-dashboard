const { runPython } = require("./python-runtime.cjs");

try {
  runPython(process.argv.slice(2));
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
