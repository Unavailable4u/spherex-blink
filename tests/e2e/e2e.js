const chromium = require('@sparticuz/chromium').default || require('@sparticuz/chromium');
const puppeteer = require('puppeteer-core');
// Browser tests: serve web/ (cd web && python -m http.server 8000), then: cd tests/e2e && npm i && node e2e.js
// Set CHROME=/path/to/chrome to use your own browser instead of the bundled headless one.
const fs = require('fs'), path = require('path');
const BASE = process.env.BASE || 'http://localhost:8000/';
const OUT = path.join(__dirname, 'out'); fs.mkdirSync(OUT, { recursive: true });
const out = (n) => path.join(OUT, n + '.png');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };
(async () => {
  const b = await puppeteer.launch({ args: [...chromium.args, '--no-sandbox'], executablePath: process.env.CHROME || await chromium.executablePath(), headless: 'shell', defaultViewport: { width: 1440, height: 900 } });
  const p = await b.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  p.on('pageerror', e => errs.push('PAGEERROR ' + e.message));
  await p.evaluateOnNewDocument(() => { try { localStorage.setItem('sx-seen', '1'); } catch (e) {} });
  await p.goto(BASE, { waitUntil: 'networkidle0' }); await sleep(800);
  const $t = (sel) => p.$eval(sel, e => e.textContent.trim());
  const cls = (sel) => p.$eval(sel, e => e.className);

  // ---- 1. Space bar: toggles exactly once, even right after clicking the Blink button
  await p.click('#blink'); await sleep(300);
  ok((await cls('#blink')).includes('on'), 'blink starts via button');
  await p.keyboard.press('Space'); await sleep(300);
  ok(!(await cls('#blink')).includes('on'), 'Space after clicking the button stops blink (single toggle, no double fire)');
  await p.keyboard.press('Space'); await sleep(300);
  ok((await cls('#blink')).includes('on'), 'Space starts blink');
  // held key must not auto-repeat
  await p.keyboard.down('Space'); await p.keyboard.down('Space'); await p.keyboard.down('Space'); await p.keyboard.up('Space'); await sleep(300);
  ok(!(await cls('#blink')).includes('on'), 'held Space toggles once (auto-repeat ignored)');
  // Space with focus on a button via keyboard
  await p.focus('#setRef'); await p.keyboard.press('Space'); await sleep(300);
  ok((await cls('#blink')).includes('on'), 'Space while a button has focus still blinks (button not activated)');
  // blink really alternates the picture
  const sample = () => p.evaluate(() => { const c = document.getElementById('sky'), x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4 * 97) s += d[i] + d[i + 3]; return s; });
  const seen = new Set(); for (let i = 0; i < 14; i++) { seen.add(await sample()); await sleep(90); }
  ok(seen.size >= 2, 'canvas content alternates while blinking (' + seen.size + ' distinct states)');
  await p.keyboard.press('Space'); await sleep(200);

  // ---- 2. overlay
  await p.keyboard.press('o'); await sleep(300);
  ok((await cls('#overlayBtn')).includes('on') && (await p.evaluate(() => document.body.classList.contains('overlay-mode'))), 'O toggles amber/cyan overlay');
  await p.screenshot({ path: out('t_overlay') });
  const ovPix = await p.evaluate(() => { const c = document.getElementById('sky'), x = c.getContext('2d'); const d = x.getImageData(0, 0, c.width, c.height).data; let amber = 0, cyan = 0; for (let i = 0; i < d.length; i += 4) { if (d[i + 3] && d[i] > 200 && d[i + 2] < 150) amber++; if (d[i + 3] && d[i + 2] > 200 && d[i] < 150) cyan++; } return { amber, cyan }; });
  ok(ovPix.amber > 5 && ovPix.cyan > 5, 'overlay contains amber and cyan sources (movers/mismatches): ' + JSON.stringify(ovPix));
  await p.keyboard.press('o'); await sleep(200);

  // ---- 3. click Pallas -> snaps, mover check says moves
  const info = await p.evaluate(() => { const A = window.App, S = A.S, sky = SkyMap.data(); const tp = sky.target[S.frames[S.idx].id]; const q = S.wcs.toPix(...tp); return { c: q.col, r: q.row }; });
  await p.evaluate((i) => window.App.select(i.c + 0.5 + 1.2, i.r + 0.5 - 0.9), info); await sleep(300);
  ok((await cls('#moverCheck .verdict')).includes('moves'), 'Pallas click -> mover check "moves": ' + (await $t('#moverCheck .verdict span')).slice(0, 80));
  ok((await $t('#meta')).includes('centroid'), 'click snapped to a source centroid');
  const snapOff = await p.evaluate((i) => { const S = window.App.S; return Math.hypot(S.sel.col - i.c, S.sel.row - i.r); }, info);
  ok(snapOff < 1.8, 'snapped position within 1.8 px of ephemeris (' + snapOff.toFixed(2) + ' px)');
  // a star
  const star = await p.evaluate(() => { const S = window.App.S, t = S.tiles[S.idx]; let best = null; for (let y = 200; y < 300; y++) for (let x = 200; x < 400; x++) { const g = t.gray[y * t.w + x]; if (g > 150 && g < 250 && (!best || g > best.g)) best = { x, y, g }; } return best; });
  await p.evaluate((s) => window.App.select(s.x + 0.5, s.y + 0.5), star); await sleep(300);
  console.log('   star click verdict:', await cls('#moverCheck .verdict'), '|', (await $t('#moverCheck .verdict span')).slice(0, 90));

  // ---- 4. flag Pallas -> known object match
  await p.evaluate((i) => window.App.select(i.c + 0.5, i.r + 0.5), info); await sleep(200);
  await p.click('#submitFlag'); await sleep(500);
  ok((await $t('#flagMatch')).includes('known object'), 'flag on Pallas cross-matches the known object');
  ok((await p.$$('#flagList li .flag-go')).length === 1, 'flag listed');
  ok(!(await p.$eval('#exportCsv', e => e.disabled)), 'export enabled');
  ok((await $t('#flagMode')).includes('this browser'), 'flag mode says local');
  const csv = await p.evaluate(() => Flagging.toCSV(window.App.S.flags)); ok(csv.split('\n').length === 2 && csv.includes('asteroid'), 'CSV export has header + 1 row');

  // ---- 5. Planet X tab: lab output + track + measurement
  await p.click('#tabs button[data-pane=planetx]'); await sleep(500);
  ok((await $t('#pxOut')).includes('pixels'), 'Planet X lab text: ' + (await $t('#pxOut')).slice(0, 110));
  ok((await p.$$('#overlay .pxg')).length === 1, 'simulated track is drawn only on the Planet X tab');
  ok((await $t('#pxOut')).includes('6 months'), 'lab shows the six-month comparison');
  await p.screenshot({ path: out('t_planetx') });
  // measure Pallas across two frames
  const fr = await p.evaluate(() => window.App.S.frames.map(f => f.id));
  const meas = async (idx) => { await p.evaluate((i) => window.App.goto(i, false), idx); await sleep(250); const q = await p.evaluate(() => { const S = window.App.S, tp = SkyMap.data().target[S.frames[S.idx].id], pp = S.wcs.toPix(...tp); return pp; }); await p.evaluate((q) => window.App.select(q.col + 0.5, q.row + 0.5), q); await sleep(150); };
  await meas(0); await p.click('#markA'); await meas(fr.length - 1); await p.click('#markB'); await sleep(300);
  ok((await cls('#mvOut .verdict')).includes('near'), 'measuring Pallas -> "nearby object": ' + (await $t('#mvOut .verdict span')).slice(0, 80));
  await p.screenshot({ path: out('t_measure') });
  await p.click('#clearMk');
  // a fixed star measured twice -> still
  await p.evaluate(() => window.App.goto(0, false)); await sleep(200);
  await p.evaluate((s) => window.App.select(s.x + 0.5, s.y + 0.5), star); await p.click('#markA');
  await p.evaluate(() => window.App.goto(window.App.S.frames.length - 1, false)); await sleep(200);
  await p.evaluate((s) => window.App.select(s.x + 0.5, s.y + 0.5), star); await p.click('#markB'); await sleep(300);
  console.log('   star measured verdict:', await cls('#mvOut .verdict'), '|', (await $t('#mvOut .verdict span')).slice(0, 100));

  // ---- 6. context tab
  await p.click('#tabs button[data-pane=context]'); await sleep(400);
  await p.screenshot({ path: out('t_context') });
  ok((await $t('#fieldInfo')).includes('real SPHEREx data'), 'field card says real data');
  ok((await $t('#valOut')).includes('13/13'), 'reality-check card reports 13/13: ' + (await $t('#valOut')).slice(0,60));

  // ---- 6b. solar system big view
  await p.click('#viewSolar'); await sleep(700);
  ok(await p.evaluate(() => document.body.classList.contains('view-solar')), 'Solar system view opens');
  await p.screenshot({ path: out('t_solar') });
  await p.click('#viewSky'); await sleep(300);

  // ---- 6c. hunt blind: hide known objects
  await p.click('#tabs button[data-pane=inspect]'); await p.evaluate(() => { const c = document.getElementById('showKnown'); c.checked = false; c.dispatchEvent(new Event('change')); }); await sleep(300);
  ok(await p.evaluate(() => !document.querySelector('#overlay .kn') || getComputedStyle(document.querySelector('#overlay .kn')).display === 'none' || document.querySelectorAll('#overlay .kn').length === 0), 'Known objects hidden for blind hunt');
  await p.evaluate(() => { const c = document.getElementById('showKnown'); c.checked = true; c.dispatchEvent(new Event('change')); });

  // ---- 7. D4 frame with missing wavelength gets an estimate
  await p.click('#bands button[data-band=D4]'); await sleep(900);
  const lbls = await p.evaluate(() => window.App.S.frames.map(f => window.App.lamTxt(f)));
  ok(lbls.every(l => l !== '\u2014'), 'every D4 frame shows a wavelength (' + lbls.join(' | ') + ')');

  // ---- 8. synthetic field
  await p.select('#region', 'synthetic'); await sleep(1500);
  ok(await p.evaluate(() => document.body.classList.contains('sim')) && !(await p.$eval('#simBanner', e => e.hidden)), 'simulated banner shown');
  ok(!(await p.$eval('#epochSeg', e => e.hidden)), 'epoch (pass) switcher shown for 2-pass field');
  await p.screenshot({ path: out('t_synth') });
  await p.evaluate(() => window.openPane('planetx')); await sleep(300);
  console.log('   synthetic Planet X pane lab:', (await $t('#pxOut')).slice(0, 80));
  await p.select('#region', 'pallas'); await sleep(1200);
  ok(!(await p.evaluate(() => document.body.classList.contains('sim'))), 'back on Pallas: banner gone');

  // ---- 9. URL state
  ok(p.url().includes('region=pallas') && p.url().includes('band='), 'URL carries region/band/frames: ' + p.url().split('?')[1]);

  // ---- 10. save image
  const dl = await p.evaluate(async () => { let name = null; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { name = this.download; }; document.getElementById('saveImg').click(); await new Promise(r => setTimeout(r, 4000)); HTMLAnchorElement.prototype.click = orig; return name; });
  ok(dl && dl.endsWith('.png'), 'Save image produced ' + dl);

  // ---- 11. tour
  await p.click('#tourBtn'); await sleep(800);
  for (let i = 0; i < 5; i++) { await p.click('#tourNext'); await sleep(900); }
  await p.screenshot({ path: out('t_tour') });
  await p.click('#tourNext'); await sleep(300);
  ok(await p.$eval('#tour', e => e.hidden), 'tour completes and closes');

  console.log('\nconsole errors:', errs.length ? errs.join('\n') : 'none');
  console.log(`\n${pass} passed, ${fail} failed`);
  await b.close(); process.exit(fail ? 1 : 0);
})().catch(e => { console.error('ERR', e.stack.slice(0, 1200)); process.exit(1); });
