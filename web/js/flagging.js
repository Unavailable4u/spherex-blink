// Crowdsourced flags. Shared through Firestore (REST, no SDK) when js/config.js is filled in,
// otherwise kept in this browser only. The UI always says which of the two it is doing.
const Flagging = (() => {
  const cfg = window.FLAG_CONFIG || {};
  const remote = !!(cfg.projectId && cfg.apiKey);
  const root = remote && `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents`;
  const KEY = "spherex-flags", UID = "sx-uid";
  let mem = [], uid = "anon";
  const store = { get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } } };
  try { mem = JSON.parse(store.get(KEY) || "[]"); } catch (e) { mem = []; }
  uid = store.get(UID) || (Math.random().toString(36).slice(2) + Date.now().toString(36)); store.set(UID, uid);
  const save = () => store.set(KEY, JSON.stringify(mem));

  const FIELDS = ["region", "frame", "band", "epoch", "ra", "dec", "category", "note", "verdict", "created", "uid"];
  const enc = (f) => ({ fields: Object.fromEntries(FIELDS.filter((k) => f[k] !== undefined).map((k) =>
    [k, typeof f[k] === "number" ? { doubleValue: f[k] } : { stringValue: String(f[k] ?? "") }])) });
  const dec = (d) => Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) =>
    [k, "doubleValue" in v ? v.doubleValue : "integerValue" in v ? +v.integerValue : v.stringValue]));
  const mine = (f) => f.uid === uid;
  const html = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  let status = remote ? "connecting" : "local";            // "shared" | "local" | "offline" | "connecting"

  // all flags for a region, shared ones merged with this browser's own
  async function list(region) {
    const own = mem.filter((f) => f.region === region);
    if (!remote) { status = "local"; return own; }
    try {
      const body = { structuredQuery: { from: [{ collectionId: "flags" }], limit: 500,
        where: { fieldFilter: { field: { fieldPath: "region" }, op: "EQUAL", value: { stringValue: region } } } } };
      const r = await fetch(`${root}:runQuery?key=${cfg.apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(r.status);
      const shared = (await r.json()).filter((x) => x.document).map((x) => dec(x.document));
      status = "shared";
      const seen = new Set(shared.map((f) => f.created + ":" + f.uid));
      return shared.concat(own.filter((f) => !seen.has(f.created + ":" + f.uid)));   // unsent local ones stay visible
    } catch (e) { status = "offline"; return own; }
  }

  // returns "shared" | "local"
  async function add(flag) {
    flag.created = Date.now(); flag.uid = uid;
    mem.push(flag); save();
    if (!remote) return "local";
    try {
      const r = await fetch(`${root}/flags?key=${cfg.apiKey}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(enc(flag)) });
      status = r.ok ? "shared" : "offline"; return r.ok ? "shared" : "local";
    } catch (e) { status = "offline"; return "local"; }
  }

  function removeLocal(flag) { mem = mem.filter((f) => !(f.created === flag.created && f.uid === flag.uid)); save(); }
  function clearLocal(region) { mem = mem.filter((f) => f.region !== region); save(); }

  // ---- export ----
  const esc = (v) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const COLS = ["region", "frame", "band", "epoch", "ra", "dec", "category", "verdict", "note", "created"];
  function toCSV(flags) {
    const rows = flags.map((f) => COLS.map((k) => esc(k === "created" ? new Date(f.created).toISOString() : (typeof f[k] === "number" && (k === "ra" || k === "dec") ? f[k].toFixed(6) : f[k]))).join(","));
    return [COLS.join(",")].concat(rows).join("\n");
  }
  function download(name, text, type) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // pins: solid on the frame they were made on, faint elsewhere; teal ring = from other people
  function render(svg, flags, frameId, wcs) {
    const ns = "http://www.w3.org/2000/svg";
    svg.querySelectorAll(".pin").forEach((n) => n.remove());
    for (const f of flags) {
      const p = wcs.toPix(f.ra, f.dec), here = f.frame === frameId, col = mine(f) ? "#ff5a47" : "#7fd8e6";
      const g = document.createElementNS(ns, "g"); g.setAttribute("class", "pin");
      g.setAttribute("opacity", here ? 1 : 0.3);
      g.innerHTML = `<circle cx="${p.col + 0.5}" cy="${p.row + 0.5}" r="9" fill="none" stroke="${col}" stroke-width="2" vector-effect="non-scaling-stroke"/>` +
        `<circle cx="${p.col + 0.5}" cy="${p.row + 0.5}" r="1.5" fill="${col}"/><title>${html(f.category)}${f.note ? ": " + html(f.note) : ""}</title>`;
      svg.appendChild(g);
    }
  }
  return { list, add, render, removeLocal, clearLocal, toCSV, download, mine, remote, status: () => status, uid: () => uid };
})();
