// node tests/tools/viewershots.cjs <outdir> [base url] [views...]  — screenshots of /model-viewer.html
// view = name:querystring   e.g. all:m=all   ae:m=takumi_ae&yaw=1.57
const { chromium } = require('playwright');
const fs = require('fs');
(async () => {
  const [out, base = 'http://localhost:5199', ...views] = process.argv.slice(2);
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1400, height: 900 } });
  p.on('pageerror', (e) => console.log('pageerror:', e.message));
  p.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(m.type() + ':', m.text().slice(0, 300)); });
  for (const v of views.length ? views : ['all:m=all']) {
    const [name, qs] = v.split(/:(.*)/s);
    await p.goto(`${base}/model-viewer.html?${qs}`);
    await p.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
    await p.waitForTimeout(800);
    await p.screenshot({ path: `${out}/${name}.png` });
    if (name === 'all') fs.writeFileSync(`${out}/dims.json`, JSON.stringify(await p.evaluate(() => window.__dims), null, 1));
    console.log('saved', name);
  }
  await b.close();
})();
