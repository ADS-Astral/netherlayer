/* Flights that cross the shot: chosen at the destination, laid out at the
   count, and reported second by second. */
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

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
  BROWSER = browser;
  const p = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
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
  await p.evaluate(() => { const c = document.getElementById('showsite'); if (c && c.checked) { c.checked=false; c.dispatchEvent(new Event('change')); } });
  await p.evaluate(() => { const c = document.getElementById('showbuildings'); if (c && c.checked) { c.checked=false; c.dispatchEvent(new Event('change')); } });
  await p.waitForTimeout(3000);

  /* terrestrial, and pick a destination — which is what rolls the count */
  await p.evaluate(() => document.querySelector('[data-pane="p-target"]').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="mission"] button')].find(b=>/Terrestrial/.test(b.textContent)).click());
  await p.waitForTimeout(4000);

  const counts = [];
  for (const name of ['perth', 'sydney', 'brisbane', 'melbourne', 'adelaide', 'auckland']) {
    await p.evaluate(n => { const e = document.getElementById('citysearch'); e.value = n; e.dispatchEvent(new Event('input')); }, name);
    await p.waitForTimeout(500);
    await p.evaluate(() => { const r = document.querySelector('#citylist .cityrow'); if (r) r.click(); });
    await p.waitForTimeout(2600);
    /* the count is not on screen until the countdown, so fire and read it */
    await p.evaluate(() => document.getElementById('fire').click());
    await p.waitForTimeout(3600);
    const seen = await p.evaluate(() => ({
      shown: !document.getElementById('cd-traffic').hidden,
      cross: document.getElementById('cd-cross').textContent,
      risk: document.getElementById('cd-risk').textContent,
      routes: (() => { try { return window.netherlayerRange.querySourceFeatures('airways').length; } catch (e) { return -1; } })(),
      inSource: (() => { try { const d = window.netherlayerRange.getSource('airways').serialize(); return d.data.features.length; } catch (e) { return -1; } })()
    }));
    counts.push(seen);
    console.log(('after ' + name).padEnd(18), JSON.stringify(seen));
    if (counts.length === 1) await shot({ path: OUT + 'F-count.png' });
    /* watch the risk line flip as the seconds pass */
    if (counts.length === 1) {
      const seq = [];
      for (let k = 0; k < 7; k++) {
        await p.waitForTimeout(1000);
        seq.push(await p.evaluate(() => document.getElementById('cd-risk').textContent.slice(0, 18)));
      }
      console.log('  risk line by second:', JSON.stringify(seq));
    }
    await p.evaluate(() => { const b = document.getElementById('cd-skip'); if (b) b.click(); });
    await p.waitForTimeout(2500);
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x=>/Exit flight/.test(x.textContent)); if (b) b.click(); });
    await p.waitForTimeout(2000);
  }

  const nums = counts.map(c => { const m = /(\d+)/.exec(c.cross); return m ? +m[1] : 0; });
  console.log('\nflight counts across six destinations:', JSON.stringify(nums));
  console.log('  all within 1..10:', nums.every(n => n >= 1 && n <= 10));
  console.log('  they vary       :', new Set(nums).size > 1);
  console.log('  routes in the source:', JSON.stringify(counts.map(c => c.inSource)));
  console.log('  routes tiled near view:', JSON.stringify(counts.map(c => c.routes)));
  console.log('  source count matches flights:', counts.every(c => c.inSource === (/(\d+)/.exec(c.cross) ? +/(\d+)/.exec(c.cross)[1] : -1)));

  console.log('\n' + (errs.length ? errs.slice(0,4).join('\n') : 'no js errors'));
  await browser.close(); done();
})().catch(e => { console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]); if (BROWSER) BROWSER.close().then(()=>process.exit(3),()=>process.exit(3)); else process.exit(3); });
