// Canvas imagery layer: tile cache, no-data masks, crossfade, blink, A+B overlay, and pixel analysis.
//
// A "tile" is one 8-bit greyscale PNG decoded once into:
//   gray  Uint8Array (w*h)   exact grey levels, used for readout / centroiding / persistence tests
//   nd    Uint8Array (w*h)   1 where the tile has NO DATA (outside the exposure footprint)
//   cv    canvas             the picture: grey where there is data, transparent where there is none
//                            (the page paints a hatch behind the canvas, so a gap reads as "no coverage")
//
// Zero is both "no data" and "darker than the stretch floor", so a no-data region is a zero area that
// survives a 5x5 morphological opening: isolated dark pixels (about 1% of valid pixels) are kept as data.
const Renderer = (() => {
  let cv, ctx, shown = null, raf = 0, timer = null, rate = 3;
  const cache = new Map();
  const pairCache = new Map();

  function init(canvas) { cv = canvas; ctx = cv.getContext("2d"); }
  function resize(w, h) { cv.width = w; cv.height = h; ctx.imageSmoothingEnabled = false; shown = null; }

  // ---- morphology on a binary mask (box structuring element, separable) ----
  function boxFilter(src, w, h, r, wantMin) {
    const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h), k = wantMin ? 1 : 0;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let v = k;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx; const s = xx < 0 || xx >= w ? (wantMin ? 1 : 0) : src[row + xx];   // outside counts as "same as the edge" for erosion
          if (wantMin ? s === 0 : s === 1) { v = wantMin ? 0 : 1; break; }
        }
        tmp[row + x] = v;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = k;
        for (let dy = -r; dy <= r; dy++) {
          const yy = y + dy; const s = yy < 0 || yy >= h ? (wantMin ? 1 : 0) : tmp[yy * w + x];
          if (wantMin ? s === 0 : s === 1) { v = wantMin ? 0 : 1; break; }
        }
        out[y * w + x] = v;
      }
    }
    return out;
  }

  function decode(img, url) {
    const w = img.naturalWidth, h = img.naturalHeight, c = document.createElement("canvas"); c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(img, 0, 0);
    const px = x.getImageData(0, 0, w, h), d = px.data, gray = new Uint8Array(w * h), zero = new Uint8Array(w * h);
    let nz = 0;
    for (let i = 0; i < w * h; i++) { const g = d[i * 4]; gray[i] = g; if (g === 0) { zero[i] = 1; nz++; } }
    let nd;
    if (nz > 25) nd = boxFilter(boxFilter(zero, w, h, 2, true), w, h, 2, false);    // opening: erode then dilate
    else nd = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) { const g = gray[i]; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = g; d[i * 4 + 3] = nd[i] ? 0 : 255; }
    x.putImageData(px, 0, 0);
    let ndc = 0; for (let i = 0; i < w * h; i++) ndc += nd[i];
    return { url, w, h, gray, nd, cv: c, cov: 1 - ndc / (w * h) };
  }

  function load(url) {
    if (!cache.has(url)) cache.set(url, new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => { try { res(decode(im, url)); } catch (e) { cache.delete(url); rej(e); } };
      im.onerror = () => { cache.delete(url); rej(new Error("missing tile " + url)); };
      im.src = url;
    }));
    return cache.get(url);
  }

  const paint = (src, a = 1) => { ctx.globalAlpha = a; ctx.drawImage(src, 0, 0); ctx.globalAlpha = 1; };
  const surface = (t) => (t && t.cv) || t;          // a tile, or a ready-made canvas from pair()

  function draw(t) { cancelAnimationFrame(raf); ctx.clearRect(0, 0, cv.width, cv.height); if (t) paint(surface(t)); shown = t; }

  // draw the old picture, then ramp the new one in over `ms`
  function fadeTo(t, ms = 250) {
    cancelAnimationFrame(raf);
    const old = shown; shown = t;
    if (!old || old === t) return draw(t);
    const t0 = performance.now();
    const step = (now) => {
      const a = Math.min(1, (now - t0) / ms);
      ctx.clearRect(0, 0, cv.width, cv.height); paint(surface(old)); paint(surface(t), a);
      if (a < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // ---- A/B pair: both pictures share one footprint so only real differences flash ----
  const AMBER = [1.0, 0.62, 0.22], CYAN = [0.2, 0.74, 1.0];
  function pair(A, B, { common = true, overlay = false } = {}) {
    const key = [A.url, B.url, common ? 1 : 0, overlay ? 1 : 0].join("|");
    if (pairCache.has(key)) return pairCache.get(key);
    const w = A.w, h = A.h, n = w * h;
    const nd = new Uint8Array(n); let k = 0;
    for (let i = 0; i < n; i++) { const m = common ? (A.nd[i] | B.nd[i]) : 0; nd[i] = m; k += m; }
    const mk = () => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; };
    const out = { overlap: 1 - k / n };
    if (overlay) {
      const c = mk(), x = c.getContext("2d"), px = x.createImageData(w, h), d = px.data;
      for (let i = 0; i < n; i++) {
        const a = A.gray[i], b = B.gray[i], o = i * 4, hole = common ? nd[i] : (A.nd[i] & B.nd[i]);
        d[o] = Math.min(255, a * AMBER[0] + b * CYAN[0]); d[o + 1] = Math.min(255, a * AMBER[1] + b * CYAN[1]); d[o + 2] = Math.min(255, a * AMBER[2] + b * CYAN[2]);
        d[o + 3] = hole ? 0 : 255;
      }
      x.putImageData(px, 0, 0); out.O = c;
    } else {
      const side = (T) => {
        const c = mk(), x = c.getContext("2d"), px = x.createImageData(w, h), d = px.data;
        for (let i = 0; i < n; i++) { const g = T.gray[i], o = i * 4; d[o] = d[o + 1] = d[o + 2] = g; d[o + 3] = (common ? nd[i] : T.nd[i]) ? 0 : 255; }
        x.putImageData(px, 0, 0); return c;
      };
      out.A = side(A); out.B = side(B);
    }
    if (pairCache.size > 8) pairCache.delete(pairCache.keys().next().value);
    pairCache.set(key, out); return out;
  }

  // fraction of the field with valid data in both tiles (cheap: no canvases)
  function overlap(A, B) { const n = A.w * A.h; let k = 0; for (let i = 0; i < n; i++) k += A.nd[i] | B.nd[i]; return 1 - k / n; }

  // ---- blink: alternate two pictures at `hz` ----
  function startBlink(getA, getB, hz) {
    stopBlink(); if (hz) rate = hz; let flip = false;
    const tick = () => { flip = !flip; const s = flip ? getB() : getA(); if (s) draw(s); };
    tick(); timer = setInterval(tick, 1000 / (2 * rate));
  }
  function stopBlink() { clearInterval(timer); timer = null; }
  const blinking = () => timer !== null;
  const setRate = (hz) => { rate = hz; };

  // ---- pixel analysis on the exact grey levels ----
  const at = (t, c, r) => (c < 0 || r < 0 || c >= t.w || r >= t.h ? 0 : t.gray[r * t.w + c]);
  const value = (t, col, row) => at(t, col, row);

  // robust local background: median and MAD of a (2r+1)^2 window
  function localStats(t, c, r, rad = 30) {
    const v = [];
    for (let y = Math.max(0, r - rad); y <= Math.min(t.h - 1, r + rad); y += 2)
      for (let x = Math.max(0, c - rad); x <= Math.min(t.w - 1, c + rad); x += 2) if (!t.nd[y * t.w + x]) v.push(t.gray[y * t.w + x]);
    if (v.length < 20) return null;
    v.sort((a, b) => a - b); const med = v[v.length >> 1];
    const dev = v.map((q) => Math.abs(q - med)).sort((a, b) => a - b);
    return { med, sig: Math.max(1.5, 1.4826 * dev[dev.length >> 1]) };
  }

  // snap a click to the centroid of the source under it. Returns null if nothing stands out.
  function snap(t, col, row, search = 3) {
    const ci = Math.round(col), ri = Math.round(row), st = localStats(t, ci, ri);
    if (!st) return null;
    let best = -1, bc = ci, br = ri;
    for (let y = ri - search; y <= ri + search; y++) for (let x = ci - search; x <= ci + search; x++) {
      if (x < 1 || y < 1 || x >= t.w - 1 || y >= t.h - 1) continue;
      let s = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) s += at(t, x + i, y + j);
      s /= 9; if (s > best) { best = s; bc = x; br = y; }
    }
    if (best < st.med + 5 * st.sig) return null;
    const half = 4; let sw = 0, sx = 0, sy = 0; const lo = [];
    for (let y = br - half; y <= br + half; y++) for (let x = bc - half; x <= bc + half; x++) lo.push(at(t, x, y));
    lo.sort((a, b) => a - b); const bkg = lo[Math.floor(lo.length * 0.2)];
    for (let y = br - half; y <= br + half; y++) for (let x = bc - half; x <= bc + half; x++) { const w = Math.max(0, at(t, x, y) - bkg); sw += w; sx += w * x; sy += w * y; }
    if (sw <= 0) return null;
    return { col: sx / sw, row: sy / sw, peak: at(t, bc, br), snr: (best - st.med) / st.sig };
  }

  // Is the source we expect (a star that is `expected` grey levels bright in this tile) at (col,row)?
  //   1 = yes, 0 = no, 2 = something fainter than a star would be, -1 = no data / no way to tell.
  // With expected = 0 this is a plain "is there anything there" test at k sigma.
  function sourceAt(t, col, row, rad = 3, k = 5, expected = 0) {
    const ci = Math.round(col), ri = Math.round(row);
    if (ci < 4 || ri < 4 || ci >= t.w - 4 || ri >= t.h - 4) return -1;
    if (t.nd[ri * t.w + ci]) return -1;
    const st = localStats(t, ci, ri); if (!st) return -1;
    let pk = 0; for (let y = ri - rad; y <= ri + rad; y++) for (let x = ci - rad; x <= ci + rad; x++) pk = Math.max(pk, at(t, x, y));
    const ex = pk - st.med, floor = k * st.sig;
    if (!expected) return ex > floor ? 1 : 0;
    if (ex >= Math.max(floor, 0.5 * expected)) return 1;           // about as bright as a star there should be
    if (ex < Math.max(floor, 0.25 * expected)) return 0;           // far too faint to be it
    return 2;
  }

  // typical brightness of a star in tile B relative to the same star in tile A (median over bright, unsaturated,
  // compact sources). Sensitivity and wavelength differ between frames, so "the same star" is not equally bright.
  const ratioCache = new Map();
  function fluxRatio(A, B) {
    const key = A.url + "|" + B.url; if (ratioCache.has(key)) return ratioCache.get(key);
    const rs = []; let seen = 0;
    for (let y = 40; y < A.h - 40 && seen < 400; y += 5) for (let x = 40; x < A.w - 40 && seen < 400; x += 5) {
      const g = A.gray[y * A.w + x]; if (g < 40 || g > 245 || A.nd[y * A.w + x] || B.nd[y * A.w + x]) continue;
      let ok = true; for (let j = -2; j <= 2 && ok; j++) for (let i = -2; i <= 2; i++) if (at(A, x + i, y + j) > g) { ok = false; break; }   // local maximum only
      if (!ok) continue; seen++;
      const sa = localStats(A, x, y), sb = localStats(B, x, y); if (!sa || !sb) continue;
      let pb = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) pb = Math.max(pb, at(B, x + i, y + j));
      const ea = g - sa.med; if (ea > 10) rs.push(Math.max(0, pb - sb.med) / ea);
    }
    let q = 1; if (rs.length >= 8) { rs.sort((a, b) => a - b); q = rs[rs.length >> 1]; }
    q = Math.min(2, Math.max(0.1, q)); ratioCache.set(key, q); return q;
  }

  // brightness of whatever is at (col,row): peak within 3 px minus the local background, in grey levels
  function excess(t, col, row) {
    const ci = Math.round(col), ri = Math.round(row), st = localStats(t, ci, ri); if (!st) return 0;
    let pk = 0; for (let y = ri - 3; y <= ri + 3; y++) for (let x = ci - 3; x <= ci + 3; x++) pk = Math.max(pk, at(t, x, y));
    return Math.max(0, pk - st.med);
  }

  // how many pixels of the 3x3 around the brightest pixel near (col,row) stand out (>3 sigma)?
  // A real source has a point-spread function a couple of pixels wide; a cosmic-ray hit or hot pixel is one pixel.
  function compactness(t, col, row) {
    const ci = Math.round(col), ri = Math.round(row), st = localStats(t, ci, ri); if (!st) return 0;
    let bx = ci, by = ri, bv = -1;
    for (let y = ri - 3; y <= ri + 3; y++) for (let x = ci - 3; x <= ci + 3; x++) { const g = at(t, x, y); if (g > bv) { bv = g; bx = x; by = y; } }
    let n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) if (at(t, bx + i, by + j) > st.med + 3 * st.sig) n++;
    return n;
  }

  // soft halo around the brightest pixel: mean of the ring 2-3 px out, relative to the peak (background removed).
  // Stars have a point-spread halo (about 0.03 on these tiles); a cosmic-ray hit has hard edges (about 0.003).
  // The two overlap for faint sources, so this is a hint, never proof.
  function halo(t, col, row) {
    const ci = Math.round(col), ri = Math.round(row), v = [];
    for (let y = ri - 6; y <= ri + 6; y++) for (let x = ci - 6; x <= ci + 6; x++) v.push(at(t, x, y));
    v.sort((a, b) => a - b); const bkg = v[v.length >> 1];
    let bx = ci, by = ri, bv = -1;
    for (let y = ri - 3; y <= ri + 3; y++) for (let x = ci - 3; x <= ci + 3; x++) { const g = at(t, x, y); if (g > bv) { bv = g; bx = x; by = y; } }
    let pk = 0; for (let y = by - 2; y <= by + 2; y++) for (let x = bx - 2; x <= bx + 2; x++) pk = Math.max(pk, at(t, x, y));
    pk -= bkg; if (pk <= 0) return null;
    let s = 0, n = 0;
    for (let y = by - 3; y <= by + 3; y++) for (let x = bx - 3; x <= bx + 3; x++) { const d = Math.max(Math.abs(x - bx), Math.abs(y - by)); if (d >= 2) { s += at(t, x, y); n++; } }
    return (s / n - bkg) / pk;
  }

  return { init, resize, load, draw, fadeTo, pair, overlap, startBlink, stopBlink, blinking, setRate, value, snap, sourceAt, fluxRatio, excess, compactness, halo, localStats };
})();
if (typeof module !== "undefined") module.exports = Renderer;
