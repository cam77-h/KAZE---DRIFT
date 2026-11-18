// Renders the mode-select card art from the game itself (UI hidden) into public/assets/ui/.
const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const out = path.resolve(__dirname, '../../public/assets/ui');
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 760, height: 400 } });
  await p.goto('http://localhost:5199/?hour=17.6');
  await p.waitForFunction(() => window.__kaze && window.__kaze.state() === 'title', null, { timeout: 180000 });
  const shots = [['openroad', 'mode-openroad.jpg', 8250, 1], ['minami', 'mode-drift.jpg', 300, 1], ['skidpad', 'mode-practice.jpg', -1, 0]];
  for (const [loc, file, s, cam] of shots) {
    await p.evaluate((l) => window.__kaze.drive(l), loc);
    await p.waitForFunction(() => window.__kaze.state() === 'drive', null, { timeout: 240000 });
    if (s >= 0) await p.evaluate((s) => window.__kaze.teleport(s, 16), s);
    await p.evaluate((c) => { window.__kaze.camera(c); window.__kaze.setInput({ throttle: 0.9, steer: -0.6, handbrake: 0 }); document.getElementById('ui').style.display = 'none'; document.querySelectorAll('.toast,.chain,.session,.objective,.banner,.chain-broken').forEach((e) => (e.style.display = 'none')); }, cam);
    await p.waitForTimeout(3500);
    await p.screenshot({ path: path.join(out, file), type: 'jpeg', quality: 82 });
    await p.evaluate(() => { document.getElementById('ui').style.display = ''; window.__kaze.setInput(null); window.__kaze.end(); });
    await p.waitForTimeout(500);
    console.log('saved', file);
  }
  await b.close();
})();
