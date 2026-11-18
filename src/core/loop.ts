/**
 * Fixed-timestep loop: physics runs at a constant 120 Hz, rendering runs at the display
 * rate and interpolates between the last two physics states using `alpha`.
 */
export const PHYSICS_HZ = 120;
export const PHYSICS_DT = 1 / PHYSICS_HZ;

export interface LoopCallbacks {
  /** one fixed physics step */
  step(dt: number): void;
  /** once per animation frame; alpha in [0,1) is the interpolation factor */
  render(frameDt: number, alpha: number): void;
}

export class GameLoop {
  private acc = 0;
  private last = 0;
  private raf = 0;
  running = false;
  /** steps executed during the last frame (for the debug overlay) */
  stepsLastFrame = 0;
  timeScale = 1;
  paused = false;

  constructor(private cb: LoopCallbacks, private maxSteps = 8) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const tick = (now: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.frame(now);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Advance by wall-clock time `now` (ms). Exposed for tests. */
  frame(now: number): void {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (dt > 0.25) dt = 0.25;
    if (dt < 0) dt = 0;
    let steps = 0;
    if (!this.paused) {
      this.acc += dt * this.timeScale;
      while (this.acc >= PHYSICS_DT && steps < this.maxSteps) {
        this.cb.step(PHYSICS_DT);
        this.acc -= PHYSICS_DT;
        steps++;
      }
      if (steps === this.maxSteps) this.acc = 0; // spiral-of-death guard
    }
    this.stepsLastFrame = steps;
    this.cb.render(dt, this.paused ? 1 : this.acc / PHYSICS_DT);
  }
}
