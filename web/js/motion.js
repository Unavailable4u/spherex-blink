// Planet X lab: (1) what a distant body would do in this field, (2) measure a mover and fit a distance.
//
// Physics: a distant body is nearly stationary, but the Earth moves 30 km/s, so its apparent position shifts
// by parallax. parallax.js computes that exactly from Earth's orbit (no straight-line approximation), so the
// same maths covers a 9-day window and two survey passes six months apart.
//
// Honesty about error bars: positions come from clicks snapped to a source centroid. How well that works was
// MEASURED on the known asteroid (data-prep/verify_target.py -> validation.json): the rms offset between
// centroid and ephemeris. That number, not a guess, sets the error bar. Faint sources scatter more.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const mk = { A: null, B: null };
  const A_ = () => window.App, S_ = () => window.App.S;
  const sky = () => SkyMap.data();
  const fmt = (x, n = 1) => (+x).toFixed(n);
  const dur = (days) => { const h = days * 24; return h < 48 ? `${fmt(h, h < 10 ? 1 : 0)} h` : days < 60 ? `${fmt(days, days < 10 ? 1 : 0)} d` : `${fmt(days / 30.44, 1)} months`; };
  const pixscale = () => S_().man.size_deg * 3600 / S_().wcs.width;
  const paneOpen = () => document.body.dataset.pane === "planetx";

  // per-axis 1-sigma position error in pixels for one clicked position
  function sigPx(m) {
    const v = S_().val && S_().val.summary, floor = v && v.rms_offset_px ? v.rms_offset_px / Math.SQRT2 : 0.5;
    return m && m.snap ? Math.hypot(floor, 1.5 / Math.max(3, m.snr)) : 0.75;
  }
  const sigDiff = (a, b) => Math.hypot(sigPx(a), sigPx(b)) * pixscale();            // arcsec per axis, for the offset of two positions

  const frames = () => S_().frames.filter((f) => sky() && sky().frames[f.id]);

  // ------------------------------------------------------------ simulator
  function simulate() {
    const A = A_(), s = sky(); if (!A || !A.S.wcs || !s || !A.S.frames.length || !Parallax.ready()) return;
    const d = +$("pxDist").value; $("pxDistVal").textContent = d + " AU";
    const list = frames(); if (list.length < 2) { $("pxOut").textContent = "This band has a single frame."; return; }
    const { ra, dec } = s.field, t0 = list[0].mjd, t1 = list[list.length - 1].mjd, ps = pixscale();
    const o = Parallax.offset(d, t0, t1, ra, dec); if (!o) { $("pxOut").textContent = "Earth's orbit table does not cover these dates."; return; }
    const tot = Math.hypot(o.e, o.n), sig = sigDiff({ snap: 1, snr: 30 }, { snap: 1, snr: 30 });
    const lim = Parallax.detectLimit(t0, t1, ra, dec, sig);
    const six = Parallax.offset(d, t0, t0 + 182.6, ra, dec), sixTot = six ? Math.hypot(six.e, six.n) : null;
    $("pxOut").innerHTML = `A body at <b>${d} AU</b> would shift <b>${fmt(tot, tot < 100 ? 1 : 0)}\u2033 = ${fmt(tot / ps, 1)} pixels</b> over these ${dur(t1 - t0)} (${fmt(tot / ((t1 - t0) * 24), 3)}\u2033/hour).` +
      `<div class="px-grid"><div><span>error on a measured shift (1\u03c3 per axis)</span><b>\u00b1${fmt(sig, 1)}\u2033</b></div><div><span>farthest body distinguishable from a star here</span><b>~${lim > 5000 ? ">5000" : fmt(lim, 0)} AU</b></div>` +
      (sixTot ? `<div class="hl"><span>same body, a second pass 6 months later</span><b>${fmt(sixTot, 0)}\u2033 = ${fmt(sixTot / ps, 0)} px</b></div>` : "") + `</div>` +
      `<span class="small">${sixTot ? `That is ${fmt(sixTot / tot, 0)}\u00d7 more shift than this field's ${dur(t1 - t0)} window, which is why the challenge compares images six months apart. ` : ""}For comparison, ${s.target_name || "the known asteroid"} moves ${fmt(targetRate(list), 0)}\u2033/hour.</span>`;
    drawTrack(list, d, ra, dec);
  }
  function drawTrack(list, d, ra, dec) {
    const A = A_(), svg = $("overlay"); svg.querySelectorAll(".pxg").forEach((n) => n.remove());
    if (!$("pxDraw").checked || !paneOpen()) return;
    const k = A.S.wcs.width / $("viewer").clientWidth / A.view.s, cur = A.S.frames[A.S.idx].id, cosd = Math.cos(dec * Math.PI / 180), t0 = list[0].mjd;
    const pts = list.map((f) => { const o = Parallax.offset(d, t0, f.mjd, ra, dec); return o ? A.S.wcs.toDraw(ra + o.e / cosd / 3600, dec + o.n / 3600) : null; });
    const ok = pts.map((p, i) => (p ? i : -1)).filter((i) => i >= 0); if (!ok.length) return;
    const g = document.createElementNS(NS, "g"); g.setAttribute("class", "pxg");
    let h = `<polyline points="${ok.map((i) => pts[i].x + "," + pts[i].y).join(" ")}" fill="none" stroke="#d36bff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    ok.forEach((i) => { const f = list[i]; h += `<circle cx="${pts[i].x}" cy="${pts[i].y}" r="${(f.id === cur ? 4 : 2) * k}" fill="#d36bff" fill-opacity="${f.id === cur ? 1 : 0.5}"/>`; });
    const ci = list.findIndex((f) => f.id === cur), cp = pts[ci] || pts[ok[0]];
    h += `<text x="${cp.x + 10 * k}" y="${cp.y - 10 * k}" font-size="${14.5 * k}" fill="#ecc9ff" stroke="#000" stroke-width="${3 * k}" paint-order="stroke">Planet X @ ${d} AU (simulated)</text>`;
    g.innerHTML = h; svg.appendChild(g);
  }
  function targetRate(list) {
    const s = sky(), t = s.target || {}, ids = list.filter((f) => t[f.id]); if (ids.length < 2) return NaN;
    const a = ids[0], b = ids[ids.length - 1], o = WCS.offset(...t[a.id], ...t[b.id]);
    return Math.hypot(o.e, o.n) / ((b.mjd - a.mjd) * 24);
  }

  // ------------------------------------------------------------ measure
  function mark(which) {
    const S = S_(); if (!S.sel) return; const f = S.frames[S.idx];
    mk[which] = { ra: S.sel.ra, dec: S.sel.dec, mjd: f.mjd, id: f.id, utc: f.utc, snap: !!S.sel.snap, snr: S.sel.snap ? S.sel.snap.snr : 0 };
    measure();
  }
  function measure() {
    const out = $("mvOut"), s = sky();
    const lab = (m) => (m ? `${m.utc.slice(0, 16).replace("T", " ")} UTC${m.snap ? "" : " <span class=\"small\">(unsnapped click)</span>"}` : "not set");
    let h = `<div class="ab"><b>A</b> ${lab(mk.A)}</div><div class="ab"><b>B</b> ${lab(mk.B)}</div>`;
    if (!mk.A || !mk.B) { out.innerHTML = h + `<span class="small">Click the mover on one frame and press Mark A. Move the time bar, click it again, press Mark B.</span>`; return; }
    const [p, q] = mk.A.mjd <= mk.B.mjd ? [mk.A, mk.B] : [mk.B, mk.A], dtd = q.mjd - p.mjd, dth = dtd * 24;
    if (dth < 1) { out.innerHTML = h + `<span class="small">Pick two frames at least 1 hour apart.</span>`; return; }
    if (!Parallax.ready()) { out.innerHTML = h + `<span class="small">Earth's orbit table is still loading.</span>`; return; }
    const o = WCS.offset(p.ra, p.dec, q.ra, q.dec), sig = sigDiff(p, q), M = Math.hypot(o.e, o.n), tot = sig * Math.SQRT2;
    const fit = Parallax.fit(o, p.mjd, q.mjd, p.ra, p.dec, sig);
    if (!fit) { out.innerHTML = h + `<span class="small">Earth's orbit table does not cover these dates.</span>`; return; }
    const pa = (Math.atan2(o.e, o.n) * 180 / Math.PI + 360) % 360;
    h += `<div class="mv-nums"><div><span>moved</span><b>${fmt(M, M < 100 ? 1 : 0)}\u2033 \u00b1 ${fmt(tot, 1)}\u2033</b></div><div><span>in</span><b>${dur(dtd)}</b></div><div><span>rate</span><b>${fmt(M / dth, 2)} \u00b1 ${fmt(tot / dth, 2)}\u2033/h</b></div><div><span>direction</span><b>${fmt(pa, 0)}\u00b0 <i>N\u2192E</i></b></div></div>`;
    const range = fit.openHi ? `more than ${fmt(fit.lo, 0)} AU` : `${fmt(fit.lo, 0)}\u2013${fmt(fit.hi, 0)} AU`;
    let v, cls;
    if (fit.kind === "still") { cls = "still"; v = `<b>No significant motion.</b> Shift ${fmt(M, 1)}\u2033 is within the error (\u00b1${fmt(tot, 1)}\u2033). It is a fixed source such as a star, or a body too far for this baseline: over ${dur(dtd)} only bodies closer than about <b>${fit.limit > 5000 ? "5000+" : fmt(fit.limit, 0)} AU</b> could show up.`; }
    else if (fit.kind === "near") { cls = "near"; v = `<b>Nearby object: asteroid or comet.</b> It moved far more than any body beyond ${Parallax.DMIN} AU can through parallax (even at ${Parallax.DMIN} AU the shift would be ${fmt(Math.hypot(fit.predicted.e, fit.predicted.n), 0)}\u2033).`; }
    else if (fit.kind === "distant") { cls = "far"; v = `<b>Consistent with a distant body.</b> Best fit <b>${fmt(fit.d, 0)} AU</b> (68% range ${range}). The measured direction (${fmt(fit.measAngle, 0)}\u00b0) matches the predicted parallax direction (${fmt(fit.predAngle, 0)}\u00b0). This is a <b>candidate</b>, not a detection: it needs confirming in another pass.`; }
    else { cls = "mis"; v = `<b>Moves, but not as parallax predicts</b> (measured ${fmt(fit.measAngle, 0)}\u00b0, predicted ${fmt(fit.predAngle, 0)}\u00b0). More likely noise, an artifact, a mis-click or a nearby slow object.`; }
    requestAnimationFrame(() => { try { out.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (e) { /* old browsers */ } });
    out.innerHTML = h + `<div class="verdict ${cls}"><i></i><span>${v}</span></div>` +
      `<span class="small">Error bars come from the position scatter measured on ${s && s.target_name ? s.target_name : "the known asteroid"} (rms ${S_().val && S_().val.summary ? fmt(S_().val.summary.rms_offset_px, 2) + " px" : "n/a: assumed 0.5 px"}); a faint source will scatter more. Assumes the body's own orbital motion is small (true beyond ~100 AU). The shift is computed from Earth's orbit, so it holds for any baseline.</span>`;
  }

  // ------------------------------------------------------------ wiring
  $("markA").onclick = () => mark("A"); $("markB").onclick = () => mark("B");
  $("clearMk").onclick = () => { mk.A = mk.B = null; measure(); };
  $("pxDist").oninput = simulate; $("pxDraw").onchange = simulate;
  ["sx:frame", "sx:skyready", "sx:zoom", "sx:orrery", "sx:pane"].forEach((e) => document.addEventListener(e, simulate));
  document.addEventListener("sx:region", () => { mk.A = mk.B = null; $("mvCard").hidden = true; $("overlay").querySelectorAll(".pxg").forEach((n) => n.remove()); measure(); });
  document.addEventListener("sx:skyready", () => { $("mvCard").hidden = false; measure(); });
  function selLine() {
    const S = S_(); if (!S.sel) return;
    $("mvSel").innerHTML = `Selected: <b>${S.sel.ra.toFixed(4)}\u00b0, ${S.sel.dec >= 0 ? "+" : ""}${S.sel.dec.toFixed(4)}\u00b0</b> ${S.sel.snap ? "(snapped to a source)" : "<span class=\"warnc\">(no source under the click: the error bar will be wider)</span>"}`;
  }
  document.addEventListener("sx:select", () => { $("markA").disabled = $("markB").disabled = false; selLine(); });
})();
