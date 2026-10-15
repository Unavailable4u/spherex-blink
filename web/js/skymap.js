// All-sky mini-map (Hammer projection): Milky Way, ecliptic, Sun + planets on the frame's date,
// the 90-degrees-from-Sun circle, this field and the known target's track. Data: tiles/<region>/sky.json
const SkyMap = (() => {
  const D = Math.PI / 180, W = 316, H = 158;
  const COL = { sun: "#ffd23f", mercury: "#b8b8b8", venus: "#f0e0a0", mars: "#ee6a4f", jupiter: "#e0a468", saturn: "#ead58f", uranus: "#7fd8e6", neptune: "#6b88ff" };
  const NAME = (s) => s[0].toUpperCase() + s.slice(1);
  const $ = (id) => document.getElementById(id);
  let cv, ctx, data = null, last = null, token = 0;

  function proj(ra, dec) {                       // Hammer; RA increases to the left, centre = 12h
    const lam = (180 - ra) * D, phi = dec * D, k = Math.sqrt(1 + Math.cos(phi) * Math.cos(lam / 2));
    return [W / 2 + (Math.cos(phi) * Math.sin(lam / 2) / k) * (W / 2), H / 2 - (Math.sin(phi) / k) * (H / 2)];
  }
  const toRaDec = (v) => [((Math.atan2(v[1], v[0]) / D) % 360 + 360) % 360, Math.asin(Math.max(-1, Math.min(1, v[2]))) / D];
  const vec = (ra, dec) => [Math.cos(dec * D) * Math.cos(ra * D), Math.cos(dec * D) * Math.sin(ra * D), Math.sin(dec * D)];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const unit = (a) => { const n = Math.hypot(...a); return a.map((x) => x / n); };
  const GAL = [[-0.0548755604, -0.8734370902, -0.4838350155], [0.4941094279, -0.4448296300, 0.7469822445], [-0.8676661490, -0.1980763734, 0.4559837762]];
  const galToEq = (l, b) => { const g = [Math.cos(b * D) * Math.cos(l * D), Math.cos(b * D) * Math.sin(l * D), Math.sin(b * D)];
    return toRaDec([0, 1, 2].map((i) => GAL[0][i] * g[0] + GAL[1][i] * g[1] + GAL[2][i] * g[2])); };
  const eclToEq = (lon) => { const e = 23.4393 * D, x = Math.cos(lon * D), y = Math.sin(lon * D); return toRaDec([x, y * Math.cos(e), y * Math.sin(e)]); };

  function line(pts, style, width, dash) {       // polyline that breaks where the map wraps
    ctx.beginPath(); ctx.setLineDash(dash || []); let prev = null;
    for (const [ra, dec] of pts) {
      const p = proj(ra, dec);
      if (!prev || Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 40) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
      prev = p;
    }
    ctx.strokeStyle = style; ctx.lineWidth = width; ctx.stroke(); ctx.setLineDash([]);
  }
  function dot(ra, dec, r, color, label) {
    const [x, y] = proj(ra, dec); ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fillStyle = color; ctx.fill();
    if (label) { ctx.fillStyle = "#cfd5e3"; const w = ctx.measureText(label).width; let lx = x + 6; if (lx + w > W - 3) lx = x - w - 6; if (lx < 3) lx = 3; ctx.fillText(label, lx, y - 5); }
  }

  function init(canvas) {
    cv = canvas; const r = window.devicePixelRatio || 1; cv.width = W * r; cv.height = H * r;
    cv.style.width = "100%"; cv.style.aspectRatio = `${W} / ${H}`; ctx = cv.getContext("2d"); ctx.scale(r, r);
  }

  function setRegion(id) {
    const my = ++token; data = null; $("skyCard").hidden = true;
    fetch(`tiles/${id}/sky.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
      if (my !== token) return;                  // user switched region meanwhile
      data = j; $("skyCard").hidden = !j;
      if (j) { update(last); document.dispatchEvent(new Event("sx:skyready")); }
    });
  }

  function update(frameId) {
    last = frameId; if (!data || !ctx) return;
    const fr = data.frames[frameId] || Object.values(data.frames)[0]; if (!fr) return;
    ctx.clearRect(0, 0, W, H); ctx.font = "9px system-ui,sans-serif";
    ctx.beginPath(); ctx.ellipse(W / 2, H / 2, W / 2 - 1, H / 2 - 1, 0, 0, 7); ctx.fillStyle = "#06080d"; ctx.fill();
    ctx.save(); ctx.clip();
    for (let d = -60; d <= 60; d += 30) line(Array.from({ length: 73 }, (_, i) => [i * 5, d]), "#1b2233", 0.6);
    for (let r = 0; r < 360; r += 30) line(Array.from({ length: 37 }, (_, i) => [r, -90 + i * 5]), "#1b2233", 0.6);
    const gal = Array.from({ length: 181 }, (_, i) => galToEq(i * 2, 0));
    line(gal, "rgba(150,170,255,.22)", 9); line(gal, "rgba(190,205,255,.35)", 2);
    line(Array.from({ length: 181 }, (_, i) => eclToEq(i * 2)), "rgba(255,200,120,.5)", 1);
    const s = vec(...fr.pos.sun), u = unit(cross(s, [0, 0, 1])), v = cross(s, u);
    line(Array.from({ length: 121 }, (_, i) => toRaDec([0, 1, 2].map((k) => Math.cos(i * 3 * D) * u[k] + Math.sin(i * 3 * D) * v[k]))), "rgba(255,210,63,.6)", 1, [3, 3]);
    ctx.restore();
    ctx.beginPath(); ctx.ellipse(W / 2, H / 2, W / 2 - 1, H / 2 - 1, 0, 0, 7); ctx.strokeStyle = "#2a3248"; ctx.lineWidth = 1; ctx.stroke();
    const gc = galToEq(0, 0); dot(gc[0], gc[1], 2.5, "#9fb4ff", "Galactic centre");
    const tr = Object.entries(data.target || {}).filter((e) => data.frames[e[0]]).sort((a, b) => data.frames[a[0]].mjd - data.frames[b[0]].mjd).map((e) => e[1]);
    if (tr.length > 1) line(tr, "rgba(255,179,71,.9)", 1.5);
    const [fx, fy] = proj(data.field.ra, data.field.dec);
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.2; ctx.strokeRect(fx - 4, fy - 4, 8, 8);
    if (data.target && data.target[frameId]) dot(...data.target[frameId], 2.8, "#ffb347", null);
    for (const b of data.bodies) dot(...fr.pos[b], b === "sun" ? 4.5 : 2.4, COL[b], NAME(b));
    const inf = fr.in_field.length ? "In this field right now: " + fr.in_field.map(NAME).join(", ") + "." : `No planets in this field, so anything that moves here is a small body, here ${data.target_name || "an asteroid"}.`;
    $("skyNote").textContent = `This field is ${fr.elong.toFixed(0)}\u00b0 from the Sun, ecliptic latitude ${data.field.ecl_lat >= 0 ? "+" : ""}${data.field.ecl_lat.toFixed(0)}\u00b0. ${inf}`;
  }
  return { init, update, setRegion, data: () => data };
})();

document.addEventListener("sx:region", (e) => SkyMap.setRegion(e.detail.id));
document.addEventListener("sx:frame", (e) => SkyMap.update(e.detail.id));
