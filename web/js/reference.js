// "Compare with other eyes": blend a reference image (optical / near-IR / mid-IR / Hubble) over the SPHEREx tile.
// Layers come from tiles/<region>/ref/ref.json, written by data-prep/fetch_reference.py. No ref.json = card stays hidden.
(() => {
  const $ = (id) => document.getElementById(id);
  let region = null, layers = [], token = 0;

  function show() {
    const L = layers.find((l) => l.id === $("refSel").value), img = $("ref");
    if (!L) { img.style.display = "none"; $("refCredit").textContent = ""; return; }
    img.src = `tiles/${region}/ref/${L.file}`; img.style.display = "block";
    img.style.opacity = $("refMix").value / 100; $("refCredit").textContent = "Credit: " + L.credit;
  }

  document.addEventListener("sx:region", (e) => {
    region = e.detail.id; const my = ++token; layers = [];
    $("refCard").hidden = true; $("ref").style.display = "none";
    fetch(`tiles/${region}/ref/ref.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
      if (my !== token || !j || !j.layers || !j.layers.length) return;
      layers = j.layers;
      $("refSel").innerHTML = `<option value="">none (SPHEREx only)</option>` + layers.map((l) => `<option value="${l.id}">${l.label}</option>`).join("");
      $("refCard").hidden = false; show();
    });
  });
  $("refSel").onchange = show;
  $("refMix").oninput = () => { $("ref").style.opacity = $("refMix").value / 100; };
})();
