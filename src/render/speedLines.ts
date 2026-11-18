/**
 * Speed lines: thin streaks rushing out from the centre towards the screen edges, drawn on a 2D
 * canvas over the 3D view. Invisible below ~120 km/h, full strength by ~260 km/h.
 */
interface Streak {
  angle: number;
  r: number;
  len: number;
  speed: number;
  width: number;
}

export class SpeedLines {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D | null;
  private streaks: Streak[] = [];
  private level = 0;

  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'speedlines';
    this.g = this.canvas.getContext('2d');
    parent.prepend(this.canvas);
    for (let i = 0; i < 70; i++) this.streaks.push(this.spawn(Math.random()));
  }

  private spawn(r = 0): Streak {
    return { angle: Math.random() * Math.PI * 2, r: 0.35 + r * 0.6, len: 0.05 + Math.random() * 0.12, speed: 0.8 + Math.random() * 1.2, width: 0.6 + Math.random() * 1.4 };
  }

  /** speed in m/s; on = false clears the overlay (menus, replays) */
  update(dt: number, speed: number, on: boolean): void {
    const g = this.g;
    if (!g) return;
    const target = on ? smoothstep(120 / 3.6, 260 / 3.6, speed) : 0;
    this.level += (target - this.level) * Math.min(1, dt * 4);
    const W = Math.round(this.canvas.clientWidth * Math.min(1.5, devicePixelRatio));
    const H = Math.round(this.canvas.clientHeight * Math.min(1.5, devicePixelRatio));
    if (this.canvas.width !== W || this.canvas.height !== H) {
      this.canvas.width = W;
      this.canvas.height = H;
    }
    g.clearRect(0, 0, W, H);
    if (this.level < 0.01 || W === 0) return;
    const cx = W / 2, cy = H * 0.46;
    const R = Math.hypot(W, H) * 0.5;
    g.lineCap = 'round';
    for (const s of this.streaks) {
      s.r += s.speed * dt * (0.6 + speed / 60);
      if (s.r > 1.1) Object.assign(s, this.spawn());
      const r0 = s.r * R, r1 = (s.r + s.len) * R;
      const ca = Math.cos(s.angle), sa = Math.sin(s.angle) * 0.62;
      // fade in from the centre, strongest at the edges
      const a = this.level * smoothstep(0.38, 0.75, s.r) * 0.32;
      if (a < 0.01) continue;
      g.strokeStyle = `rgba(242,239,230,${a.toFixed(3)})`;
      g.lineWidth = s.width * (W / 1400);
      g.beginPath();
      g.moveTo(cx + ca * r0, cy + sa * r0);
      g.lineTo(cx + ca * r1, cy + sa * r1);
      g.stroke();
    }
  }
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
