// Phase smoke test: loads the game, drives for 10 s with scripted inputs on each location
// and saves screenshots to screenshots/phase-N/.
//   npm run build && npx vite preview --port 4173 &   then   node tests/smoke/smoke.cjs [phase] [url]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const phase = process.argv[2] || '1';
  const url = process.argv[3] || 'http://localhost:4173/';
  const out = path.resolve(__dirname, '../../screenshots/phase-' + phase);
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const shot = async (name) => { await page.screenshot({ path: path.join(out, name + '.png') }); console.log('saved', name); };

  await page.goto(url);
  await page.waitForFunction(() => window.__kaze && window.__kaze.state() === 'title', null, { timeout: 120000 });
  await page.waitForTimeout(4000);
  await shot('01-title');

  // location select screen
  await page.click('text=FREE DRIVE');
  await page.waitForTimeout(800);
  await shot('02-select');

  const drive = async (id, tag, script) => {
    await page.evaluate((id) => window.__kaze.drive(id), id);
    await page.waitForFunction(() => window.__kaze.state() === 'drive', null, { timeout: 180000 });
    await page.waitForTimeout(500);
    const start = Date.now();
    let shots = 0;
    for (const [t, input, snap] of script) {
      const wait = t * 1000 - (Date.now() - start);
      if (wait > 0) await page.waitForTimeout(wait);
      await page.evaluate((inp) => window.__kaze.setInput(inp), input);
      if (snap) { await shot(`${tag}-${String(++shots).padStart(2, '0')}-${snap}`); }
    }
    const tel = await page.evaluate(() => window.__kaze.telemetry());
    console.log(id, 'telemetry after run:', JSON.stringify({ speed: tel.speed.toFixed(1), rpm: tel.rpm.toFixed(0), gear: tel.gear, drift: (tel.driftAngle * 57.3).toFixed(1) }));
    await page.evaluate(() => window.__kaze.setInput(null));
  };

  // 10 s on Minami: launch, sweeper, handbrake flick into a slide, power over
  await drive('minami', '03-minami', [
    [0, { throttle: 1, steer: 0, brake: 0, handbrake: 0 }, 'launch'],
    [3.0, { throttle: 1, steer: 0.15 }, null],
    [4.5, { throttle: 1, steer: 0.35 }, 'sweeper'],
    [6.0, { throttle: 1, steer: -0.9, handbrake: 1 }, null],
    [6.3, { throttle: 1, steer: 0.45, handbrake: 0 }, 'slide'],
    [8.0, { throttle: 0.8, steer: 0.3 }, 'exit'],
    [10.0, { throttle: 0, brake: 0.4, steer: 0 }, 'end'],
  ]);
  await page.evaluate(() => window.__kaze.camera(2));
  await page.waitForTimeout(600);
  await shot('03-minami-hood-cam');
  await page.evaluate(() => window.__kaze.camera(0));

  // 10 s on the skidpad: donut / drift circle
  await drive('skidpad', '04-skidpad', [
    [0, { throttle: 1, steer: 0 }, 'launch'],
    [2.5, { throttle: 1, steer: -1, handbrake: 1 }, null],
    [2.9, { throttle: 1, steer: 0.4, handbrake: 0 }, 'drift'],
    [5.0, { throttle: 0.9, steer: 0.35 }, 'smoke'],
    [8.0, { throttle: 1, steer: 0.3 }, 'held'],
    [10.0, { throttle: 0, brake: 0.3, steer: 0 }, null],
  ]);

  // pause + settings
  await page.evaluate(() => window.__kaze.pause());
  await page.waitForTimeout(500);
  await shot('05-pause');
  await page.evaluate(() => window.__kaze.settings());
  await page.waitForTimeout(500);
  await shot('06-settings');
  await page.click('text=CONTROLS');
  await page.waitForTimeout(300);
  await shot('07-settings-controls');

  // night preview
  await page.goto(url + '?hour=21');
  await page.waitForFunction(() => window.__kaze && window.__kaze.state() === 'title', null, { timeout: 120000 });
  await page.evaluate(() => window.__kaze.drive('minami'));
  await page.waitForFunction(() => window.__kaze.state() === 'drive', null, { timeout: 180000 });
  await page.evaluate(() => window.__kaze.setInput({ throttle: 0.7 }));
  await page.waitForTimeout(3000);
  await shot('08-night');

  const fps = await page.evaluate(() => new Promise((r) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else r(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
  console.log('fps (software renderer, not representative):', fps.toFixed(1));
  console.log('console errors:', errors.length ? errors.join('\n') : 'none');
  await browser.close();
  if (errors.some((e) => e.startsWith('pageerror'))) process.exit(1);
})();
