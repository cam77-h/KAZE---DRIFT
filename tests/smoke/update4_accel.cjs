// Update 4 §1 check: staged launch, then 20 s flat out on the Open Road with a simple autopilot
// holding the lane. Logs the speedometer every second and saves frames to screenshots/update-4/.
//   npx vite --port 5199 &   then   node tests/smoke/update4_accel.cjs [url]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
(async () => {
  const base = process.argv[2] || 'http://localhost:5199/';
  const url = base + (base.includes('?') ? '&' : '?') + 'car=sakura_s15';
  const out = path.resolve(__dirname, '../../screenshots/update-4');
  fs.mkdirSync(out, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1280, height: 720 } });
  const errors = [];
  p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const K = (fn, arg) => p.evaluate(fn, arg);
  await p.goto(url);
  await p.waitForFunction(() => window.__kaze && window.__kaze.state() === 'title', null, { timeout: 180000 });
  await K(() => window.__kaze.session({ mode: 'openroad', location: 'openroad', event: 'free' }));
  await p.waitForFunction(() => window.__kaze.state() === 'drive', null, { timeout: 300000 });
  // find the start of the longest gentle stretch of the main road
  const s0 = await K(() => {
    const road = window.__kaze.game.location.track.roads[0];
    const S = road.samples, n = S.length, step = road.length / n;
    let best = 0, bestTurn = Infinity;
    for (let i = 0; i < n; i += 4) {
      let turn = 0;
      for (let j = 0; j < 900 / step; j++) {
        const a = S[(i + j) % n], c = S[(i + j + 1) % n];
        turn += Math.abs(Math.atan2(a.tx * c.tz - a.tz * c.tx, a.tx * c.tx + a.tz * c.tz));
      }
      if (turn < bestTurn) { bestTurn = turn; best = i * step; }
    }
    return best;
  });
  await K((s) => window.__kaze.teleport(s, 0), s0);
  // autopilot: steer at a point 30 m ahead on the lane, ease off for sharp bends
  await K(() => {
    const k = window.__kaze, g = k.game;
    window.__auto = { throttle: 1, brake: 1, steer: 0, handbrake: 0, clutch: 0 };
    k.setInput(window.__auto);
    const tick = () => {
      const v = g.vehicle, t = g.location.track, road = t.roads[0];
      const l = t.locate(v.position.x, v.position.z);
      if (l) {
        const look = 18 + v.telemetry.speed * 0.9;
        const S = road.samples, n = S.length;
        const idx = Math.floor((((l.s + look) % road.length) / road.length) * n) % n;
        const q = S[idx], off = q.halfWidth * 0.45;
        const tx = q.x + q.lx * off - v.position.x, tz = q.z + q.lz * off - v.position.z;
        const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw);
        const ang = Math.atan2(fx * tz - fz * tx, fx * tx + fz * tz);
        window.__auto.steer = Math.max(-1, Math.min(1, ang * 2.4));
        const far = S[(idx + Math.floor(60 / (road.length / n))) % n];
        const bend = Math.abs(Math.atan2(q.tx * far.tz - q.tz * far.tx, q.tx * far.tx + q.tz * far.tz));
        const vmax = Math.sqrt(9.81 * 1.0 * (60 / Math.max(0.01, bend)));
        window.__auto.throttle = v.telemetry.speed > vmax ? 0.2 : 1;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
  // staged launch
  await p.waitForTimeout(1500);
  await p.screenshot({ path: path.join(out, 'accel-00-staged.png') });
  const staged = await K(() => window.__kaze.game.vehicle.launchStaged);
  console.log('staged launch:', staged);
  await K(() => (window.__auto.brake = 0));
  // seconds of game time (software GL in CI renders far slower than real time)
  const t0 = await K(() => window.__kaze.game.vehicle.time);
  const log = [];
  for (let sec = 1; sec <= 20; sec++) {
    while ((await K(() => window.__kaze.game.vehicle.time)) - t0 < sec) await p.waitForTimeout(40);
    const r = await K(() => ({ hud: document.querySelector('#hud .tach b, #hud .spd b, #hud .speed')?.textContent, kmh: window.__kaze.telemetry().forwardSpeed * 3.6, gear: window.__kaze.telemetry().gear }));
    log.push(r);
    console.log(`${sec}s  ${r.kmh.toFixed(0)} km/h  gear ${r.gear}  hud ${r.hud}`);
    if ([1, 3, 6, 10, 15, 20].includes(sec)) await p.screenshot({ path: path.join(out, `accel-${String(sec).padStart(2, '0')}s.png`) });
  }
  const climbing = log.slice(0, 8).every((r, i) => i === 0 || r.kmh > log[i - 1].kmh - 1);
  const peak = Math.max(...log.map((r) => r.kmh));
  console.log((climbing ? 'PASS' : 'FAIL') + ' speedometer climbs through the first 8 s');
  console.log((peak > 150 ? 'PASS' : 'FAIL') + ` peak ${peak.toFixed(0)} km/h > 150`);
  console.log(errors.length ? 'ERRORS\n' + errors.join('\n') : 'no page errors');
  await b.close();
  process.exit(climbing && peak > 150 && !errors.length ? 0 : 1);
})();
