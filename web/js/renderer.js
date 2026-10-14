// Canvas imagery layer: tile cache, crossfade, blink.
const Renderer = (() => {
  let cv, ctx, shown = null, raf = 0, timer = null;
  const cache = new Map();
  const px = document.createElement("canvas"); px.width = px.height = 1;
  const pctx = px.getContext("2d", { willReadFrequently: true });

  function init(canvas) { cv = canvas; ctx = cv.getContext("2d"); }
  function resize(w, h) { cv.width = w; cv.height = h; ctx.imageSmoothingEnabled = false; }

  function load(url) {
    if (!cache.has(url)) cache.set(url, new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im);
      im.onerror = () => { cache.delete(url); rej(new Error("missing tile " + url)); };
      im.src = url;
    }));
    return cache.get(url);
  }
  const draw = (img) => { cancelAnimationFrame(raf); ctx.globalAlpha = 1; ctx.drawImage(img, 0, 0); shown = img; };

  // draw the old tile, then ramp the new one in over `ms`
  function fadeTo(img, ms = 250) {
    cancelAnimationFrame(raf);
    const old = shown; shown = img;
    if (!old || old === img) return draw(img);
    const t0 = performance.now();
    const step = (t) => {
      const a = Math.min(1, (t - t0) / ms);
      ctx.globalAlpha = 1; ctx.drawImage(old, 0, 0);
      ctx.globalAlpha = a; ctx.drawImage(img, 0, 0);
      ctx.globalAlpha = 1;
      if (a < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
  }

  // blink: alternate between two tile getters at `hz`
  function startBlink(getA, getB, hz = 3) {
    stopBlink(); let flip = false;
    timer = setInterval(() => { flip = !flip; const im = flip ? getB() : getA(); if (im) draw(im); }, 1000 / (2 * hz));
  }
  function stopBlink() { clearInterval(timer); timer = null; }
  const blinking = () => timer !== null;

  function value(img, col, row) {   // 0..255 grey level of one tile pixel
    pctx.clearRect(0, 0, 1, 1); pctx.drawImage(img, col, row, 1, 1, 0, 0, 1, 1);
    return pctx.getImageData(0, 0, 1, 1).data[0];
  }
  return { init, resize, load, draw, fadeTo, startBlink, stopBlink, blinking, value };
})();
