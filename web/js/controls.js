// App glue: region/band/time controls, blink, click -> metadata, flagging, zoom/pan.
(() => {
  const $ = (id) => document.getElementById(id);
  const NS = "http://www.w3.org/2000/svg";
  const S = { man: null, wcs: null, band: null, frames: [], imgs: [], idx: 0, ref: 0, sel: null, flags: [], region: null };
  const view = { s: 1, tx: 0, ty: 0 };
  const cv = $("sky"), svg = $("overlay"), stage = $("stage"), viewer = $("viewer");
  Renderer.init(cv);

  const fmtTime = (f) => f.utc.replace("T", " ").slice(0, 16) + " UTC";
  const say = (id, t) => { $(id).textContent = t; };
  const getJSON = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(u + " -> " + r.status); return r.json(); };

  // ---------------------------------------------------------------- region / band
  async function loadRegion(id) {
    S.region = id; Renderer.stopBlink(); $("blink").classList.remove("on");
    try {
      [S.man, S.wcs] = [await getJSON(`tiles/${id}/manifest.json`), null];
      S.wcs = WCS.make(await getJSON(`tiles/${id}/wcs.json`));
    } catch (e) { say("flagStatus", "Could not load region: " + e.message); return; }
    const { width: w, height: h } = S.wcs;
    Renderer.resize(w, h); svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    svg.innerHTML = ""; S.sel = null; $("submitFlag").disabled = true; resetView();
    $("bands").innerHTML = "";
    for (const b of Object.keys(S.man.bands)) {
      const wl = S.man.frames.filter((f) => f.band === b && f.wavelength_um).map((f) => f.wavelength_um);
      const btn = document.createElement("button"); btn.dataset.band = b;
      btn.innerHTML = `${b}<small>${wl.length ? Math.min(...wl).toFixed(2) + "–" + Math.max(...wl).toFixed(2) + " µm" : "—"}</small>`;
      btn.onclick = () => setBand(b); $("bands").appendChild(btn);
    }
    S.flags = await Flagging.list(id); say("flagCount", `(${S.flags.length} so far${Flagging.remote ? "" : ", this browser"})`);
    setBand(Object.keys(S.man.bands)[0]);
  }

  async function setBand(b) {
    Renderer.stopBlink(); $("blink").classList.remove("on");
    S.band = b;
    document.querySelectorAll("#bands button").forEach((x) => x.classList.toggle("on", x.dataset.band === b));
    S.frames = S.man.frames.filter((f) => f.band === b).sort((p, q) => p.mjd - q.mjd);
    $("time").max = S.frames.length - 1;
    $("loading").hidden = false;
    S.imgs = await Promise.all(S.frames.map((f) => Renderer.load(`tiles/${S.region}/${f.path}`).catch(() => null)));
    $("loading").hidden = true;
    // open on the frame that covers the most sky; blink against the next best
    const order = S.frames.map((f, i) => i).sort((a, b) => S.frames[b].coverage - S.frames[a].coverage);
    S.ref = order[1] ?? order[0]; goto(order[0], false);
  }

  // ---------------------------------------------------------------- time
  function goto(i, fade = true) {
    i = Math.max(0, Math.min(S.frames.length - 1, i)); S.idx = i; $("time").value = i;
    const f = S.frames[i], img = S.imgs[i];
    say("frameLabel", `${fmtTime(f)}  (${i + 1}/${S.frames.length})`);
    if (img && !Renderer.blinking()) fade ? Renderer.fadeTo(img) : Renderer.draw(img);
    else if (!img) say("flagStatus", "Tile missing for this frame.");
    blinkInfo(); Flagging.render(svg, S.flags, f.id, S.wcs); showMeta();
  }
  const blinkInfo = () => say("blinkInfo", S.frames.length > 1 ? `A (time bar): ${fmtTime(S.frames[S.idx])}   ⇄   B: ${fmtTime(S.frames[S.ref])}` : "");

  function toggleBlink() {
    if (Renderer.blinking()) { Renderer.stopBlink(); $("blink").classList.remove("on"); goto(S.idx, false); return; }
    if (S.frames.length < 2) return;
    if (S.ref === S.idx) S.ref = S.idx > 0 ? S.idx - 1 : 1;
    blinkInfo(); $("blink").classList.add("on");
    Renderer.startBlink(() => S.imgs[S.idx], () => S.imgs[S.ref], 3);
  }

  // ---------------------------------------------------------------- click -> metadata
  function valueAt(col, row) { const im = S.imgs[S.idx]; return im ? Renderer.value(im, col, row) : null; }

  function showMeta() {
    const m = $("meta"); if (!S.sel) return;
    const { col, row, ra, dec } = S.sel, f = S.frames[S.idx], v = valueAt(col, row);
    let flux = "—", lam = f.wavelength_um;
    if (v !== null) {
      const st = S.man.bands[S.band].stretch, y = v / 255;
      flux = v === 0 ? "no data / at floor" : (st.lo + (st.hi - st.lo) * st.a * Math.sinh(y * Math.asinh(1 / st.a)) + f.bkg).toPrecision(3) + " " + (f.unit || "MJy/sr");
    }
    if (f.wavelength_plane) { const p = f.wavelength_plane; lam = p.c0 + p.per_col * col + p.per_row * row; }
    const rows = [["RA", `${ra.toFixed(5)}°  ${WCS.hms(ra)}`], ["Dec", `${dec.toFixed(5)}°  ${WCS.dms(dec)}`],
      ["Pixel", `${col.toFixed(0)}, ${row.toFixed(0)}`], ["Band", `${S.band}${lam ? "  ·  " + (+lam).toFixed(3) + " µm" : ""}`],
      ["Epoch", `${f.epoch}  ·  ${fmtTime(f)}`], ["Intensity", flux]];
    m.innerHTML = rows.map(([k, v2]) => `<dt>${k}</dt><dd>${v2}</dd>`).join("");
  }

  function select(col, row) {
    if (col < 0 || row < 0 || col >= S.wcs.width || row >= S.wcs.height) return;
    S.sel = { col, row, ...S.wcs.toSky(col, row) };
    svg.querySelectorAll(".xh").forEach((n) => n.remove());
    const g = document.createElementNS(NS, "g"); g.setAttribute("class", "xh");
    const w = S.wcs.width, h = S.wcs.height, st = 'stroke="#ffb347" stroke-width="1" vector-effect="non-scaling-stroke"';
    g.innerHTML = `<line x1="${col}" y1="0" x2="${col}" y2="${row - 10}" ${st}/><line x1="${col}" y1="${row + 10}" x2="${col}" y2="${h}" ${st}/>` +
      `<line x1="0" y1="${row}" x2="${col - 10}" y2="${row}" ${st}/><line x1="${col + 10}" y1="${row}" x2="${w}" y2="${row}" ${st}/>` +
      `<circle cx="${col}" cy="${row}" r="10" fill="none" ${st}/>`;
    svg.appendChild(g); showMeta(); $("submitFlag").disabled = false;
  }

  // ---------------------------------------------------------------- zoom / pan
  function applyView() {
    const W = viewer.clientWidth, H = viewer.clientHeight;
    view.tx = Math.min(0, Math.max(W - W * view.s, view.tx)); view.ty = Math.min(0, Math.max(H - H * view.s, view.ty));
    stage.style.transform = `translate(${view.tx}px,${view.ty}px) scale(${view.s})`;
  }
  function resetView() { view.s = 1; view.tx = view.ty = 0; applyView(); }
  viewer.addEventListener("wheel", (e) => {
    e.preventDefault(); const r = viewer.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    const ns = Math.max(1, Math.min(12, view.s * (e.deltaY < 0 ? 1.25 : 0.8)));
    view.tx = mx - (mx - view.tx) * (ns / view.s); view.ty = my - (my - view.ty) * (ns / view.s); view.s = ns; applyView();
  }, { passive: false });

  let down = null;
  stage.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false }; stage.setPointerCapture(e.pointerId); });
  stage.addEventListener("pointermove", (e) => {
    if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y;
    if (!down.moved && Math.hypot(dx, dy) > 4) { down.moved = true; stage.classList.add("drag"); }
    if (down.moved) { view.tx = down.tx + dx; view.ty = down.ty + dy; applyView(); }
  });
  stage.addEventListener("pointerup", (e) => {
    const wasClick = down && !down.moved; down = null; stage.classList.remove("drag");
    if (!wasClick || !S.wcs) return;
    const r = cv.getBoundingClientRect();
    select(Math.floor((e.clientX - r.left) / r.width * S.wcs.width), Math.floor((e.clientY - r.top) / r.height * S.wcs.height));
  });
  window.addEventListener("resize", applyView);
  $("zoomReset").onclick = resetView;

  // ---------------------------------------------------------------- flagging
  $("submitFlag").onclick = async () => {
    if (!S.sel) return; const f = S.frames[S.idx];
    const flag = { region: S.region, frame: f.id, band: S.band, epoch: f.epoch, ra: S.sel.ra, dec: S.sel.dec,
      category: $("category").value, note: $("note").value.trim() };
    S.flags.push(flag); Flagging.render(svg, S.flags, f.id, S.wcs);
    say("flagCount", `(${S.flags.length} so far${Flagging.remote ? "" : ", this browser"})`);
    say("flagStatus", "Saving…"); $("note").value = "";
    const where = await Flagging.add(flag);
    say("flagStatus", where === "shared" ? "Flag saved for everyone." : Flagging.remote ? "Shared store unreachable — saved in this browser only." : "Saved in this browser (no shared store configured).");
  };

  // ---------------------------------------------------------------- wiring
  $("time").oninput = (e) => goto(+e.target.value, true);
  $("prev").onclick = () => goto(S.idx - 1);
  $("next").onclick = () => goto(S.idx + 1);
  $("blink").onclick = toggleBlink;
  $("setRef").onclick = () => { S.ref = S.idx; blinkInfo(); };
  document.addEventListener("keydown", (e) => {
    if (/INPUT|SELECT/.test(e.target.tagName) && e.target.type !== "range") return;
    if (e.key === "ArrowLeft") { goto(S.idx - 1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { goto(S.idx + 1); e.preventDefault(); }
    else if (e.key === " ") { toggleBlink(); e.preventDefault(); }
  });
  $("region").onchange = (e) => loadRegion(e.target.value);

  (async () => {
    try {
      const regs = (await getJSON("tiles/regions.json")).regions;
      $("region").innerHTML = regs.map((r) => `<option value="${r.id}">${r.id} (${r.frames} frames)</option>`).join("");
      const want = new URLSearchParams(location.search).get("region");
      const first = regs.find((r) => r.id === want) || regs.find((r) => r.id !== "synthetic") || regs[0];
      $("region").value = first.id; loadRegion(first.id);
    } catch (e) { say("flagStatus", "Could not load tiles/regions.json — serve this folder over http (see README)."); }
  })();
})();
