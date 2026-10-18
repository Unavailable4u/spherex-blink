// Solar System panel: top-down view of the planets, playable through time, synced to the frame you are viewing.
// Data: tiles/orrery.json (make_orrery.py). Radius uses a square-root scale so Mercury and Neptune both fit.
// Labels are placed by a small collision solver (see layoutLabels): a name never lands on another name,
// on a planet, off the canvas, or under the buttons that float over the big view.
(() => {
  const $ = (id) => document.getElementById(id);
  const D = Math.PI / 180, AU_KM = 1.495978707e8, OUTER_AU = 31;
  const COL = { mercury: "#b8b8b8", venus: "#f0e0a0", earth: "#4da3ff", mars: "#ee6a4f", jupiter: "#e0a468", saturn: "#ead58f", uranus: "#7fd8e6", neptune: "#6b88ff" };
  const NAME = (s) => s[0].toUpperCase() + s.slice(1);
  let cv, ctx, bcv, bctx, bsz = 0, big = false, data = null, t = 0, playing = false, last = 0, lon = null, tick = 0;
  let avoid = [], avoidAt = 0;                         // rectangles (canvas px) that labels keep clear of: the HUD on the big view

  // plot geometry of the canvas being painted: size, centre of the Sun, radius of the outermost orbit
  let SZ = 316, CX = 158, CY = 158, R = 144, K = 1;
  const rad = (au) => R * (0.1 + 0.9 * Math.sqrt(au / OUTER_AU));
  const xy = (x, y) => { const r = Math.hypot(x, y); if (!r) return [CX, CY]; const k = rad(r) / r; return [CX + x * k, CY - y * k]; };
  const at = (n, tt) => { const p = data.bodies[n].pos, i = Math.max(0, Math.min(data.days - 2, Math.floor(tt))), f = tt - i; return p[i].map((v, k) => v + (p[i + 1][k] - v) * f); };
  const iso = () => new Date((data.mjd0 + t - 40587) * 864e5).toISOString().slice(0, 10);

  function draw() {
    if (!data) return;
    paint(ctx, 316, false);
    if (big && bsz) { const now = performance.now(); if (now - avoidAt > 500) readAvoid(); paint(bctx, bsz, true); }
    const d = iso();
    $("orDate").textContent = d; $("orT").value = t.toFixed(2);
    if (big) $("bdDate").textContent = d;
  }

  // the floating controls of the big view, as rectangles in canvas pixels (the canvas fills the viewer)
  function readAvoid() {
    avoidAt = performance.now(); avoid = [];
    const v = $("viewer").getBoundingClientRect();
    for (const id of ["viewtabs", "bigDate", "viewtools", "simBanner"]) {
      const e = $(id); if (!e) continue;
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
      avoid.push([r.left - v.left, r.top - v.top, r.right - v.left, r.bottom - v.top]);
    }
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

  // ---- label placement ---------------------------------------------------------------------------------------
  // Each item {text, x, y, r, w, color} is the name of a disc at (x, y) with radius r. Items are placed in priority
  // order. For each one, spots are generated around the disc (12 directions x 5 distances) and scored: a spot costs a lot
  // for leaving the canvas, overlapping an earlier name, a planet or a rectangle in `avoid` (the buttons floating over
  // the big view), a little for sitting on the sight line, and a little for being far from its planet (the leader line makes up for distance). The cheapest
  // spot wins, so a crowded corner degrades gracefully (a name nudged outward, with a hairline back to its planet)
  // instead of printing on top of its neighbour.
  const ovArea = (a, b) => Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const hitDisc = (r, d, pad) => Math.hypot(Math.max(r[0], Math.min(d.x, r[2])) - d.x, Math.max(r[1], Math.min(d.y, r[3])) - d.y) < d.r + pad;
  function layoutLabels(c, items, discs, line, fs) {
    const placed = [], m = 4, h = fs, pad = 1.5 * K;
    for (const it of items) {
      const w = it.w;
      let best = null;
      for (const extra of [0, 7 * K, 15 * K, 26 * K, 40 * K]) {
        const g = it.r + 4 * K + extra;
        for (let k = 0; k < 12; k++) {
          const ang = k * Math.PI / 6, cx = Math.cos(ang), cy = -Math.sin(ang);            // canvas y points down
          const px = it.x + g * cx, py = it.y + g * cy;
          const x0 = cx > 0.3 ? px : cx < -0.3 ? px - w : px - w / 2, y0 = cy > 0.3 ? py : cy < -0.3 ? py - h : py - h / 2;
          const r = [x0, y0, x0 + w, y0 + h];
          let cost = extra * 2.2 + (k === 0 ? 0 : k === 6 ? 6 : 10 + Math.abs(k - 3));    // prefer: right, left, then the rest
          const out = Math.max(0, m - r[0]) + Math.max(0, r[2] - (SZ - m)) + Math.max(0, m - r[1]) + Math.max(0, r[3] - (SZ - m));
          if (out > 0) cost += 5000 + out * 60;
          for (const p of placed) cost += ovArea(r, [p[0] - 2 * K, p[1] - K, p[2] + 2 * K, p[3] + K]) * 3;
          for (const a of avoid) cost += ovArea(r, a) * 4;
          for (const d of discs) if (hitDisc(r, d, pad)) cost += 3000;
          if (!it.ignoreLine) for (const d of line) if (hitDisc(r, d, 0)) cost += 25;
          if (!best || cost < best.cost) best = { cost, r };
          if (cost < 1) break;
        }
        if (best && best.cost < 1) break;
      }
      const pick = best.r; placed.push(pick);
      const tx = pick[0], ty = pick[1] + h * 0.8;
      const gap = Math.max(pick[0] - it.x - it.r, it.x - it.r - pick[2], pick[1] - it.y - it.r, it.y - it.r - pick[3]);
      if (gap > 12 * K) {                                   // pushed away: tie the name back to its planet
        const ax = Math.max(pick[0], Math.min(it.x, pick[2])), ay = Math.max(pick[1], Math.min(it.y, pick[3])), d = Math.hypot(ax - it.x, ay - it.y) || 1;
        c.beginPath(); c.moveTo(it.x + (ax - it.x) / d * (it.r + 1.5 * K), it.y + (ay - it.y) / d * (it.r + 1.5 * K)); c.lineTo(ax, ay);
        c.strokeStyle = "rgba(236,230,213,.3)"; c.lineWidth = 1; c.stroke();
      }
      c.lineJoin = "round"; c.lineWidth = 3.4; c.strokeStyle = "rgba(3,5,10,.92)"; c.strokeText(it.text, tx, ty);
      c.fillStyle = it.color; c.fillText(it.text, tx, ty);
    }
  }

  // the line of sight from Earth, drawn through the distance scale (so it bends the way the map does) up to the outer ring
  function sightLine(e) {
    const pts = [];
    for (let u = 0; u <= 80; u += 0.25) {
      const x = e[0] + u * Math.cos(lon * D), y = e[1] + u * Math.sin(lon * D);
      if (Math.hypot(x, y) > OUTER_AU) break;
      pts.push(xy(x, y));
    }
    return pts;
  }

  function paint(c, size, isBig) {
    SZ = size; K = size / 316;
    if (isBig) { R = size * 0.42; CX = size / 2; CY = size * 0.465; } else { R = size / 2 - size * 0.05; CX = CY = size / 2; }
    c.clearRect(0, 0, SZ, SZ);
    for (const [u, v, a] of stars) { c.fillStyle = `rgba(255,255,255,${a})`; c.fillRect(u * SZ, v * SZ, K > 1.5 ? 1.5 : 1, K > 1.5 ? 1.5 : 1); }
    const fs = Math.max(13, SZ / 33);
    c.font = `italic 400 ${fs}px "CMU Serif","Latin Modern Roman",Georgia,serif`; c.textBaseline = "alphabetic"; c.textAlign = "left";
    for (const n of Object.keys(data.bodies)) {
      c.beginPath(); data.bodies[n].orbit.forEach(([x, y], i) => { const p = xy(x, y); i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]); });
      c.strokeStyle = n === "earth" ? "rgba(122,167,255,.5)" : "rgba(255,255,255,.09)"; c.lineWidth = 1; c.stroke();
    }
    body(c, "sun", CX, CY);
    const items = [], discs = [{ x: CX, y: CY, r: PX.sun * K * 0.5 }], dots = [];
    const e = at("earth", t), ep = xy(e[0], e[1]);
    if (lon !== null) {                                    // where SPHEREx is looking from Earth (projected on the ecliptic)
      const line = sightLine(e);
      if (line.length > 1) {
        const a = line[line.length - 2], b = line[line.length - 1], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hd = 7 * K;
        c.beginPath(); line.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])));
        c.strokeStyle = "rgba(217,168,255,.85)"; c.lineWidth = 1.3; c.setLineDash([5 * K, 4 * K]); c.stroke(); c.setLineDash([]);
        c.beginPath(); c.moveTo(b[0], b[1]); c.lineTo(b[0] - hd * Math.cos(ang - 0.45), b[1] - hd * Math.sin(ang - 0.45)); c.lineTo(b[0] - hd * Math.cos(ang + 0.45), b[1] - hd * Math.sin(ang + 0.45)); c.closePath();
        c.fillStyle = "rgba(217,168,255,.95)"; c.fill();
        const text = "direction of this field";
        items.push({ text, x: b[0], y: b[1], r: 3 * K, w: c.measureText(text).width, color: "#d9a8ff", prio: 1, ignoreLine: true });
        let lastP = null;                                  // the line itself is a soft obstacle for the other names
        for (const p of line) if (!lastP || Math.hypot(p[0] - lastP[0], p[1] - lastP[1]) > 9 * K) { dots.push({ x: p[0], y: p[1], r: 2 * K }); lastP = p; }
      }
    }
    const order = Object.keys(data.bodies).map((n) => [n, at(n, t)]).sort((p, q) => Math.hypot(q[1][0], q[1][1]) - Math.hypot(p[1][0], p[1][1]));
    for (const [n, p] of order) {                          // far planets first so near ones sit on top
      const q = xy(p[0], p[1]), s = body(c, n, q[0], q[1]);
      if (n === "earth") { c.beginPath(); c.arc(q[0], q[1], s / 2 + 3 * K, 0, 7); c.strokeStyle = "rgba(122,167,255,.55)"; c.lineWidth = 1; c.stroke(); }
      const r = s / 2 + (n === "earth" ? 3 * K : 0);
      discs.push({ x: q[0], y: q[1], r });
      items.push({ text: NAME(n), x: q[0], y: q[1], r, w: c.measureText(NAME(n)).width, color: n === "earth" ? "#cfe0ff" : "rgba(236,230,213,.94)", prio: n === "earth" ? 0 : 2 + (40 - PX[n]) / 100 });
    }
    items.sort((a, b) => a.prio - b.prio);                 // Earth, the sight line, then big planets before small ones
    layoutLabels(c, items, discs, dots, fs);
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
    const r = window.devicePixelRatio || 1; bsz = $("viewer").clientWidth; if (!bsz) return;
    bcv.width = bcv.height = bsz * r; bctx.setTransform(r, 0, 0, r, 0, 0); readAvoid(); draw();
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
    if (typeof Parallax !== "undefined") { Parallax.setData(data); document.dispatchEvent(new Event("sx:orrery")); }
    bcv = $("orBig"); bctx = bcv.getContext("2d"); $("viewtabs").hidden = false;
    $("viewSky").onclick = () => show(false); $("viewSolar").onclick = () => show(true);
    window.addEventListener("resize", () => big && sizeBig());
    if (window.ResizeObserver) new ResizeObserver(() => { if (big && $("viewer").clientWidth !== bsz) sizeBig(); }).observe($("viewer"));
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
