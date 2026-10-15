// Motion lab: (1) Planet X simulator, (2) measure a mover between two frames and estimate its distance.
//
// Physics: a distant body is nearly stationary, but Earth moves ~30 km/s, so it appears to drift by
// (Earth's sky-projected velocity) / distance. solar_system.py stores that drift for a body at 1 AU in
// sky.json ("reflex", arcsec/hour, [east, north]); the drift at distance d AU is reflex / d.
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const mk = { A: null, B: null };

  const sky = () => SkyMap.data();
  const frames = () => (window.App.S.man.frames.filter((f) => sky() && sky().frames[f.id]).sort((a, b) => a.mjd - b.mjd));
  const norm = (v) => Math.hypot(v[0], v[1]);
  const fmt = (x, n = 1) => (+x).toFixed(n);

  // cumulative apparent drift (arcsec * AU) of a stationary distant body, per frame, relative to the first frame
  function cumulative(list) {
    const out = [[0, 0]];
    for (let i = 1; i < list.length; i++) {
      const a = sky().frames[list[i - 1].id], b = sky().frames[list[i].id], dt = (list[i].mjd - list[i - 1].mjd) * 24;
      out.push([out[i - 1][0] + 0.5 * (a.reflex[0] + b.reflex[0]) * dt, out[i - 1][1] + 0.5 * (a.reflex[1] + b.reflex[1]) * dt]);
    }
    return out;
  }

  // ------------------------------------------------------------ simulator
  function simulate() {
    const A = window.App, s = sky(); if (!A || !A.S.wcs || !s || !A.S.frames.length) return;
    const d = +$("pxDist").value; $("pxDistVal").textContent = d + " AU";
    const list = frames(); if (list.length < 2) return;
    const cum = cumulative(list), hours = (list[list.length - 1].mjd - list[0].mjd) * 24;
    const total = norm(cum[cum.length - 1]) / d, rate = total / hours, pxs = total / s.field.pixscale_arcsec;
    $("pxOut").innerHTML = `A body at <b>${d} AU</b> would drift <b>${fmt(rate, 3)}\u2033/hour</b>: about <b>${fmt(total, 0)}\u2033 = ${fmt(pxs, 1)} pixels</b> over these ${fmt(hours / 24, 1)} days.` +
      `<br><span class="small">For comparison, ${s.target_name || "the known asteroid"} moves ${fmt(targetRate(list), 1)}\u2033/hour.</span>`;
    svg().querySelectorAll(".pxg").forEach((n) => n.remove());
    if (!$("pxDraw").checked) return;
    const k = A.S.wcs.width / $("viewer").clientWidth / A.view.s, cur = A.S.frames[A.S.idx].id, cosd = Math.cos(s.field.dec * Math.PI / 180);
    const pts = list.map((f, i) => A.S.wcs.toPix(s.field.ra + (cum[i][0] / d / 3600) / cosd, s.field.dec + cum[i][1] / d / 3600));
    const g = document.createElementNS(NS, "g"); g.setAttribute("class", "pxg");
    let h = `<polyline points="${pts.map((p) => p.col + "," + p.row).join(" ")}" fill="none" stroke="#d36bff" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    list.forEach((f, i) => { h += `<circle cx="${pts[i].col}" cy="${pts[i].row}" r="${(f.id === cur ? 4 : 2) * k}" fill="#d36bff" fill-opacity="${f.id === cur ? 1 : 0.5}"/>`; });
    const cp = pts[list.findIndex((f) => f.id === cur)] || pts[0];
    h += `<text x="${cp.col + 10 * k}" y="${cp.row - 10 * k}" font-size="${12 * k}" fill="#ecc9ff" stroke="#000" stroke-width="${3 * k}" paint-order="stroke">Planet X @ ${d} AU (simulated)</text>`;
    g.innerHTML = h; svg().appendChild(g);
  }
  const svg = () => $("overlay");

  function targetRate(list) {
    const s = sky(), t = s.target || {}, ids = list.filter((f) => t[f.id]);
    if (ids.length < 2) return NaN;
    const a = ids[0], b = ids[ids.length - 1], o = WCS.offset(...t[a.id], ...t[b.id]);
    return norm([o.e, o.n]) / ((b.mjd - a.mjd) * 24);
  }

  // ------------------------------------------------------------ measure
  function mark(which) {
    const S = window.App.S; if (!S.sel) return;
    const f = S.frames[S.idx];
    mk[which] = { ra: S.sel.ra, dec: S.sel.dec, mjd: f.mjd, id: f.id, utc: f.utc };
    measure();
  }

  function measure() {
    const out = $("mvOut"), s = sky();
    const lab = (m) => (m ? `${m.utc.slice(0, 16).replace("T", " ")} UTC` : "not set");
    let h = `A: ${lab(mk.A)}<br>B: ${lab(mk.B)}<br>`;
    if (!mk.A || !mk.B) { out.innerHTML = h + `<span class="small">Click the mover on one frame, press Mark A; move the time bar, click it again, press Mark B.</span>`; return; }
    let [p, q] = mk.A.mjd <= mk.B.mjd ? [mk.A, mk.B] : [mk.B, mk.A];
    const dt = (q.mjd - p.mjd) * 24;
    if (dt < 1) { out.innerHTML = h + `<span class="small">Pick two frames at least 1 hour apart.</span>`; return; }
    const o = WCS.offset(p.ra, p.dec, q.ra, q.dec), sep = norm([o.e, o.n]), rate = sep / dt;
    const err = Math.SQRT2 * s.field.pixscale_arcsec / dt;                       // ~1 pixel click error on each end
    const pa = (Math.atan2(o.e, o.n) * 180 / Math.PI + 360) % 360;
    const ra = sky().frames[p.id].reflex, rb = sky().frames[q.id].reflex, rho = [(ra[0] + rb[0]) / 2, (ra[1] + rb[1]) / 2];
    const dEst = norm(rho) / rate;
    const ang = Math.acos(Math.max(-1, Math.min(1, (o.e * rho[0] + o.n * rho[1]) / (sep * norm(rho))))) * 180 / Math.PI;
    h += `Moved <b>${fmt(sep, 0)}\u2033</b> in ${fmt(dt / 24, 1)} d: <b>${fmt(rate, 2)} \u00b1 ${fmt(err, 2)} \u2033/hour</b>, direction ${fmt(pa, 0)}\u00b0 (N through E).<br>`;
    let verdict;
    if (dEst < 20) verdict = `Too fast for anything beyond ~20 AU (a body at 20 AU drifts at most ${fmt(norm(rho) / 20, 1)}\u2033/h here). <b>Nearby object: asteroid or comet.</b>`;
    else if (ang <= 35) verdict = `Slow, and drifting the way Earth's orbital motion predicts. <b>Candidate distant body, roughly ${fmt(dEst, 0)} AU</b> (\u00b1 ${fmt(100 * err / rate, 0)}%). Flag it and follow up.`;
    else verdict = `Slow, but not drifting the way a distant body should (off by ${fmt(ang, 0)}\u00b0). More likely noise, an artifact or a mis-click.`;
    out.innerHTML = h + verdict + `<br><span class="small">Distance estimate = Earth-reflex drift at 1 AU (${fmt(norm(rho), 0)}\u2033/h) \u00f7 your rate; valid only for bodies beyond ~20 AU.</span>`;
  }

  // ------------------------------------------------------------ wiring
  $("markA").onclick = () => mark("A"); $("markB").onclick = () => mark("B");
  $("clearMk").onclick = () => { mk.A = mk.B = null; measure(); };
  $("pxDist").oninput = simulate; $("pxDraw").onchange = simulate;
  document.addEventListener("sx:frame", simulate);
  document.addEventListener("sx:skyready", simulate);
  document.addEventListener("sx:zoom", simulate);
  document.addEventListener("sx:region", () => { mk.A = mk.B = null; $("mvCard").hidden = true; measure(); });
  document.addEventListener("sx:skyready", () => { $("mvCard").hidden = false; measure(); });
  document.addEventListener("sx:select", () => { $("markA").disabled = $("markB").disabled = false; });
})();
