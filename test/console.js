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
  const p = await (await browser.newContext({ viewport: { width: 1000, height: 720 } })).newPage();
  p.setDefaultTimeout(90000);
  /* A screenshot forces a whole frame, which on this rasteriser can take
     longer than the action budget. Losing one is not losing the run. */
  const shot = (o) => p.screenshot(o).catch(
    (e) => console.log('!! screenshot skipped: ' + String(e.message).split('\n')[0]));
  const errs = [];
  p.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 220)));
  p.on('console', m => { if (m.type() === 'error' && !/ERR_FAILED|Failed to load resource|no imagery/.test(m.text())) errs.push('CON ' + m.text().slice(0, 140)); });
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
  await p.waitForTimeout(9000);
  /* This harness rasterises on the CPU; pin the quality so the tests
     measure the page's behaviour and not SwiftShader's fill rate. */
  await p.evaluate(() => { const e = document.getElementById('sharpness'); if (e) { e.value = 'soft'; e.dispatchEvent(new Event('change')); } });
  /* The site models are 35 MB and about a million triangles a frame. This
     harness rasterises on the CPU and is not testing them, so leave them out. */
  await p.evaluate(() => { const c = document.getElementById('showsite'); if (c && c.checked) { c.checked = false; c.dispatchEvent(new Event('change')); } });

  console.log('brand removed:', await p.evaluate(() => !document.getElementById('topbar') && !/NETHERLAYER/.test(document.body.innerText)));
  console.log('model hidden:', await p.evaluate(() => getComputedStyle(document.getElementById('model')).display === 'none'));
  console.log('knobs built:', await p.evaluate(() => document.querySelectorAll('.kdial').length));

  const read = id => p.evaluate(i => document.getElementById(i).value, id);
  const knobOf = bind => p.evaluate(b => {
    const k = document.querySelector('.knob[data-bind="' + b + '"]');
    return k ? { shown: !!k.offsetParent, text: k.querySelector('.kval b').textContent, unit: k.querySelector('.kval span').textContent } : null;
  }, bind);

  // ── stations hide and reveal the dials
  console.log('\nstations:');
  for (const [pane, probe] of [['p-pad', 'angle'], ['p-rails', 'rail'], ['p-bank', 'bankN'], ['p-round', 'mPay'], ['p-target', 'alt'], ['p-scene', null]]) {
    await p.evaluate(x => document.querySelector('[data-pane="' + x + '"]').click(), pane);
    await p.waitForTimeout(400);
    const vis = await p.evaluate(x => [...document.querySelectorAll('#deck .pane')].filter(s => !s.hidden).map(s => s.id), pane);
    const k = probe ? await knobOf(probe) : null;
    console.log('  ' + pane.padEnd(9), 'open:', vis.join(','), k ? ('· ' + probe + ' dial ' + k.text + ' ' + k.unit + ' shown=' + k.shown) : '');
  }

  // ── rails in 1 m steps
  await p.evaluate(() => document.querySelector('[data-pane="p-rails"]').click());
  await p.waitForTimeout(500);
  const railBefore = await read('rail');
  for (let i = 0; i < 5; i++) {
    await p.evaluate(() => document.querySelector('.knob[data-bind="rail"] .kstep[data-d="1"]').click());
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(1200);
  console.log('\nrail +5 clicks:', railBefore, '->', await read('rail'), '| unit select is', await read('railUnit'), '| dial reads', (await knobOf('rail')).text);
  for (let i = 0; i < 3; i++) {
    await p.evaluate(() => document.querySelector('.knob[data-bind="rail"] .kstep[data-d="-1"]').click());
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(1200);
  console.log('rail -3 clicks:', await read('rail'));

  // ── turning a dial
  const box = await p.evaluate(() => {
    const r = document.querySelector('.knob[data-bind="gap"] .kdial').getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, r: r.width / 2 };
  });
  const gapBefore = await read('gap');
  await p.mouse.move(box.cx, box.cy - box.r * 0.8);
  await p.mouse.down();
  for (let a = -90; a <= 10; a += 10) {
    const rad = a * Math.PI / 180;
    await p.mouse.move(box.cx + Math.cos(rad) * box.r * 0.8, box.cy + Math.sin(rad) * box.r * 0.8);
  }
  await p.mouse.up();
  await p.waitForTimeout(1500);
  console.log('turning the bore dial clockwise:', gapBefore, '->', await read('gap'), '| dial reads', (await knobOf('gap')).text);

  // ── capacitor banks make the farads
  await p.evaluate(() => document.querySelector('[data-pane="p-bank"]').click());
  await p.waitForTimeout(500);
  console.log('\nbank at rest:', await read('bankN'), 'modules ·', await read('cap'), 'F ·', await p.evaluate(() => document.getElementById('bankmix').textContent));
  for (let i = 0; i < 6; i++) {
    await p.evaluate(() => document.querySelector('.knob[data-bind="bankN"] .kstep[data-d="1"]').click());
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(1500);
  console.log('after +6 modules:', await read('bankN'), 'modules ·', await read('cap'), 'F ·', await p.evaluate(() => document.getElementById('bankmix').textContent));
  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="bankSize"] button')].find(b => b.textContent === '2 F').click());
  await p.waitForTimeout(1500);
  console.log('switched to 2 F modules:', await read('bankN'), '×2 F =', await read('cap'), 'F');
  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="bankSize"] button')].find(b => b.textContent === '500 mF').click());
  await p.evaluate(() => { const e = document.getElementById('bankN'); e.value = '40'; e.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(1500);

  // ── segmented selectors and lamp switches
  await p.evaluate(() => document.querySelector('[data-pane="p-round"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="shape"] button')].find(b => /Sphere/.test(b.textContent)).click());
  await p.waitForTimeout(1200);
  console.log('\nnose set to Sphere: shape =', await read('shape'), '| hint:', await p.evaluate(() => document.getElementById('dPayHint').textContent));
  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="shape"] button')][0].click());
  await p.waitForTimeout(1000);

  await p.evaluate(() => document.querySelector('[data-pane="p-scene"]').click());
  await p.waitForTimeout(400);
  const before = await p.evaluate(() => document.getElementById('showcities').checked);
  await p.evaluate(() => document.querySelector('.tgl[data-bind="showcities"]').click());
  await p.waitForTimeout(900);
  const after = await p.evaluate(() => ({ on: document.getElementById('showcities').checked, lit: document.querySelector('.tgl[data-bind="showcities"]').classList.contains('on') }));
  console.log('city-marker switch:', before, '->', after.on, '| lamp lit =', after.lit);
  await p.evaluate(() => document.querySelector('.tgl[data-bind="showcities"]').click());
  await p.waitForTimeout(600);

  // ── the azimuth dial and the compass agree
  await p.evaluate(() => document.querySelector('[data-pane="p-pad"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => document.querySelector('#compass [data-az="225"]').click());
  await p.waitForTimeout(1400);
  console.log('\ncompass SW pressed: azimuth =', await read('azimuth'), '| dial reads', (await knobOf('azdial')).text);

  // ── target presets drive the altitude dial
  await p.evaluate(() => document.querySelector('[data-pane="p-target"]').click());
  await p.waitForTimeout(400);
  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="dest"] button')].find(b => /800 km/.test(b.textContent)).click());
  await p.waitForTimeout(1400);
  console.log('preset 800 km orbit: alt =', await read('alt'), '| dial reads', (await knobOf('alt')).text);

  // ── still solving, and still launching
  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="dest"] button')].find(b => /200 km/.test(b.textContent)).click());
  await p.waitForTimeout(1600);
  console.log('\nverdict:', await p.textContent('#flag'), '| lamp:', await p.evaluate(() => document.getElementById('lamp').className),
              '| fire enabled:', await p.evaluate(() => !document.getElementById('fire').disabled));
  console.log('cost still reads:', await p.evaluate(() => document.getElementById('cost-build').textContent));
  await shot({ path: OUT + 'U-console.png' });
  await p.evaluate(() => document.querySelector('[data-pane="p-bank"]').click());
  await p.waitForTimeout(600);
  await shot({ path: OUT + 'U-bank.png' });
  console.log('launch button on the tallest station:', await p.evaluate(() => {
    const f = document.getElementById('fire').getBoundingClientRect();
    const h = document.getElementById('hud').getBoundingClientRect();
    const sc = document.getElementById('conscroll');
    return JSON.stringify({ fireBottom: Math.round(f.bottom), viewport: innerHeight,
      clearsHud: f.bottom <= h.top, deckScrolls: sc.scrollHeight > sc.clientHeight + 1 });
  }));

  await p.evaluate(() => document.getElementById('fire').click());
  await p.waitForTimeout(1200);
  await p.evaluate(() => { const b = document.getElementById('cd-skip'); if (b) b.click(); });
  await p.waitForTimeout(4000);
  console.log('in flight:', await p.evaluate(() => document.body.classList.contains('flying')));
  await shot({ path: OUT + 'U-flight.png' });

  console.log('\n' + (errs.length ? errs.slice(0, 8).join('\n') : 'no js errors'));
  await browser.close();
  done();
})().catch((e) => {
  console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]);
  try { done(3); } catch (x) {}
  if (BROWSER) BROWSER.close().then(() => process.exit(3), () => process.exit(3));
  else process.exit(3);
});
