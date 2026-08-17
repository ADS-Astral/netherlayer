/* The rail is three.js boxes now: do the console inputs actually shape it? */
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require(PLAYWRIGHT);
const { execFile } = require('child_process'); const crypto = require('crypto'); const fs = require('fs');
const path = require('path');
const SITE = path.join(__dirname, '..') + '/';
const OUT = __dirname + '/'; const CACHE = OUT + '.cache/';
fs.mkdirSync(CACHE + 'three', { recursive: true });
function cf(u) { const f = CACHE + crypto.createHash('sha1').update(u).digest('hex'); if (fs.existsSync(f)) return Promise.resolve(fs.readFileSync(f)); return new Promise(r => execFile('curl', ['-sSL','--max-time','25','--compressed','-o',f,u], e => r(e || !fs.existsSync(f) ? null : fs.readFileSync(f)))); }
const ct = u => u.endsWith('.glb') ? 'model/gltf-binary' : u.endsWith('.js') ? 'application/javascript' : u.includes('.png') ? 'image/png' : u.endsWith('.css') ? 'text/css' : 'image/jpeg';
const BUDGET = Number(process.env.BUDGET || 480) * 1000;
const T0 = Date.now(); let BROWSER = null;
const WATCHDOG = setTimeout(() => { console.log('\n!! watchdog after ' + Math.round((Date.now()-T0)/1000) + 's'); setTimeout(()=>process.exit(2),4000).unref(); if (BROWSER) BROWSER.close().then(()=>process.exit(2),()=>process.exit(2)); else process.exit(2); }, BUDGET);
const done = () => clearTimeout(WATCHDOG);
const PAD = [132.7394349, -23.0788817];

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
  BROWSER = browser;
  const p = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
  p.setDefaultTimeout(90000);
  const shot = (o) => p.screenshot(o).catch(e => console.log('!! shot skipped: ' + String(e.message).split('\n')[0]));
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
  await p.waitForFunction(() => !!window.netherlayerRange.getLayer('site-models'), { timeout: 240000 }).catch(()=>console.log('!! site models never arrived'));
  await p.waitForTimeout(5000);

  const set = async (id, v) => { await p.evaluate(([i,x]) => { const e = document.getElementById(i); e.value = String(x); e.dispatchEvent(new Event('input')); }, [id, v]); await p.waitForTimeout(3000); };
  const view = async (name, up, zoom, bearing, pitch) => {
    await p.evaluate(([c,g,u,z,b,t]) => window.netherlayerRange.jumpTo({ center: c, zoom: z, pitch: t, bearing: b, elevation: g + u }),
      [PAD, GROUND, up, zoom, bearing, pitch]);
    await p.waitForTimeout(7000);
    await shot({ path: OUT + name + '.png' });
    console.log('shot', name);
  };
  const GROUND = await p.evaluate(c => { const h = window.netherlayerRange.queryTerrainElevation({lng:c[0],lat:c[1]}); return (h===null||h===undefined||!isFinite(h))?0:h; }, PAD);

  /* A short, fat rail seen from the side, so the turn is unmistakable.
     A thin one a kilometre off is sub-pixel wide and shows nothing. */
  await set('rail', 200); await set('gap', 2.5); await set('railH', 2.5);
  for (const a of [10, 45, 80]) {
    await set('angle', a);
    await view('R-el' + a, 60, 16.9, 200, 74);
    console.log('   elevation', a);
  }
  /* and the length input, at a fixed elevation */
  await set('angle', 30);
  for (const L of [60, 400]) {
    await set('rail', L);
    await view('R-len' + L, 70, 16.4, 200, 68);
    console.log('   length', L, 'm');
  }

  console.log('\n' + (errs.length ? errs.slice(0,4).join('\n') : 'no js errors'));
  await browser.close(); done();
})().catch(e => { console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]); if (BROWSER) BROWSER.close().then(()=>process.exit(3),()=>process.exit(3)); else process.exit(3); });
