// Writes an SVG preview of a track layout and prints radius / crossing stats.
import { readFileSync, writeFileSync } from 'node:fs';
import { Track } from '../../src/world/track';
const file = process.argv[2];
const outPath = process.argv[3];
const def = JSON.parse(readFileSync(file, 'utf8'));
const track = new Track(def);
let svg = '';
const S = def.size / 2;
const sx = (x: number) => (x + S).toFixed(1), sz = (z: number) => (z + S).toFixed(1);
// terrain heat
for (let x = -S; x < S; x += 8) for (let z = -S; z < S; z += 8) {
  const h = track.terrainHeight(x, z);
  const c = Math.max(0, Math.min(255, 60 + h * 2));
  svg += `<rect x="${sx(x)}" y="${sz(z)}" width="8" height="8" fill="rgb(${c * 0.5},${c},${c * 0.5})"/>`;
}
for (const pad of def.pads) {
  if (pad.shape === 'circle') svg += `<circle cx="${sx(pad.x)}" cy="${sz(pad.z)}" r="${pad.r}" fill="#888"/>`;
  else svg += `<rect x="${sx(pad.x - pad.w / 2)}" y="${sz(pad.z - pad.d / 2)}" width="${pad.w}" height="${pad.d}" fill="#888" transform="rotate(${(pad.rot ?? 0) * 57.3} ${sx(pad.x)} ${sz(pad.z)})"/>`;
}
for (const r of track.roads) {
  let minR = Infinity, minAt = 0;
  const pts = r.samples.map((p) => `${sx(p.x)},${sz(p.z)}`).join(' ');
  svg += `<polyline points="${pts}${r.def.closed ? ' ' + sx(r.samples[0].x) + ',' + sz(r.samples[0].z) : ''}" fill="none" stroke="#222" stroke-width="${r.def.width}" stroke-linejoin="round"/>`;
  for (const p of r.samples) { const R = 1 / Math.max(1e-6, Math.abs(p.curvature)); if (R < minR) { minR = R; minAt = p.s; } }
  r.samples.forEach((p, i) => { if (i % (def.size > 1500 ? 250 : 50) === 0) svg += `<text x="${sx(p.x)}" y="${sz(p.z)}" font-size="${def.size > 1500 ? 30 : 9}" fill="#ff0">${i} y${p.y.toFixed(0)}</text>`; if (p.kerbL) svg += `<circle cx="${sx(p.x + p.lx * (p.halfWidth + 0.5))}" cy="${sz(p.z + p.lz * (p.halfWidth + 0.5))}" r="0.6" fill="#f33"/>`; });
  // self-approach check: samples far apart along s but close in space
  let closest = Infinity;
  const m = r.samples.length;
  for (let i = 0; i < m; i += 2) for (let j = i + 40; j < m; j += 2) {
    const ds = Math.min(j - i, m - (j - i)); if (ds < 40) continue;
    const a = r.samples[i], b = r.samples[j];
    const d = Math.hypot(a.x - b.x, a.z - b.z) - a.halfWidth - b.halfWidth;
    if (d < closest) closest = d;
  }
  const ys = r.samples.map((p) => p.y);
  console.log(r.def.id, 'length', r.length.toFixed(0), 'min radius', minR.toFixed(1), '@', minAt.toFixed(0), 'closest edge gap', closest.toFixed(1), 'y range', Math.min(...ys).toFixed(1), Math.max(...ys).toFixed(1));
}
for (const w of track.walls.walls) svg += `<line x1="${sx(w.x1)}" y1="${sz(w.z1)}" x2="${sx(w.x2)}" y2="${sz(w.z2)}" stroke="${w.material === 'tire' ? '#fff' : w.material === 'concrete' ? '#0cf' : '#fc0'}" stroke-width="1"/>`;
svg += `<circle cx="${sx(def.spawn.x)}" cy="${sz(def.spawn.z)}" r="3" fill="#f0f"/>`;
writeFileSync(outPath, `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900" viewBox="0 0 ${def.size} ${def.size}"><rect width="100%" height="100%" fill="#000"/>${svg}</svg>`);
