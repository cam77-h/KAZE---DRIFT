// node tests/tools/glbinfo.mjs file.glb  — prints the node tree with world-space bounds per mesh node,
// plus materials. Pure GLB parsing, no three.js needed.
import fs from 'node:fs';
const file = process.argv[2];
const buf = fs.readFileSync(file);
const jsonLen = buf.readUInt32LE(12);
const gltf = JSON.parse(buf.slice(20, 20 + jsonLen).toString());
const mul = (a, b) => { const o = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return o; };
const I = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
function local(n) {
  if (n.matrix) return n.matrix;
  const [x, y, z, w] = n.rotation ?? [0, 0, 0, 1]; const [sx, sy, sz] = n.scale ?? [1, 1, 1]; const [tx, ty, tz] = n.translation ?? [0, 0, 0];
  return [(1 - 2*(y*y + z*z))*sx, (2*(x*y + z*w))*sx, (2*(x*z - y*w))*sx, 0, (2*(x*y - z*w))*sy, (1 - 2*(x*x + z*z))*sy, (2*(y*z + x*w))*sy, 0, (2*(x*z + y*w))*sz, (2*(y*z - x*w))*sz, (1 - 2*(x*x + y*y))*sz, 0, tx, ty, tz, 1];
}
const xf = (m, p) => [m[0]*p[0] + m[4]*p[1] + m[8]*p[2] + m[12], m[1]*p[0] + m[5]*p[1] + m[9]*p[2] + m[13], m[2]*p[0] + m[6]*p[1] + m[10]*p[2] + m[14]];
const all = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
const lines = [];
function walk(i, parent, depth) {
  const n = gltf.nodes[i]; const m = mul(parent, local(n));
  let info = '';
  if (n.mesh !== undefined) {
    const mesh = gltf.meshes[n.mesh]; const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; let tris = 0; const mats = new Set();
    for (const p of mesh.primitives) {
      const acc = gltf.accessors[p.attributes.POSITION]; mats.add(p.material);
      tris += p.indices !== undefined ? gltf.accessors[p.indices].count / 3 : acc.count / 3;
      for (let k = 0; k < 8; k++) { const c = [k & 1 ? acc.max[0] : acc.min[0], k & 2 ? acc.max[1] : acc.min[1], k & 4 ? acc.max[2] : acc.min[2]]; const w = xf(m, c); for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], w[a]); b[a + 3] = Math.max(b[a + 3], w[a]); all[a] = Math.min(all[a], w[a]); all[a + 3] = Math.max(all[a + 3], w[a]); } }
    }
    const c = [0, 1, 2].map((a) => ((b[a] + b[a + 3]) / 2).toFixed(2)); const s = [0, 1, 2].map((a) => (b[a + 3] - b[a]).toFixed(2));
    info = ` mesh tris=${tris|0} center=(${c}) size=(${s}) mats=[${[...mats].map((x) => gltf.materials?.[x]?.name ?? x)}]`;
  }
  lines.push(`${'  '.repeat(depth)}[${i}] ${n.name ?? ''}${info}`);
  for (const ch of n.children ?? []) walk(ch, m, depth + 1);
}
for (const r of gltf.scenes[gltf.scene ?? 0].nodes) walk(r, I, 0);
console.log(lines.slice(0, Number(process.argv[3] ?? 60)).join('\n'));
if (lines.length > Number(process.argv[3] ?? 60)) console.log(`... ${lines.length} nodes total`);
console.log('BOUNDS min', all.slice(0, 3).map((v) => v.toFixed(2)), 'max', all.slice(3).map((v) => v.toFixed(2)));
console.log('MATERIALS', (gltf.materials ?? []).map((m, i) => `${i}:${m.name}${m.pbrMetallicRoughness?.baseColorTexture ? '(tex)' : ''}${m.pbrMetallicRoughness?.baseColorFactor ? '[' + m.pbrMetallicRoughness.baseColorFactor.map((v) => v.toFixed(2)) + ']' : ''}`).join('  '));
console.log('IMAGES', (gltf.images ?? []).map((im) => im.uri ?? im.mimeType).join(', '));
