// Guided tour: a short scripted walk through the technique on the real Pallas field.
// It drives the same controls a visitor would use, so what it shows is what the tool does.
(() => {
  const $ = (id) => document.getElementById(id);
  const card = $("tour"), App = () => window.App;
  let step = -1, running = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const STEPS = [
    { t: "A patch of real sky", x: "These are real SPHEREx images of one patch of sky, taken on different days. Almost everything in them is a star, and stars do not move. One thing does.",
      go: async () => { await ensure(); window.openPane("inspect"); App().setMode("blink"); } },
    { t: "Blink it", x: "The tool flips between two frames. Stars stay put; one dot jumps. That is the trick Clyde Tombaugh used to find Pluto in 1930.",
      go: async () => { await ensure(); if (!App().S.frames.length) return; if (!isBlinking()) App().toggleBlink(); } },
    { t: "See both positions at once", x: "Overlay paints the earlier frame amber and the later one cyan. A star is white, a mover splits into an amber dot and a cyan dot.",
      go: async () => { await ensure(); if (isBlinking()) App().toggleBlink(); App().setMode("overlay"); } },
    { t: "Click the mover", x: "Clicking snaps to the source and runs a mover check: is it at the same spot in the other frames? This one is gone from the others, so it moves. It is the asteroid (2) Pallas.",
      go: async () => { await ensure(); App().setMode("blink"); selectTarget(); window.openPane("inspect"); } },
    { t: "What would Planet X do?", x: "A distant planet moves only by parallax, as the Earth moves. Over these days that is a few pixels; over six months it is more than a hundred. Measure a mover and the tool tells you which kind it is.",
      go: async () => { await ensure(); window.openPane("planetx"); } },
    { t: "Your turn", x: "Open the Context tab and untick Known objects to hunt blind. Flag what you find, then export your flags.",
      go: async () => { await ensure(); window.openPane("inspect"); } },
  ];
  const isBlinking = () => Renderer.blinking();

  async function ensure() {
    const A = App(); if (!A) return;
    if (A.S.region !== "pallas" && A.S.regions.some((r) => r.id === "pallas")) { $("region").value = "pallas"; await A.loadRegion("pallas"); }
    for (let i = 0; i < 60 && !A.S.tiles.length; i++) await sleep(100);
  }
  function selectTarget() {
    const A = App(), S = A.S, sky = SkyMap.data(); if (!sky || !S.frames.length) return;
    const tp = sky.target && sky.target[S.frames[S.idx].id]; if (!tp) return;
    const p = S.wcs.toPix(...tp); A.select(p.col + 0.5, p.row + 0.5);
  }

  async function show(i) {
    if (i < 0) i = 0; if (i >= STEPS.length) return end();
    step = i; running = true; card.hidden = false; document.body.classList.add("touring");
    const s = STEPS[i]; $("tourTitle").textContent = s.t; $("tourText").textContent = s.x;
    $("tourDots").innerHTML = STEPS.map((_, k) => `<i class="${k === i ? "on" : k < i ? "done" : ""}"></i>`).join("");
    $("tourBack").disabled = i === 0; $("tourNext").textContent = i === STEPS.length - 1 ? "Finish" : "Next";
    try { await s.go(); } catch (e) { /* the tour must never break the app */ }
  }
  function end() { running = false; step = -1; card.hidden = true; document.body.classList.remove("touring"); if (isBlinking()) App().toggleBlink(); }

  $("tourBtn").onclick = () => { const h = $("help"); if (h.open) h.close(); if (running) end(); else show(0); };
  $("helpTour").onclick = (e) => { e.preventDefault(); $("help").close(); show(0); };
  $("tourNext").onclick = () => show(step + 1);
  $("tourBack").onclick = () => show(step - 1);
  $("tourSkip").onclick = end;
  document.addEventListener("keydown", (e) => { if (running && e.key === "Escape") end(); });
})();
