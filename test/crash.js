/* A mid-air: the clip plays, then the round comes down under canopy at
   the crash site rather than carrying on to the target.

   The Playwright Chromium build ships without an H.264 decoder, so it
   cannot play the clip the page actually carries. Rather than declare
   the cut untestable, the run records a few seconds of WebM out of the
   browser itself and serves that in the clip's place, which exercises
   the same element and the same events. Whether the real file decodes
   is reported separately, as the browser's own answer. */
const PLAYWRIGHT = process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright';
const CHROME = process.env.CHROMIUM || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const { chromium } = require(PLAYWRIGHT);
const { execFile } = require('child_process'); const crypto = require('crypto'); const fs = require('fs');
const path = require('path');
const SITE = path.join(__dirname, '..') + '/';
const OUT = __dirname + '/'; const CACHE = OUT + '.cache/';
fs.mkdirSync(CACHE + 'three', { recursive: true });
const STANDIN = CACHE + 'standin.webm';
function cf(u) { const f = CACHE + crypto.createHash('sha1').update(u).digest('hex'); if (fs.existsSync(f)) return Promise.resolve(fs.readFileSync(f)); return new Promise(r => execFile('curl', ['-sSL','--max-time','25','--compressed','-o',f,u], e => r(e || !fs.existsSync(f) ? null : fs.readFileSync(f)))); }
const ct = u => u.endsWith('.glb') ? 'model/gltf-binary' : u.endsWith('.js') ? 'application/javascript' : u.includes('.png') ? 'image/png' : u.endsWith('.css') ? 'text/css' : 'image/jpeg';
const BUDGET = Number(process.env.BUDGET || 600) * 1000;
const T0 = Date.now(); let BROWSER = null;
const WATCHDOG = setTimeout(() => { console.log('\n!! watchdog after ' + Math.round((Date.now()-T0)/1000) + 's'); setTimeout(()=>process.exit(2),4000).unref(); if (BROWSER) BROWSER.close().then(()=>process.exit(2),()=>process.exit(2)); else process.exit(2); }, BUDGET);
const done = () => clearTimeout(WATCHDOG);
const ARGS = ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox',
              '--autoplay-policy=no-user-gesture-required'];

