const assert = require("assert");
global.window = {}; global.localStorage = { getItem: () => null, setItem() {} }; global.document = {};
const F = eval(require("fs").readFileSync(require("path").join(__dirname, "..", "web", "js", "flagging.js"), "utf8") + ";Flagging");
const csv = F.toCSV([{ region: "r", frame: "f", band: "D1", epoch: 1, ra: 1.5, dec: -2.25, category: "asteroid", verdict: "moves", note: 'say "hi", ok', created: 0 }]);
const lines = csv.split("\n"); assert.strictEqual(lines.length, 2); assert(lines[1].includes('"say ""hi"", ok"'), "CSV quoting"); assert(lines[1].includes("1.500000,-2.250000"));
assert.strictEqual(F.remote, false);
console.log("flags ok");
