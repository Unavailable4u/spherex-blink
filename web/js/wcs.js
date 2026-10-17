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
      // SVG/canvas drawing coordinates: pixel edges, so the centre of pixel c sits at c + 0.5
      toDraw(ra, dec) { const p = this.toPix(ra, dec); return { x: p.col + 0.5, y: p.row + 0.5 }; },
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
  // J2000 equatorial -> galactic (l, b) and ecliptic latitude/longitude, degrees
  const GM = [[-0.0548755604, -0.8734370902, -0.4838350155], [0.4941094279, -0.4448296300, 0.7469822445], [-0.8676661490, -0.1980763734, 0.4559837762]];
  const unitVec = (ra, dec) => [Math.cos(dec * D) * Math.cos(ra * D), Math.cos(dec * D) * Math.sin(ra * D), Math.sin(dec * D)];
  function galactic(ra, dec) {
    const v = unitVec(ra, dec), g = GM.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
    return { l: ((Math.atan2(g[1], g[0]) / D) % 360 + 360) % 360, b: Math.asin(Math.max(-1, Math.min(1, g[2]))) / D };
  }
  function ecliptic(ra, dec) {
    const e = 23.4392911 * D, v = unitVec(ra, dec), y = v[1] * Math.cos(e) + v[2] * Math.sin(e), z = -v[1] * Math.sin(e) + v[2] * Math.cos(e);
    return { lon: ((Math.atan2(y, v[0]) / D) % 360 + 360) % 360, lat: Math.asin(Math.max(-1, Math.min(1, z))) / D };
  }
  // small-field offset of (ra2,dec2) from (ra1,dec1) in arcsec: {e, n}
  const offset = (ra1, dec1, ra2, dec2) => ({ e: (ra2 - ra1) * Math.cos((dec1 + dec2) / 2 * D) * 3600, n: (dec2 - dec1) * 3600 });
  return { make, hms, dms, galactic, ecliptic, offset };
})();
if (typeof module !== "undefined") module.exports = WCS;
