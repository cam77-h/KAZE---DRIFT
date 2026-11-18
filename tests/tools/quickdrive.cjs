// node tests/tools/quickdrive.cjs <out.png> <url> [seconds] — load, drive straight-ish, screenshot
const { chromium } = require('playwright');
(async () => {
  const [out, url, secs = '4'] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(url);
  await p.waitForFunction(() => window.__kaze && window.__kaze.state() === 'title', null, { timeout: 180000 });
  const loc = new URL(url).searchParams.get('loc') || 'minami';
  await p.evaluate((l) => window.__kaze.drive(l), loc);
  await p.waitForFunction(() => window.__kaze.state() === 'drive', null, { timeout: 180000 });
  await p.evaluate(() => window.__kaze.setInput({ throttle: 0.6, steer: 0.05 }));
  await p.waitForTimeout(Number(secs) * 1000);
  await p.screenshot({ path: out });
  console.log(JSON.stringify(await p.evaluate(() => { const t = window.__kaze.telemetry(); return { speed: t.speed.toFixed(1), gear: t.gear, y: window.__kaze.position()[1].toFixed(2) }; })), errs.length ? errs : 'no errors');
  await b.close();
})();
