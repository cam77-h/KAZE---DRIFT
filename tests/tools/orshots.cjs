// node tests/tools/orshots.cjs outdir s1 s2 ... — Open Road screenshots at distances along the loop
const { chromium } = require('playwright');
(async () => {
  const [out, ...ss] = process.argv.slice(2);
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('pageerror', (e) => console.log('pageerror', e.message));
  await p.goto('http://localhost:5199/' + (process.env.Q || ''));
  await p.waitForFunction(() => window.__kaze && window.__kaze.state() === 'title', null, { timeout: 180000 });
  await p.evaluate(() => window.__kaze.drive('openroad'));
  await p.waitForFunction(() => window.__kaze.state() === 'drive', null, { timeout: 240000 });
  for (const s of ss) {
    await p.evaluate((s) => { window.__kaze.teleport(Number(s), 14); window.__kaze.setInput({ throttle: 0.4 }); }, s);
    await p.waitForTimeout(2500);
    await p.screenshot({ path: `${out}/or-${s}.png` });
    console.log('s', s, 'traffic', await p.evaluate(() => window.__kaze.traffic()));
  }
  await b.close();
})();
