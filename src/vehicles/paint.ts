import * as THREE from 'three';

// Car paint: MeshPhysicalMaterial with a clearcoat, and a set of finishes. Metallic paint
// gets a fine flake normal map; pearl uses iridescence; matte and satin drop the clearcoat.

export type PaintFinish = 'gloss' | 'metallic' | 'pearl' | 'matte' | 'satin' | 'chrome' | 'candy' | 'shift';
export const FINISHES: PaintFinish[] = ['gloss', 'metallic', 'pearl', 'matte', 'satin', 'chrome', 'candy'];

let flakeTex: THREE.Texture | null = null;
function flakeNormal(): THREE.Texture {
  if (flakeTex) return flakeTex;
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < N * N; i++) {
    // random flake tilt, mostly facing outward
    const nx = (r() - 0.5) * 0.5, ny = (r() - 0.5) * 0.5;
    img.data[i * 4] = (nx * 0.5 + 0.5) * 255;
    img.data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  flakeTex = new THREE.CanvasTexture(c);
  flakeTex.wrapS = flakeTex.wrapT = THREE.RepeatWrapping;
  flakeTex.repeat.set(24, 24);
  return flakeTex;
}

export interface PaintMaterial extends THREE.MeshPhysicalMaterial {
  setPaint(color: string, finish: PaintFinish): void;
}

function applyFinish(m: THREE.MeshPhysicalMaterial, color: string, finish: PaintFinish, allowFlake: boolean): void {
  const soft = m.userData.lowPoly ? 1 : 0;
  m.color.set(color);
  // real paint never reflects 100%: cap the albedo so white cars don't clip in sunlight
  const lum = m.color.r * 0.2126 + m.color.g * 0.7152 + m.color.b * 0.0722;
  if (lum > 0.62) m.color.multiplyScalar(0.62 / lum);
  m.clearcoat = 1;
  m.clearcoatRoughness = 0.05;
  m.metalness = 0.4;
  m.roughness = 0.35;
  m.iridescence = 0;
  m.normalMap = null;
  m.sheen = 0;
  switch (finish) {
    case 'gloss':
      m.metalness = 0.05;
      m.roughness = 0.3;
      break;
    case 'metallic':
      m.metalness = 0.55;
      m.roughness = 0.32;
      if (allowFlake) {
        m.normalMap = flakeNormal();
        m.normalScale.set(0.12, 0.12);
      }
      break;
    case 'pearl':
      m.metalness = 0.35;
      m.roughness = 0.28;
      m.iridescence = 0.6;
      m.iridescenceIOR = 1.6;
      break;
    case 'matte':
      m.metalness = 0.1;
      m.roughness = 0.82;
      m.clearcoat = 0;
      break;
    case 'satin':
      m.metalness = 0.3;
      m.roughness = 0.55;
      m.clearcoat = 0.3;
      m.clearcoatRoughness = 0.4;
      break;
    case 'chrome':
      m.metalness = 1;
      m.roughness = 0.06;
      m.clearcoat = 0.4;
      break;
    case 'candy':
      m.metalness = 0.7;
      m.roughness = 0.18;
      m.color.multiplyScalar(0.8);
      break;
    case 'shift':
      m.metalness = 0.5;
      m.roughness = 0.25;
      m.iridescence = 1;
      m.iridescenceIOR = 2.0;
      break;
  }
  // flat-shaded imported models mirror the sun across a whole face: blur the highlight a little
  if (soft) {
    m.clearcoatRoughness = Math.max(m.clearcoatRoughness, 0.16);
    m.roughness = Math.max(m.roughness, 0.42);
    m.envMapIntensity = 0.9;
  }
  m.needsUpdate = true;
}

export function makePaintMaterial(color: string, finish: PaintFinish = 'metallic', lowPoly = false): PaintMaterial {
  const m = new THREE.MeshPhysicalMaterial({ envMapIntensity: 1.15 }) as PaintMaterial;
  m.userData.lowPoly = lowPoly;
  m.setPaint = (c, f) => applyFinish(m, c, f, true);
  m.setPaint(color, finish);
  return m;
}

/**
 * For models whose whole body is one palette texture: keep the texture, but recolour only
 * the texels that match the body colour `key` (so trim, lights and tires keep their colour).
 */
export function applyPaintToTextured(src: THREE.MeshStandardMaterial, key: [number, number, number], tolerance: number): PaintMaterial {
  const m = new THREE.MeshPhysicalMaterial({ map: src.map, envMapIntensity: 1.15, name: src.name }) as PaintMaterial;
  m.userData.lowPoly = true;
  const uniforms = {
    paintColor: { value: new THREE.Color(0xffffff) },
    paintKey: { value: new THREE.Color().setRGB(key[0], key[1], key[2], THREE.SRGBColorSpace) },
    paintTol: { value: tolerance },
  };
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 paintColor; uniform vec3 paintKey; uniform float paintTol;')
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        {
          vec3 t = diffuseColor.rgb;
          float d = distance(t, paintKey);
          float mask = 1.0 - smoothstep(paintTol * 0.6, paintTol, d);
          float shade = dot(t, vec3(0.333)) / max(0.05, dot(paintKey, vec3(0.333)));
          diffuseColor.rgb = mix(t, paintColor * clamp(shade, 0.0, 1.2), mask);
        }`,
      );
  };
  m.customProgramCacheKey = () => 'texpaint';
  m.setPaint = (c, f) => {
    applyFinish(m, '#ffffff', f, false);
    uniforms.paintColor.value.set(c);
    const pc = uniforms.paintColor.value;
    const l = pc.r * 0.2126 + pc.g * 0.7152 + pc.b * 0.0722;
    if (l > 0.62) pc.multiplyScalar(0.62 / l);
  };
  m.setPaint('#f2efe6', 'gloss');
  return m;
}
