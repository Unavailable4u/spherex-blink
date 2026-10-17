// node tests/run.js : all unit tests (no browser needed)
const { execFileSync } = require("child_process"), path = require("path");
for (const t of ["test_wcs.js", "test_parallax.js", "test_flags.js"]) { console.log("\u25b6 " + t); execFileSync(process.execPath, [path.join(__dirname, t)], { stdio: "inherit" }); }
console.log("\nall unit tests passed");
