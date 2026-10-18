// Known-object overlay: draws the catalogued target's track and any planet inside the field.
// Uncheck "Show known objects" to hunt blind first. Data: SkyMap.data() (tiles/<region>/sky.json)
(() => {
  const NS = "http://www.w3.org/2000/svg";
  const $ = (id) => document.getElementById(id);
  const NAME = (s) => s[0].toUpperCase() + s.slice(1);
  let lastScale = 0;

  const unitsPerPx = () => { const A = window.App; return A.S.wcs.width / $("viewer").clientWidth / A.view.s; };   // tile px per screen px

  function render() {
    const A = window.App, sky = SkyMap.data(), svg = $("overlay");
    svg.querySelectorAll(".kn").forEach((n) => n.remove());
    if (!A || !A.S.wcs || !sky || !$("showKnown").checked || !A.S.frames.length) return;
    const S = A.S, cur = S.frames[S.idx].id, k = unitsPerPx();
    const track = Object.entries(sky.target || {}).filter((e) => sky.frames[e[0]]).sort((a, b) => sky.frames[a[0]].mjd - sky.frames[b[0]].mjd)
      .map(([id, [ra, dec]]) => { const q = S.wcs.toDraw(ra, dec); return { id, col: q.x, row: q.y }; });
    const g = document.createElementNS(NS, "g"); g.setAttribute("class", "kn");
    let h = "";
    if (track.length > 1) h += `<polyline points="${track.map((p) => p.col + "," + p.row).join(" ")}" fill="none" stroke="#ffb347" stroke-opacity=".55" stroke-width="1.2" stroke-dasharray="${5 * k},${4 * k}" vector-effect="non-scaling-stroke"/>`;
    for (const p of track) h += `<circle cx="${p.col}" cy="${p.row}" r="${2.2 * k}" fill="#ffb347" fill-opacity="${p.id === cur ? 1 : 0.45}"/>`;
    const here = track.find((p) => p.id === cur);
    if (here) h += `<circle cx="${here.col}" cy="${here.row}" r="${11 * k}" fill="none" stroke="#ffb347" stroke-width="1.8" vector-effect="non-scaling-stroke"/>` +
      `<text x="${here.col + 15 * k}" y="${here.row - 12 * k}" font-size="${14.5 * k}" fill="#ffd9a0" stroke="#000" stroke-width="${3 * k}" paint-order="stroke">${sky.target_name || "known object"} (known asteroid)</text>`;
    const fr = sky.frames[cur];
    if (fr) for (const b of fr.in_field) {
      const q = S.wcs.toDraw(...fr.pos[b]), p = { col: q.x, row: q.y };
      h += `<circle cx="${p.col}" cy="${p.row}" r="${9 * k}" fill="none" stroke="#7fd8e6" stroke-width="1.8" vector-effect="non-scaling-stroke"/>` +
        `<text x="${p.col + 13 * k}" y="${p.row - 10 * k}" font-size="${14.5 * k}" fill="#bff3fb" stroke="#000" stroke-width="${3 * k}" paint-order="stroke">${NAME(b)}</text>`;
    }
    g.innerHTML = h; svg.appendChild(g);
    keepLabelsInside(g, S, k);
  }

  // A name sits to the upper right of its ring. Near the right or top edge that would clip it (or push it under the
  // top-right buttons), so flip it to the left of the ring, or under it. Measured from the real text, not guessed.
  function keepLabelsInside(g, S, k) {
    const A = window.App, w = S.wcs.width, h = S.wcs.height, s = A.view.s, W = $("viewer").clientWidth, H = $("viewer").clientHeight;
    const left = -A.view.tx / s / W * w, right = (W - A.view.tx) / s / W * w, top = -A.view.ty / s / H * h, bottom = (H - A.view.ty) / s / H * h, m = 8 * k;
    g.querySelectorAll("text").forEach((t) => {
      let b; try { b = t.getBBox(); } catch (e) { return; }
      const x = +t.getAttribute("x"), y = +t.getAttribute("y");
      if (b.x + b.width > right - m) { t.setAttribute("text-anchor", "end"); t.setAttribute("x", x - 30 * k); }
      if (b.y < top + m) t.setAttribute("y", y + 34 * k);
      if (b.y + b.height > bottom - m) t.setAttribute("y", y - 8 * k);
      const c = t.getBBox();
      if (c.x < left + m) { t.setAttribute("text-anchor", "start"); t.setAttribute("x", left + m); }
    });
  }

  document.addEventListener("sx:frame", render);
  document.addEventListener("sx:skyready", render);
  document.addEventListener("sx:zoom", () => { if (window.App && window.App.view.s !== lastScale) { lastScale = window.App.view.s; render(); } });
  $("showKnown").addEventListener("change", render);
})();
