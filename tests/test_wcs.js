// The WCS maths must agree with astropy (the pipeline stores check points computed by astropy in wcs.json).
const fs = require("fs"), path = require("path"), assert = require("assert");
const WCS = require("../web/js/wcs.js");
const tiles = path.join(__dirname, "..", "web", "tiles");
let n = 0;
for (const r of JSON.parse(fs.readFileSync(path.join(tiles, "regions.json"))).regions) {
  const j = JSON.parse(fs.readFileSync(path.join(tiles, r.id, "wcs.json")));
  if (!j.check_points) continue;
  const w = WCS.make(j); let worst = 0;
  for (const c of j.check_points) {
    const s = w.toSky(c.col, c.row), b = w.toPix(c.ra, c.dec);
    worst = Math.max(worst, Math.hypot((s.ra - c.ra) * Math.cos(c.dec * Math.PI / 180), s.dec - c.dec) * 3600, Math.hypot(b.col - c.col, b.row - c.row) * 6.15);
    n++;
  }
  assert(worst < 0.01, `${r.id}: WCS differs from astropy by ${worst} arcsec`);
  console.log(`  ${r.id}: ${j.check_points.length} check points, worst error ${worst.toExponential(1)} arcsec`);
}
// round trip
const j = JSON.parse(fs.readFileSync(path.join(tiles, "pallas", "wcs.json"))), w = WCS.make(j);
for (const [c, r] of [[0, 0], [1023, 0], [512, 512], [1023, 1023], [100.5, 900.25]]) { const s = w.toSky(c, r), b = w.toPix(s.ra, s.dec); assert(Math.hypot(b.col - c, b.row - r) < 1e-6, "round trip"); }
console.log("wcs ok");
