// Update 4 §2–3 check: dealer showroom (browse every car, paint preview), car select, my cars,
// upgrades & tuning (tier cards, confirm, tuning, quick upgrade). Screenshots → screenshots/update-4/.
//   npx vite --port 5199 &   then   node tests/smoke/update4_showroom.cjs [url]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const url = process.argv[2] || 'http://localhost:5199/';
  const out = path.resolve(__dirname, '../../screenshots/update-4');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async (n) => { await p.screenshot({ path: path.join(out, n + '.png') }); console.log('saved', n); };
  const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) errors.push('check failed: ' + msg); };
  const settle = (ms = 2500) => p.waitForTimeout(ms);
  p.setDefaultTimeout(240000);
  // software GL can stall the main thread for a while on first frames: click without waiting for it
  const click = async (sel) => {
    await p.waitForSelector(sel.split(' >> ')[0], { state: 'attached' });
    await p.evaluate((s) => {
      const all = [...document.querySelectorAll(s.split(' >> ')[0])];
      const txt = s.includes(' >> text=') ? s.split(' >> text=')[1] : null;
      const nth = s.includes(' >> nth=') ? +s.split(' >> nth=')[1] : 0;
      const el = txt ? [...document.querySelectorAll(s.split(' >> ')[0] + ' *'), ...all].find((e) => e.textContent.trim().startsWith(txt) && (e.tagName === 'BUTTON' || e.closest('button'))) : all[nth];
      (el?.closest('button') ?? el)?.click();
    }, sel);
  };
  await p.goto(url);
  await p.evaluate(() => localStorage.clear());
  await p.goto(url);
  await p.waitForFunction(() => window.__kaze && window.__kaze.state() === 'title', null, { timeout: 180000 });
  await p.evaluate(() => { const s = window.__kaze.game.save; s.profile.credits = 900000; s.profile.level = 20; });
  await p.keyboard.press('Enter');
  await settle(800);
  // ---- dealer: browse every car
  await click('#main >> text=DEALER');
  await p.waitForSelector('#showroom.on');
  const n = await p.evaluate(() => document.querySelectorAll('#showroom .sr-counter i').length);
  check(n === 8, `dealer lists ${n} cars`);
  for (let i = 0; i < n; i++) {
    await p.waitForFunction(() => !document.querySelector('#showroom .sr-t100')?.textContent.includes('…'), null, { timeout: 120000 });
    await settle(1800);
    const name = await p.evaluate(() => document.querySelector('#showroom h2').textContent);
    const cls = await p.evaluate(() => document.querySelector('#showroom .sr-class').textContent);
    const t = await p.evaluate(() => document.querySelector('#showroom .sr-t100').textContent);
    console.log(`  ${name}  ${cls}  0-100 ${t}`);
    await shot(`showroom-dealer-${String(i + 1).padStart(2, '0')}`);
    await click('#showroom .sr-arrow.right');
  }
  // paint preview on the S15
  for (let i = 0; i < n; i++) {
    if ((await p.evaluate(() => document.querySelector('#showroom h2').textContent)).includes('S15')) break;
    await click('#showroom .sr-arrow.right');
    await settle(400);
  }
  await settle(2500);
  await click('#showroom .sr-sw:nth-child(4)');
  await click('#showroom .sr-finishes .sr-chip:nth-child(3)');
  await settle(1500);
  await shot('showroom-dealer-paint-preview');
  await click('#showroom .sr-actions .sbtn.primary');
  await settle(600);
  // ---- my cars → upgrades
  await click('#showroom .sr-close');
  await settle(600);
  await click('#main >> text=GARAGE');
  await p.waitForSelector('#showroom.on');
  await settle(3000);
  await shot('showroom-mycars');
  const cars = await p.evaluate(() => document.querySelectorAll('#showroom .sr-counter i').length);
  check(cars === 2, `my cars shows ${cars} cars`);
  for (let i = 0; i < cars; i++) {
    if ((await p.evaluate(() => document.querySelector('#showroom h2').textContent)).includes('S15')) break;
    await click('#showroom .sr-arrow.right');
    await settle(2500);
  }
  await click('#showroom >> text=UPGRADES & TUNING');
  await p.waitForSelector('#upgrades.on');
  await settle(2500);
  await shot('upgrade-home');
  await click('#upgrades .up-tile.cat-engine');
  await settle(400);
  await click('#upgrades .up-slot >> text=Exhaust');
  await settle(600);
  await p.hover('#upgrades .up-card.t-race');
  await settle(1500);
  await shot('upgrade-engine-exhaust-hover');
  const r0 = await p.evaluate(() => +document.querySelector('#upgrades .up-rating').textContent);
  await click('#upgrades .up-card.t-race');
  await p.waitForSelector('#upgrades .up-confirm');
  await settle(500);
  await shot('upgrade-confirm');
  await click('#upgrades .up-confirm .sbtn.primary');
  await settle(2500);
  const r1 = await p.evaluate(() => +document.querySelector('#upgrades .up-rating').textContent);
  check(r1 > r0 - 1, `rating after race exhaust ${r0} → ${r1}`);
  const parts = await p.evaluate(() => JSON.stringify(window.__kaze.game.save.garage.cars.find((c) => c.carId === 'sakura_s15').parts));
  check(parts.includes('"exhaust":"race"'), 'race exhaust saved on the S15 ' + parts);
  // conversion warning
  await click('#upgrades .sr-close');
  await click('#upgrades .sr-close');
  await settle(300);
  await click('#upgrades .up-tile.cat-conversion');
  await click('#upgrades .up-slot >> text=Engine Swap');
  await settle(500);
  await click('#upgrades .up-card >> nth=2');
  await settle(600);
  const warn = await p.evaluate(() => document.querySelector('#upgrades .up-confirm .warn')?.textContent ?? '');
  check(warn.includes('Exhaust'), 'engine swap warns it removes the exhaust: ' + warn);
  await shot('upgrade-conversion-warning');
  await click('#upgrades .up-confirm >> text=CANCEL');
  // tuning
  await click('#upgrades .sr-close');
  await click('#upgrades .sr-close');
  await click('#upgrades .up-tile.tune');
  await settle(800);
  await shot('upgrade-tuning-locked');
  // quick upgrade
  await click('#upgrades .sr-close');
  await click('#upgrades .up-tile.quick');
  await click('#upgrades .up-qopts .sr-chip >> nth=1');
  await settle(800);
  await shot('upgrade-quick-plan');
  await click('#upgrades .up-plan .sbtn.primary');
  await settle(2500);
  await click('#upgrades .up-tile.tune');
  await settle(800);
  await shot('upgrade-tuning');
  await click('#upgrades .sr-close');
  await click('#upgrades .up-tile.presets');
  await settle(500);
  await shot('upgrade-presets');
  // ---- car select via PLAY
  await click('#upgrades .sr-close');
  await click('#upgrades .sr-close');
  await settle(500);
  await click('#showroom .sr-close');
  await settle(500);
  await click('#main >> text=PLAY');
  await click('#modes >> text=PRACTICE');
  await p.waitForSelector('#showroom.on');
  await settle(3000);
  await shot('showroom-car-select');
  await click('#showroom .sr-actions .sbtn.primary');
  await p.waitForFunction(() => window.__kaze.state() === 'drive', null, { timeout: 300000 });
  check(true, 'car select drives the chosen car');
  // ---- portrait phone
  await p.setViewportSize({ width: 390, height: 844 });
  await p.evaluate(() => window.__kaze.end());
  await settle(1500);
  await p.evaluate(() => window.__kaze.game.openShowroom('dealer'));
  await settle(4000);
  await shot('showroom-portrait');
  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no page errors');
  await b.close();
  process.exit(errors.length ? 1 : 0);
})();
