// TAN projection for the ONE shared grid of a region (see tiles/<region>/wcs.json).
// PNG (col,row): 0-based, row 0 = top.  FITS pixel: x = col+1, y = height-row (1-based).
const WCS = (() => {
  const D = Math.PI / 180;
  function make(j) {
    const [a0, d0] = [j.crval[0] * D, j.crval[1] * D];
    const [px, py] = j.crpix, [sx, sy] = j.cdelt;
    const sd0 = Math.sin(d0), cd0 = Math.cos(d0);
    return {
      width: j.width, height: j.height,
      toSky(col, row) {
        const xi = sx * D * (col + 1 - px), eta = sy * D * (j.height - row - py);
        const r = Math.hypot(xi, eta), c = Math.atan(r);
        const sc = Math.sin(c), cc = Math.cos(c);
        const dec = Math.asin(cc * sd0 + (r ? eta * sc * cd0 / r : 0));
        const ra = a0 + Math.atan2(xi * sc, r * cd0 * cc - eta * sd0 * sc);
        return { ra: ((ra / D) % 360 + 360) % 360, dec: dec / D };
      },
      toPix(ra, dec) {
        const a = ra * D, d = dec * D, da = a - a0;
        const cc = sd0 * Math.sin(d) + cd0 * Math.cos(d) * Math.cos(da);
        const xi = Math.cos(d) * Math.sin(da) / cc;
        const eta = (cd0 * Math.sin(d) - sd0 * Math.cos(d) * Math.cos(da)) / cc;
        return { col: xi / (sx * D) + px - 1, row: j.height - (eta / (sy * D) + py) };
      },
    };
  }
  const hms = (ra) => { const h = ra / 15, m = (h % 1) * 60; return `${String(Math.floor(h)).padStart(2, "0")}h ${String(Math.floor(m)).padStart(2, "0")}m ${((m % 1) * 60).toFixed(1).padStart(4, "0")}s`; };
  const dms = (dec) => { const s = dec < 0 ? "-" : "+", a = Math.abs(dec), m = (a % 1) * 60; return `${s}${String(Math.floor(a)).padStart(2, "0")}° ${String(Math.floor(m)).padStart(2, "0")}′ ${((m % 1) * 60).toFixed(1).padStart(4, "0")}″`; };
  return { make, hms, dms };
})();
if (typeof module !== "undefined") module.exports = WCS;
