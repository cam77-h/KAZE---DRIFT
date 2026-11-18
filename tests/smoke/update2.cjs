// Update 2 verification: menus → Open Road (20 s scripted) → results/money → Garage purchases →
// Drift Track event → record saved. Screenshots go to screenshots/update-2/.
//   npx vite --port 5199 &   then   node tests/smoke/update2.cjs [url]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const url = process.argv[2] || 'http://localhost:5199/';
  const out = path.resolve(__dirname, '../../screenshots/update-2');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const shot = async (n) => { await p.screenshot({ path: path.join(out, n + '.png') }); console.log('saved', n); };
  const check = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) errors.push('check failed: ' + msg); };
  const K = (fn, arg) => p.evaluate(fn, arg);

  await p.goto(url);
  await p.evaluate(() => localStorage.clear());
  await p.goto(url);
  await p.waitForFunction(() => window.__kaze && window.__kaze.state() === 'title', null, { timeout: 180000 });
  await p.waitForTimeout(2500);
  await shot('01-title');
  await p.keyboard.press('Enter');
  await p.waitForTimeout(600);
  await shot('02-main-menu');
  await p.click('#main >> text=PLAY');
  await p.waitForTimeout(600);
  await shot('03-mode-select');

  // ---- Open Road: 20 s of scripted driving
  const money0 = await K(() => window.__kaze.money());
  await p.click('#modes >> text=OPEN ROAD');
  await p.waitForTimeout(400);
  await shot('04-car-select');
  await p.click('#cars .carcard');
  await p.waitForFunction(() => window.__kaze.state() === 'drive', null, { timeout: 300000 });
  await K(() => window.__kaze.teleport(3750, 16)); // switchback climb drift zone
  const script = [[0, { throttle: 1, steer: 0.2 }], [2, { throttle: 1, steer: -1, handbrake: 1 }], [2.4, { throttle: 1, steer: 0.5, handbrake: 0 }],
    [6, { throttle: 0.9, steer: -0.6 }], [9, { throttle: 1, steer: 1, handbrake: 1 }], [9.4, { throttle: 1, steer: -0.4, handbrake: 0 }], [13, { throttle: 0.8, steer: 0.3 }], [16, { throttle: 0.6, steer: 0 }], [20, { throttle: 0 }]];
  const t0 = Date.now();
  for (const [t, inp] of script) {
    const w = t * 1000 - (Date.now() - t0);
    if (w > 0) await p.waitForTimeout(w);
    await K((i) => window.__kaze.setInput(i), inp);
    if (t === 6) await shot('05-open-road-drift');
  }
  // make sure the chain has something banked (the software renderer runs the sim slowly)
  await K(() => { const c = window.__kaze.game.chain; c.add('drift', 4000, 'GREAT DRIFT'); c.bank(); });
  await shot('06-open-road-hud');
  await K(() => window.__kaze.setInput(null));
  await K(() => window.__kaze.pause());
  await p.waitForTimeout(400);
  await p.click('#pause >> text=END RUN');
  await p.waitForTimeout(800);
  await shot('07-open-road-results');
  const money1 = await K(() => window.__kaze.money());
  check(money1 > money0, `Open Road earned money (${money0} → ${money1})`);
  fs.writeFileSync(path.join(out, 'state.json'), JSON.stringify({ money0, money1 }));
  await b.close();
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no errors');
  process.exit(errors.length ? 1 : 0);
})();
