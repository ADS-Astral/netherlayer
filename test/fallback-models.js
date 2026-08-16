/* Run with:  node test/<name>.js
   Set CHROMIUM or PLAYWRIGHT_MODULE if they live somewhere else, and
   BUDGET=<seconds> to change the watchdog. */
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
/* The site must still stand when the models cannot be fetched. */
const { chromium } = require(PLAYWRIGHT);
const { execFile } = require('child_process'); const crypto = require('crypto'); const fs = require('fs');
const path = require('path');
const SITE = path.join(__dirname, '..') + '/';
const OUT = __dirname + '/'; const CACHE = OUT + '.cache/';
function cf(u){const f=CACHE+crypto.createHash('sha1').update(u).digest('hex');if(fs.existsSync(f))return Promise.resolve(fs.readFileSync(f));return new Promise(r=>execFile('curl',['-sSL','--max-time','25','--compressed','-o',f,u],e=>r(e||!fs.existsSync(f)?null:fs.readFileSync(f))));}
const ct=u=>u.endsWith('.bin')?'application/octet-stream':u.includes('.png')?'image/png':u.endsWith('.css')?'text/css':u.endsWith('.js')?'application/javascript':'image/jpeg';
/* No harness may hang. A hard wall-clock budget that always exits, so a
   stalled frame can cost minutes but never the session. */
const BUDGET = Number(process.env.BUDGET || 360) * 1000;
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

(async()=>{
  const b=BROWSER=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome',args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox']});
  const p=await (await b.newContext({viewport:{width:1200,height:820}})).newPage();
  p.setDefaultTimeout(90000);
  /* A screenshot forces a whole frame, which on this rasteriser can take
     longer than the action budget. Losing one is not losing the run. */
  const shot = (o) => p.screenshot(o).catch(
    (e) => console.log('!! screenshot skipped: ' + String(e.message).split('\n')[0]));
  const errs=[],warns=[];
  p.on('pageerror',e=>errs.push('ERR '+e.message.slice(0,200)));
  p.on('console',m=>{ if(m.type()==='warning'&&/Launch site model/.test(m.text())) warns.push(m.text().slice(0,120)); });
  await p.route('**/*',async r=>{
    const u=r.request().url();
    if(u.startsWith('https://netherlayer.local/')){
      const f=SITE+decodeURIComponent(u.split('/').pop().split('?')[0]);
      if(f.endsWith('.glb')) return r.fulfill({status:503,body:''});   // every model blocked
      return r.fulfill({path:f,contentType:'text/html; charset=utf-8'});
    }
    if (u.startsWith('https://unpkg.com/three@')) return r.fulfill({ status: 503, body: '' });   // three blocked too
    if (u.startsWith('https://unpkg.com/')) {
      /* maplibre and three both come from here; cached to disk on the
         first run so every run after it needs no network at all */
      const lib = await cf(u);
      return lib ? r.fulfill({ status: 200, body: lib, contentType: ct(u) }) : r.abort();
    }
    if(u.includes('interpreter'))return r.abort();
    const x=await cf(u);return x?r.fulfill({status:200,body:x,contentType:ct(u),headers:{'access-control-allow-origin':'*'}}):r.abort();
  });
  /* A fresh checkout has an empty cache, and fetching a megabyte of
     MapLibre while the page is already booting loses the race. Pull the
     CDN files down first; every run after this one has them on disk. */
  for (const u of ['https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js',
                   'https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css']) await cf(u);
  await p.goto('https://netherlayer.local/launch.html',{waitUntil:'load'});
  await p.waitForFunction(()=>document.getElementById('loader').classList.contains('gone'),{timeout:150000}).catch(()=>console.log('!! loader stuck'));
  await p.waitForTimeout(15000);
  await p.evaluate(()=>{const e=document.getElementById('sharpness');if(e){e.value='soft';e.dispatchEvent(new Event('change'));}});
  await p.waitForTimeout(6000);
  console.log('verdict still solves :', await p.evaluate(()=>document.getElementById('flag').textContent));
  console.log('bank hint            :', await p.evaluate(()=>document.getElementById('bankmix').textContent.trim()));
  console.log('warnings seen        :', warns.length, warns.length?('e.g. '+warns[0]):'');
  console.log('fire still enabled   :', await p.evaluate(()=>!document.getElementById('fire').disabled));
  await p.evaluate(()=>window.netherlayerRange.jumpTo({center:[132.7394349,-23.0788817],zoom:17.2,pitch:58,bearing:250,elevation:567+110}));
  await p.waitForTimeout(8000);
  await shot({path:OUT+'F-noModels.png'});
  console.log('\n'+(errs.length?errs.slice(0,4).join('\n'):'no js errors'));
  await b.close();
  done();
})().catch((e) => {
  console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]);
  try { done(3); } catch (x) {}
  if (BROWSER) BROWSER.close().then(() => process.exit(3), () => process.exit(3));
  else process.exit(3);
});
