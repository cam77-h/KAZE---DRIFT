// node tests/sim/carshots.cjs outdir  (needs `npx vite --port 5199` running)
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2];
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1100, height: 650 } });
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text()); });
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  const views = (process.argv[3] || 'q34:yaw=0.75&pitch=0.15,side:yaw=1.5708&pitch=0.02&dist=6.5,rear:yaw=2.6&pitch=0.18,front:yaw=-0.05&pitch=0.08&dist=6,top:yaw=0.4&pitch=1.2&dist=7').split(',');
  for (const v of views) {
    const [name, qs] = v.split(':');
    await p.goto('http://localhost:5199/dev/car.html?' + qs);
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
    await p.waitForTimeout(300);
    await p.screenshot({ path: `${out}/car-${name}.png` });
  }
  await b.close();
})();
