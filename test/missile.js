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
const BUDGET = Number(process.env.BUDGET || 480) * 1000;
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
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errs.push('CON ' + m.text().slice(0, 140)); });
  await p.route('**/*', async r => {
    const u = r.request().url();
    if (u.startsWith('https://netherlayer.local/')) {
      const f = SITE + decodeURIComponent(u.split('/').pop().split('?')[0]);
      if (f.endsWith('.glb')) got.push(f.split('/').pop());
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
  await p.goto('https://netherlayer.local/launch.html', { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('loader').classList.contains('gone'), { timeout: 120000 }).catch(() => console.log('!! loader stuck'));
  await p.waitForTimeout(9000);
  await p.evaluate(() => { const e = document.getElementById('sharpness'); if (e) { e.value = 'soft'; e.dispatchEvent(new Event('change')); } });
  await p.evaluate(() => { const c = document.getElementById('showsite'); if (c && c.checked) { c.checked = false; c.dispatchEvent(new Event('change')); } });
  await p.waitForTimeout(4000);

  console.log('missile.glb fetched:', got.length ? got.join(', ') : '(none)');
  console.log('verdict:', await p.textContent('#flag'));

  await p.evaluate(() => document.getElementById('fire').click());
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const b = document.getElementById('cd-skip'); if (b) b.click(); });
  await p.waitForTimeout(4000);
  await p.evaluate(() => document.getElementById('playpause').click());   /* hold it still */
  await p.waitForTimeout(1500);

  /* Scrub to a point where the round is clear of the rail and the ground,
     then look at it from behind and from the side. */
  for (const [tag, at, cam] of [['early', 12, 'Chase'], ['early', 12, 'Tail'],
                                ['mid', 300, 'Chase'], ['mid', 300, 'Tail']]) {
    await p.evaluate((v) => {
      const e = document.getElementById('scrub');
      e.value = String(v); e.dispatchEvent(new Event('input'));
    }, at);
    await p.waitForTimeout(2500);
    await p.evaluate((c) => {
      const b = [...document.querySelectorAll('.cams button')].find(x => x.textContent.trim().startsWith(c));
      if (b) b.click();
    }, cam);
    await p.waitForTimeout(6000);
    /* the console and the flight bar sit over the middle of the frame */
    await p.evaluate(() => {
      ['panel', 'flightbar', 'hud', 'rightrail', 'aimchip'].forEach((id) => {
        const e = document.getElementById(id); if (e) e.style.visibility = 'hidden';
      });
    });
    await p.waitForTimeout(1200);
    await shot({ path: OUT + 'M-' + tag + '-' + cam.toLowerCase() + '.png' });
    await p.evaluate(() => {
      ['panel', 'flightbar', 'hud', 'rightrail', 'aimchip'].forEach((id) => {
        const e = document.getElementById(id); if (e) e.style.visibility = '';
      });
    });
    console.log('shot M-' + tag + '-' + cam.toLowerCase(), '·',
      (await p.textContent('#hud')).replace(/\s+/g, ' ').trim().slice(0, 70));
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
