// Monotone cubic profile curves (Fritsch–Carlson) used to describe car bodies.
// They never overshoot between control points, so hand-tuned shapes stay clean.

export class Profile {
  private xs: number[];
  private ys: number[];
  private ms: number[];

  constructor(points: [number, number][]) {
    const p = [...points].sort((a, b) => a[0] - b[0]);
    this.xs = p.map((q) => q[0]);
    this.ys = p.map((q) => q[1]);
    const n = p.length;
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) d.push((this.ys[i + 1] - this.ys[i]) / (this.xs[i + 1] - this.xs[i]));
    const m: number[] = new Array(n);
    m[0] = d[0];
    m[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      const a = m[i] / d[i], b = m[i + 1] / d[i];
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i];
        m[i + 1] = t * b * d[i];
      }
    }
    this.ms = m;
  }

  get min(): number {
    return this.xs[0];
  }
  get max(): number {
    return this.xs[this.xs.length - 1];
  }

  at(x: number): number {
    const xs = this.xs;
    const n = xs.length;
    if (x <= xs[0]) return this.ys[0];
    if (x >= xs[n - 1]) return this.ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (
      (2 * t3 - 3 * t2 + 1) * this.ys[i] +
      (t3 - 2 * t2 + t) * h * this.ms[i] +
      (-2 * t3 + 3 * t2) * this.ys[i + 1] +
      (t3 - t2) * h * this.ms[i + 1]
    );
  }
}

/** Body description in model space: x = left, y = up (ground at 0), z = forward. */
export interface BodyShape {
  /** z range of the body */
  zRear: number;
  zFront: number;
  top: Profile;
  bottom: Profile;
  halfWidth: Profile;
  /** height of the widest line as a fraction between bottom and top */
  shoulder: Profile;
  /** superellipse exponents for the upper and lower halves of the section */
  upperExp: Profile;
  lowerExp: number;
  wheels: { z: number; y: number; arch: number }[];
  greenhouse: {
    zRear: number;
    zFront: number;
    roof: Profile;
    roofHalfWidth: number;
    /** inset of the greenhouse base from the body side */
    beltInset: number;
    windshieldZ: number;
    rearWindowZ: number;
    quarterZ: number;
    bPillar: [number, number];
  };
}

/** Section half-extent at height y for station z (no arch cut). */
export function sectionExtent(b: BodyShape, y: number, z: number): number {
  const bot = b.bottom.at(z), top = b.top.at(z);
  if (y < bot || y > top) return -1;
  const hw = b.halfWidth.at(z);
  const yc = bot + (top - bot) * b.shoulder.at(z);
  if (y < yc) {
    const n = b.lowerExp;
    const f = (yc - y) / (yc - bot);
    return hw * Math.pow(Math.max(0, 1 - Math.pow(f, n)), 1 / n);
  }
  const n = b.upperExp.at(z);
  const f = (y - yc) / (top - yc);
  return hw * Math.pow(Math.max(0, 1 - Math.pow(f, n)), 1 / n);
}

export function insideBody(b: BodyShape, x: number, y: number, z: number): boolean {
  const e = sectionExtent(b, y, z);
  return e >= 0 && Math.abs(x) <= e;
}

/** Height of the upper body surface at (x, z), or -1 if outside. */
export function topSurfaceY(b: BodyShape, x: number, z: number): number {
  const bot = b.bottom.at(z), top = b.top.at(z);
  const hw = b.halfWidth.at(z);
  const ax = Math.abs(x);
  if (ax > hw) return -1;
  const yc = bot + (top - bot) * b.shoulder.at(z);
  const n = b.upperExp.at(z);
  return yc + (top - yc) * Math.pow(Math.max(0, 1 - Math.pow(ax / hw, n)), 1 / n);
}

/** z of the body surface seen from the front (dir = 1) or rear (dir = -1) at (x, y). */
export function endSurfaceZ(b: BodyShape, x: number, y: number, dir: 1 | -1): number | null {
  const outer = dir > 0 ? b.zFront + 0.01 : b.zRear - 0.01;
  const mid = (b.zFront + b.zRear) / 2;
  if (!insideBody(b, x, y, mid)) {
    // march inward to find any inside point
    let found: number | null = null;
    for (let k = 1; k <= 40; k++) {
      const z = outer - dir * k * ((b.zFront - b.zRear) / 80);
      if (insideBody(b, x, y, z)) {
        found = z;
        break;
      }
    }
    if (found === null) return null;
    return bisect(b, x, y, outer, found);
  }
  // march from the outside in until inside, then bisect
  const steps = 60;
  let prev = outer;
  for (let k = 1; k <= steps; k++) {
    const z = outer - dir * k * (Math.abs(outer - mid) / steps);
    if (insideBody(b, x, y, z)) return bisect(b, x, y, prev, z);
    prev = z;
  }
  return null;
}

function bisect(b: BodyShape, x: number, y: number, out: number, inn: number): number {
  let a = out, c = inn;
  for (let i = 0; i < 24; i++) {
    const m = (a + c) / 2;
    if (insideBody(b, x, y, m)) c = m;
    else a = m;
  }
  return (a + c) / 2;
}

/** Side surface |x| at (y, z) including the wheel arch cut (returns -1 if no surface). */
export function sideSurfaceX(b: BodyShape, y: number, z: number): number {
  for (const w of b.wheels) {
    const dz = z - w.z;
    if (Math.abs(dz) < w.arch && y < w.y + Math.sqrt(w.arch * w.arch - dz * dz)) return -1;
  }
  return sectionExtent(b, y, z);
}
