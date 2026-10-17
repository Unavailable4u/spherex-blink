// Chrome: side-panel tabs, help / about dialogs, first-use hint, acknowledgement and image credits.
(() => {
  const $ = (id) => document.getElementById(id);
  const tabs = [...document.querySelectorAll("#tabs button")];

  function openPane(name) {
    tabs.forEach((b) => { const on = b.dataset.pane === name; b.classList.toggle("on", on); b.setAttribute("aria-selected", on); });
    document.querySelectorAll(".pane").forEach((p) => { p.hidden = p.id !== "pane-" + name; });
    document.body.dataset.pane = name; document.dispatchEvent(new Event("sx:pane"));
  }
  tabs.forEach((b) => { b.onclick = () => openPane(b.dataset.pane); });
  // a click normally opens Inspect, but not while measuring in the Planet X tab (Mark A/B need it open)
  document.addEventListener("sx:select", () => { if (document.body.dataset.pane !== "planetx") openPane("inspect"); });
  window.openPane = openPane; openPane("inspect");

  const open = (d) => (d.showModal ? d.showModal() : d.setAttribute("open", ""));
  const help = $("help"), about = $("about");
  $("helpBtn").onclick = () => open(help);
  $("aboutBtn").onclick = () => open(about);
  $("aboutFromHelp").onclick = (e) => { e.preventDefault(); help.close(); open(about); };
  document.querySelectorAll("dialog").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.close(); }));
  try { if (!localStorage.getItem("sx-seen")) { localStorage.setItem("sx-seen", "1"); setTimeout(() => open(help), 700); } } catch (e) { /* private mode */ }

  // the hint fades after the first interaction
  const coach = $("coach"), hide = () => coach.classList.add("gone");
  ["pointerdown", "wheel", "keydown"].forEach((ev) => document.addEventListener(ev, hide, { once: true }));
  setTimeout(hide, 20000);

  // acknowledgement text lives in one file so it is easy to replace with IRSA's exact wording
  fetch("assets/acknowledgement.txt").then((r) => (r.ok ? r.text() : "")).catch(() => "").then((t) => {
    t = (t || "SPHEREx data: NASA/JPL-Caltech via NASA/IPAC IRSA.").trim(); $("ackText").textContent = t; $("ackFoot").textContent = t;
  });

  // image credits (written by data-prep/fetch_planets.py)
  fetch("assets/credits.json").then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
    if (!j) return;
    const items = [...Object.entries(j.planets || {}).map(([k, v]) => `${k[0].toUpperCase() + k.slice(1)}: ${v.credit}`), j.milkyway ? "Milky Way: " + j.milkyway.credit : null].filter(Boolean);
    $("imgCredits").textContent = "Images \u2014 " + items.join(" \u00b7 "); $("imgCreditsAbout").textContent = items.join(" \u00b7 ");
  });
})();
