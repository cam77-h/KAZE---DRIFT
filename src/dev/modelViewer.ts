// /model-viewer.html — every model on a turntable (or all in a grid) with bounding boxes,
// wheel pivots and a forward arrow, so imported models can be checked quickly.
//   ?m=<car or traffic id>   one model on a turntable
//   ?m=all (default)         grid of every model, side-on
//   ?yaw=<rad> ?spin=0 ?paint=#hex ?finish=metallic ?dist=8
import * as THREE from 'three';
import '@fontsource/chakra-petch/700.css';
import { Environment } from '../render/environment';
import { CARS, TRAFFIC, carName } from '../data';
import { buildCarVisual, type CarVisual } from '../vehicles/carVisual';
import { loadCarModel } from '../vehicles/modelLoader';
import type { PaintFinish } from '../vehicles/paint';

const q = new URLSearchParams(location.search);
const which = q.get('m') ?? 'all';
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const env = new Environment(scene, renderer);
env.setShadowQuality(2);
env.setHour(Number(q.get('hour') ?? 15));
const grid = new THREE.GridHelper(200, 200, 0x3a5070, 0x24354d);
scene.add(grid);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.95 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.002;
floor.receiveShadow = true;
scene.add(floor);
const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.05, 2000);

interface Item {
  id: string;
  label: string;
  holder: THREE.Group;
  visual: CarVisual | null;
}
const items: Item[] = [];
const ids = [...Object.keys(CARS), ...Object.keys(TRAFFIC)];
const pick = document.getElementById('pick') as HTMLSelectElement;
for (const id of ['all', ...ids]) {
  const o = document.createElement('option');
  o.value = id;
  o.textContent = id === 'all' ? 'All models' : CARS[id] ? carName(id) : id;
  if (id === which) o.selected = true;
  pick.appendChild(o);
}
pick.onchange = () => (location.search = '?m=' + pick.value);
let spinning = q.get('spin') !== '0';
document.getElementById('spin')!.onclick = (e) => {
  spinning = !spinning;
  (e.target as HTMLElement).textContent = 'Turntable: ' + (spinning ? 'on' : 'off');
};

async function makeItem(id: string): Promise<Item> {
  const holder = new THREE.Group();
  let visual: CarVisual | null = null;
  let label = id;
  try {
    if (CARS[id]) {
      const def = CARS[id];
      visual = await buildCarVisual(def, q.get('paint') ?? def.visual.defaultPaint, (q.get('finish') as PaintFinish) ?? def.visual.defaultFinish ?? 'metallic');
      label = `${carName(id)} <b>${visual.kind}</b>`;
    } else {
      const t = TRAFFIC[id];
      const m = await loadCarModel(t.glb);
      if (t.paint) m.setPaint(t.paint, 'gloss');
      visual = {
        kind: 'glb',
        root: m.root,
        wheels: m.wheels.map((w) => ({ pivot: w.pivot, spin: w.spin, spinSign: 1, shared: w.shared })),
        dims: m.dims,
        frontAxleZ: m.dims.frontAxleZ,
        headAnchors: [],
        setPaint: () => {},
        setHeadlights: () => {},
        setBrake: () => {},
        setReverse: () => {},
      };
      label = `${id} <b>traffic</b>`;
    }
  } catch (e) {
    label = `${id} <b style="color:#e8202f">FAILED</b>`;
    console.error(id, e);
  }
  if (visual) {
    const d = visual.dims;
    // procedural cars are built around the CG; shift so the axle midpoint is the origin like imported ones
    if (visual.kind === 'procedural') {
      visual.root.position.z = -(d.frontAxleZ + d.rearAxleZ) / 2;
      visual.wheels.forEach((w, i) => {
        const front = i < 2, left = i % 2 === 0;
        w.pivot.position.set(((left ? 1 : -1) * (front ? d.trackFront : d.trackRear)) / 2, d.wheelRadius, (front ? d.frontAxleZ : d.rearAxleZ) + visual!.root.position.z);
        holder.add(w.pivot);
      });
    }
    holder.add(visual.root);
    for (const w of visual.wheels) if (!w.shared) w.pivot.add(new THREE.AxesHelper(0.5));
    holder.add(new THREE.Box3Helper(new THREE.Box3().setFromObject(visual.root), 0xf39c32));
    holder.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.05, d.length / 2 + 0.3), 1.2, 0xe8202f, 0.4, 0.3));
    holder.traverse((o) => (o.castShadow = true));
  }
  return { id, label, holder, visual };
}

async function main() {
  const list = which === 'all' ? ids : [which];
  const made = await Promise.all(list.map(makeItem));
  const cols = which === 'all' ? 5 : 1;
  made.forEach((it, i) => {
    const r = Math.floor(i / cols), c = i % cols;
    it.holder.position.set(c * 6.5 - ((cols - 1) * 6.5) / 2, 0, -r * 8);
    if (which === 'all') it.holder.rotation.y = Math.PI / 2; // side-on, front pointing right (+X)
    scene.add(it.holder);
    items.push(it);
  });
  const rows = Math.ceil(made.length / cols);
  if (which === 'all') {
    camera.fov = 40;
    camera.position.set(0, 18 + rows * 2.5, 16);
    camera.lookAt(0, 0, -rows * 3.6);
  } else {
    const yaw = Number(q.get('yaw') ?? 0.8);
    const dd = Number(q.get('dist') ?? 8.5);
    camera.position.set(Math.sin(yaw) * dd, Number(q.get('h') ?? 1.6), Math.cos(yaw) * dd);
    camera.lookAt(0, 0.6, 0);
  }
  camera.updateProjectionMatrix();
  env.follow(new THREE.Vector3());
  const dims: Record<string, unknown> = {};
  for (const it of items) if (it.visual) dims[it.id] = Object.fromEntries(Object.entries(it.visual.dims).map(([k, v]) => [k, Math.round(v * 1000) / 1000]));
  (window as unknown as { __dims: unknown }).__dims = dims;
  if (which !== 'all' && items[0]?.visual) {
    const d = items[0].visual.dims;
    document.getElementById('info')!.textContent = `L ${d.length.toFixed(2)} W ${d.width.toFixed(2)} H ${d.height.toFixed(2)} · wheelbase ${d.wheelbase.toFixed(2)} · track ${d.trackFront.toFixed(2)}/${d.trackRear.toFixed(2)} · wheel r ${d.wheelRadius.toFixed(3)}`;
  }
  (window as unknown as { __ready: boolean }).__ready = true;
}

const labels = document.getElementById('labels')!;
let t = 0;
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;
  labels.innerHTML = '';
  for (const it of items) {
    if (which !== 'all' && spinning) it.holder.rotation.y += dt * 0.4;
    for (const w of it.visual?.wheels ?? []) w.spin.rotation.x += dt * 6 * w.spinSign;
    for (const w of it.visual?.wheels.slice(0, 2) ?? []) w.pivot.rotation.y = Math.sin(t) * 0.4;
    const p = it.holder.position.clone();
    p.y = (it.visual?.dims.height ?? 1.4) + 0.6;
    p.project(camera);
    if (p.z < 1) {
      const d = document.createElement('div');
      d.style.left = `${(p.x * 0.5 + 0.5) * innerWidth}px`;
      d.style.top = `${(-p.y * 0.5 + 0.5) * innerHeight}px`;
      d.innerHTML = it.label;
      labels.appendChild(d);
    }
  }
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
void main();
requestAnimationFrame(frame);
