/* Run with:  node test/<name>.js
   Set CHROMIUM or PLAYWRIGHT_MODULE if they live somewhere else, and
   BUDGET=<seconds> to change the watchdog. */
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require(PLAYWRIGHT);
const { execFile } = require('child_process'); const crypto = require('crypto'); const fs = require('fs');
const path = require('path');
const SITE = path.join(__dirname, '..') + '/';
const OUT = __dirname + '/'; const CACHE = OUT + '.cache/';
fs.mkdirSync(CACHE, { recursive: true });
function cf(u) { const f = CACHE + crypto.createHash('sha1').update(u).digest('hex'); if (fs.existsSync(f)) return Promise.resolve(fs.readFileSync(f)); return new Promise(r => execFile('curl', ['-sSL', '--max-time', '25', '--compressed', '-o', f, u], e => r(e || !fs.existsSync(f) ? null : fs.readFileSync(f)))); }
const ct = u => u.includes('.png') ? 'image/png' : u.endsWith('.css') ? 'text/css' : u.endsWith('.js') ? 'application/javascript' : 'image/jpeg';

/* No harness may hang. A hard wall-clock budget that always exits, so a
   stalled frame can cost minutes but never the session. */
const BUDGET = Number(process.env.BUDGET || 600) * 1000;
const T0 = Date.now();
let BROWSER = null;
const WATCHDOG = setTimeout(() => {
  console.log('\n!! watchdog: no result after ' + Math.round((Date.now() - T0) / 1000) +
              's — giving up. Partial output above is all there is.');
  setTimeout(() => process.exit(2), 4000).unref();
  if (BROWSER) BROWSER.close().then(() => process.exit(2), () => process.exit(2));
  else process.exit(2);
}, BUDGET);
const done = (code) => { clearTimeout(WATCHDOG); if (code) process.exitCode = code; };


