// Crowdsourced flags. Firestore REST if js/config.js is filled in, else this browser only.
const Flagging = (() => {
  const cfg = window.FLAG_CONFIG || {};
  const remote = !!(cfg.projectId && cfg.apiKey);
  const base = remote && `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/flags`;
  const KEY = "spherex-flags";
  let mem = [];
  try { mem = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { mem = []; }
  const saveLocal = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { /* private mode */ } };

  const enc = (f) => ({ fields: Object.fromEntries(Object.entries(f).map(([k, v]) =>
    [k, typeof v === "number" ? { doubleValue: v } : { stringValue: String(v ?? "") }])) });
  const dec = (d) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) =>
    [k, "doubleValue" in v ? v.doubleValue : "integerValue" in v ? +v.integerValue : v.stringValue]));

  async function list(region) {
    if (remote) {
      try {
        const r = await fetch(`${base}?pageSize=300&key=${cfg.apiKey}`);
        if (!r.ok) throw new Error(r.status);
        const j = await r.json();
        return (j.documents || []).map(dec).filter((f) => f.region === region);
      } catch (e) { /* fall through to local */ }
    }
    return mem.filter((f) => f.region === region);
  }

  // returns "shared" | "local"
  async function add(flag) {
    flag.created = Date.now();
    mem.push(flag); saveLocal();
    if (!remote) return "local";
    try {
      const r = await fetch(`${base}?key=${cfg.apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(enc(flag)) });
      return r.ok ? "shared" : "local";
    } catch (e) { return "local"; }
  }

  // pins for the current frame are solid, flags made on other frames are faint
  function render(svg, flags, frameId, wcs) {
    const ns = "http://www.w3.org/2000/svg";
    svg.querySelectorAll(".pin").forEach((n) => n.remove());
    for (const f of flags) {
      const p = wcs.toPix(f.ra, f.dec), here = f.frame === frameId;
      const g = document.createElementNS(ns, "g"); g.setAttribute("class", "pin");
      g.setAttribute("opacity", here ? 1 : 0.3);
      g.innerHTML = `<circle cx="${p.col}" cy="${p.row}" r="9" fill="none" stroke="#ff4d6d" stroke-width="2" vector-effect="non-scaling-stroke"/>` +
        `<circle cx="${p.col}" cy="${p.row}" r="1.5" fill="#ff4d6d"/><title>${f.category}${f.note ? ": " + String(f.note).replace(/[<&]/g, "") : ""}</title>`;
      svg.appendChild(g);
    }
  }
  return { list, add, render, remote };
})();
