// Figure furniture: RA/Dec rulers, compass, scale bar, live caption, timeline ticks, slider fill.
// Pure presentation: reads App.S / App.view and the region WCS, never changes them.
(() => {
  const $ = (id) => document.getElementById(id);
  const A = () => window.App;
  const viewer = $("viewer"), top = $("axTop"), left = $("axLeft");

  // 1-2-5 step giving roughly `target` ticks across `span`
  function nice(span, target) {
    const raw = span / target, p = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / p;
    const n = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
    return { step: n * p, minors: n === 2 ? 4 : 5 };
  }
  const dec = (step) => Math.max(0, Math.ceil(-Math.log10(step) - 1e-9));
  const mod360 = (v) => ((v % 360) + 360) % 360;

  function ticks(v0, v1, len, target) {            // value at pixel 0 -> v0, at pixel len -> v1 (linear)
    const span = Math.abs(v1 - v0), { step, minors } = nice(span, target), lo = Math.min(v0, v1), hi = Math.max(v0, v1);
    const out = { major: [], minor: [], d: dec(step) };
    const sub = step / minors;
    for (let v = Math.ceil(lo / sub - 1e-9) * sub; v <= hi + 1e-9; v += sub) {
      const k = Math.round(v / step), isMajor = Math.abs(v - k * step) < sub * 0.01;
      (isMajor ? out.major : out.minor).push({ v: isMajor ? k * step : v, p: (v - v0) / (v1 - v0) * len });
    }
    return out;
  }

  function rulers() {
    const a = A(); if (!a || !a.S.wcs) return;
    const W = viewer.clientWidth, H = viewer.clientHeight, { s, tx, ty } = a.view, w = a.S.wcs;
    if (!W) return;
    const c0 = (0 - tx) / s / W * w.width, c1 = (W - tx) / s / W * w.width;
    const r0 = (0 - ty) / s / H * w.height, r1 = (H - ty) / s / H * w.height;
    const th = top.clientHeight || 30, lw = left.clientWidth || 58;

    let ra0 = w.toSky(c0 - .5, r0 - .5).ra, ra1 = w.toSky(c1 - .5, r0 - .5).ra;
    if (ra1 - ra0 > 180) ra1 -= 360; else if (ra1 - ra0 < -180) ra1 += 360;
    const tr = ticks(ra0, ra1, W, W / 118);
    let h = `<line class="base" x1="0" x2="${W}" y1="${th - .5}" y2="${th - .5}"/>`;
    for (const t of tr.minor) h += `<line class="min" x1="${t.p}" x2="${t.p}" y1="${th - 4}" y2="${th}"/>`;
    for (const t of tr.major) {
      h += `<line class="maj" x1="${t.p}" x2="${t.p}" y1="${th - 8}" y2="${th}"/>`;
      if (t.p > 20 && t.p < W - 20) h += `<text x="${t.p}" y="${th - 12}" text-anchor="middle">${mod360(t.v).toFixed(tr.d)}\u00b0</text>`;
    }
    top.setAttribute("viewBox", `0 0 ${W} ${th}`); top.innerHTML = h;

    const d0 = w.toSky(c0 - .5, r0 - .5).dec, d1 = w.toSky(c0 - .5, r1 - .5).dec;
    const tl = ticks(d0, d1, H, H / 100);
    h = `<line class="base" x1="${lw - .5}" x2="${lw - .5}" y1="0" y2="${H}"/>`;
    for (const t of tl.minor) h += `<line class="min" y1="${t.p}" y2="${t.p}" x1="${lw - 4}" x2="${lw}"/>`;
    for (const t of tl.major) {
      h += `<line class="maj" y1="${t.p}" y2="${t.p}" x1="${lw - 8}" x2="${lw}"/>`;
      if (t.p > 10 && t.p < H - 10) h += `<text x="${lw - 12}" y="${t.p}" dy=".32em" text-anchor="end">${(t.v < 0 ? "\u2212" : "+") + Math.abs(t.v).toFixed(tl.d)}\u00b0</text>`;
    }
    left.setAttribute("viewBox", `0 0 ${lw} ${H}`); left.innerHTML = h;

    scaleBar(w, W, s);
  }

  // scale bar: pick the longest round angle that fits in ~130 screen px (less on a small picture)
  function scaleBar(w, W, s) {
    const cx = w.width / 2, cy = w.height / 2, p0 = w.toSky(cx, cy), p1 = w.toSky(cx + 1, cy);
    const o = WCS.offset(p0.ra, p0.dec, p1.ra, p1.dec), asPerTile = Math.hypot(o.e, o.n), pxPerTile = W / w.width * s;
    const steps = [1, 2, 5, 10, 20, 30, 60, 120, 300, 600, 1200, 1800, 3600, 7200];
    let best = steps[0];
    const maxPx = Math.max(64, Math.min(130, viewer.clientWidth * 0.26));       // a quarter of a small picture at most
    for (const v of steps) if (v / asPerTile * pxPerTile <= maxPx) best = v;
    const label = best >= 3600 ? `${best / 3600}\u00b0` : best >= 60 ? `${best / 60}\u2032` : `${best}\u2033`;
    $("scale").innerHTML = `<i style="width:${best / asPerTile * pxPerTile}px"></i><span>${label}</span>`;
  }

  // compass: north is always up in these tiles; east points to whichever side RA increases
  let eastSide = "left";
  function compass(w) {
    const a = w.toSky(w.width / 2, w.height / 2), b = w.toSky(w.width / 2 + 20, w.height / 2);
    let d = b.ra - a.ra; if (d > 180) d -= 360; else if (d < -180) d += 360;
    const east = d > 0 ? 1 : -1; eastSide = east > 0 ? "right" : "left"; const st = 'stroke="currentColor" stroke-width="1.2" fill="none"';
    $("compass").innerHTML =
      `<g style="color:var(--ink)"><path d="M17 31V6" ${st}/><path d="M13.5 10 17 5l3.5 5" ${st}/>` +
      `<path d="M17 17H${17 + east * 14}" ${st}/><path d="M${17 + east * 10} ${17 - 3.4}l${east * 5} 3.4 l${-east * 5} 3.4" ${st}/></g>` +
      `<text x="17" y="3.5" text-anchor="middle" dy="-.15em">N</text>` +
      `<text x="${17 + east * 14 + east * 3}" y="17" dy=".34em" text-anchor="${east > 0 ? "start" : "end"}">E</text>`;
  }

  // ---------------------------------------------------------------- caption, ticks, slider fill
  const cap = (id) => id[0].toUpperCase() + id.slice(1);
  function caption() {
    const a = A(), el = $("capText"); if (!a || !a.S.man || !a.S.frames.length) return;
    const S = a.S, m = S.man, f = S.frames[S.idx], wl = S.frames.map((x) => x.wavelength_um).filter(Boolean);
    const band = wl.length ? `${S.band}, ${Math.min(...wl).toFixed(2)}\u2013${Math.max(...wl).toFixed(2)}\u2009\u00b5m` : S.band;
    const c = m.center ? ` centred on (<i>\u03b1</i>,\u2009<i>\u03b4</i>)\u2009=\u2009(${m.center.ra.toFixed(3)}\u00b0,\u2009${m.center.dec >= 0 ? "+" : "\u2212"}${Math.abs(m.center.dec).toFixed(3)}\u00b0)` : "";
    const sz = m.size_deg ? `, ${m.size_deg.toFixed(2)}\u00b0 on a side` : "";
    el.innerHTML = `${cap(S.region)} field${c}${sz}. SPHEREx band <i>${band}</i>, frame ${S.idx + 1} of ${S.frames.length}, ` +
      `${f.utc.replace("T", " ").slice(0, 16)}\u2009UTC. Arcsinh stretch; north up, east ${eastSide}.${S.mode === "overlay" ? " Overlay: frame A in amber, frame B in cyan, so a source that moved appears as an amber and a cyan dot." : ""}`;
  }
  function frameTicks() {
    const a = A(), el = $("ftick"); if (!a) return;
    const n = a.S.frames.length;
    if (el.children.length !== n) el.innerHTML = "<i></i>".repeat(n);
    [...el.children].forEach((c, i) => { c.classList.toggle("on", i === a.S.idx); c.classList.toggle("e2", (a.S.frames[i] || {}).epoch > 1); });
  }
  const fill = (inp) => { const lo = +inp.min || 0, hi = +inp.max || 1; inp.style.setProperty("--p", ((+inp.value - lo) / ((hi - lo) || 1) * 100) + "%"); };
  document.querySelectorAll("input.fill").forEach((i) => { i.addEventListener("input", () => fill(i)); fill(i); });

  document.addEventListener("sx:frame", () => {
    const a = A(); if (a && a.S.wcs && !$("compass").firstChild) compass(a.S.wcs);
    rulers(); caption(); frameTicks(); fill($("time"));
  });
  document.addEventListener("sx:region", () => { $("compass").innerHTML = ""; });
  document.addEventListener("sx:zoom", rulers);
  window.addEventListener("resize", rulers);
  if (window.ResizeObserver) new ResizeObserver(rulers).observe(viewer);

  // canvas text needs the faces loaded before it is drawn: ask for them, then tell the canvas modules to repaint
  if (document.fonts && document.fonts.load) {
    Promise.all(['400 14px "CMU Serif"', 'italic 400 14px "CMU Serif"', '700 14px "CMU Serif"'].map((f) => document.fonts.load(f)))
      .catch(() => null).then(() => document.dispatchEvent(new Event("sx:fonts")));
  }
})();
