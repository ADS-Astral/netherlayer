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
  const p = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
  p.setDefaultTimeout(90000);   /* CPU rasteriser: frames stall for tens of seconds */
  /* A screenshot forces a whole frame, which on this rasteriser can take
     longer than the action budget. Losing one is not losing the run. */
  const shot = (o) => p.screenshot(o).catch(
    (e) => console.log('!! screenshot skipped: ' + String(e.message).split('\n')[0]));
  const errs = [];
  p.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 220)));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource/.test(m.text())) errs.push('CON ' + m.text().slice(0, 140)); });
  await p.route('**/*', async r => {
    const u = r.request().url();
    if (u.startsWith('https://netherlayer.local/')) return r.fulfill({ path: SITE + decodeURIComponent(u.split('/').pop().split('?')[0]), contentType: u.endsWith('.glb') ? 'model/gltf-binary' : 'text/html; charset=utf-8' });
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
  await p.waitForFunction(() => document.getElementById('loader').classList.contains('gone'), { timeout: 90000 }).catch(() => console.log('!! loader stuck'));
  await p.waitForTimeout(9000);
  /* This harness rasterises on the CPU; pin the quality so the tests
     measure the page's behaviour and not SwiftShader's fill rate. */
  await p.evaluate(() => { const e = document.getElementById('sharpness'); if (e) { e.value = 'soft'; e.dispatchEvent(new Event('change')); } });
  /* The site models are 35 MB and about a million triangles a frame. This
     harness rasterises on the CPU and is not testing them, so leave them out. */
  await p.evaluate(() => { const c = document.getElementById('showsite'); if (c && c.checked) { c.checked = false; c.dispatchEvent(new Event('change')); } });

  // pad on the canyon rim, shot to the east at 30°
  await p.evaluate(() => window.netherlayerRange.jumpTo({ center: [-112.12, 36.075], zoom: 13.5, pitch: 60, bearing: 80, elevation: 2000 }));
  await p.waitForTimeout(9000);
  await p.evaluate(() => {
    document.getElementById('pick').click();
    const m = window.netherlayerRange, c = { lng: -112.12, lat: 36.075 };
    m.fire('click', { lngLat: c, point: m.project(c), originalEvent: {} });
  });
  await p.waitForTimeout(2500);
  await shot({ path: OUT + 'R1-solved.png' });
  console.log('verdict:', await p.textContent('#flag'), '| fire enabled:', await p.evaluate(() => !document.getElementById('fire').disabled));

  const hud = async () => (await p.textContent('#hud')).replace(/\s+/g, ' ').trim();

  // ── launch, pause early, then walk the cameras at a fixed moment
  await p.click('#fire');
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.getElementById('cd-skip').click());
  await p.waitForTimeout(1200);
  console.log('after launch — playing:', await p.evaluate(() => document.getElementById('playpause').textContent),
              '| pace:', await p.textContent('#ratelbl'),
              '| flying class:', await p.evaluate(() => document.body.classList.contains('flying')));
  await p.waitForTimeout(2500);
  await shot({ path: OUT + 'R2-earlyflight.png' });
  console.log('t~3.7s   ', await hud());

  // pause and scrub to a good vantage point (about a quarter through)
  await p.click('#playpause');
  await p.evaluate(() => { const s = document.getElementById('scrub'); s.value = '260'; s.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(1500);

  for (const cam of ['pad', 'chase', 'nose', 'tail', 'orbit']) {
    await p.evaluate(c => document.querySelector('[data-cam="' + c + '"]').click(), cam);
    await p.waitForTimeout(3500);
    await shot({ path: OUT + 'R3-cam-' + cam + '.png' });
    const cam3 = await p.evaluate(() => ({
      pitch: +window.netherlayerRange.getPitch().toFixed(1),
      bearing: +((window.netherlayerRange.getBearing() + 360) % 360).toFixed(1),
      elev: Math.round(window.netherlayerRange.getCenterElevation()),
      zoom: +window.netherlayerRange.getZoom().toFixed(2)
    }));
    console.log(('cam ' + cam).padEnd(10), JSON.stringify(cam3), '|', await hud());
  }

  // orbit drag should swing the camera around the projectile
  await p.evaluate(() => document.querySelector('[data-cam="orbit"]').click());
  const before = await p.evaluate(() => +window.netherlayerRange.getBearing().toFixed(1));
  await p.mouse.move(800, 500); await p.mouse.down();
  await p.mouse.move(1050, 470, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(1500);
  const after = await p.evaluate(() => +window.netherlayerRange.getBearing().toFixed(1));
  console.log('orbit drag moved bearing', before, '->', after);

  // apogee + end buttons
  await p.click('#apogeebtn'); await p.waitForTimeout(2500);
  await shot({ path: OUT + 'R4-apogee.png' });
  console.log('apogee   ', await hud());
  await p.click('#endbtn'); await p.waitForTimeout(2500);
  await shot({ path: OUT + 'R5-end.png' });
  console.log('end      ', await hud());

  // ── a >12 km/s shot should default to 1/20 pace
  await p.click('#reset');
  await p.waitForTimeout(1500);
  await p.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); };
    set('volt', '80'); set('cap', '60');
  });
  await p.waitForTimeout(2000);
  const fastStats = await p.evaluate(() => {
    const out = {}; document.querySelectorAll('#stats div').forEach(d => out[d.querySelector('span').textContent] = d.querySelector('b').textContent);
    return { flag: document.getElementById('flag').textContent, stats: out };
  });
  console.log('fast shot:', fastStats.flag, JSON.stringify(fastStats.stats));
  await p.click('#fire');
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.getElementById('cd-skip').click());
  await p.waitForTimeout(1500);
  console.log('pace after fast launch:', await p.textContent('#ratelbl'));
  await shot({ path: OUT + 'R6-fastshot.png' });

  // slider back to real time
  await p.evaluate(() => { const r = document.getElementById('rate'); r.value = '1000'; r.dispatchEvent(new Event('input')); });
  console.log('slider at max:', await p.textContent('#ratelbl'));

  // ── a shot that cannot leave the rails
  await p.click('#reset');
  await p.evaluate(() => {
    const set = (id, v) => { const e = document.getElementById(id); e.value = v; e.dispatchEvent(new Event('input')); };
    set('volt', '3'); set('cap', '1');
  });
  await p.waitForTimeout(2000);
  console.log('weak shot:', await p.textContent('#flag'), '| fire disabled:', await p.evaluate(() => document.getElementById('fire').disabled));

  console.log(errs.length ? errs.slice(0, 10).join('\n') : 'no js errors');
  await browser.close();
  done();
})().catch((e) => {
  console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]);
  try { done(3); } catch (x) {}
  if (BROWSER) BROWSER.close().then(() => process.exit(3), () => process.exit(3));
  else process.exit(3);
});
