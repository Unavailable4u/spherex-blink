// App glue: field/band/time controls, blink + overlay, click -> metadata, mover check, flagging, zoom/pan, export.
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const S = { man: null, wcs: null, region: null, meta: null, band: null, frames: [], tiles: [], idx: 0, ref: 0, sel: null,
    flags: [], mode: "blink", val: null, regions: [] };
  const view = { s: 1, tx: 0, ty: 0 };
  const emit = (name, detail) => document.dispatchEvent(new CustomEvent(name, { detail }));
  const cv = $("sky"), svg = $("overlay"), stage = $("stage"), viewer = $("viewer");
  let loadTok = 0, bandTok = 0;
  Renderer.init(cv);
  SkyMap.init($("skymap"));

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmtTime = (f) => f.utc.replace("T", " ").slice(0, 16) + " UTC";
  const say = (id, t) => { $(id).textContent = t; };
  const getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + " -> " + r.status); return r.json(); };
  const getJSONorNull = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  const dur = (days) => { const h = days * 24; return h < 1 ? `${Math.round(h * 60)} min` : h < 48 ? `${h.toFixed(h < 10 ? 1 : 0)} h` : days < 60 ? `${days.toFixed(days < 10 ? 1 : 0)} d` : `${(days / 30.44).toFixed(1)} months`; };

  let toastTimer = 0;
  function toast(msg, ms = 4200) { const t = $("toast"); t.textContent = msg; t.style.bottom = ($("hud-bottom").offsetHeight + 24) + "px"; t.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms); }
  function problem(msg) { const l = $("loading"); l.hidden = false; l.classList.add("err"); l.textContent = msg; }
  function busy(msg) { const l = $("loading"); l.classList.remove("err"); if (msg) { l.hidden = false; l.textContent = msg; } else l.hidden = true; }

  // wavelength of a frame at the tile centre; falls back to the fitted plane when the header value is missing
  function lamOf(f) {
    if (f.wavelength_um) return { v: f.wavelength_um, est: false };
    const p = f.wavelength_plane; if (!p || !S.wcs) return null;
    const v = p.c0 + p.per_col * S.wcs.width / 2 + p.per_row * S.wcs.height / 2;
    return v > 0 ? { v, est: true } : null;
  }
  const lamTxt = (f) => { const l = f.lam; return l ? `${l.est ? "\u2248" : ""}${l.v.toFixed(2)}\u2009\u00b5m` : "\u2014"; };

  // ---------------------------------------------------------------- URL state
  function pushState() {
    if (!S.region || !S.frames.length) return;
    const q = new URLSearchParams(); q.set("region", S.region); q.set("band", S.band);
    q.set("a", S.frames[S.idx].id); if (S.frames[S.ref]) q.set("b", S.frames[S.ref].id);
    try { history.replaceState(null, "", "?" + q.toString()); } catch (e) { /* file:// or sandbox */ }
  }

  // ---------------------------------------------------------------- field / band
  async function loadRegion(id, want = {}) {
    const my = ++loadTok;
    S.region = id; S.meta = S.regions.find((r) => r.id === id) || { id }; emit("sx:region", { id, extras: S.meta.extras });
    Renderer.stopBlink(); setMode("blink", true);
    busy("Loading field\u2026"); S.sel = null; S.val = null; S.frames = []; S.tiles = [];
    let man, wj;
    try { [man, wj] = await Promise.all([getJSON(`tiles/${id}/manifest.json`), getJSON(`tiles/${id}/wcs.json`)]); }
    catch (e) { if (my === loadTok) problem("Could not load this field: " + e.message); return; }
    if (my !== loadTok) return;
    S.man = man; S.wcs = WCS.make(wj);
    S.val = !S.meta.extras || S.meta.extras.includes("validation") ? await getJSONorNull(`tiles/${id}/validation.json`) : null; if (my !== loadTok) return;
    const { width: w, height: h } = S.wcs;
    Renderer.resize(w, h); svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = ""; $("submitFlag").disabled = true; $("meta").innerHTML = `<dt class="empty">Click anywhere on the sky to read its position, band and brightness.</dt>`; $("moverCheck").innerHTML = ""; resetView();
    // bands
    $("bands").innerHTML = "";
    for (const b of Object.keys(man.bands)) {
      const fs = man.frames.filter((f) => f.band === b), wl = fs.filter((f) => f.wavelength_um).map((f) => f.wavelength_um);
      const btn = document.createElement("button"); btn.dataset.band = b; btn.type = "button";
      btn.innerHTML = `${b}<small>${wl.length ? Math.min(...wl).toFixed(2) + "\u2013" + Math.max(...wl).toFixed(2) + " \u00b5m" : "\u2014"}</small><em>${fs.length} frame${fs.length === 1 ? "" : "s"}</em>`;
      btn.onclick = () => setBand(b); $("bands").appendChild(btn);
    }
    // epochs
    const eps = man.epochs || [1]; $("epochSeg").hidden = eps.length < 2;
    $("epochSeg").innerHTML = eps.length < 2 ? "" : eps.map((e) => `<button type="button" data-epoch="${e}">Pass ${e}</button>`).join("");
    $("epochSeg").querySelectorAll("button").forEach((b) => { b.onclick = () => { const i = S.frames.findIndex((f) => f.epoch === +b.dataset.epoch); if (i >= 0) goto(i); }; });
    fieldInfo();
    S.flags = await Flagging.list(id); if (my !== loadTok) return; flagUI();
    setBand(want.band && man.bands[want.band] ? want.band : Object.keys(man.bands)[0], want);
  }

  function fieldInfo() {
    const m = S.meta || {}, man = S.man, sim = m.kind === "simulated";
    document.body.classList.toggle("sim", sim); $("simBanner").hidden = !sim;
    const ms = man.frames.map((f) => f.mjd), span = Math.max(...ms) - Math.min(...ms);
    const dates = (x) => new Date((x - 40587) * 864e5).toISOString().slice(0, 10);
    $("fieldInfo").innerHTML = `<div class="ftitle">${esc(m.title || S.region)}${sim ? ' <span class="badge">simulated</span>' : ' <span class="badge ok">real SPHEREx data</span>'}</div>` +
      (m.blurb ? `<p>${esc(m.blurb)}</p>` : "") +
      `<dl class="mini"><dt>Frames</dt><dd>${man.frames.length} in ${Object.keys(man.bands).length} bands</dd><dt>Dates</dt><dd>${dates(Math.min(...ms))} \u2192 ${dates(Math.max(...ms))} (${dur(span)})</dd>` +
      `<dt>Passes</dt><dd>${(man.epochs || [1]).length}${(man.epochs || [1]).length < 2 ? " <span class=\"small\">(one survey pass: add a second ~6 months later for parallax)</span>" : ""}</dd>` +
      `<dt>Size</dt><dd>${man.size_deg.toFixed(2)}\u00b0 square, ${S.wcs.width}\u00d7${S.wcs.height} px</dd></dl>`;
    const sel = $("region"); [...sel.options].forEach((o) => { o.selected = o.value === S.region; });
    $("simHint").hidden = !sim;
    valCard();
  }
  // proof that the known-object overlay is real: written by data-prep/verify_target.py
  function valCard() {
    const v = S.val && S.val.summary, c = $("valCard");
    if (!v) { c.hidden = true; return; }
    c.hidden = false;
    $("valOut").innerHTML = `<p>The ephemeris position of <b>${esc(v.target)}</b> was searched for a real source in every frame, so the orange overlay is checked against the pixels, not just drawn.</p>` +
      `<div class="valnum"><div><b>${v.frames_detected}/${v.frames_checked}</b><span>frames with a source on the predicted spot</span></div><div><b>${(+v.rms_offset_px).toFixed(2)} px</b><span>rms offset, about ${Math.round(v.rms_offset_arcsec)}\u2033</span></div><div><b>${v.movers_confirmed}/${v.frames_checked}</b><span>frames where it is gone from that pixel in the other frames</span></div></div>` +
      (v.movers_confirmed < v.frames_detected ? `<p class="small">Not every frame can show it gone from that pixel: the check needs the asteroid to have moved clear of its other positions, which short windows and crowded fields may not allow. The detections above are the stronger evidence.</p>` : "") +
      `<span class="small">Repeat it with <span class="tt">data-prep/verify_target.py</span>. This scatter is also the error bar used in the Planet X lab.</span>`;
  }

  async function setBand(b, want = {}) {
    const my = ++bandTok, rt = loadTok;
    Renderer.stopBlink(); setMode("blink", true);
    S.band = b;
    document.querySelectorAll("#bands button").forEach((x) => x.classList.toggle("on", x.dataset.band === b));
    S.frames = S.man.frames.filter((f) => f.band === b).sort((p, q) => p.mjd - q.mjd);
    S.frames.forEach((f) => { f.lam = lamOf(f); });
    $("time").max = Math.max(0, S.frames.length - 1); $("time").disabled = S.frames.length < 2;
    let done = 0; busy(`Loading frames\u2026 0/${S.frames.length}`);
    const tiles = await Promise.all(S.frames.map((f) => Renderer.load(`tiles/${S.region}/${f.path}`).catch(() => null)
      .then((t) => { done++; if (my === bandTok) busy(done < S.frames.length ? `Loading frames\u2026 ${done}/${S.frames.length}` : null); return t; })));
    if (my !== bandTok || rt !== loadTok) return;                    // user moved on while we were loading
    S.tiles = tiles; busy(null);
    if (tiles.some((t) => !t)) toast(`${tiles.filter((t) => !t).length} tile(s) of this band could not be loaded.`);
    const ia = want.a ? S.frames.findIndex((f) => f.id === want.a) : -1, ib = want.b ? S.frames.findIndex((f) => f.id === want.b) : -1;
    if (ia >= 0 && ib >= 0 && ia !== ib) { S.ref = ib; goto(ia, false); }
    else bestPair(false);
    updateEnabled();
  }

  function updateEnabled() {
    const two = S.frames.length > 1;
    ["blink", "overlayBtn", "setRef", "swapAB", "bestPair", "prev", "next"].forEach((id) => { $(id).disabled = !two; });
    $("blinkNote").textContent = two ? "" : "This band has a single frame, so there is nothing to blink against. Pick another band.";
  }

  // ---------------------------------------------------------------- frame pairs
  const ok = (i) => S.tiles[i] && S.frames[i];
  function stats(i, j) {
    if (i === j || !ok(i) || !ok(j)) return null;
    const A = S.frames[i], B = S.frames[j], dt = Math.abs(A.mjd - B.mjd), ov = Renderer.overlap(S.tiles[i], S.tiles[j]);
    const dl = A.lam && B.lam ? Math.abs(A.lam.v - B.lam.v) : null, rel = dl === null ? null : dl / ((A.lam.v + B.lam.v) / 2);
    return { dt, ov, dl, rel, cross: A.epoch !== B.epoch };
  }
  // choose the pair that shows motion best: far enough apart in time, similar wavelength, big shared footprint
  function bestPair(fade = true) {
    let best = null;
    const n = S.frames.length;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const s = stats(i, j); if (!s) continue;
      const far = s.dt >= 0.5, wf = s.rel === null ? 0.6 : 1 / (1 + Math.pow(s.rel / 0.10, 2)), tf = 0.7 + 0.3 * Math.min(1, s.dt / 5);
      const score = (far ? 1 : 0.02) * s.ov * wf * tf * (s.ov < 0.3 ? 0.3 : 1);
      if (!best || score > best.score) best = { i, j, score };
    }
    if (best) { S.ref = best.j; goto(best.i, fade); }
    else { S.ref = Math.min(1, n - 1); goto(0, fade); }
  }

  function pairUI() {
    const A = S.frames[S.idx], B = S.frames[S.ref], el = $("blinkInfo");
    if (!A) { el.innerHTML = ""; $("pairInfo").innerHTML = ""; $("pairWarn").innerHTML = ""; return; }
    const ov = S.mode === "overlay";
    el.innerHTML = S.frames.length > 1 ? `<span class="${ov ? "amber" : ""}"><b>A</b>${fmtTime(A).replace(" UTC", "")}<small>${lamTxt(A)}</small></span><span class="${ov ? "cyan" : ""}"><b>B</b>${B ? fmtTime(B).replace(" UTC", "") : "\u2014"}<small>${B ? lamTxt(B) : ""}</small></span>` : "";
    const s = stats(S.idx, S.ref); const w = [];
    if (!s) { $("pairInfo").innerHTML = ""; $("pairWarn").innerHTML = S.frames.length > 1 ? `<div class="note">A and B are the same frame. Move the time bar, then press <b>Set B</b>.</div>` : ""; return; }
    $("pairInfo").innerHTML = `<span><i>\u0394t</i> ${dur(s.dt)}</span><span><i>\u0394\u03bb</i> ${s.dl === null ? "\u2014" : s.dl.toFixed(2) + " \u00b5m (" + (s.rel * 100).toFixed(0) + "%)"}</span><span><i>shared</i> ${(s.ov * 100).toFixed(0)}%</span>`;
    if (s.dt * 24 < 1) w.push(["info", `These frames are only ${dur(s.dt)} apart. Only a fast mover will shift; for a slow one choose frames days apart.`]);
    if (s.cross) w.push(["good", `Different survey passes, about ${dur(s.dt)} apart: stars stay fixed, a distant body shows its parallax.`]);
    if (s.rel !== null && s.rel > 0.08) w.push(["warn", `These frames differ in wavelength by ${(s.rel * 100).toFixed(0)}%. Stars can change brightness between them, and the background level shifts, so judge by <b>position</b>, not brightness.`]);
    if (s.ov < 0.5) w.push(["warn", `Only ${(s.ov * 100).toFixed(0)}% of the field is covered in both frames. The hatched area has no data in one of them.`]);
    $("pairWarn").innerHTML = w.map(([k, t]) => `<div class="note ${k}">${t}</div>`).join("");
  }

  // ---------------------------------------------------------------- what is on screen
  // mode: "blink" (A/B alternate when running, A otherwise) | "overlay" (A in amber + B in cyan, static)
  function setMode(m, quiet) {
    S.mode = m; $("blink").classList.remove("on"); $("overlayBtn").classList.toggle("on", m === "overlay");
    document.body.classList.toggle("overlay-mode", m === "overlay");
    if (m !== "blink") Renderer.stopBlink();
    if (!quiet) refreshView(false);
  }
  const usePair = () => ok(S.idx) && ok(S.ref) && S.idx !== S.ref;
  const common = () => $("showMask").checked;

  function refreshView(fade = true) {
    const img = S.tiles[S.idx];
    if (S.mode === "overlay") {
      if (!usePair()) { setMode("blink", true); toast("Overlay needs two different frames."); return refreshView(fade); }
      Renderer.draw(Renderer.pair(S.tiles[S.idx], S.tiles[S.ref], { common: common(), overlay: true }).O);
    } else if (Renderer.blinking()) {
      startBlinkNow();
    } else if (img) {
      // when masking is on, show A with the shared footprint so what you see matches what blinks
      fade ? Renderer.fadeTo(img) : Renderer.draw(img);
    } else if (S.frames.length) toast("The tile for this frame is missing.");
  }
  function startBlinkNow() {
    const p = Renderer.pair(S.tiles[S.idx], S.tiles[S.ref], { common: common() });
    Renderer.startBlink(() => p.A, () => p.B, +$("rate").value);
  }
  function toggleBlink() {
    if (S.frames.length < 2) return;
    if (S.mode === "overlay") setMode("blink", true);
    if (Renderer.blinking()) { Renderer.stopBlink(); $("blink").classList.remove("on"); refreshView(false); emit("sx:blink", { on: false }); return; }
    if (!usePair()) { if (S.ref === S.idx) S.ref = S.idx > 0 ? S.idx - 1 : 1; if (!usePair()) return toast("Blink needs two frames with tiles."); pairUI(); }
    $("blink").classList.add("on"); startBlinkNow(); emit("sx:blink", { on: true });
  }
  function toggleOverlay() {
    if (S.frames.length < 2) return;
    if (S.mode === "overlay") { setMode("blink"); return; }
    Renderer.stopBlink(); $("blink").classList.remove("on");
    if (!usePair()) { if (S.ref === S.idx) S.ref = S.idx > 0 ? S.idx - 1 : 1; }
    setMode("overlay"); pairUI();
  }

  // ---------------------------------------------------------------- time
  function goto(i, fade = true) {
    if (!S.frames.length) return;
    i = Math.max(0, Math.min(S.frames.length - 1, i)); S.idx = i; $("time").value = i;
    const f = S.frames[i];
    const e = (S.man.epochs || [1]).length > 1 ? `<span class="ep">pass ${f.epoch}</span> \u00b7 ` : "";
    $("frameLabel").innerHTML = `<i>${i + 1}</i> of ${S.frames.length} &middot; ${e}${fmtTime(f)} &middot; ${lamTxt(f)}`;
    document.querySelectorAll("#epochSeg button").forEach((b) => b.classList.toggle("on", +b.dataset.epoch === f.epoch));
    refreshView(fade);
    pairUI(); Flagging.render(svg, flagsShown(), f.id, S.wcs); showMeta(); pushState(); emit("sx:frame", { id: f.id });
  }

  // ---------------------------------------------------------------- click -> metadata
  function showMeta() {
    const m = $("meta"); if (!S.sel) return;
    const { col, row, ra, dec } = S.sel, f = S.frames[S.idx], ci = Math.round(col), ri = Math.round(row), t = S.tiles[S.idx];
    let flux = "\u2014", lam = f.lam ? f.lam.v : null;
    if (t && ci >= 0 && ri >= 0 && ci < t.w && ri < t.h) {
      const v = Renderer.value(t, ci, ri), st = S.man.bands[S.band].stretch, y = v / 255;
      if (t.nd[ri * t.w + ci]) flux = "no data in this frame here";
      else { const x = st.lo + (st.hi - st.lo) * st.a * Math.sinh(y * Math.asinh(1 / st.a)) + f.bkg; flux = (v === 255 ? "\u2265 " : "") + x.toPrecision(3) + " " + (f.unit || "MJy/sr") + (v === 255 ? " <span class=\"small\">(saturated in the 8-bit tile)</span>" : ""); }
    }
    if (f.wavelength_plane) { const p = f.wavelength_plane; lam = p.c0 + p.per_col * ci + p.per_row * ri; }
    const gl = WCS.galactic(ra, dec), ec = WCS.ecliptic(ra, dec);
    const rows = [["RA", `${ra.toFixed(5)}\u00b0  ${WCS.hms(ra)}`], ["Dec", `${dec.toFixed(5)}\u00b0  ${WCS.dms(dec)}`],
      ["Pixel", `${ci}, ${ri}${S.sel.snap ? ` <span class="small">centroid of a source (SNR ${S.sel.snap.snr.toFixed(0)})</span>` : ` <span class="small">your click, no source under it</span>`}`],
      ["Galactic", `l ${gl.l.toFixed(2)}\u00b0  b ${gl.b.toFixed(2)}\u00b0`], ["Ecliptic", `\u03bb ${ec.lon.toFixed(2)}\u00b0  \u03b2 ${ec.lat.toFixed(2)}\u00b0`],
      ["Band", `${S.band}${lam ? "  \u00b7  " + (+lam).toFixed(3) + " \u00b5m" : ""}`],
      ["Frame", `${fmtTime(f)}${(S.man.epochs || [1]).length > 1 ? " \u00b7 pass " + f.epoch : ""}`], ["Intensity", flux]];
    m.innerHTML = rows.map(([k, v2]) => `<dt>${k}</dt><dd>${v2}</dd>`).join("");
    moverCheck();
  }

  // Does the source under the cursor stay put in the other frames of this band?  (fixed star vs mover)
  function persistence() {
    const { ra, dec } = S.sel, cur = S.frames[S.idx], p = S.wcs.toPix(ra, dec), here = S.tiles[S.idx];
    const r = { here: here ? Renderer.sourceAt(here, p.col, p.row) : -1, compact: here ? Renderer.compactness(here, p.col, p.row) : 0, halo: here ? Renderer.halo(here, p.col, p.row) : null, present: 0, absent: 0, faint: 0, nodata: 0 };
    const ex = here ? Renderer.excess(here, p.col, p.row) : 0;      // the same star elsewhere should be about as bright as it is here, scaled by how the two frames differ in sensitivity
    S.frames.forEach((f, i) => {
      if (i === S.idx || !S.tiles[i] || Math.abs(f.mjd - cur.mjd) * 24 < 1) return;       // same visit: object has not moved yet
      const v = Renderer.sourceAt(S.tiles[i], p.col, p.row, 1, 3, Renderer.fluxRatio(here, S.tiles[i]) * ex); if (v === 1) r.present++; else if (v === 0) r.absent++; else if (v === 2) r.faint++; else r.nodata++;
    });
    return r;
  }
  function verdict(r) {
    const n = r.present + r.absent + r.faint;
    if (r.here !== 1) return { k: "none", t: "No clear source at this spot in this frame." };
    if (r.compact < 3) return { k: "none", t: "Only one or two bright pixels: this looks like a cosmic-ray hit or hot pixel, not a source. A real source is a few pixels wide." };
    if (n === 0) return { k: "unclear", t: "Mover check needs other frames of this band, taken at least an hour apart, that cover this spot." };
    if (r.absent === 0 && r.faint === 0) return { k: "fixed", t: `Same spot in all ${n} other frame${n > 1 ? "s" : ""}: a fixed star or galaxy, not a mover.` };
    if (r.present === 0 && r.faint === 0 && r.halo !== null && r.halo < 0.008) return { k: "unclear", t: `Gone from all ${n} other frame${n > 1 ? "s" : ""}, but it has hard edges and no soft halo like a star's. It could be a <b>cosmic-ray hit</b> rather than a mover: check it before flagging.` };
    if (r.present === 0 && r.faint === 0) return { k: "moves", t: `Gone from this spot in all ${n} other frame${n > 1 ? "s" : ""}: <b>it moves</b> (or is a transient). A good candidate.` };
    const bits = [r.present && `${r.present} same`, r.faint && `${r.faint} fainter`, r.absent && `${r.absent} empty`].filter(Boolean).join(", ");
    return { k: "unclear", t: `Not clearly the same in the other frames (${bits}): inconclusive. Stars change brightness with wavelength, so look at the frames yourself.` };
  }
  function moverCheck() {
    if (!S.sel || !S.wcs) return; const v = verdict(persistence()); S.sel.verdict = v.k;
    $("moverCheck").innerHTML = `<h3 class="lbl sub">Mover check</h3><div class="verdict ${v.k}"><i></i><span>${v.t}</span></div>`;
  }

  function select(fx, fy) {                       // fx, fy: continuous tile coordinates, pixel edges (0 = left edge of pixel 0)
    if (fx < 0 || fy < 0 || fx >= S.wcs.width || fy >= S.wcs.height) return;
    let col = fx - 0.5, row = fy - 0.5, snap = null;                 // convert to pixel-centre coordinates, the convention WCS uses
    const t = S.tiles[S.idx];
    if ($("snapOn").checked && t) { snap = Renderer.snap(t, col, row); if (snap) { col = snap.col; row = snap.row; } }
    S.sel = { col, row, snap, ...S.wcs.toSky(col, row) };
    drawCrosshair(); showMeta(); $("submitFlag").disabled = false; $("flagMatch").textContent = ""; emit("sx:select");
  }
  function drawCrosshair() {
    svg.querySelectorAll(".xh").forEach((n) => n.remove()); if (!S.sel) return;
    const x = S.sel.col + 0.5, y = S.sel.row + 0.5, w = S.wcs.width, h = S.wcs.height, st = 'stroke="#ffb347" stroke-opacity=".55" stroke-width="1" vector-effect="non-scaling-stroke"';
    const g = document.createElementNS(NS, "g"); g.setAttribute("class", "xh");
    g.innerHTML = `<line x1="${x}" y1="0" x2="${x}" y2="${y - 10}" ${st}/><line x1="${x}" y1="${y + 10}" x2="${x}" y2="${h}" ${st}/>` +
      `<line x1="0" y1="${y}" x2="${x - 10}" y2="${y}" ${st}/><line x1="${x + 10}" y1="${y}" x2="${w}" y2="${y}" ${st}/><circle cx="${x}" cy="${y}" r="10" fill="none" ${st}/>`;
    svg.appendChild(g);
  }

  // ---------------------------------------------------------------- zoom / pan (wheel, drag, pinch, double-click, keys)
  function applyView() {
    const W = viewer.clientWidth, H = viewer.clientHeight;
    view.tx = Math.min(0, Math.max(W - W * view.s, view.tx)); view.ty = Math.min(0, Math.max(H - H * view.s, view.ty));
    stage.style.transform = `translate(${view.tx}px,${view.ty}px) scale(${view.s})`; emit("sx:zoom");
  }
  function resetView() { view.s = 1; view.tx = view.ty = 0; applyView(); }
  function zoomAt(mx, my, factor) {
    const ns = Math.max(1, Math.min(14, view.s * factor));
    view.tx = mx - (mx - view.tx) * (ns / view.s); view.ty = my - (my - view.ty) * (ns / view.s); view.s = ns; applyView();
  }
  const inSolar = () => document.body.classList.contains("view-solar");        // the solar-system view covers the sky: sky zoom keys do nothing there
  viewer.addEventListener("wheel", (e) => { if (inSolar()) return; e.preventDefault(); const r = viewer.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.25 : 0.8); }, { passive: false });

  const ptrs = new Map(); let down = null, pinch = null;
  const centre = () => { const a = [...ptrs.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) }; };
  stage.addEventListener("pointerdown", (e) => {
    ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); try { stage.setPointerCapture(e.pointerId); } catch (err) { /* synthetic */ }
    if (ptrs.size === 2) { pinch = centre(); down = null; return; }
    down = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
  });
  stage.addEventListener("pointermove", (e) => {
    if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && ptrs.size === 2) {
      const c = centre(), r = viewer.getBoundingClientRect();
      if (pinch.d > 0) zoomAt(c.x - r.left, c.y - r.top, c.d / pinch.d);
      view.tx += c.x - pinch.x; view.ty += c.y - pinch.y; applyView(); pinch = c; return;
    }
    if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > 4) { down.moved = true; stage.classList.add("drag"); }
    if (down.moved) { view.tx = down.tx + dx; view.ty = down.ty + dy; applyView(); }
  });
  const endPtr = (e) => {
    const wasClick = down && !down.moved && ptrs.size === 1 && e.type === "pointerup";
    ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; down = null; stage.classList.remove("drag");
    if (!wasClick || !S.wcs) return;
    const r = cv.getBoundingClientRect();
    select((e.clientX - r.left) / r.width * S.wcs.width, (e.clientY - r.top) / r.height * S.wcs.height);
  };
  stage.addEventListener("pointerup", endPtr); stage.addEventListener("pointercancel", endPtr);
  stage.addEventListener("dblclick", (e) => { const r = viewer.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.shiftKey ? 0.5 : 2); });
  window.addEventListener("resize", applyView);
  $("zoomReset").onclick = resetView;

  // ---------------------------------------------------------------- flags
  const flagsShown = () => ($("showFlags").checked ? S.flags : []);
  function flagUI() {
    const st = Flagging.status(), sh = Flagging.remote;
    $("flagMode").className = "pill " + (sh && st === "shared" ? "ok" : sh && st === "offline" ? "bad" : "local");
    $("flagMode").textContent = sh ? (st === "shared" ? "shared with everyone" : st === "offline" ? "offline, saved here" : "connecting\u2026") : "saved in this browser only";
    const mine = S.flags.filter(Flagging.mine);
    say("flagCount", `(${S.flags.length}${sh ? " from everyone" : ""})`);
    $("flagList").innerHTML = S.flags.length ? "" : `<li class="empty">No flags in this field yet.</li>`;
    S.flags.slice().sort((a, b) => b.created - a.created).slice(0, 60).forEach((f) => {
      const li = document.createElement("li"), who = Flagging.mine(f);
      li.innerHTML = `<button type="button" class="flag-go" title="Go to this flag"><span class="dot ${who ? "me" : "other"}"></span><span><b>${esc(f.category)}</b> <span class="small">${esc(f.band)} \u00b7 ${esc(String(f.frame).replace("_", " "))}${f.verdict ? " \u00b7 " + esc(f.verdict) : ""}</span><br><span class="tt small">${(+f.ra).toFixed(4)}\u00b0 ${(+f.dec) >= 0 ? "+" : ""}${(+f.dec).toFixed(4)}\u00b0${f.note ? " \u2014 " + esc(f.note) : ""}</span></span></button>` +
        (who && !Flagging.remote ? `<button type="button" class="flag-x" title="Delete this flag" aria-label="Delete flag">\u00d7</button>` : "");
      li.querySelector(".flag-go").onclick = () => goFlag(f);
      const x = li.querySelector(".flag-x"); if (x) x.onclick = () => { Flagging.removeLocal(f); S.flags = S.flags.filter((g) => g !== f); flagUI(); Flagging.render(svg, flagsShown(), S.frames[S.idx].id, S.wcs); };
      $("flagList").appendChild(li);
    });
    $("exportCsv").disabled = $("exportJson").disabled = !S.flags.length;
    $("clearFlags").hidden = sh || !mine.length;
  }
  async function goFlag(f) {
    if (f.band !== S.band && S.man.bands[f.band]) await setBand(f.band);
    const i = S.frames.findIndex((x) => x.id === f.frame); if (i >= 0) goto(i, false);
    const p = S.wcs.toPix(f.ra, f.dec); select(p.col + 0.5, p.row + 0.5);
  }
  function matchKnown() {
    const sky = SkyMap.data(), f = S.frames[S.idx]; if (!sky || !S.sel) return null;
    const out = [], tp = sky.target && sky.target[f.id];
    if (tp) { const p = S.wcs.toPix(...tp), d = Math.hypot(p.col - S.sel.col, p.row - S.sel.row); if (d <= 8) out.push(`${sky.target_name || "the known asteroid"} (${(d * S.man.size_deg * 3600 / S.wcs.width).toFixed(0)}\u2033 away)`); }
    const fr = sky.frames[f.id]; if (fr) for (const b of fr.in_field) { const p = S.wcs.toPix(...fr.pos[b]); if (Math.hypot(p.col - S.sel.col, p.row - S.sel.row) <= 12) out.push(b[0].toUpperCase() + b.slice(1)); }
    return { names: out, haveCatalog: !!(sky.target && Object.keys(sky.target).length) };
  }
  $("submitFlag").onclick = async () => {
    if (!S.sel || $("submitFlag").dataset.busy) return; const f = S.frames[S.idx];
    $("submitFlag").dataset.busy = "1"; $("submitFlag").disabled = true;
    const flag = { region: S.region, frame: f.id, band: S.band, epoch: f.epoch, ra: S.sel.ra, dec: S.sel.dec, category: $("category").value, note: $("note").value.trim(), verdict: S.sel.verdict || "" };
    S.flags.push(flag); Flagging.render(svg, flagsShown(), f.id, S.wcs); $("note").value = "";
    const mk = matchKnown();
    $("flagMatch").className = "note " + (mk && mk.names.length ? "good" : "info");
    $("flagMatch").innerHTML = mk && mk.names.length ? `This matches a <b>known object: ${esc(mk.names.join(", "))}</b>. Good catch. It is catalogued, so it is not a new discovery.`
      : mk ? `Not ${esc(SkyMap.data().target_name || "the known asteroid")}. It could still be another catalogued minor planet, a variable star or an artifact: check the Minor Planet Center before calling it new.` : "";
    say("flagStatus", "Saving\u2026");
    const where = await Flagging.add(flag);
    say("flagStatus", where === "shared" ? "Saved for everyone." : Flagging.remote ? "Shared store unreachable: saved in this browser only." : "Saved in this browser (no shared store is configured).");
    flagUI(); delete $("submitFlag").dataset.busy; $("submitFlag").disabled = !S.sel;
  };
  $("exportCsv").onclick = () => Flagging.download(`spherex-flags-${S.region}.csv`, Flagging.toCSV(S.flags), "text/csv");
  $("exportJson").onclick = () => Flagging.download(`spherex-flags-${S.region}.json`, JSON.stringify(S.flags, null, 2), "application/json");
  $("clearFlags").onclick = () => { if (confirm("Delete the flags saved in this browser for this field?")) { Flagging.clearLocal(S.region); Flagging.list(S.region).then((l) => { S.flags = l; flagUI(); Flagging.render(svg, flagsShown(), S.frames[S.idx].id, S.wcs); }); } };
  $("showFlags").onchange = () => S.frames.length && Flagging.render(svg, flagsShown(), S.frames[S.idx].id, S.wcs);

  // ---------------------------------------------------------------- export
  async function saveImage() {
    try {
      const solar = document.body.classList.contains("view-solar"), W = S.wcs.width, H = S.wcs.height, band = 64;
      const c = document.createElement("canvas"); c.width = W; c.height = H + band; const x = c.getContext("2d");
      x.fillStyle = "#05060a"; x.fillRect(0, 0, W, H + band);
      if (solar) { x.drawImage($("orBig"), 0, 0, W, H); }
      else {
        x.fillStyle = "#000"; x.fillRect(0, 0, W, H); x.drawImage(cv, 0, 0);
        const clone = svg.cloneNode(true); clone.setAttribute("xmlns", NS); clone.setAttribute("width", W); clone.setAttribute("height", H);
        clone.querySelectorAll("text").forEach((t) => t.setAttribute("font-family", "Georgia, serif"));
        const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }));
        await new Promise((res) => { const im = new Image(); im.onload = () => { x.drawImage(im, 0, 0); res(); }; im.onerror = res; im.src = url; });
        URL.revokeObjectURL(url);
      }
      const f = S.frames[S.idx], B = S.frames[S.ref];
      x.fillStyle = "#ece6d5"; x.font = "italic 22px 'CMU Serif', Georgia, serif";
      const head = solar ? `Solar system on ${$("bdDate").textContent || $("orDate").textContent} \u00b7 top-down, square-root distance scale`
        : `${(S.meta && S.meta.title) || S.region} \u00b7 SPHEREx ${S.band} ${lamTxt(f)} \u00b7 ${fmtTime(f)}` + (S.mode === "overlay" && B ? `  +  ${fmtTime(B)} (overlay: A amber, B cyan)` : "");
      x.fillText(head, 14, H + 27); x.fillStyle = "#8e8a7c"; x.font = "italic 16px 'CMU Serif', Georgia, serif";
      x.fillText(solar ? "Planet positions: JPL Horizons. Made with the SPHEREx Blink Comparator."
        : (S.meta && S.meta.kind === "simulated" ? "SIMULATED DATA. " : "") + "Data: NASA/JPL-Caltech SPHEREx via IRSA/IPAC. Made with the SPHEREx Blink Comparator.", 14, H + 52);
      c.toBlob((b) => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = solar ? `spherex-solar-system-${($("bdDate").textContent || "view")}.png` : `spherex-${S.region}-${S.band}-${f.id}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }, "image/png");
    } catch (e) { toast("Could not save the image: " + e.message); }
  }
  async function copyLink() {
    try { await navigator.clipboard.writeText(location.href); toast("Link copied: it reopens this field, band and frame pair."); }
    catch (e) { toast("Copy this address from the browser bar to share the view."); }
  }
  $("saveImg").onclick = saveImage; $("copyLink").onclick = copyLink;

  // ---------------------------------------------------------------- wiring
  let kbd = false;
  document.addEventListener("keydown", () => { kbd = true; }, true); document.addEventListener("pointerdown", () => { kbd = false; }, true);
  document.querySelectorAll("input[type=checkbox],select").forEach((c) => c.addEventListener("change", () => { if (!kbd && c.blur) c.blur(); }));
  const unfocus = (e) => { if (e.detail > 0 && e.currentTarget.blur) e.currentTarget.blur(); };     // after a mouse click, give the keys back to the app
  document.querySelectorAll("button").forEach((b) => b.addEventListener("click", unfocus));
  $("time").oninput = (e) => goto(+e.target.value, true);
  $("prev").onclick = () => goto(S.idx - 1);
  $("next").onclick = () => goto(S.idx + 1);
  $("blink").onclick = toggleBlink;
  $("overlayBtn").onclick = toggleOverlay;
  $("setRef").onclick = () => { if (S.idx === S.ref) return toast("A is already this frame. Move the time bar first."); S.ref = S.idx; pairUI(); refreshView(false); pushState(); };
  $("swapAB").onclick = () => { const a = S.idx, b = S.ref; S.ref = a; goto(b, false); };
  $("bestPair").onclick = () => bestPair(false);
  $("rate").onchange = (e) => { Renderer.setRate(+e.target.value); if (Renderer.blinking()) startBlinkNow(); };
  $("showMask").onchange = () => { pairUI(); refreshView(false); };

  const typing = (t) => t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) && t.type !== "range";
  const dialogOpen = () => document.querySelector("dialog[open]");
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || dialogOpen()) return;
    const k = e.key;
    if (k === " " || k === "Spacebar") { e.preventDefault(); if (!e.repeat) toggleBlink(); }          // ignore auto-repeat while the bar is held
    else if (k === "ArrowLeft") { goto(S.idx - 1); e.preventDefault(); }
    else if (k === "ArrowRight") { goto(S.idx + 1); e.preventDefault(); }
    else if (k === "b" || k === "B") $("setRef").click();
    else if (k === "o" || k === "O") toggleOverlay();
    else if (k === "x" || k === "X") $("swapAB").click();
    else if ((k === "+" || k === "=" || k === "-" || k === "_" || k === "0") && inSolar()) return;
    else if (k === "+" || k === "=") zoomAt(viewer.clientWidth / 2, viewer.clientHeight / 2, 1.4);
    else if (k === "-" || k === "_") zoomAt(viewer.clientWidth / 2, viewer.clientHeight / 2, 1 / 1.4);
    else if (k === "0") resetView();
    else return;
  });
  // A button reacts to Space on keyup; we already handled the key on keydown, so swallow the keyup or it would toggle twice.
  document.addEventListener("keyup", (e) => { if ((e.key === " " || e.key === "Spacebar") && !typing(e.target) && !dialogOpen()) e.preventDefault(); });

  $("region").onchange = (e) => loadRegion(e.target.value);
  window.App = { S, view, toast, goto, setBand, loadRegion, select, setMode, toggleBlink, bestPair, lamTxt };

  (async () => {
    try {
      const regs = (await getJSON("tiles/regions.json")).regions; S.regions = regs;
      const real = regs.filter((r) => r.kind !== "simulated"), sim = regs.filter((r) => r.kind === "simulated");
      const opt = (r) => `<option value="${esc(r.id)}">${esc(r.title || r.id)}</option>`;
      $("region").innerHTML = (real.length ? `<optgroup label="Real SPHEREx data">${real.map(opt).join("")}</optgroup>` : "") + (sim.length ? `<optgroup label="Simulated (practice)">${sim.map(opt).join("")}</optgroup>` : "");
      const q = new URLSearchParams(location.search), want = q.get("region");
      const first = regs.find((r) => r.id === want) || real[0] || regs[0];
      $("region").value = first.id;
      await loadRegion(first.id, { band: q.get("band"), a: q.get("a"), b: q.get("b") });
      emit("sx:ready");
    } catch (e) { problem("Could not load tiles/regions.json. Serve the web folder over http (see README) or check the deployment."); }
  })();
})();
