// node tests/tools/glbimages.mjs file.glb outdir — extracts embedded images
import fs from 'node:fs'; import path from 'node:path';
const [file, out] = process.argv.slice(2); const buf = fs.readFileSync(file);
const jl = buf.readUInt32LE(12); const gltf = JSON.parse(buf.slice(20, 20 + jl).toString());
const binStart = 20 + jl + 8;
(gltf.images ?? []).forEach((im, i) => { if (im.bufferView === undefined) return; const bv = gltf.bufferViews[im.bufferView];
  const data = buf.slice(binStart + (bv.byteOffset ?? 0), binStart + (bv.byteOffset ?? 0) + bv.byteLength);
  const p = path.join(out, path.basename(file, '.glb') + '-' + i + (im.mimeType === 'image/jpeg' ? '.jpg' : '.png')); fs.writeFileSync(p, data); console.log(p, data.length); });
