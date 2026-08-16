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
  const p = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  p.setDefaultTimeout(90000);
  /* A screenshot forces a whole frame, which on this rasteriser can take
     longer than the action budget. Losing one is not losing the run. */
  const shot = (o) => p.screenshot(o).catch(
    (e) => console.log('!! screenshot skipped: ' + String(e.message).split('\n')[0]));
  const errs = [];
  p.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 220)));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|no imagery/.test(m.text())) errs.push('CON ' + m.text().slice(0, 160)); });
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
  await p.waitForFunction(() => document.getElementById('loader').classList.contains('gone'), { timeout: 120000 }).catch(() => console.log('!! loader stuck'));
  await p.waitForTimeout(14000);
  await p.evaluate(() => { const e = document.getElementById('sharpness'); if (e) { e.value = 'soft'; e.dispatchEvent(new Event('change')); } });
  /* The site models are 35 MB and about a million triangles a frame. This
     harness rasterises on the CPU and is not testing them, so leave them out. */
  await p.evaluate(() => { const c = document.getElementById('showsite'); if (c && c.checked) { c.checked = false; c.dispatchEvent(new Event('change')); } });
  await p.evaluate(() => { const c = document.getElementById('showbuildings'); if (c.checked) { c.checked = false; c.dispatchEvent(new Event('change')); } });

  // ── (1) the pad the page opens with
  const where = await p.evaluate(() => ({
    centre: window.netherlayerRange.getCenter(),
    pad: document.getElementById('padline').textContent.replace(/\s+/g, ' ').trim()
  }));
  console.log('map opens at  :', where.centre.lng.toFixed(6), where.centre.lat.toFixed(6));
  console.log('pad line reads:', where.pad);
  console.log('  wanted      : 132.739435 -23.078882');

  // wait for the terrain seed to land the pad
  await p.waitForFunction(() => /ASL/.test(document.getElementById('padline').textContent), { timeout: 90000 }).catch(() => console.log('!! pad never seeded'));
  await p.waitForTimeout(2500);
  console.log('after seeding :', await p.evaluate(() => document.getElementById('padline').textContent.replace(/\s+/g, ' ').trim()));

  // ── (2) terrestrial gives a city list, not a distance dial
  await p.evaluate(() => document.querySelector('[data-pane="p-target"]').click());
  await p.waitForTimeout(700);
  console.log('\norbital mode shows a range dial:',
    await p.evaluate(() => !!document.querySelector('.knob[data-bind="range"]')));

  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="mission"] button')].find(b => /Terrestrial/.test(b.textContent)).click());
  await p.waitForTimeout(4000);
  const g = () => p.evaluate(() => ({
    target: document.getElementById('targetline').textContent,
    search: document.getElementById('citysearch').value,
    rows: [...document.querySelectorAll('#citylist .cityrow')].slice(0, 6)
      .map(r => r.querySelector('b').textContent + ' ' + r.querySelector('.far').textContent + (r.classList.contains('on') ? ' ←' : '')),
    total: document.querySelectorAll('#citylist .cityrow').length,
    hint: document.getElementById('groundHint').textContent.trim().slice(0, 110),
    range: document.getElementById('range').value,
    dialGone: !document.querySelector('.knob[data-bind="range"]')
  }));
  let s = await g();
  console.log('\nswitched to TERRESTRIAL');
  console.log('  range dial gone :', s.dialGone);
  console.log('  destination     :', s.target);
  console.log('  search box      :', JSON.stringify(s.search));
  console.log('  list (' + s.total + ' rows) :', s.rows.join(' | '));
  console.log('  hidden range    :', s.range, 'km');
  console.log('  hint            :', s.hint);

  // ── (3) typing a name
  await p.evaluate(() => { const e = document.getElementById('citysearch'); e.value = 'wellin'; e.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(500);
  s = await g();
  console.log('\ntyped "wellin"  :', s.rows.join(' | '), '·', s.total, 'rows');
  await p.evaluate(() => document.querySelector('#citylist .cityrow').click());
  await p.waitForTimeout(3500);
  s = await g();
  console.log('clicked the row :', s.target);
  console.log('  search box    :', JSON.stringify(s.search), '· hidden range', s.range, 'km');
  console.log('  azimuth now   :', await p.evaluate(() => document.getElementById('azimuth').value) + '°');
  console.log('  marked row    :', (s.rows.find(r => /←/.test(r)) || '(none in the top six)'));
  console.log('  scrolled to it:', await p.evaluate(() => {
    const box = document.getElementById('citylist');
    const on = box.querySelector('.cityrow.on');
    if (!on) return 'no marked row!';
    const b = box.getBoundingClientRect(), r = on.getBoundingClientRect();
    return (r.top >= b.top - 1 && r.bottom <= b.bottom + 1)
      ? 'yes — ' + on.querySelector('b').textContent + ' is inside the visible list'
      : 'NO — marked row is ' + Math.round(r.top - b.top) + 'px off, list scrollTop ' + box.scrollTop;
  }));

  // a name that matches nothing
  await p.evaluate(() => { const e = document.getElementById('citysearch'); e.value = 'zzzz'; e.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(400);
  console.log('typed "zzzz"    :', await p.evaluate(() => document.getElementById('citylist').textContent.trim().slice(0, 70)));

  // Enter picks the first match
  await p.evaluate(() => { const e = document.getElementById('citysearch'); e.focus(); e.value = 'perth'; e.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(400);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(3500);
  s = await g();
  console.log('typed "perth" ⏎ :', s.target);

  // clear button
  await p.evaluate(() => document.getElementById('cityclear').click());
  await p.waitForTimeout(500);
  s = await g();
  console.log('cleared the box :', s.total, 'rows ·', s.rows.slice(0, 3).join(' | '), '· still aimed at', JSON.stringify(s.target));

  // ── (4) clicking a marker on the globe still aims
  await p.evaluate(() => window.netherlayerRange.jumpTo({ center: [151.21, -33.87], zoom: 5, pitch: 0, bearing: 0, elevation: 0 }));
  await p.waitForTimeout(6000);
  const hit = await p.evaluate(() => {
    const m = window.netherlayerRange;
    const c = { lng: 151.21, lat: -33.87 };
    const pt = m.project(c);
    m.fire('click', { lngLat: c, point: pt, originalEvent: {} });
    return true;
  });
  await p.waitForTimeout(3500);
  s = await g();
  console.log('\ntapped Sydney on the globe:', s.target, '| search box', JSON.stringify(s.search));

  // ── (5) trim still works against the chosen city, and back to orbital
  await p.evaluate(() => document.getElementById('trim').click());
  await p.waitForTimeout(6000);
  const stats = await p.evaluate(() => { const o = {}; document.querySelectorAll('#stats div').forEach(d => o[d.querySelector('span').textContent] = d.querySelector('b').textContent); return { flag: document.getElementById('flag').textContent, o }; });
  console.log('after trimming  :', stats.flag, '|', JSON.stringify(stats.o).slice(0, 200));
  console.log('reachable rows marked:', await p.evaluate(() => document.querySelectorAll('#citylist .cityrow.reach').length));

  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="mission"] button')].find(b => /Orbital/.test(b.textContent)).click());
  await p.waitForTimeout(3500);
  console.log('back to ORBITAL :', await p.evaluate(() => document.getElementById('flag').textContent),
              '| ground pane hidden:', await p.evaluate(() => document.getElementById('m-ground').hidden));
  await shot({ path: OUT + 'D-orbital.png' });
  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="mission"] button')].find(b => /Terrestrial/.test(b.textContent)).click());
  await p.waitForTimeout(3500);
  console.log('terrestrial again:', await p.evaluate(() => document.getElementById('targetline').textContent));
  await shot({ path: OUT + 'D-ground.png' });

  console.log('\n' + (errs.length ? errs.slice(0, 6).join('\n') : 'no js errors'));
  await browser.close();
  done();
})().catch((e) => {
  console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]);
  try { done(3); } catch (x) {}
  if (BROWSER) BROWSER.close().then(() => process.exit(3), () => process.exit(3));
  else process.exit(3);
});
