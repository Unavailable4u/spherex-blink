// All-sky mini-map (Hammer projection): Milky Way, ecliptic, Sun + planets on the frame's date,
// the 90-degrees-from-Sun circle, this field and the known target's track. Data: tiles/<region>/sky.json
const SkyMap = (() => {
  const D = Math.PI / 180, W = 316, H = 158;
  const COL = { sun: "#ffd23f", mercury: "#b8b8b8", venus: "#f0e0a0", mars: "#ee6a4f", jupiter: "#e0a468", saturn: "#ead58f", uranus: "#7fd8e6", neptune: "#6b88ff" };
  const NAME = (s) => s[0].toUpperCase() + s.slice(1);
  const $ = (id) => document.getElementById(id);
  const DPR = Math.max(2, window.devicePixelRatio || 1);
  let cv, ctx, data = null, last = null, token = 0, mw = null;

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
    if (label) { ctx.fillStyle = "#ece6d5"; const w = ctx.measureText(label).width; let lx = x + 6; if (lx + w > W - 3) lx = x - w - 6; if (lx < 3) lx = 3; ctx.fillText(label, lx, y - 5); }
  }


  // Real Milky Way: re-project the ESO panorama (galactic, equirectangular) into this Hammer map once.
  function loadMilkyWay() {
    const im = new Image();
    im.onload = () => {
      const sw = 2048, sh = 1024, src = document.createElement("canvas"); src.width = sw; src.height = sh;
      const sc = src.getContext("2d", { willReadFrequently: true }); sc.drawImage(im, 0, 0, sw, sh);
      const sd = sc.getImageData(0, 0, sw, sh).data;
      const ow = Math.round(W * DPR), oh = Math.round(H * DPR), out = document.createElement("canvas"); out.width = ow; out.height = oh;
      const oc = out.getContext("2d"), od = oc.createImageData(ow, oh), o = od.data;
      for (let py = 0; py < oh; py++) for (let px = 0; px < ow; px++) {
        const X = (px + 0.5) / ow * 2 - 1, Y = 1 - (py + 0.5) / oh * 2, q = X * X + Y * Y;
        if (q > 1) continue;
        const x = 2 * Math.SQRT2 * X, y = Math.SQRT2 * Y, z = Math.sqrt(1 - q / 2);          // inverse Hammer
        const lam = 2 * Math.atan2(z * x, 2 * (2 * z * z - 1)), phi = Math.asin(z * y);
        const eq = vec(180 - lam / D, phi / D);
        const gx = GAL[0][0] * eq[0] + GAL[0][1] * eq[1] + GAL[0][2] * eq[2], gy = GAL[1][0] * eq[0] + GAL[1][1] * eq[1] + GAL[1][2] * eq[2], gz = GAL[2][0] * eq[0] + GAL[2][1] * eq[1] + GAL[2][2] * eq[2];
        const l = Math.atan2(gy, gx) / D, b = Math.asin(Math.max(-1, Math.min(1, gz))) / D;
        const u = ((0.5 - l / 360) % 1 + 1) % 1 * (sw - 1), v = (0.5 - b / 180) * (sh - 1), u0 = Math.floor(u), v0 = Math.floor(v), fu = u - u0, fv = v - v0;
        const i00 = (v0 * sw + u0) * 4, i10 = (v0 * sw + Math.min(sw - 1, u0 + 1)) * 4, i01 = (Math.min(sh - 1, v0 + 1) * sw + u0) * 4, i11 = (Math.min(sh - 1, v0 + 1) * sw + Math.min(sw - 1, u0 + 1)) * 4, oi = (py * ow + px) * 4;
        for (let k = 0; k < 3; k++) o[oi + k] = (sd[i00 + k] * (1 - fu) + sd[i10 + k] * fu) * (1 - fv) + (sd[i01 + k] * (1 - fu) + sd[i11 + k] * fu) * fv;
        o[oi + 3] = 255;
      }
      oc.putImageData(od, 0, 0); mw = out; if (data) update(last);
    };
    im.src = "assets/milkyway.jpg";                      // missing file = vector fallback
  }

  function init(canvas) {
    cv = canvas; const r = DPR; cv.width = W * r; cv.height = H * r;
    cv.style.width = "100%"; cv.style.aspectRatio = `${W} / ${H}`; ctx = cv.getContext("2d"); ctx.scale(r, r); loadMilkyWay();
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
    ctx.clearRect(0, 0, W, H); ctx.font = 'italic 400 11px "CMU Serif","Latin Modern Roman",Georgia,serif';
    ctx.beginPath(); ctx.ellipse(W / 2, H / 2, W / 2 - 1, H / 2 - 1, 0, 0, 7); ctx.fillStyle = "#06080d"; ctx.fill();
    ctx.save(); ctx.clip();
    for (let d = -60; d <= 60; d += 30) line(Array.from({ length: 73 }, (_, i) => [i * 5, d]), mw ? "rgba(255,255,255,.10)" : "#1b2233", 0.6);
    for (let r = 0; r < 360; r += 30) line(Array.from({ length: 37 }, (_, i) => [r, -90 + i * 5]), mw ? "rgba(255,255,255,.10)" : "#1b2233", 0.6);
    if (mw) { ctx.globalAlpha = 0.95; ctx.drawImage(mw, 0, 0, W, H); ctx.globalAlpha = 1; }
    else { const gal = Array.from({ length: 181 }, (_, i) => galToEq(i * 2, 0)); line(gal, "rgba(150,170,255,.22)", 9); line(gal, "rgba(190,205,255,.35)", 2); }
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
  return { init, update, setRegion, data: () => data, redraw: () => update(last) };
})();

document.addEventListener("sx:region", (e) => SkyMap.setRegion(e.detail.id));
document.addEventListener("sx:fonts", () => SkyMap.redraw());
document.addEventListener("sx:frame", (e) => SkyMap.update(e.detail.id));
