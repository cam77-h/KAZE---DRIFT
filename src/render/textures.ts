import * as THREE from 'three';

// Every texture in the game is generated here from code, so the build ships no image files.

let seed = 1;
function rnd(): number {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
function reseed(s: number): void {
  seed = s;
}

function canvas(w: number, h = w): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

const cache = new Map<string, THREE.Texture>();
let maxAniso = 8;
export function setMaxAnisotropy(n: number): void {
  maxAniso = n;
}

function finish(c: HTMLCanvasElement, key: string, color = true, repeat = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  cache.set(key, t);
  return t;
}

function cached<T extends THREE.Texture>(key: string, make: () => T): T {
  return (cache.get(key) as T) ?? make();
}

/** Asphalt: aggregate speckle, cracks, tar-sealed patches, rubbered racing line. Returns [color, bump/roughness]. */
export function asphaltTextures(): { map: THREE.Texture; bump: THREE.Texture; rough: THREE.Texture } {
  const map = cached('asphalt', () => {
    reseed(11);
    const N = 1024;
    const [c, g] = canvas(N);
    g.fillStyle = '#4a4b4e';
    g.fillRect(0, 0, N, N);
    // large tone variation
    for (let i = 0; i < 60; i++) {
      const x = rnd() * N, y = rnd() * N, r = 60 + rnd() * 260;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      const light = rnd() < 0.5;
      grd.addColorStop(0, light ? 'rgba(130,130,135,0.10)' : 'rgba(20,20,24,0.16)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) g.fillRect(x - r + ox, y - r + oy, r * 2, r * 2);
    }
    // aggregate
    for (let i = 0; i < 160000; i++) {
      const v = 35 + rnd() * 95;
      const warm = rnd() * 8;
      g.fillStyle = `rgba(${v + warm | 0},${v | 0},${v - warm * 0.5 | 0},${0.25 + rnd() * 0.5})`;
      const s = 0.8 + rnd() * 1.8;
      g.fillRect(rnd() * N, rnd() * N, s, s);
    }
    // bright stones
    for (let i = 0; i < 9000; i++) {
      const v = 140 + rnd() * 80;
      g.fillStyle = `rgba(${v | 0},${v | 0},${v | 0},${0.35 + rnd() * 0.4})`;
      g.fillRect(rnd() * N, rnd() * N, 1 + rnd(), 1 + rnd());
    }
    // tar-sealed cracks
    g.lineCap = 'round';
    for (let i = 0; i < 26; i++) {
      let x = rnd() * N, y = rnd() * N;
      g.strokeStyle = `rgba(14,14,16,${0.55 + rnd() * 0.3})`;
      g.lineWidth = 2 + rnd() * 5;
      g.beginPath();
      g.moveTo(x, y);
      const ang = rnd() * Math.PI * 2;
      for (let k = 0; k < 14; k++) {
        x += Math.cos(ang + (rnd() - 0.5) * 1.6) * 18;
        y += Math.sin(ang + (rnd() - 0.5) * 1.6) * 18;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // hairline cracks
    for (let i = 0; i < 70; i++) {
      let x = rnd() * N, y = rnd() * N;
      g.strokeStyle = 'rgba(18,18,20,0.5)';
      g.lineWidth = 0.8;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rnd() - 0.5) * 30;
        y += (rnd() - 0.5) * 30;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    // patches
    for (let i = 0; i < 4; i++) {
      const w = 80 + rnd() * 160, h = 60 + rnd() * 120, x = rnd() * N, y = rnd() * N;
      g.fillStyle = 'rgba(34,34,37,0.55)';
      g.fillRect(x, y, w, h);
      g.strokeStyle = 'rgba(15,15,15,0.6)';
      g.lineWidth = 2;
      g.strokeRect(x, y, w, h);
    }
    return finish(c, 'asphalt');
  });
  const bump = cached('asphalt-bump', () => {
    reseed(12);
    const N = 512;
    const [c, g] = canvas(N);
    g.fillStyle = '#808080';
    g.fillRect(0, 0, N, N);
    for (let i = 0; i < 60000; i++) {
      const v = 60 + rnd() * 150;
      g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      g.fillRect(rnd() * N, rnd() * N, 1 + rnd() * 1.5, 1 + rnd() * 1.5);
    }
    return finish(c, 'asphalt-bump', false);
  });
  const rough = cached('asphalt-rough', () => {
    reseed(13);
    const N = 256;
    const [c, g] = canvas(N);
    g.fillStyle = 'rgb(225,225,225)';
    g.fillRect(0, 0, N, N);
    for (let i = 0; i < 40; i++) {
      const x = rnd() * N, y = rnd() * N, r = 10 + rnd() * 50;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, 'rgba(150,150,150,0.5)');
      grd.addColorStop(1, 'rgba(225,225,225,0)');
      g.fillStyle = grd;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return finish(c, 'asphalt-rough', false);
  });
  return { map, bump, rough };
}

export function concreteTexture(): THREE.Texture {
  return cached('concrete', () => {
    reseed(21);
    const N = 512;
    const [c, g] = canvas(N);
    g.fillStyle = '#a9a69f';
    g.fillRect(0, 0, N, N);
    for (let i = 0; i < 40000; i++) {
      const v = 120 + rnd() * 80;
      g.fillStyle = `rgba(${v | 0},${v - 3 | 0},${v - 8 | 0},0.35)`;
      g.fillRect(rnd() * N, rnd() * N, 1.5, 1.5);
    }
    // rain stains running down
    for (let i = 0; i < 50; i++) {
      const x = rnd() * N, w = 3 + rnd() * 18, h = 40 + rnd() * 200;
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, 'rgba(60,58,52,0.28)');
      grd.addColorStop(1, 'rgba(60,58,52,0)');
      g.fillStyle = grd;
      g.fillRect(x, 0, w, h);
    }
    // panel joints
    g.fillStyle = 'rgba(50,50,48,0.6)';
    g.fillRect(0, 0, N, 3);
    g.fillRect(0, 0, 3, N);
    // tire scuffs
    for (let i = 0; i < 14; i++) {
      g.fillStyle = `rgba(20,20,20,${0.15 + rnd() * 0.3})`;
      g.fillRect(rnd() * N, N * 0.55 + rnd() * N * 0.4, 30 + rnd() * 120, 3 + rnd() * 8);
    }
    return finish(c, 'concrete');
  });
}

export function grassTexture(): THREE.Texture {
  return cached('grass', () => {
    reseed(31);
    const N = 512;
    const [c, g] = canvas(N);
    g.fillStyle = '#4c6a2c';
    g.fillRect(0, 0, N, N);
    for (let i = 0; i < 30; i++) {
      const x = rnd() * N, y = rnd() * N, r = 30 + rnd() * 120;
      const grd = g.createRadialGradient(x, y, 0, x, y, r);
      grd.addColorStop(0, rnd() < 0.5 ? 'rgba(110,130,50,0.25)' : 'rgba(30,50,20,0.25)');
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      for (const ox of [-N, 0, N]) for (const oy of [-N, 0, N]) g.fillRect(x - r + ox, y - r + oy, r * 2, r * 2);
    }
    for (let i = 0; i < 26000; i++) {
      const x = rnd() * N, y = rnd() * N;
      const gr = 70 + rnd() * 80;
      g.strokeStyle = `rgba(${gr * 0.55 | 0},${gr | 0},${gr * 0.3 | 0},0.6)`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + (rnd() - 0.5) * 3, y - 2 - rnd() * 5);
      g.stroke();
    }
    return finish(c, 'grass');
  });
}

export function gravelTexture(): THREE.Texture {
  return cached('gravel', () => {
    reseed(41);
    const N = 512;
    const [c, g] = canvas(N);
    g.fillStyle = '#8c8577';
    g.fillRect(0, 0, N, N);
    for (let i = 0; i < 9000; i++) {
      const v = 90 + rnd() * 120;
      g.fillStyle = `rgb(${v | 0},${v * 0.95 | 0},${v * 0.86 | 0})`;
      g.beginPath();
      g.ellipse(rnd() * N, rnd() * N, 1 + rnd() * 3, 1 + rnd() * 2.5, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    return finish(c, 'gravel');
  });
}

/** Two-tone kerb stripes along V. */
export function kerbTexture(): THREE.Texture {
  return cached('kerb', () => {
    const [c, g] = canvas(64, 256);
    g.fillStyle = '#e9e6de';
    g.fillRect(0, 0, 64, 256);
    g.fillStyle = '#c4161c';
    g.fillRect(0, 0, 64, 128);
    // grime
    reseed(51);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(30,30,30,${rnd() * 0.15})`;
      g.fillRect(rnd() * 64, rnd() * 256, 2, 2);
    }
    return finish(c, 'kerb');
  });
}

export function honeycombTexture(): THREE.Texture {
  return cached('honeycomb', () => {
    const [c, g] = canvas(128);
    g.fillStyle = '#050506';
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = '#2a2b2e';
    g.lineWidth = 2;
    const r = 8;
    for (let row = -1; row < 12; row++)
      for (let col = -1; col < 10; col++) {
        const x = col * r * 1.75 + (row % 2) * r * 0.87;
        const y = row * r * 1.5;
        g.beginPath();
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 + Math.PI / 6;
          const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (k === 0) g.moveTo(px, py);
          else g.lineTo(px, py);
        }
        g.closePath();
        g.stroke();
      }
    return finish(c, 'honeycomb');
  });
}

/** A Japanese-style (fictional) number plate. */
export function plateTexture(text = '300', hira = 'さ', number = '15-15', region = '風見'): THREE.Texture {
  return cached('plate-' + number, () => {
    const [c, g] = canvas(256, 128);
    g.fillStyle = '#f3f1e7';
    g.fillRect(0, 0, 256, 128);
    g.strokeStyle = '#1d5b2c';
    g.lineWidth = 5;
    g.strokeRect(4, 4, 248, 120);
    g.fillStyle = '#1d5b2c';
    g.textAlign = 'center';
    g.font = '600 30px "Zen Kaku Gothic New", sans-serif';
    g.fillText(`${region} ${text}`, 128, 42);
    g.font = '600 30px "Zen Kaku Gothic New", sans-serif';
    g.fillText(hira, 34, 102);
    g.font = '700 62px "Chakra Petch", sans-serif';
    g.fillText(number, 148, 110);
    return finish(c, 'plate-' + number, true, false);
  });
}

/** Tire sidewall lettering ring (u = around, v = radial). */
export function sidewallTexture(): THREE.Texture {
  return cached('sidewall', () => {
    const [c, g] = canvas(1024, 64);
    g.fillStyle = '#121214';
    g.fillRect(0, 0, 1024, 64);
    g.fillStyle = '#2d2e31';
    g.font = '700 30px "Chakra Petch", sans-serif';
    g.textBaseline = 'middle';
    for (const x of [30, 542]) {
      g.fillText('HAYATE  SPORT-R', x, 32);
      g.font = '600 20px "Chakra Petch", sans-serif';
      g.fillText('225/45 R17  94W', x + 300, 32);
      g.font = '700 30px "Chakra Petch", sans-serif';
    }
    return finish(c, 'sidewall', true, true);
  });
}

/** Wide banner with an original brand name. */
export function bannerTexture(text: string, sub: string, bg: string, fg: string, accent: string): THREE.Texture {
  return cached('banner-' + text + bg, () => {
    const [c, g] = canvas(1024, 192);
    g.fillStyle = bg;
    g.fillRect(0, 0, 1024, 192);
    g.fillStyle = accent;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(150, 0);
    g.lineTo(90, 192);
    g.lineTo(0, 192);
    g.fill();
    g.fillStyle = fg;
    g.font = 'italic 700 104px "Chakra Petch", sans-serif';
    g.textBaseline = 'middle';
    g.fillText(text, 180, 92);
    g.font = '500 30px "Zen Kaku Gothic New", sans-serif';
    g.globalAlpha = 0.8;
    g.fillText(sub, 186, 160);
    return finish(c, 'banner-' + text + bg, true, false);
  });
}

/** Soft smoke puff with some internal noise. */
export function smokeTexture(): THREE.Texture {
  return cached('smoke', () => {
    reseed(61);
    const N = 128;
    const [c, g] = canvas(N);
    const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grd.addColorStop(0, 'rgba(255,255,255,0.9)');
    grd.addColorStop(0.5, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, N, N);
    g.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 40; i++) {
      const x = 20 + rnd() * 88, y = 20 + rnd() * 88, r = 6 + rnd() * 16;
      const h = g.createRadialGradient(x, y, 0, x, y, r);
      h.addColorStop(0, 'rgba(0,0,0,0.25)');
      h.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = h;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return finish(c, 'smoke', true, false);
  });
}

/** Painted marking sheet for the skidpad / start grid. */
export function lineTexture(): THREE.Texture {
  return cached('paintline', () => {
    reseed(71);
    const [c, g] = canvas(64, 256);
    g.fillStyle = '#efede4';
    g.fillRect(0, 0, 64, 256);
    for (let i = 0; i < 500; i++) {
      g.fillStyle = `rgba(70,70,70,${rnd() * 0.35})`;
      g.fillRect(rnd() * 64, rnd() * 256, 2 + rnd() * 3, 2 + rnd() * 3);
    }
    return finish(c, 'paintline');
  });
}

export function checkerTexture(): THREE.Texture {
  return cached('checker', () => {
    const [c, g] = canvas(256, 64);
    for (let x = 0; x < 16; x++)
      for (let y = 0; y < 4; y++) {
        g.fillStyle = (x + y) % 2 ? '#111' : '#eee';
        g.fillRect(x * 16, y * 16, 16, 16);
      }
    return finish(c, 'checker');
  });
}

/** Vertical Japanese-style sign with kanji + an English subtitle. */
export function signTexture(jp: string, en: string, bg = '#0d1a2b', fg = '#f2efe6', accent = '#e8202f'): THREE.Texture {
  return cached('sign-' + jp + en, () => {
    const [c, g] = canvas(512, 256);
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 256);
    g.fillStyle = accent;
    g.fillRect(0, 0, 512, 14);
    g.fillRect(0, 242, 512, 14);
    g.fillStyle = fg;
    g.textAlign = 'center';
    g.font = '700 96px "Zen Kaku Gothic New", sans-serif';
    g.fillText(jp, 256, 130);
    g.font = '700 40px "Chakra Petch", sans-serif';
    g.fillText(en, 256, 205);
    return finish(c, 'sign-' + jp + en, true, false);
  });
}
