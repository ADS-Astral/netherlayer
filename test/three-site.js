/* Run with:  node test/<name>.js
   Set CHROMIUM or PLAYWRIGHT_MODULE if they live somewhere else, and
   BUDGET=<seconds> to change the watchdog. */
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
/* The launch site, drawn by three.js from the source glTF. */
const { chromium } = require(PLAYWRIGHT);
const { execFile } = require('child_process'); const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const SITE = path.join(__dirname, '..') + '/';
const OUT = __dirname + '/'; const CACHE = OUT + '.cache/';
const PAD = [132.7394349, -23.0788817];
fs.mkdirSync(CACHE, { recursive: true });
function cf(u) { const f = CACHE + crypto.createHash('sha1').update(u).digest('hex'); if (fs.existsSync(f)) return Promise.resolve(fs.readFileSync(f)); return new Promise(r => execFile('curl', ['-sSL', '--max-time', '25', '--compressed', '-o', f, u], e => r(e || !fs.existsSync(f) ? null : fs.readFileSync(f)))); }
const ct = u => u.endsWith('.glb') ? 'model/gltf-binary' : u.endsWith('.js') ? 'application/javascript'
  : u.includes('.png') ? 'image/png' : u.endsWith('.css') ? 'text/css' : 'image/jpeg';

/* No harness may hang. A hard wall-clock budget that always exits, so a
   stalled frame can cost minutes but never the session. */
const BUDGET = Number(process.env.BUDGET || 900) * 1000;
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

const SHOTS = process.env.SHOTS ? JSON.parse(process.env.SHOTS) : [
  ['T1-hero', { zoom: 18.0, pitch: 66, bearing: 268, up: 45, dx: -13 }],
  ['T2-quarter', { zoom: 17.9, pitch: 60, bearing: 232, up: 60, dx: -30 }],
  ['T3-gate', { zoom: 18.8, pitch: 84, bearing: 271, up: 7, dx: -8 }],
  ['T4-whole', { zoom: 17.1, pitch: 56, bearing: 250, up: 120, dx: -60 }]
];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  BROWSER = browser;
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  p.setDefaultTimeout(90000);
  /* A screenshot forces a whole frame, which on this rasteriser can take
     longer than the action budget. Losing one is not losing the run. */
  const shot = (o) => p.screenshot(o).catch(
    (e) => console.log('!! screenshot skipped: ' + String(e.message).split('\n')[0]));
  const errs = [], warns = [], got = [];
  p.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 260)));
  p.on('console', m => {
    const t = m.text();
    if (m.type() === 'warning' && /Launch site models/.test(t)) warns.push(t.slice(0, 160));
    if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|no imagery/.test(t)) errs.push('CON ' + t.slice(0, 200));
  });
  await p.route('**/*', async r => {
    const u = r.request().url();
    if (u.startsWith('https://netherlayer.local/')) {
      const f = SITE + decodeURIComponent(u.split('/').pop().split('?')[0]);
      if (f.endsWith('.glb')) got.push(path.basename(f) + (fs.existsSync(f) ? '' : ' MISSING'));
      if (!fs.existsSync(f)) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ path: f, contentType: f.endsWith('.html') ? 'text/html; charset=utf-8' : ct(f) });
    }
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
  await p.waitForFunction(() => document.getElementById('loader').classList.contains('gone'), { timeout: 180000 }).catch(() => console.log('!! loader stuck'));
  await p.waitForTimeout(15000);
  await p.evaluate(() => { const e = document.getElementById('sharpness'); if (e) { e.value = 'soft'; e.dispatchEvent(new Event('change')); } });
  await p.evaluate(() => { const c = document.getElementById('showbuildings'); if (c.checked) { c.checked = false; c.dispatchEvent(new Event('change')); } });

  /* the models are 35 MB and decode on the main thread; give them room */
  await p.waitForFunction(() => !!window.netherlayerRange.getLayer('site-models'), { timeout: 240000 })
    .catch(() => console.log('!! the model layer never appeared'));
  await p.waitForTimeout(10000);

  console.log('glb files fetched  :', JSON.stringify([...new Set(got)]));
  console.log('model layer present:', await p.evaluate(() => !!window.netherlayerRange.getLayer('site-models')));
  console.log('bank hint          :', await p.evaluate(() => document.getElementById('bankmix').textContent.trim()));
  if (warns.length) console.log('warnings           :', warns.join(' | '));

  const GROUND = await p.evaluate((c) => {
    const h = window.netherlayerRange.queryTerrainElevation({ lng: c[0], lat: c[1] });
    return (h === null || h === undefined || !isFinite(h)) ? 0 : h;
  }, PAD);
  console.log('ground under pad   :', Math.round(GROUND), 'm');

  for (const [name, v] of SHOTS) {
    await p.evaluate((v) => {
      const mpd = 111320 * Math.cos(v.c[1] * Math.PI / 180);
      window.netherlayerRange.jumpTo({
        center: [v.c[0] + (v.dx || 0) / mpd, v.c[1]],
        zoom: v.zoom, pitch: v.pitch, bearing: v.bearing, elevation: v.ground + v.up
      });
    }, Object.assign({ c: PAD, ground: GROUND }, v));
    await p.waitForTimeout(9000);
    await shot({ path: OUT + name + '.png' });
    console.log('shot', name);
  }

  console.log('\n' + (errs.length ? errs.slice(0, 6).join('\n') : 'no js errors'));
  await browser.close();
  done();
})().catch((e) => {
  console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]);
  try { done(3); } catch (x) {}
  if (BROWSER) BROWSER.close().then(() => process.exit(3), () => process.exit(3));
  else process.exit(3);
});
