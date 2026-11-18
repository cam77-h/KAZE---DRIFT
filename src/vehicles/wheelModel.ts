import * as THREE from 'three';

export interface WheelOptions {
  radius: number;
  width: number;
  rimRadius: number;
  spokes: number;
  rimColor: string;
  caliperColor: string;
  design: 'kumo6' | 'mesh' | 'deep5';
}

export interface WheelModel {
  /** steering pivot, positioned at the wheel centre by the car view */
  pivot: THREE.Group;
  /** spins about local X */
  spin: THREE.Group;
  rimMaterial: THREE.MeshStandardMaterial;
  caliperMaterial: THREE.MeshStandardMaterial;
  /** -1 for right-side wheels (mirrored) */
  side: 1 | -1;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function cachedGeo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geoCache.get(key);
  if (!g) geoCache.set(key, (g = make()));
  return g;
}

/** Wheel facing +X (outboard). The car view mirrors right-side wheels. */
export function buildWheel(o: WheelOptions, side: 1 | -1, shared?: { rim: THREE.MeshStandardMaterial; caliper: THREE.MeshStandardMaterial; rubber: THREE.MeshStandardMaterial; disc: THREE.MeshStandardMaterial }): WheelModel {
  const R = o.radius, W = o.width, r = o.rimRadius;
  const key = `${R}-${W}-${r}-${o.design}`;
  const rubber = shared?.rubber ?? new THREE.MeshStandardMaterial({ color: 0x131315, roughness: 0.88 });
  const rimMat = shared?.rim ?? new THREE.MeshStandardMaterial({ color: o.rimColor, metalness: 0.85, roughness: 0.28 });
  const caliperMat = shared?.caliper ?? new THREE.MeshStandardMaterial({ color: o.caliperColor, metalness: 0.3, roughness: 0.4 });
  const discMat = shared?.disc ?? new THREE.MeshStandardMaterial({ color: 0x5b5d61, metalness: 0.9, roughness: 0.45 });

  const pivot = new THREE.Group();
  const mirror = new THREE.Group();
  if (side < 0) mirror.rotation.y = Math.PI;
  pivot.add(mirror);
  const spin = new THREE.Group();
  mirror.add(spin);

  // tire: lathe a rounded profile around the X axis
  const tireGeo = cachedGeo('tire' + key, () => {
    const pts: THREE.Vector2[] = [];
    const hw = W / 2;
    const prof: [number, number][] = [
      [r + 0.005, -hw * 0.86], [r + 0.02, -hw * 0.98], [r + 0.05, -hw * 1.02], [(r + R) / 2, -hw * 1.03],
      [R - 0.03, -hw * 0.98], [R - 0.008, -hw * 0.9], [R, -hw * 0.7], [R, hw * 0.7], [R - 0.008, hw * 0.9],
      [R - 0.03, hw * 0.98], [(r + R) / 2, hw * 1.03], [r + 0.05, hw * 1.02], [r + 0.02, hw * 0.98], [r + 0.005, hw * 0.86],
    ];
    for (const [rad, y] of prof) pts.push(new THREE.Vector2(rad, y));
    const g = new THREE.LatheGeometry(pts, 48);
    g.rotateZ(-Math.PI / 2);
    return g;
  });
  const tire = new THREE.Mesh(tireGeo, rubber);
  tire.castShadow = true;
  spin.add(tire);

  // rim barrel + polished lip
  const barrel = new THREE.Mesh(
    cachedGeo('barrel' + key, () => {
      const g = new THREE.CylinderGeometry(r - 0.005, r - 0.005, W * 0.86, 36, 1, true);
      g.rotateZ(Math.PI / 2);
      return g;
    }),
    new THREE.MeshStandardMaterial({ color: 0x2a2b2e, metalness: 0.7, roughness: 0.5, side: THREE.DoubleSide }),
  );
  spin.add(barrel);
  const lip = new THREE.Mesh(
    cachedGeo('lip' + key, () => {
      const g = new THREE.TorusGeometry(r - 0.004, 0.009, 8, 48);
      g.rotateY(Math.PI / 2);
      return g;
    }),
    new THREE.MeshStandardMaterial({ color: 0xdfe2e6, metalness: 1, roughness: 0.15 }),
  );
  lip.position.x = W * 0.42;
  spin.add(lip);

  // face: hub + spokes
  const faceX = W * 0.36;
  const hub = new THREE.Mesh(
    cachedGeo('hub' + key, () => {
      const g = new THREE.CylinderGeometry(0.075, 0.085, 0.05, 24);
      g.rotateZ(Math.PI / 2);
      return g;
    }),
    rimMat,
  );
  hub.position.x = faceX - 0.01;
  spin.add(hub);
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.032, 20), new THREE.MeshStandardMaterial({ color: 0xc8102e, metalness: 0.5, roughness: 0.3 }));
  cap.rotation.y = Math.PI / 2;
  cap.position.x = faceX + 0.016;
  spin.add(cap);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const nut = new THREE.Mesh(cachedGeo('nut', () => new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6).rotateZ(Math.PI / 2)), new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 1, roughness: 0.25 }));
    nut.position.set(faceX + 0.012, Math.cos(a) * 0.052, Math.sin(a) * 0.052);
    spin.add(nut);
  }
  const spokeGeo = cachedGeo('spoke' + key + o.spokes, () => {
    // tapered spoke from hub to rim, dished outward toward the hub
    const s = new THREE.Shape();
    const inner = 0.07, outer = r - 0.012;
    s.moveTo(inner, -0.024);
    s.lineTo(outer, -0.017);
    s.lineTo(outer, 0.017);
    s.lineTo(inner, 0.024);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.026, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2 });
    // shape is in the XY plane, extruded along Z. Map: shape X → radial (Y), extrude → axial (X)
    g.rotateY(-Math.PI / 2);
    g.rotateX(Math.PI / 2);
    return g;
  });
  const n = o.design === 'mesh' ? 10 : o.spokes;
  for (let i = 0; i < n; i++) {
    const sp = new THREE.Mesh(spokeGeo, rimMat);
    sp.rotation.x = (i / n) * Math.PI * 2;
    sp.position.x = faceX + 0.004;
    sp.castShadow = false;
    spin.add(sp);
  }

  // brake disc spins, caliper does not
  const disc = new THREE.Mesh(
    cachedGeo('disc' + key, () => {
      const g = new THREE.CylinderGeometry(r - 0.045, r - 0.045, 0.026, 32);
      g.rotateZ(Math.PI / 2);
      return g;
    }),
    discMat,
  );
  disc.position.x = -0.01;
  spin.add(disc);
  const cal = new THREE.Mesh(
    cachedGeo('caliper' + key, () => {
      const g = new THREE.CylinderGeometry(r - 0.035, r - 0.035, 0.07, 12, 1, false, 0, 0.9);
      g.rotateZ(Math.PI / 2);
      return g;
    }),
    caliperMat,
  );
  cal.rotation.x = -0.45; // sits at the rear-upper part of the disc
  cal.position.x = 0.004;
  mirror.add(cal);

  return { pivot, spin, rimMaterial: rimMat, caliperMaterial: caliperMat, side };
}
