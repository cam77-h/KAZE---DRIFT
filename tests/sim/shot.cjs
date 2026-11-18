// node tests/sim/shot.cjs in.svg out.png
const { chromium } = require('playwright');
(async () => {
  const [inp, out] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 900, height: 900 } });
  await p.goto('file://' + require('path').resolve(inp)); await p.screenshot({ path: out }); await b.close();
})();
