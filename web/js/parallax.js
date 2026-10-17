// Exact apparent shift of a distant, (nearly) stationary body as seen from the moving Earth.
//
// The body sits at a fixed point P in the Solar System. Earth's heliocentric position E(t) comes from
// tiles/orrery.json (daily, ecliptic AU). At any time the line of sight is u(t) = (P - E(t)) / |P - E(t)|,
// so the apparent position moves as Earth does: a few arcsec per day at 500 AU, hundreds of arcsec over
// six months. Nothing here is a straight-line approximation, so it is right for a 9-day window and for
// two survey passes six months apart alike.
//
// Assumption (stated in the app): the body's own orbital motion is small next to Earth's. Its speed is about
// 1/sqrt(d) of Earth's, so that holds to ~10% beyond 100 AU and ~5% beyond 400 AU.
const Parallax = (() => {
  const D = Math.PI / 180, AS = 206264.806, EPS = 23.4392911 * D;
  let pos = null, mjd0 = 0, days = 0;

  const setData = (o) => { pos = o.bodies.earth.pos; mjd0 = o.mjd0; days = o.days; };
  const ready = () => !!pos;
  const span = () => (pos ? [mjd0, mjd0 + days - 1] : null);

  function earthAt(mjd) {                                        // heliocentric ecliptic AU, linear in time
    if (!pos) return null; const t = mjd - mjd0;
    if (!(t >= 0 && t <= days - 1)) return null;
    const i = Math.min(days - 2, Math.floor(t)), f = t - i, a = pos[i], b = pos[i + 1];
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }
  const eqToEcl = (v) => [v[0], v[1] * Math.cos(EPS) + v[2] * Math.sin(EPS), -v[1] * Math.sin(EPS) + v[2] * Math.cos(EPS)];
  const eclToEq = (v) => [v[0], v[1] * Math.cos(EPS) - v[2] * Math.sin(EPS), v[1] * Math.sin(EPS) + v[2] * Math.cos(EPS)];
  const unitEq = (ra, dec) => [Math.cos(dec * D) * Math.cos(ra * D), Math.cos(dec * D) * Math.sin(ra * D), Math.sin(dec * D)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

  // apparent offset {e, n} in arcsec at time `mjd`, relative to where the body appeared at `mjdRef`,
  // for a body d AU from Earth at mjdRef in direction (ra, dec). null if Earth's position is unknown there.
  function offset(d, mjdRef, mjd, ra, dec) {
    const E0 = earthAt(mjdRef), E1 = earthAt(mjd); if (!E0 || !E1) return null;
    const nEq = unitEq(ra, dec), nEc = eqToEcl(nEq);
    const P = [E0[0] + d * nEc[0], E0[1] + d * nEc[1], E0[2] + d * nEc[2]];
    let u = [P[0] - E1[0], P[1] - E1[1], P[2] - E1[2]]; const L = Math.hypot(u[0], u[1], u[2]); u = u.map((x) => x / L);
    const uq = eclToEq(u), a = ra * D, de = dec * D;
    const east = [-Math.sin(a), Math.cos(a), 0], north = [-Math.sin(de) * Math.cos(a), -Math.sin(de) * Math.sin(a), Math.cos(de)];
    const l = dot(uq, nEq);
    return { e: dot(uq, east) / l * AS, n: dot(uq, north) / l * AS };
  }

  // ---- fit a distance to a measured offset ----------------------------------------------------------
  // meas {e, n} arcsec between positions at mjdA and mjdB; sig = 1-sigma error per axis of that offset.
  // Scans d (log grid) for the best match; reports a 68% range, the goodness of fit and a plain verdict.
  const DMIN = 25, DMAX = 5000;
  function fit(meas, mjdA, mjdB, ra, dec, sig) {
    const M = Math.hypot(meas.e, meas.n), pts = [];
    for (let i = 0; i <= 320; i++) {
      const d = DMIN * Math.pow(DMAX / DMIN, i / 320), o = offset(d, mjdA, mjdB, ra, dec); if (!o) return null;
      const r2 = ((meas.e - o.e) ** 2 + (meas.n - o.n) ** 2) / (sig * sig);
      pts.push({ d, o, r2 });
    }
    let best = pts[0]; for (const p of pts) if (p.r2 < best.r2) best = p;
    const ok = pts.filter((p) => p.r2 <= best.r2 + 1), lo = Math.min(...ok.map((p) => p.d)), hi = Math.max(...ok.map((p) => p.d));
    const oMin = Math.hypot(pts[0].o.e, pts[0].o.n);                 // shift of a body at DMIN: the largest we model
    const o100 = offset(100, mjdA, mjdB, ra, dec), o100m = Math.hypot(o100.e, o100.n);
    const zeroChi2 = (M * M) / (sig * sig);                          // chi^2 of "no motion at all"
    const predAng = Math.atan2(best.o.e, best.o.n) / D, measAng = Math.atan2(meas.e, meas.n) / D;
    let kind;
    if (M < 2 * Math.SQRT2 * sig) kind = "still";                    // under ~2 sigma of total motion
    else if (M > oMin + 3 * sig) kind = "near";                      // faster than anything beyond DMIN can move
    else if (best.r2 <= 6.6) kind = "distant";                       // 99% for the leftover degrees of freedom
    else kind = "misfit";
    return {
      kind, d: best.d, lo, hi, openHi: hi >= DMAX * 0.97, chi2: best.r2, zeroChi2, M, predicted: best.o,
      measAngle: (measAng + 360) % 360, predAngle: (predAng + 360) % 360,
      // smallest distance this baseline can still tell from "no motion" at 2 sigma (shift ~ 1/d)
      limit: o100m * 100 / (2 * Math.SQRT2 * sig),
    };
  }

  // largest distance whose shift over [mjdA, mjdB] still exceeds k*sigma (k = 2 by default)
  function detectLimit(mjdA, mjdB, ra, dec, sig, k = 2) {
    const o = offset(100, mjdA, mjdB, ra, dec); if (!o) return null;
    return Math.hypot(o.e, o.n) * 100 / (k * Math.SQRT2 * sig);
  }

  return { setData, ready, span, earthAt, offset, fit, detectLimit, DMIN, DMAX };
})();
if (typeof module !== "undefined") module.exports = Parallax;
