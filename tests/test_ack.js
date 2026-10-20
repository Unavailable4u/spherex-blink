// Non-fatal check: warns until web/assets/acknowledgement.txt holds IRSA's exact SPHEREx acknowledgement
// (copy it from the Acknowledgement row at https://irsa.ipac.caltech.edu/Missions/spherex.html).
const fs = require("fs"), path = require("path");
const t = fs.readFileSync(path.join(__dirname, "..", "web", "assets", "acknowledgement.txt"), "utf8");
const need = ["This publication makes use of data products from the Spectro-Photometer for the History of the Universe, Epoch of Reionization and Ices Explorer (SPHEREx)", "Jet Propulsion Laboratory", "California Institute of Technology", "National Aeronautics and Space Administration", "10.26131/IRSA652"];
const missing = need.filter((p) => !t.includes(p));
if (missing.length) console.log("  WARNING: acknowledgement.txt is not yet IRSA's exact wording. Missing: " + missing.map((m) => m.slice(0, 40) + "...").join(" | "));
else console.log("  acknowledgement ok");
