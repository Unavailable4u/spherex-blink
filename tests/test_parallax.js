// Exact parallax must (a) vanish at the reference time, (b) agree with the independent reflex-velocity integral
// computed by solar_system.py over the real 9-day window, (c) recover a known distance from a synthetic measurement,
// (d) classify a fast mover as "near" and a motionless source as "still".
const fs = require("fs"), path = require("path"), assert = require("assert");
const P = require("../web/js/parallax.js");
const root = path.join(__dirname, "..", "web", "tiles");
P.setData(JSON.parse(fs.readFileSync(path.join(root, "orrery.json"))));
const sky = JSON.parse(fs.readFileSync(path.join(root, "pallas", "sky.json")));
const man = JSON.parse(fs.readFileSync(path.join(root, "pallas", "manifest.json")));
const fr = man.frames.filter((f) => sky.frames[f.id]).sort((a, b) => a.mjd - b.mjd);
const { ra, dec } = sky.field, f0 = fr[0], f1 = fr[fr.length - 1];

const z = P.offset(500, f0.mjd, f0.mjd, ra, dec); assert(Math.hypot(z.e, z.n) < 1e-6, "zero at reference time");

let cum = [0, 0]; for (let i = 1; i < fr.length; i++) { const a = sky.frames[fr[i - 1].id], b = sky.frames[fr[i].id], dt = (fr[i].mjd - fr[i - 1].mjd) * 24; cum[0] += 0.5 * (a.reflex[0] + b.reflex[0]) * dt; cum[1] += 0.5 * (a.reflex[1] + b.reflex[1]) * dt; }
for (const d of [100, 500, 1000]) {
  const o = P.offset(d, f0.mjd, f1.mjd, ra, dec), ratio = Math.hypot(o.e, o.n) / (Math.hypot(cum[0], cum[1]) / d);
  assert(Math.abs(ratio - 1) < 0.01, `parallax vs reflex at ${d} AU: ratio ${ratio}`);
}
for (const dTrue of [60, 200, 500, 700]) {
  const o = P.offset(dTrue, f0.mjd, f1.mjd, ra, dec), r = P.fit(o, f0.mjd, f1.mjd, ra, dec, 3.5);
  assert(r.kind === "distant" && Math.abs(r.d / dTrue - 1) < 0.03 && r.lo <= dTrue * 1.01 && r.hi >= dTrue * 0.99, `fit ${dTrue}: ${JSON.stringify(r)}`);
}
const six = P.offset(500, f0.mjd, f0.mjd + 182, ra, dec); assert(Math.hypot(six.e, six.n) > 20 * Math.hypot(...Object.values(P.offset(500, f0.mjd, f1.mjd, ra, dec))), "six months shifts far more");
const t = sky.target, a = fr.find((f) => f.id === "2025-10-07_2337"), b = fr.find((f) => f.id === "2025-10-14_1028");
const WCSm = require("../web/js/wcs.js"); const o = WCSm.offset(...t[a.id], ...t[b.id]);
assert(P.fit(o, a.mjd, b.mjd, t[a.id][0], t[a.id][1], 3.5).kind === "near", "Pallas is nearby");
assert(P.fit({ e: 1, n: -1 }, f0.mjd, f1.mjd, ra, dec, 3.5).kind === "still", "no motion is still");
assert(P.offset(500, f0.mjd, 1e9, ra, dec) === null, "outside the Earth table returns null");
console.log("parallax ok");