/* Four seconds of something this browser can certainly decode. */
async function recordStandin(browser) {
  if (fs.existsSync(STANDIN)) return;
  const p = await browser.newPage();
  await p.route('**/*', r => r.fulfill({ status: 200, contentType: 'text/html', body: '<canvas id=c width=320 height=180></canvas>' }));
  await p.goto('https://standin.local/');
  const got = await p.evaluate(async () => {
    const c = document.getElementById('c'), g = c.getContext('2d');
    const mt = ['video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'].find(t => MediaRecorder.isTypeSupported(t));
    if (!mt) return 'NONE';
    const rec = new MediaRecorder(c.captureStream(25), { mimeType: mt }), parts = [];
    rec.ondataavailable = e => parts.push(e.data);
    const stopped = new Promise(r => rec.onstop = r);
    rec.start();
    let f = 0;
    await new Promise(fin => { const tick = () => {
      g.fillStyle = 'hsl(' + (f * 4 % 360) + ',70%,45%)'; g.fillRect(0, 0, 320, 180);
      g.fillStyle = '#fff'; g.font = '28px sans-serif'; g.fillText('cut ' + f, 20, 100);
      if (++f < 100) requestAnimationFrame(tick); else fin(); }; tick(); });
    rec.stop(); await stopped;
    const u = new Uint8Array(await new Blob(parts, { type: mt }).arrayBuffer());
    let s = ''; for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
  });
  await p.close();
  if (got === 'NONE') return;
  fs.writeFileSync(STANDIN, Buffer.from(got, 'base64'));
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ARGS });
  BROWSER = browser;
  await recordStandin(browser);
  const standin = fs.existsSync(STANDIN) ? fs.readFileSync(STANDIN) : null;

  const p = await (await browser.newContext({ viewport: { width: 1000, height: 700 } })).newPage();
  p.setDefaultTimeout(90000);
  const shot = (o) => p.screenshot(o).catch(e => console.log('!! shot skipped: ' + String(e.message).split('\n')[0]));
  const errs = []; let clipAsked = 0; let served = 'the clip itself';
  /* Serve it the way a network does, not the way a disk does. The bug
     this guards against was invisible at disk speed: the clip was armed
     with preload="none" (so nothing downloaded until play), and a short
     fuse then gave up on it and disabled the cut for the whole session.
     Three seconds is longer than that fuse was. */
  const CLIP_LAG = Number(process.env.CLIP_LAG || 3000);
  let clipAskedAt = []; let firedAt = 0;
  p.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 200)));
  await p.route('**/*', async r => {
    const u = r.request().url();
    if (u.startsWith('https://netherlayer.local/')) {
      const f = SITE + decodeURIComponent(u.split('/').pop().split('?')[0]);
      if (f.endsWith('.mp4')) {
        clipAsked++; clipAskedAt.push(Date.now());
        await new Promise(go => setTimeout(go, CLIP_LAG));
        if (standin) return r.fulfill({ status: 200, body: standin, contentType: 'video/webm' });
        return fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'video/mp4' }) : r.fulfill({ status: 404, body: '' });
      }
      return fs.existsSync(f) ? r.fulfill({ path: f, contentType: f.endsWith('.html') ? 'text/html; charset=utf-8' : ct(f) }) : r.fulfill({ status: 404, body: '' });
    }
    if (u.startsWith('https://unpkg.com/three@')) { const rel = u.split('three@0.180.0/')[1].split('?')[0]; const tf = CACHE + 'three/' + rel;
      if (fs.existsSync(tf)) return r.fulfill({ path: tf, contentType: 'application/javascript' });
      const js = await cf(u); return js ? r.fulfill({ status: 200, body: js, contentType: 'application/javascript' }) : r.abort(); }
    const x = await cf(u); return x ? r.fulfill({ status: 200, body: x, contentType: ct(u), headers: { 'access-control-allow-origin': '*' } }) : r.abort();
  });
  for (const u of ['https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js','https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css']) await cf(u);
  await p.goto('https://netherlayer.local/launch.html', { waitUntil: 'load' });
  await p.waitForFunction(() => document.getElementById('loader').classList.contains('gone'), { timeout: 120000 }).catch(()=>console.log('!! loader stuck'));
  await p.waitForTimeout(9000);

  const canH264 = await p.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.42E01E"') || '(no)');
  console.log('this browser plays H.264:', canH264);
  if (standin) { served = 'a recorded WebM in its place'; console.log('serving ' + served + ', ' + standin.length + ' bytes — the cut is exercised, the shipped file is not'); }
  console.log('the clip is held back ' + CLIP_LAG + ' ms, as a network would');

  await p.evaluate(() => { const e = document.getElementById('sharpness'); if (e) { e.value='soft'; e.dispatchEvent(new Event('change')); } });
  for (const id of ['showsite','showbuildings']) await p.evaluate(i => { const c = document.getElementById(i); if (c && c.checked) { c.checked=false; c.dispatchEvent(new Event('change')); } }, id);
  await p.waitForTimeout(3000);

  /* Watch the overlay from inside the page, so a cut that comes and
     goes between two polls is still seen. */
  await p.evaluate(() => {
    window.__cut = [];
    const box = document.getElementById('crashcut');
    new MutationObserver(() => window.__cut.push({ shown: !box.hidden, at: performance.now() }))
      .observe(box, { attributes: true, attributeFilter: ['hidden'] });
  });

  await p.evaluate(() => document.querySelector('[data-pane="p-target"]').click());
  await p.waitForTimeout(600);
  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="mission"] button')].find(b=>/Terrestrial/.test(b.textContent)).click());
  await p.waitForTimeout(4000);

  console.log('the clip is untouched until it is needed:', clipAsked === 0);
  const clean = await p.evaluate(() => {
    const rows = {}; document.querySelectorAll('#stats div').forEach(d => { const s = d.querySelector('span'), b = d.querySelector('b'); if (s && b) rows[s.textContent] = b.textContent; });
    return { reaches: rows['Reaches'] || '(none)', target: rows['Target range'] || '(none)',
             canopy: rows['Canopy out at'] || '(none)', back: rows['Back down at'] || '(none)' };
  });
  console.log('a clean shot   ', JSON.stringify(clean));

  /* Fire repeatedly and let it go on a second the count itself calls
     dangerous. The check and the skip happen in one page turn, so the
     shot leaves inside the window rather than a round trip after it. */
  let hit = false, tries = 0, warned = 0, during = null, waited = false;
  while (!hit && tries++ < 12 && Date.now() - T0 < BUDGET - 120000) {
    await p.evaluate(() => { window.__cut = []; document.getElementById('fire').click(); });
    await p.waitForTimeout(1800);
    let went = false;
    for (let k = 0; k < 44 && !went; k++) {
      went = await p.evaluate(() => {
        const t = document.getElementById('cd-traffic');
        if (!t || t.hidden || t.className !== 'hot') return false;
        document.getElementById('cd-skip').click();          /* same turn: no round trip */
        return true;
      });
      if (went) firedAt = Date.now();
      if (went) { warned++; break; }
      if (await p.evaluate(() => document.getElementById('countdown').hidden)) break;
      await p.waitForTimeout(250);
    }
    if (!went) { await p.evaluate(() => { const b = document.getElementById('cd-skip'); if (b && !document.getElementById('countdown').hidden) b.click(); }); }

    /* Did the collision land? The canopy time is the tell: forced open
       early is a mid-air, 98% of the way through is the ordinary one. */
    await p.waitForTimeout(900);
    const st = await p.evaluate(() => {
      const rows = {}; document.querySelectorAll('#stats div').forEach(d => { const s = d.querySelector('span'), b = d.querySelector('b'); if (s && b) rows[s.textContent] = b.textContent; });
      return { canopy: rows['Canopy out at'] || '', back: rows['Back down at'] || '' };
    });
    if (went && st.canopy && st.canopy !== clean.canopy) {
      hit = true;
      console.log('caught one on launch ' + tries + ' — canopy forced at ' + st.canopy + ' (a clean shot: ' + clean.canopy + ')');
      if (warned === 1) await shot({ path: OUT + 'C-warned.png' });

      /* Walk the clock over the collision with the scrub bar rather than
         waiting for it. Playing through is not an option here: this
         browser rasterises on the CPU, a frame of the launch view costs
         seconds, and requestAnimationFrame stops being served long
         before a flight gets anywhere — which is why flight.js scrubs
         too. The page meets the mid-air in frame(), on flight.t, and
         the scrub bar moves flight.t; the code under test is the same. */
      const secs = t => { const m = /^(\d+):(\d\d)/.exec(t); if (m) return +m[1] * 60 + +m[2];
                          const n = /([\d.]+)\s*s/.exec(t); return n ? +n[1] : NaN; };
      const tc = secs(st.canopy), dur = secs(st.back);
      const at = Math.min(999, Math.ceil(tc / dur * 1000) + 4);
      console.log('scrubbing past the collision: T+' + tc.toFixed(1) + ' s of ' + dur + ' s (scrub ' + at + ')');
      await p.evaluate(v => { const s = document.getElementById('scrub'); s.value = String(v); s.dispatchEvent(new Event('input')); }, at);
      for (let k = 0; k < 26; k++) {
        await p.waitForTimeout(600);
        const now = await p.evaluate(() => ({ cut: !document.getElementById('crashcut').hidden,
          cue: !document.getElementById('crashcue').hidden,
          hiddenVid: document.getElementById('crashvid').classList.contains('waiting'),
          t: document.getElementById('h-t').textContent }));
        if (now.cue) waited = true;
        if (now.cut && !now.cue && !during) { during = true; console.log('the cut is up, at ' + now.t); await shot({ path: OUT + 'C-cut.png' }); }
        if (now.cue && now.cut && !now.hiddenVid) console.log('*** WRONG: an empty player is on screen while waiting');
        if (during && !now.cut) { console.log('the cut clears again'); break; }
      }
      break;
    }
    await p.evaluate(() => { const b = [...document.querySelectorAll('button')].find(x=>/Exit flight/.test(x.textContent)); if (b) b.click(); });
    await p.waitForTimeout(1500);
  }

  const cut = await p.evaluate(() => window.__cut || []);
  const opened = cut.filter(c => c.shown), closed = cut.filter(c => !c.shown);
  const held = opened.length && closed.length ? Math.round(closed[closed.length-1].at - opened[0].at) : 0;
  console.log('dangerous seconds caught: ' + warned + ' in ' + tries + ' launches');
  console.log('the mid-air landed      : ' + hit);
  console.log('the cut came up         : ' + (opened.length > 0) + (held ? ' and held ' + held + ' ms' : ''));
  console.log('the cut cleared again   : ' + (closed.length > 0));
  console.log('waited behind a cue     : ' + waited + (waited ? ' (the clip was not ready at the collision)' : ''));
  console.log('the clip was fetched    : ' + (clipAsked > 0) + ' (' + served + ')');
  const early = clipAskedAt.length && firedAt && clipAskedAt[0] < firedAt;
  console.log('asked for during the count: ' + !!early +
              (clipAskedAt.length && firedAt ? '  (' + Math.round((firedAt - clipAskedAt[0]) / 1000) + ' s of head start)' : ''));
  if (hit && !early) console.log('*** WRONG: the clip is not asked for until it is already needed');

  await p.waitForTimeout(3000);
  const after = await p.evaluate(() => {
    const rows = {}; document.querySelectorAll('#stats div').forEach(d => { const s = d.querySelector('span'), b = d.querySelector('b'); if (s && b) rows[s.textContent] = b.textContent; });
    return { canopy: rows['Canopy out at'] || '(none)', back: rows['Back down at'] || '(none)',
             reaches: rows['Reaches'] || '(none)', target: rows['Target range'] || '(none)',
             short: rows['Falls short by'] || '(none)', speed: rows['Touchdown speed'] || rows['Impact speed'] || '(none)',
             flying: document.body.classList.contains('flying') };
  });
  console.log('after the mid-air:', JSON.stringify(after));
  if (hit) {
    if (after.canopy === clean.canopy) console.log('*** WRONG: the canopy is on the ordinary schedule, not the collision');
    if (after.short === '(none)') console.log('*** WRONG: it still made its target after hitting an airliner');
  }
  await shot({ path: OUT + 'C-after.png' });
  if (!hit) console.log('!! never landed a mid-air in ' + tries + ' launches');

  console.log('\n' + (errs.length ? errs.slice(0,4).join('\n') : 'no js errors'));
  await browser.close(); done();
})().catch(e => { console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]); if (BROWSER) BROWSER.close().then(()=>process.exit(3),()=>process.exit(3)); else process.exit(3); });