/* Every floating thing on the page, and whether any two of them collide. */
const PROBE = `(() => {
  /* countdown and toast are deliberate overlays — they are meant to cover. */
  const ids = ['panel','panel-btn','rightrail','hud','flightbar','aimchip'];
  const box = id => {
    const el = document.getElementById(id);
    if (!el) return null;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.hidden || !el.offsetParent) return null;
    if (parseFloat(cs.opacity) < 0.05) return null;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return { id, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
             r: Math.round(r.right), b: Math.round(r.bottom) };
  };
  const on = ids.map(box).filter(Boolean);
  const clash = [];
  for (let i = 0; i < on.length; i++) for (let j = i + 1; j < on.length; j++) {
    const a = on[i], c = on[j];
    const ox = Math.min(a.r, c.r) - Math.max(a.x, c.x);
    const oy = Math.min(a.b, c.b) - Math.max(a.y, c.y);
    if (ox > 3 && oy > 3) clash.push(a.id + '/' + c.id + ' ' + ox + 'x' + oy);
  }
  const off = on.filter(a => a.x < -2 || a.y < -2 || a.r > innerWidth + 2 || a.b > innerHeight + 2)
                .map(a => a.id + ' ' + JSON.stringify(a));
  /* nothing inside the console may spill sideways either */
  const spill = [...document.querySelectorAll('#panel *')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 2 && (r.right > innerWidth + 2 || r.left < -2);
  }).map(e => e.id || e.className || e.tagName);
  return { showing: on.map(a => a.id), clash, off, spill: [...new Set(spill)].slice(0, 5),
           reachable: { fire: !!document.getElementById('fire').offsetParent,
                        cost: !!document.getElementById('cost-build').offsetParent } };
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  BROWSER = browser;
  const sizes = [[390, 844, 'iphone14'], [360, 800, 'android'], [414, 896, 'iphone-max'],
                 [768, 1024, 'ipad-port'], [320, 568, 'iphone-se']];
  for (const [w, h, tag] of sizes) {
    const p = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, isMobile: true, hasTouch: true })).newPage();
    p.setDefaultTimeout(90000);
  /* A screenshot forces a whole frame, which on this rasteriser can take
     longer than the action budget. Losing one is not losing the run. */
  const shot = (o) => p.screenshot(o).catch(
    (e) => console.log('!! screenshot skipped: ' + String(e.message).split('\n')[0]));
    const errs = [];
    p.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 160)));
    await p.route('**/*', async r => {
      const u = r.request().url();
      if (u.startsWith('https://netherlayer.local/')) return r.fulfill({ path: SITE + decodeURIComponent(u.split('/').pop().split('?')[0]), contentType: u.endsWith('.glb') ? 'model/gltf-binary' : 'text/html; charset=utf-8' });
      if (u.startsWith('https://unpkg.com/')) {
      /* maplibre and three both come from here; cached to disk on the
         first run so every run after it needs no network at all */
      const lib = await cf(u);
      return lib ? r.fulfill({ status: 200, body: lib, contentType: ct(u) }) : r.abort();
    }
      if (u.includes('interpreter')) return r.abort();
      const x = await cf(u); return x ? r.fulfill({ status: 200, body: x, contentType: ct(u), headers: { 'access-control-allow-origin': '*' } }) : r.abort();
    });
    /* A fresh checkout has an empty cache, and fetching a megabyte of
     MapLibre while the page is already booting loses the race. Pull the
     CDN files down first; every run after this one has them on disk. */
  for (const u of ['https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',
                   'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css']) await cf(u);
  await p.goto('https://netherlayer.local/launch.html', { waitUntil: 'load' });
    await p.waitForFunction(() => document.getElementById('loader').classList.contains('gone'), { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(8000);
    await p.evaluate(() => { const e = document.getElementById('sharpness'); if (e) { e.value = 'soft'; e.dispatchEvent(new Event('change')); } });
  /* The site models are 35 MB and about a million triangles a frame. This
     harness rasterises on the CPU and is not testing them, so leave them out. */
  await p.evaluate(() => { const c = document.getElementById('showsite'); if (c && c.checked) { c.checked = false; c.dispatchEvent(new Event('change')); } });

    console.log('\n══ ' + tag + '  ' + w + '×' + h);
    console.log('  closed  ', JSON.stringify(await p.evaluate(PROBE)));
    await p.evaluate(() => document.getElementById('panel-btn').click());
    await p.waitForTimeout(700);
    console.log('  console ', JSON.stringify(await p.evaluate(PROBE)));
    await shot({ path: OUT + 'M-' + tag + '-console.png' });

    // every station, checking nothing spills
    for (const pane of ['p-rails', 'p-bank', 'p-round', 'p-target', 'p-scene', 'p-cost', 'p-arc']) {
      await p.evaluate(x => { const b = document.querySelector('[data-pane="' + x + '"]'); if (b && b.offsetParent) b.click(); }, pane);
      await p.waitForTimeout(350);
      const r = await p.evaluate(PROBE);
      if (r.clash.length || r.off.length || r.spill.length) console.log('  ' + pane.padEnd(9), JSON.stringify(r));
    }
    await p.evaluate(() => document.querySelector('[data-pane="p-bank"]').click());
    await p.waitForTimeout(500);
    await shot({ path: OUT + 'M-' + tag + '-bank.png' });
    await p.evaluate(() => document.querySelector('[data-pane="p-cost"]').click());
    await p.waitForTimeout(500);
    await shot({ path: OUT + 'M-' + tag + '-cost.png' });

    // and in flight
    await p.evaluate(() => document.querySelector('[data-pane="p-pad"]').click());
    await p.evaluate(() => document.getElementById('fire').click());
    await p.waitForTimeout(1200);
    console.log('  count   ', JSON.stringify(await p.evaluate(PROBE)));
    await p.evaluate(() => { const b = document.getElementById('cd-skip'); if (b) b.click(); });
    await p.waitForTimeout(3500);
    console.log('  flying  ', JSON.stringify(await p.evaluate(PROBE)));
    await shot({ path: OUT + 'M-' + tag + '-flight.png' });
    if (errs.length) console.log('  ' + errs.slice(0, 3).join('\n  '));
    await p.close();
  }
  await browser.close();
  done();
})().catch((e) => {
  console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]);
  try { done(3); } catch (x) {}
  if (BROWSER) BROWSER.close().then(() => process.exit(3), () => process.exit(3));
  else process.exit(3);
});
