// Solar System panel: top-down view of the planets, playable through time, synced to the frame you are viewing.
// Data: tiles/orrery.json (make_orrery.py). Radius uses a square-root scale so Mercury and Neptune both fit.
(() => {
  const $ = (id) => document.getElementById(id);
  const D = Math.PI / 180, AU_KM = 1.495978707e8;
  const COL = { mercury: "#b8b8b8", venus: "#f0e0a0", earth: "#4da3ff", mars: "#ee6a4f", jupiter: "#e0a468", saturn: "#ead58f", uranus: "#7fd8e6", neptune: "#6b88ff" };
  const NAME = (s) => s[0].toUpperCase() + s.slice(1);
  let cv, ctx, bcv, bctx, bsz = 0, big = false, data = null, t = 0, playing = false, last = 0, lon = null, tick = 0;

  let SZ = 316, R = 144, K = 1;
  const rad = (au) => R * Math.sqrt(au / 31);
  const xy = (x, y) => { const r = Math.hypot(x, y); if (!r) return [SZ / 2, SZ / 2]; const k = rad(r) / r; return [SZ / 2 + x * k, SZ / 2 - y * k]; };
  const at = (n, tt) => { const p = data.bodies[n].pos, i = Math.max(0, Math.min(data.days - 2, Math.floor(tt))), f = tt - i; return p[i].map((v, k) => v + (p[i + 1][k] - v) * f); };

  function draw() {
    if (!data) return;
    paint(ctx, 316);
    if (big && bsz) paint(bctx, bsz);
    const mjd = data.mjd0 + t, d = new Date((mjd - 40587) * 864e5);
    $("orDate").textContent = d.toISOString().slice(0, 10); $("orT").value = t.toFixed(2);
    if (big) $("bigDate").textContent = d.toISOString().slice(0, 10) + "  \u00b7  top-down view, square-root distance scale";
  }

  function paint(c, size) {
    SZ = size; R = size / 2 - size * 0.045; K = size / 316;
    const ctx = c;
    ctx.clearRect(0, 0, SZ, SZ); ctx.font = Math.max(9, SZ / 50) + "px system-ui,sans-serif";
    for (const n of Object.keys(data.bodies)) {
      ctx.beginPath(); data.bodies[n].orbit.forEach(([x, y], i) => { const p = xy(x, y); i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]); });
      ctx.strokeStyle = n === "earth" ? "rgba(77,163,255,.45)" : "#232b3d"; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(SZ / 2, SZ / 2, 4.5 * K, 0, 7); ctx.fillStyle = "#ffd23f"; ctx.fill();
    const e = at("earth", t), ep = xy(e[0], e[1]);
    if (lon !== null) {                                    // where SPHEREx is looking from Earth (projected on the ecliptic)
      ctx.beginPath(); ctx.moveTo(ep[0], ep[1]);
      const far = xy(e[0] + 60 * Math.cos(lon * D), e[1] + 60 * Math.sin(lon * D));
      ctx.lineTo(far[0], far[1]); ctx.strokeStyle = "rgba(211,107,255,.8)"; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = "#d9a8ff"; ctx.fillText("field direction", Math.min(far[0], SZ - 62 * K), Math.max(far[1] + 10 * K, 10 * K));
    }
    for (const n of Object.keys(data.bodies)) {
      const p = at(n, t), q = xy(p[0], p[1]);
      ctx.beginPath(); ctx.arc(q[0], q[1], (n === "earth" ? 4 : 3) * K, 0, 7); ctx.fillStyle = COL[n]; ctx.fill();
      ctx.fillStyle = "#cfd5e3"; ctx.fillText(NAME(n), q[0] + 6 * K, q[1] - 4 * K);
    }
  }

  function table() {
    if (!data) return;
    const e = at("earth", t), rows = Object.keys(data.bodies).map((n) => {
      const p = at(n, t), a = at(n, Math.max(0, t - 1)), b = at(n, Math.min(data.days - 1, t + 1));
      const sun = Math.hypot(...p), earth = Math.hypot(p[0] - e[0], p[1] - e[1], p[2] - e[2]);
      const v = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 2 * AU_KM / 86400;
      return `<tr><td style="color:${COL[n]}">${NAME(n)}</td><td>${sun.toFixed(2)}</td><td>${n === "earth" ? "—" : earth.toFixed(2)}</td><td>${v.toFixed(1)}</td></tr>`;
    });
    $("orTable").innerHTML = `<tr><th>Planet</th><th>Sun AU</th><th>Earth AU</th><th>km/s</th></tr>` + rows.join("");
  }

  function frame(ts) {
    if (!playing) return;
    t += (ts - last) / 1000 * +$("orSpeed").value; last = ts;
    if (t >= data.days - 1) t = 0;
    draw(); if (ts - tick > 200) { table(); tick = ts; }
    requestAnimationFrame(frame);
  }
  function setT(v) { t = Math.max(0, Math.min(data.days - 1.001, v)); draw(); table(); }
  function syncToFrame() {
    const A = window.App; if (!data || !A || !A.S.frames.length) return;
    setT(A.S.frames[A.S.idx].mjd - data.mjd0);
  }

  function sizeBig() {
    const r = window.devicePixelRatio || 1; bsz = $("viewer").clientWidth;
    bcv.width = bcv.height = bsz * r; bctx.setTransform(r, 0, 0, r, 0, 0); draw();
  }
  function show(on) {
    big = on; bcv.style.display = on ? "block" : "none"; $("bigDate").hidden = !on;
    $("viewSky").classList.toggle("on", !on); $("viewSolar").classList.toggle("on", on);
    if (on) { sizeBig(); table(); }
  }

  async function init() {
    cv = $("orrery"); const r = window.devicePixelRatio || 1; cv.width = cv.height = SZ * r;
    cv.style.width = "100%"; cv.style.aspectRatio = "1"; ctx = cv.getContext("2d"); ctx.scale(r, r);
    try { const res = await fetch("tiles/orrery.json"); if (!res.ok) return; data = await res.json(); } catch (e) { return; }
    bcv = $("orBig"); bctx = bcv.getContext("2d"); $("viewtabs").hidden = false;
    $("viewSky").onclick = () => show(false); $("viewSolar").onclick = () => show(true);
    window.addEventListener("resize", () => big && sizeBig());
    $("orCard").hidden = false; $("orT").max = data.days - 1.001;
    $("orPlay").onclick = () => { playing = !playing; $("orPlay").textContent = playing ? "Pause" : "Play"; $("orPlay").classList.toggle("on", playing); if (playing) { last = performance.now(); requestAnimationFrame(frame); } };
    $("orT").oninput = (e) => { playing = false; $("orPlay").textContent = "Play"; $("orPlay").classList.remove("on"); setT(+e.target.value); };
    $("orSync").onclick = syncToFrame;
    syncToFrame(); if (!window.App || !window.App.S.frames.length) setT(0);
  }
  document.addEventListener("sx:frame", () => { if (!playing) syncToFrame(); });
  document.addEventListener("sx:skyready", () => { const s = SkyMap.data(); if (s) { lon = WCS.ecliptic(s.field.ra, s.field.dec).lon; draw(); } });
  init();
})();
