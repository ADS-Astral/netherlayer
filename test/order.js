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


/* The rail as a finger sees it: only the visible keys, in painted order. */
const RAIL = `(() => {
  const ks = [...document.querySelectorAll('#stations .stn')]
    .filter(b => getComputedStyle(b).display !== 'none')
    .map(b => ({ name: b.querySelector('em').textContent, pane: b.dataset.pane,
                 on: b.classList.contains('on'),
                 y: Math.round(b.getBoundingClientRect().top),
                 x: Math.round(b.getBoundingClientRect().left) }));
  ks.sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = {};
  ks.forEach(k => { (rows[k.y] = rows[k.y] || []).push(k.name); });
  return { order: ks.map(k => k.name), rows: Object.values(rows),
           open: (ks.find(k => k.on) || {}).name };
})()`;

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
  BROWSER = browser;
  const WANT = ['Target', 'Round', 'Pad', 'Rails', 'Bank', 'Cost', 'Arc', 'Scene'];

  for (const [w, h, tag, phone] of [[1440, 900, 'desktop', false], [1100, 860, 'mid (arc moves in)', false],
                                    [900, 800, 'narrow (both move in)', false], [390, 844, 'iphone14', true]]) {
    const p = await (await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: phone ? 2 : 1, isMobile: phone, hasTouch: phone })).newPage();
    p.setDefaultTimeout(90000);
  /* A screenshot forces a whole frame, which on this rasteriser can take
     longer than the action budget. Losing one is not losing the run. */
  const shot = (o) => p.screenshot(o).catch(
    (e) => console.log('!! screenshot skipped: ' + String(e.message).split('\n')[0]));
    const errs = []; p.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 180)));
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
    await p.waitForFunction(() => document.getElementById('loader').classList.contains('gone'), { timeout: 90000 }).catch(() => console.log('!! loader stuck'));
    await p.waitForTimeout(10000);
    await p.evaluate(() => { const e = document.getElementById('sharpness'); if (e) { e.value = 'soft'; e.dispatchEvent(new Event('change')); } });
  /* The site models are 35 MB and about a million triangles a frame. This
     harness rasterises on the CPU and is not testing them, so leave them out. */
  await p.evaluate(() => { const c = document.getElementById('showsite'); if (c && c.checked) { c.checked = false; c.dispatchEvent(new Event('change')); } });
    if (phone) { await p.evaluate(() => document.getElementById('panel-btn').click()); await p.waitForTimeout(700); }

    const r0 = await p.evaluate(RAIL);
    const want = WANT.filter(n => r0.order.indexOf(n) >= 0);
    console.log('\n══ ' + tag + '  ' + w + '×' + h);
    console.log('   order  ', r0.order.join(' · '));
    console.log('   asked  ', want.join(' · '), '→', JSON.stringify(r0.order) === JSON.stringify(want) ? 'MATCH' : '*** WRONG ***');
    console.log('   rows   ', JSON.stringify(r0.rows), '· open on boot:', r0.open);

    /* every visible key opens its own pane and nothing else */
    const bad = [];
    for (const name of r0.order) {
      await p.evaluate(n => [...document.querySelectorAll('#stations .stn')].find(b => b.querySelector('em').textContent === n).click(), name);
      await p.waitForTimeout(320);
      const s = await p.evaluate(n => {
        const b = [...document.querySelectorAll('#stations .stn')].find(x => x.querySelector('em').textContent === n);
        const open = [...document.querySelectorAll('#deck .pane')].filter(s => !s.hidden).map(s => s.id);
        const rail = document.getElementById('stations').getBoundingClientRect();
        const body = document.getElementById('deck').getBoundingClientRect();
        return { want: b.dataset.pane, open, lit: b.classList.contains('on'),
                 filled: (document.getElementById(b.dataset.pane).textContent.trim().length > 0) ||
                         document.getElementById(b.dataset.pane).children.length > 0,
                 underRail: Math.round(body.top - rail.bottom) };
      }, name);
      const ok = s.open.length === 1 && s.open[0] === s.want && s.lit && s.filled;
      if (!ok) bad.push(name + ' → ' + JSON.stringify(s));
      process.stdout.write('   ' + name.padEnd(7) + (ok ? 'opens ' + s.open[0] + ', filled' : '*** ' + JSON.stringify(s)) + '\n');
    }
    if (bad.length) console.log('   !! ' + bad.join('\n   !! '));
    await shot({ path: OUT + 'O-' + tag.split(' ')[0] + '.png' });
    if (errs.length) console.log('   ' + errs.slice(0, 3).join('\n   '));
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
