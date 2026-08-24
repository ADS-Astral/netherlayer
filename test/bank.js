/* The bank: ten billion, less whatever the launcher costs, less every
   round fired, plus what the deliveries paid — and it remembers. */
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

/* "$5.89 bn" -> 5890000000, so sums can be checked rather than eyeballed */
const cash = t => {
  const m = /\$([\d.]+)\s*(tn|bn|M|k)?/.exec(String(t).replace(/[−–]/g, '-'));
  if (!m) return NaN;
  const mul = { tn: 1e12, bn: 1e9, M: 1e6, k: 1e3 }[m[2]] || 1;
  return (/^-|^\$?-/.test(String(t)) ? -1 : 1) * parseFloat(m[1]) * mul;
};
const near = (a, b, tol) => Math.abs(a - b) <= (tol === undefined ? Math.abs(b) * 0.02 + 1 : tol);
/* "launcher $2.31 bn · 0 of 1 delivered · −$14.2 k on the rounds" -> -14200 */
const net = sub => {
  const m = /([−–-]?)\s*(\$[\d.]+\s*(?:tn|bn|M|k)?)\s+on the rounds/.exec(String(sub));
  if (!m) return NaN;
  return (m[1] ? -1 : 1) * cash(m[2]);
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, args: ['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--no-sandbox'] });
  BROWSER = browser;
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(90000);
  const shot = (o) => p.screenshot(o).catch(e => console.log('!! shot skipped: ' + String(e.message).split('\n')[0]));
  const errs = []; p.on('pageerror', e => errs.push('ERR ' + e.message.slice(0, 200)));
  const route = async r => {
    const u = r.request().url();
    if (u.startsWith('https://netherlayer.local/')) { const f = SITE + decodeURIComponent(u.split('/').pop().split('?')[0]);
      return fs.existsSync(f) ? r.fulfill({ path: f, contentType: f.endsWith('.glb') ? 'model/gltf-binary' : f.endsWith('.mp4') ? 'video/mp4' : 'text/html; charset=utf-8' }) : r.fulfill({ status: 404, body: '' }); }
    if (u.startsWith('https://unpkg.com/three@')) { const rel = u.split('three@0.180.0/')[1].split('?')[0]; const tf = CACHE + 'three/' + rel;
      if (fs.existsSync(tf)) return r.fulfill({ path: tf, contentType: 'application/javascript' });
      const js = await cf(u); return js ? r.fulfill({ status: 200, body: js, contentType: 'application/javascript' }) : r.abort(); }
    const x = await cf(u); return x ? r.fulfill({ status: 200, body: x, contentType: ct(u), headers: { 'access-control-allow-origin': '*' } }) : r.abort();
  };
  await p.route('**/*', route);
  for (const u of ['https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.js','https://unpkg.com/maplibre-gl@5.24.0/dist/maplibre-gl.css']) await cf(u);

  const boot = async (page) => {
    await page.goto('https://netherlayer.local/launch.html', { waitUntil: 'load' });
    await page.waitForFunction(() => document.getElementById('loader').classList.contains('gone'), { timeout: 120000 }).catch(()=>console.log('!! loader stuck'));
    await page.waitForTimeout(9000);
    await page.evaluate(() => { const e = document.getElementById('sharpness'); if (e) { e.value='soft'; e.dispatchEvent(new Event('change')); } });
    for (const id of ['showsite','showbuildings']) await page.evaluate(i => { const c = document.getElementById(i); if (c && c.checked) { c.checked=false; c.dispatchEvent(new Event('change')); } }, id);
    await page.waitForTimeout(2500);
  };
  const vault = () => p.evaluate(() => ({
    sum: document.getElementById('vault-sum').textContent,
    sub: document.getElementById('vault-sub').textContent,
    broke: document.getElementById('vault').classList.contains('broke'),
    build: document.getElementById('cost-build').textContent,
    perShot: document.getElementById('cost-shot').textContent,
    deal: document.getElementById('dealHint').textContent,
    fire: document.getElementById('fire').disabled,
    flag: document.getElementById('flag').textContent
  }));

  await boot(p);
  await p.evaluate(() => localStorage.removeItem('netherlayer.bank.v1'));
  await p.evaluate(() => document.getElementById('vault-reset').click());
  await p.waitForTimeout(1200);

  let v = await vault();
  console.log('at rest         ', v.sum, '·', v.sub);
  const build = cash(v.build), left = cash(v.sum);
  console.log('  ten billion less the launcher:', near(left, 1e10 - build) ? 'yes' : '*** WRONG: ' + v.sum + ' vs ' + v.build);
  await shot({ path: OUT + 'B-rest.png' });

  /* the launcher is bought as it stands: a bigger bank costs more */
  const before = cash((await vault()).build);
  await p.evaluate(() => { const e = document.getElementById('bankN'); e.value = '80'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(1500);
  v = await vault();
  const after = cash(v.build);
  console.log('doubling the farads:', money(before), '->', money(after), after > before ? '(dearer)' : '*** WRONG: not dearer');
  console.log('  the bank followed :', near(cash(v.sum), 1e10 - after) ? 'yes' : '*** WRONG: ' + v.sum);
  await p.evaluate(() => { const e = document.getElementById('bankN'); e.value = '40'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(1200);

  /* the margin, and what it makes a delivery worth */
  for (const m of ['0', '25', '150']) {
    await p.evaluate(x => { const e = document.getElementById('margin'); e.value = x; e.dispatchEvent(new Event('input')); }, m);
    await p.waitForTimeout(900);
    v = await vault();
    const pay = cash(v.deal), cost = cash(v.perShot);
    const want = cost * (1 + Number(m) / 100);
    console.log(('margin ' + m + '%').padEnd(16), v.deal.slice(0, 78));
    console.log('  pays cost × (1 + margin):', near(pay, want, Math.abs(want) * 0.03 + 1) ? 'yes' : '*** WRONG: ' + money(pay) + ' vs ' + money(want));
  }

  /* aim somewhere reachable, trim onto it, and fire until it lands */
  await p.evaluate(() => document.querySelector('[data-pane="p-target"]').click());
  await p.waitForTimeout(500);
  await p.evaluate(() => [...document.querySelectorAll('.seg[data-bind="mission"] button')].find(b=>/Terrestrial/.test(b.textContent)).click());
  await p.waitForTimeout(3000);
  await p.evaluate(() => { const b = document.getElementById('trim'); if (b) b.click(); });
  await p.waitForTimeout(3000);
  v = await vault();
  console.log('\nafter trimming  ', v.flag, '| fire:', v.fire ? 'blocked' : 'ready');
  const onTarget = /ON TARGET/.test(v.flag);
  const bankBefore = cash(v.sum), shotCost = cash(v.perShot), pay = cash(v.deal);

  await p.evaluate(() => document.getElementById('fire').click());
  await p.waitForTimeout(2200);
  await p.evaluate(() => { const b = document.getElementById('cd-skip'); if (b) b.click(); });
  await p.waitForTimeout(2500);
  v = await vault();
  console.log('the round is away', v.sum, '·', v.sub);
  /* The headline is three significant figures of billions, so a round
     costing thousands is invisible in it — the running total on the
     rounds is the figure with the precision to check. */
  console.log('  a round was charged:', near(net(v.sub), -shotCost, Math.abs(shotCost) * 0.05 + 1)
    ? 'yes, ' + money(net(v.sub)) : '*** WRONG: ' + money(net(v.sub)) + ', wanted ' + money(-shotCost));

  /* run it to the ground and see the delivery paid */
  await p.evaluate(() => { const b = document.getElementById('endbtn'); if (b) b.click(); });
  await p.waitForTimeout(3500);
  v = await vault();
  console.log('once it is down  ', v.sum, '·', v.sub);
  const earned = net(v.sub) + shotCost;          /* net = paid − cost */
  /* Traffic is rolled per launch, so this shot may have met an airliner
     on the way — which is a real outcome, not a failure, and the round
     that comes down under canopy at the crash site is correctly not a
     delivery. Judge against what the console says after the flight, not
     what it said before it. */
  const landedOn = (await vault()).flag;
  const arrived = /ON TARGET/.test(landedOn);
  if (onTarget && !arrived) console.log('  it met an airliner on the way — ' + landedOn.slice(0, 40));
  if (arrived) {
    console.log('  the delivery paid:', near(earned, pay, Math.abs(pay) * 0.05 + 1)
      ? 'yes, ' + money(earned) : '*** WRONG: got ' + money(earned) + ', wanted ' + money(pay));
    console.log('  which is the cost plus the margin:',
      near(earned, shotCost * 2.5, Math.abs(shotCost) * 0.08) ? 'yes (150% margin)' : '*** WRONG');
    console.log('  counted           :', /1 of 1 delivered/.test(v.sub) ? 'yes' : '*** WRONG: ' + v.sub);
  } else {
    console.log('  not a delivery, so nothing paid:', Math.abs(earned) < 1 ? 'yes' : '*** WRONG: ' + money(earned));
    console.log('  and the round was still charged:', near(net(v.sub), -shotCost, Math.abs(shotCost) * 0.05 + 1)
      ? 'yes' : '*** WRONG: ' + money(net(v.sub)));
  }
  await shot({ path: OUT + 'B-paid.png' });

  /* And it is still there after a reload. Only the ledger persists —
     the dials come back at their defaults, so the launcher is priced
     afresh and that part of the line is expected to differ. */
  const ledger = t => (String(t).split('·').filter(x => !/launcher/.test(x)).join('·').trim());
  const held = ledger((await vault()).sub);
  await boot(p);
  const back = await vault();
  console.log('\nafter a reload   ', back.sum, '·', back.sub);
  console.log('  the ledger survived:', ledger(back.sub) === held
    ? 'yes — ' + held : '*** WRONG: was "' + held + '", now "' + ledger(back.sub) + '"');
  console.log('  the launcher is priced afresh:', /launcher/.test(back.sub) ? 'yes' : '*** WRONG');

  /* The trap: trim searches voltages up to 300 kV and a farad's price
     goes with the square of it, so the search passes through launchers
     costing hundreds of billions. Settling on one leaves a console that
     cannot fire and a bank no ledger reset will mend — and trimming
     again just does it over. Trim twice with a fiddle in between, which
     is the sequence that found this. */
  console.log('\n── trim, fiddle, trim again ──');
  for (const round of ['first trim', 'after a fiddle', 'second trim']) {
    if (round === 'after a fiddle') {
      await p.evaluate(() => { const e = document.getElementById('angle'); e.value = '52'; e.dispatchEvent(new Event('input')); });
    } else {
      await p.evaluate(() => document.getElementById('trim').click());
    }
    await p.waitForTimeout(3200);
    v = await vault();
    console.log(round.padEnd(16), v.sum.padEnd(11), '| build', v.build.padEnd(10),
                '| fire', v.fire ? 'BLOCKED' : 'ready', '|', v.flag.slice(0, 34));
    if (v.broke) console.log('  *** WRONG: trim left the bank in the red');
    if (v.fire && /CANNOT COVER/.test(v.flag)) console.log('  *** WRONG: stranded — the launcher cannot be paid for');
  }
  await shot({ path: OUT + 'B-trim.png' });

  /* And if the dials are driven into the red by hand, there is a way out.
     The voltage goes back to 30 kV first: trim leaves it low, and a
     farad's price goes with the square of the voltage, so a hundred of
     them is pocket change at 3 kV and twenty billion at thirty. */
  await p.evaluate(() => { const e = document.getElementById('volt'); e.value = '30'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(1500);
  await p.evaluate(() => { const e = document.getElementById('bankN'); e.value = '400'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(2600);
  v = await vault();
  console.log('\nby hand, 200 F  ', v.sum, '| build', v.build, '| fire', v.fire ? 'BLOCKED' : 'ready');
  const hasWayBack = await p.evaluate(() => !!document.getElementById('putback'));
  console.log('  it offers a way back:', hasWayBack ? 'yes' : '*** WRONG: no button');
  if (hasWayBack) {
    await p.evaluate(() => document.getElementById('putback').click());
    await p.waitForTimeout(2600);
    v = await vault();
    console.log('  after putting it back:', v.sum, '| build', v.build, '| fire', v.fire ? 'BLOCKED' : 'ready');
    console.log('  the bank is out of the red:', !v.broke ? 'yes' : '*** WRONG: still negative');
    console.log('  and it can fire again    :', !v.fire ? 'yes' : '*** WRONG: still blocked');
  }

  /* A launcher nobody can pay for. The farads are the bulk of the bill,
     and they are the honest way to overspend — a rail long enough to do
     it is rejected as nonsense before the costing is ever reached. */
  await p.evaluate(() => { const e = document.getElementById('volt'); e.value = '30'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(1200);
  await p.evaluate(() => { const e = document.getElementById('bankN'); e.value = '200'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); });
  await p.waitForTimeout(2800);
  v = await vault();
  console.log('\n100 farads at 30 kV', v.sum, '| build', v.build);
  console.log('  the bank is over :', v.broke ? 'yes' : '*** WRONG: not flagged');
  console.log('  firing is blocked:', v.fire ? 'yes' : '*** WRONG: still armed');
  console.log('  and it says why  :', /CANNOT COVER/.test(v.flag) ? 'yes' : '*** WRONG: ' + v.flag);
  await shot({ path: OUT + 'B-broke.png' });

  console.log('\n' + (errs.length ? errs.slice(0,4).join('\n') : 'no js errors'));
  await browser.close(); done();
})().catch(e => { console.log('\n!! run failed: ' + String(e && e.message).split('\n')[0]); if (BROWSER) BROWSER.close().then(()=>process.exit(3),()=>process.exit(3)); else process.exit(3); });

function money(x) {
  if (!isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e9) return '$' + (x / 1e9).toPrecision(3) + ' bn';
  if (a >= 1e6) return '$' + (x / 1e6).toPrecision(3) + ' M';
  if (a >= 1e3) return '$' + (x / 1e3).toPrecision(3) + ' k';
  return '$' + x.toFixed(2);
}
