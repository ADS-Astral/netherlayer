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


(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  BROWSER = browser;
  const p = await (await browser.newContext({ viewport: { width: 1280, height: 860 } })).newPage();
  p.setDefaultTimeout(90000);   /* CPU rasteriser: frames stall for tens of seconds */
  /* A screenshot forces a whole frame, which on this rasteriser can take
     longer than the action budget. Losing one is not losing the run. */
  const shot = (o) => p.screenshot(o).catch(
    (e) => console.log('!! screenshot skipped: ' + String(e.message).split('\n')[0]));
  const errs = [], got = [];
  p.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 220)));
  p.on('console', m => { if (/round model/i.test(m.text())) errs.push('MODEL ' + m.text().slice(0, 140)); });
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errs.push('CON ' + m.text().slice(0, 140)); });
  await p.route('**/*', async r => {
    const u = r.request().url();
    if (u.startsWith('https://netherlayer.local/')) {
      const f = SITE + decodeURIComponent(u.split('/').pop().split('?')[0]);
      if (f.endsWith('.glb')) got.push(f.split('/').pop());
      /* BLOCK=1 denies the round, so a run with it and a run without it can
         be compared: if the frames match, the model is not being drawn. */
      if (process.env.BLOCK && /missile/.test(f)) return r.fulfill({ status: 404, body: '' });
      return r.fulfill({ path: f, contentType: f.endsWith('.glb') ? 'model/gltf-binary' : 'text/html; charset=utf-8' });
    }
    if (u.startsWith('https://unpkg.com/')) {
      /* maplibre and three both come from here; cached to disk on the
         first run so every run after it needs no network at all */
      const lib = await cf(u);
      return lib ? r.fulfill({ status: 200, body: lib, contentType: ct(u) }) : r.abort();
    }
    const x = await cf(u); return x ? r.fulfill({ status: 200, body: x, contentType: ct(u), headers: { 'access-control-allow-origin': '*' } }) : r.abort();
  });
  /* A fresh checkout has an empty cache, and fetching a megabyte of
     MapLibre while the page is already booting loses the race. Pull the
     CDN files down first; every run after this one has them on disk. */
  for (const u of ['https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',
                   'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css']) await cf(u);
  /* A fresh checkout has an empty cache, and fetching a megabyte of
     MapLibre while the page is already booting loses the race. */
  for (const u of ['https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',
                   'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css']) await cf(u);
  await p.goto('https://netherlayer.local/launch.html', { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('loader').classList.contains('gone'), { timeout: 120000 }).catch(() => console.log('!! loader stuck'));
  await p.waitForTimeout(10000);
  await p.evaluate(() => { const e = document.getElementById('sharpness'); if (e) { e.value = 'soft'; e.dispatchEvent(new Event('change')); } });
  await p.waitForFunction(() => !!window.netherlayerRange.getLayer('site-models'), { timeout: 300000 })
    .catch(() => console.log('!! the site models never arrived'));
  await p.waitForTimeout(6000);

  const cam = () => p.evaluate(() => {
    const m = window.netherlayerRange, c = m.getCenter();
    return { lng: +c.lng.toFixed(5), lat: +c.lat.toFixed(5), zoom: +m.getZoom().toFixed(2),
             pitch: Math.round(m.getPitch()), bearing: Math.round(m.getBearing()) };
  });
  const press = async (name) => {
    await p.evaluate(n => [...document.querySelectorAll('#stations .stn')]
      .find(b => b.querySelector('em').textContent === n).click(), name);
    await p.waitForTimeout(7000);
    return cam();
  };

  console.log('at rest        ', JSON.stringify(await cam()));
  console.log('press Pad      ', JSON.stringify(await press('Pad')));
  const target = await press('Target');
  console.log('press Target   ', JSON.stringify(target), target.zoom < 5 ? '← out to the globe' : '*** still close in');

  const rails = await press('Rails');
  console.log('press Rails    ', JSON.stringify(rails));
  await shot({ path: OUT + 'S-gate-open.png' });

  const bank = await press('Bank');
  console.log('press Bank     ', JSON.stringify(bank));
  await shot({ path: OUT + 'S-bank.png' });

  /* fly, land, leave — which should shut the gate again */
  await p.evaluate(() => document.getElementById('fire').click());
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const b = document.getElementById('cd-skip'); if (b) b.click(); });
  await p.waitForTimeout(5000);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x => /Exit flight/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(6000);
  console.log('after the flight, flying =', await p.evaluate(() => document.body.classList.contains('flying')));

  /* back to exactly the gate view, with the gate now shut */
  await p.evaluate((v) => window.netherlayerRange.jumpTo({ center: [v.lng, v.lat], zoom: v.zoom, pitch: v.pitch, bearing: v.bearing }), rails);
  await p.waitForTimeout(8000);
  await shot({ path: OUT + 'S-gate-shut.png' });

  console.log('\n' + (errs.length ? errs.slice(0, 6).join('\n') : 'no js errors'));
  await browser.close();
  done();
})().catch((e) => {
  console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]);
  try { done(3); } catch (x) {}
  if (BROWSER) BROWSER.close().then(() => process.exit(3), () => process.exit(3));
  else process.exit(3);
});
