/* Where does the round actually come down — the land at that spot, or sea level? */
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require(PLAYWRIGHT);
const { execFile } = require('child_process'); const crypto = require('crypto'); const fs = require('fs');
const path = require('path');
const SITE = path.join(__dirname, '..') + '/';
const OUT = __dirname + '/'; const CACHE = OUT + '.cache/';
fs.mkdirSync(CACHE + 'three', { recursive: true });
function cf(u) { const f = CACHE + crypto.createHash('sha1').update(u).digest('hex'); if (fs.existsSync(f)) return Promise.resolve(fs.readFileSync(f)); return new Promise(r => execFile('curl', ['-sSL', '--max-time', '25', '--compressed', '-o', f, u], e => r(e || !fs.existsSync(f) ? null : fs.readFileSync(f)))); }
const ct = u => u.endsWith('.glb') ? 'model/gltf-binary' : u.endsWith('.js') ? 'application/javascript' : u.includes('.png') ? 'image/png' : u.endsWith('.css') ? 'text/css' : 'image/jpeg';
const BUDGET = Number(process.env.BUDGET || 600) * 1000;
const T0 = Date.now(); let BROWSER = null;
const WATCHDOG = setTimeout(() => { console.log('\n!! watchdog after ' + Math.round((Date.now()-T0)/1000) + 's'); setTimeout(()=>process.exit(2),4000).unref(); if (BROWSER) BROWSER.close().then(()=>process.exit(2),()=>process.exit(2)); else process.exit(2); }, BUDGET);
const done = () => clearTimeout(WATCHDOG);

/* A pad on the Peruvian coast, aimed inland at La Paz — 3.6 km of Altiplano.
   If the round lands at sea level there it is 3.6 km underground. */
const PAD = [-77.05, -12.05];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
  BROWSER = browser;
  const p = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
  p.setDefaultTimeout(90000);
  const errs = []; p.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 200)));
  await p.route('**/*', async r => {
    const u = r.request().url();
    if (u.startsWith('https://netherlayer.local/')) { const f = SITE + decodeURIComponent(u.split('/').pop().split('?')[0]);
      return fs.existsSync(f) ? r.fulfill({ path: f, contentType: f.endsWith('.glb') ? 'model/gltf-binary' : 'text/html; charset=utf-8' }) : r.fulfill({ status: 404, body: '' }); }
    if (u.startsWith('https://unpkg.com/three@')) { const rel = u.split('three@0.180.0/')[1].split('?')[0]; const tf = CACHE + 'three/' + rel;
      if (fs.existsSync(tf)) return r.fulfill({ path: tf, contentType: 'application/javascript' });
      const js = await cf(u); return js ? r.fulfill({ status: 200, body: js, contentType: 'application/javascript' }) : r.abort(); }
    const x = await cf(u); return x ? r.fulfill({ status: 200, body: x, contentType: ct(u), headers: { 'access-control-allow-origin': '*' } }) : r.abort();
  });
  for (const u of ['https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js','https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css']) await cf(u);
  await p.goto('https://netherlayer.local/launch.html', { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('loader').classList.contains('gone'), { timeout: 120000 }).catch(()=>console.log('!! loader stuck'));
  await p.waitForTimeout(9000);
  await p.evaluate(() => { const e = document.getElementById('sharpness'); if (e) { e.value='soft'; e.dispatchEvent(new Event('change')); } });
  await p.evaluate(() => { const c = document.getElementById('showsite'); if (c && c.checked) { c.checked=false; c.dispatchEvent(new Event('change')); } });

  // pad on the coast
  await p.evaluate(c => window.netherlayerRange.jumpTo({ center: c, zoom: 11, pitch: 0, bearing: 0, elevation: 3000 }), PAD);
  await p.waitForFunction(c => { const h = window.netherlayerRange.queryTerrainElevation({lng:c[0],lat:c[1]}); return h !== null && h !== undefined && isFinite(h); }, PAD, { timeout: 90000 }).catch(()=>console.log('!! pad terrain never came'));
  await p.waitForTimeout(2500);
  await p.evaluate(c => { document.getElementById('pick').click(); const m = window.netherlayerRange, ll = {lng:c[0],lat:c[1]}; m.fire('click', { lngLat: ll, point: m.project(ll), originalEvent: {} }); }, PAD);
  await p.waitForTimeout(3500);
  console.log('pad     :', await p.evaluate(() => document.getElementById('padline').textContent.replace(/\s+/g,' ').trim()));

  // terrestrial, aimed at La Paz
  await p.evaluate(() => document.querySelector('[data-pane="p-target"]').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="mission"] button')].find(b=>/Terrestrial/.test(b.textContent)).click());
  await p.waitForTimeout(3000);
  await p.evaluate(() => { const e = document.getElementById('citysearch'); e.value='la paz'; e.dispatchEvent(new Event('input')); });
  await p.waitForTimeout(700);
  await p.evaluate(() => { const r = document.querySelector('#citylist .cityrow'); if (r) r.click(); });
  await p.waitForTimeout(3500);
  console.log('target  :', await p.evaluate(() => document.getElementById('targetline').textContent));
  await p.evaluate(() => document.getElementById('trim').click());
  await p.waitForTimeout(9000);

  const stats = await p.evaluate(() => { const o={}; document.querySelectorAll('#stats div').forEach(d=>o[d.querySelector('span').textContent]=d.querySelector('b').textContent); return o; });
  console.log('solved  :', JSON.stringify(stats).slice(0, 210));

  // fly to the very end and read where it stopped
  await p.evaluate(() => document.getElementById('fire').click());
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const b = document.getElementById('cd-skip'); if (b) b.click(); });
  await p.waitForTimeout(4000);
  await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x=>/End/.test(x.textContent)); if (b) b.click(); });
  await p.waitForTimeout(9000);

  const hud = (await p.textContent('#hud')).replace(/\s+/g,' ').trim();
  console.log('at the end:', hud.slice(0, 120));
  const where = await p.evaluate(() => {
    const c = window.netherlayerRange.getCenter();
    return { lng: +c.lng.toFixed(4), lat: +c.lat.toFixed(4) };
  });
  const land = await p.evaluate(w => { const h = window.netherlayerRange.queryTerrainElevation({lng:w.lng,lat:w.lat}); return (h===null||h===undefined||!isFinite(h))?null:Math.round(h); }, where);
  console.log('camera settled over', JSON.stringify(where), '· land there:', land, 'm');
  console.log('\n' + (errs.length ? errs.slice(0,4).join('\n') : 'no js errors'));
  await browser.close(); done();
})().catch(e => { console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]); if (BROWSER) BROWSER.close().then(()=>process.exit(3),()=>process.exit(3)); else process.exit(3); });
