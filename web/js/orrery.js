// Solar System panel: top-down view of the planets, playable through time, synced to the frame you are viewing.
// Data: tiles/orrery.json (make_orrery.py). Radius uses a square-root scale so Mercury and Neptune both fit.
(() => {
  const $ = (id) => document.getElementById(id);
  const D = Math.PI / 180, AU_KM = 1.495978707e8;
  const COL = { mercury: "#b8b8b8", venus: "#f0e0a0", earth: "#4da3ff", mars: "#ee6a4f", jupiter: "#e0a468", saturn: "#ead58f", uranus: "#7fd8e6", neptune: "#6b88ff" };
  const NAME = (s) => s[0].toUpperCase() + s.slice(1);
  let cv, ctx, bcv, bctx, bsz = 0, big = false, data = null, t = 0, playing = false, last = 0, lon = null, tick = 0;

  let SZ = 316, R = 144, K = 1;
  const rad = (au) => R * (0.1 + 0.9 * Math.sqrt(au / 31));
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

  // ---- real planet photos (assets/planets/<name>.png, made by data-prep/fetch_planets.py); shaded spheres until they exist
  const PX = { sun: 26, mercury: 9, venus: 12, earth: 13, mars: 10, jupiter: 28, saturn: 42, uranus: 20, neptune: 20 };
  const sprites = {};
  function sprite(n) {
    if (!(n in sprites)) {
      const im = new Image(); sprites[n] = null;
      im.onload = () => { sprites[n] = im; draw(); }; im.onerror = () => { sprites[n] = false; };
      im.src = `assets/planets/${n}.png`;
    }
    return sprites[n] || null;
  }
  const stars = Array.from({ length: 170 }, (_, i) => { const a = Math.sin(i * 127.1) * 43758.5453, b = Math.sin(i * 311.7) * 12543.853; return [a - Math.floor(a), b - Math.floor(b), 0.15 + ((a * 7) % 1 + 1) % 1 * 0.5]; });
  function sphere(c, x, y, r, col, n) {                       // fallback: lit sphere (+ rings for Saturn)
    const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, "#fff8"); g.addColorStop(0.18, col); g.addColorStop(1, "#05070b");
    if (n === "saturn") { c.save(); c.translate(x, y); c.rotate(-0.4); c.beginPath(); c.ellipse(0, 0, r * 1.7, r * 0.55, 0, 0, 7); c.strokeStyle = "rgba(234,213,143,.7)"; c.lineWidth = Math.max(1, r * 0.22); c.stroke(); c.restore(); }
    c.beginPath(); c.arc(x, y, r, 0, 7); c.fillStyle = g; c.fill();
  }
  function body(c, n, x, y) {
    const s = PX[n] * K, im = sprite(n);
    if (n === "sun") { const g = c.createRadialGradient(x, y, 0, x, y, s * 1.7); g.addColorStop(0, "rgba(255,190,80,.55)"); g.addColorStop(0.35, "rgba(255,150,40,.16)"); g.addColorStop(1, "rgba(255,150,40,0)"); c.fillStyle = g; c.fillRect(x - s * 2, y - s * 2, s * 4, s * 4); }
    if (im) c.drawImage(im, x - s / 2, y - s / 2, s, s); else sphere(c, x, y, s / 2 * (n === "saturn" ? 0.55 : 1), COL[n] || "#ffd23f", n);
    return s;
  }

  function paint(c, size) {
    SZ = size; R = size / 2 - size * 0.05; K = size / 316;
    c.clearRect(0, 0, SZ, SZ);
    for (const [u, v, a] of stars) { c.fillStyle = `rgba(255,255,255,${a})`; c.fillRect(u * SZ, v * SZ, K > 1.5 ? 1.5 : 1, K > 1.5 ? 1.5 : 1); }
    c.font = `italic 400 ${Math.max(13, SZ / 33)}px "CMU Serif","Latin Modern Roman",Georgia,serif`; c.textBaseline = "alphabetic";
    for (const n of Object.keys(data.bodies)) {
      c.beginPath(); data.bodies[n].orbit.forEach(([x, y], i) => { const p = xy(x, y); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); });
      c.strokeStyle = n === "earth" ? "rgba(122,167,255,.5)" : "rgba(255,255,255,.09)"; c.lineWidth = 1; c.stroke();
    }
    body(c, "sun", SZ / 2, SZ / 2);
    const e = at("earth", t), ep = xy(e[0], e[1]);
    if (lon !== null) {                                    // where SPHEREx is looking from Earth (projected on the ecliptic)
      const far = xy(e[0] + 60 * Math.cos(lon * D), e[1] + 60 * Math.sin(lon * D));
      c.beginPath(); c.moveTo(ep[0], ep[1]); c.lineTo(far[0], far[1]); c.strokeStyle = "rgba(217,168,255,.85)"; c.lineWidth = 1.2; c.setLineDash([5 * K, 4 * K]); c.stroke(); c.setLineDash([]);
      c.fillStyle = "#d9a8ff"; c.fillText("direction of this field", Math.min(far[0], SZ - 112 * K), Math.max(far[1] + 12 * K, 12 * K));
    }
    const order = Object.keys(data.bodies).map((n) => [n, at(n, t)]).sort((p, q) => Math.hypot(q[1][0], q[1][1]) - Math.hypot(p[1][0], p[1][1]));
    for (const [n, p] of order) {                          // far planets first so near ones sit on top
      const q = xy(p[0], p[1]), s = body(c, n, q[0], q[1]);
      if (n === "earth") { c.beginPath(); c.arc(q[0], q[1], s / 2 + 3 * K, 0, 7); c.strokeStyle = "rgba(122,167,255,.55)"; c.lineWidth = 1; c.stroke(); }
      c.fillStyle = "rgba(236,230,213,.94)";
      const tw = c.measureText(NAME(n)).width, right = q[0] + s / 2 + 5 * K + tw < SZ - 4;
      c.fillText(NAME(n), right ? q[0] + s / 2 + 5 * K : q[0] - s / 2 - 5 * K - tw, q[1] + 4 * K);
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
    document.body.classList.toggle("view-solar", on); $("viewSky").classList.toggle("on", !on); $("viewSolar").classList.toggle("on", on);
    if (on) { sizeBig(); table(); }
  }

  async function init() {
    cv = $("orrery"); const r = Math.max(2, window.devicePixelRatio || 1); cv.width = cv.height = SZ * r;
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
  document.addEventListener("sx:fonts", () => draw());
  init();
})();
