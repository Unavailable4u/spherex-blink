// Chrome: side-panel tabs, help dialog, first-use hint, image credits.
(() => {
  const $ = (id) => document.getElementById(id);
  const tabs = [...document.querySelectorAll("#tabs button")];

  function openPane(name) {
    tabs.forEach((b) => b.classList.toggle("on", b.dataset.pane === name));
    document.querySelectorAll(".pane").forEach((p) => { p.hidden = p.id !== "pane-" + name; });
  }
  tabs.forEach((b) => { b.onclick = () => openPane(b.dataset.pane); });
  document.addEventListener("sx:select", () => openPane("inspect"));

  const help = $("help");
  $("helpBtn").onclick = () => (help.showModal ? help.showModal() : help.setAttribute("open", ""));
  try { if (!localStorage.getItem("sx-seen")) { localStorage.setItem("sx-seen", "1"); setTimeout(() => help.showModal && help.showModal(), 600); } } catch (e) { /* private mode */ }

  // the hint fades after the first interaction
  const coach = $("coach");
  const hide = () => { coach.classList.add("gone"); };
  ["pointerdown", "wheel", "keydown"].forEach((ev) => document.addEventListener(ev, hide, { once: true }));
  setTimeout(hide, 20000);

  // image credits (written by data-prep/fetch_planets.py)
  fetch("assets/credits.json").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
    if (!j) return;
    const items = [...Object.entries(j.planets || {}).map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)}: ${v.credit}`), j.milkyway ? "Milky Way: " + j.milkyway.credit : null].filter(Boolean);
    $("imgCredits").textContent = "Images \u2014 " + items.join(" \u00b7 ");
  });
})();
