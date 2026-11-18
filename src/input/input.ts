import type { Action, ControlSettings } from '../core/settings';
import { emptyInput, type DriverInput } from '../physics/types';

export type Device = 'keyboard' | 'gamepad' | 'touch';

/** Shapes an analog stick value: deadzone, then a power curve (linearity), then sensitivity. */
export function shapeAxis(v: number, deadzone: number, linearity: number, sensitivity: number): number {
  const a = Math.abs(v);
  if (a <= deadzone) return 0;
  const n = Math.min(1, (a - deadzone) / (1 - deadzone));
  return Math.sign(v) * Math.min(1, Math.pow(n, linearity) * sensitivity);
}

/**
 * Collects keyboard, gamepad and touch input into one DriverInput. Digital steering is
 * ramped so keyboard players get a smooth, controllable wheel.
 */
export class InputManager {
  private keys = new Set<string>();
  private pressedQueue = new Set<Action>();
  private padPrev: boolean[] = [];
  touch = { steer: 0, throttle: 0, brake: 0, handbrake: 0 };
  lastDevice: Device = 'keyboard';
  /** set by tests/automation to replace live input entirely */
  override: Partial<DriverInput> | null = null;
  private kbSteer = 0;
  private kbThrottle = 0;
  private kbBrake = 0;
  private capturing: ((code: string) => void) | null = null;
  private listeners: ((a: Action) => void)[] = [];
  readonly state: DriverInput = emptyInput();

  constructor(public settings: ControlSettings) {
    window.addEventListener('keydown', this.onKeyDown, { passive: false });
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
  }

  /** Called with each action that was pressed (edge), e.g. camera, reset, pause. */
  onAction(fn: (a: Action) => void): void {
    this.listeners.push(fn);
  }

  /** Wait for the next key press and hand back its code (used by the rebinding UI). */
  captureNextKey(fn: (code: string) => void): void {
    this.capturing = fn;
  }

  private actionsForKey(code: string): Action[] {
    const out: Action[] = [];
    for (const [a, codes] of Object.entries(this.settings.keys) as [Action, string[]][]) if (codes.includes(code)) out.push(a);
    return out;
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.capturing) {
      e.preventDefault();
      const fn = this.capturing;
      this.capturing = null;
      fn(e.code);
      return;
    }
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const acts = this.actionsForKey(e.code);
    if (acts.length) e.preventDefault();
    this.lastDevice = 'keyboard';
    if (!e.repeat) for (const a of acts) this.fire(a);
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private fire(a: Action): void {
    this.pressedQueue.add(a);
    for (const l of this.listeners) l(a);
  }

  /** Fire an action from on-screen UI (touch buttons). */
  press(a: Action): void {
    this.lastDevice = 'touch';
    this.fire(a);
  }

  private keyDown(a: Action): boolean {
    for (const c of this.settings.keys[a] ?? []) if (this.keys.has(c)) return true;
    return false;
  }

  /** Was the action pressed since the last call to consume()? */
  consume(a: Action): boolean {
    const had = this.pressedQueue.has(a);
    this.pressedQueue.delete(a);
    return had;
  }

  private gamepad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    try {
      for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    } catch {
      /* some browsers throw without a secure context */
    }
    return null;
  }

  get padConnected(): boolean {
    return this.gamepad() !== null;
  }

  /** Sample all devices. Call once per rendered frame. */
  update(dt: number): DriverInput {
    const s = this.settings;
    const st = this.state;

    // keyboard: ramp the digital inputs
    const left = this.keyDown('steerLeft'), right = this.keyDown('steerRight');
    const target = (right ? 1 : 0) - (left ? 1 : 0);
    const speed = 3.2 * s.keyboardSteerSpeed;
    const back = target === 0 || Math.sign(target) !== Math.sign(this.kbSteer) ? speed * 1.8 : speed;
    this.kbSteer += Math.max(-back * dt, Math.min(back * dt, target - this.kbSteer));
    const thrT = this.keyDown('throttle') ? 1 : 0;
    this.kbThrottle += Math.max(-8 * dt, Math.min(8 * dt, thrT - this.kbThrottle));
    const brT = this.keyDown('brake') ? 1 : 0;
    this.kbBrake += Math.max(-10 * dt, Math.min(10 * dt, brT - this.kbBrake));

    let steer = this.kbSteer;
    let throttle = this.kbThrottle;
    let brake = this.kbBrake;
    let handbrake = this.keyDown('handbrake') ? 1 : 0;
    let clutch = this.keyDown('clutch') ? 1 : 0;

    // gamepad
    const pad = this.gamepad();
    if (pad) {
      const ax = pad.axes[0] ?? 0;
      const shaped = shapeAxis(ax, s.deadzone, s.steerLinearity, s.steerSensitivity);
      const btn = (a: Action) => {
        let v = 0;
        for (const i of s.pad[a] ?? []) v = Math.max(v, pad.buttons[i]?.value ?? 0, pad.buttons[i]?.pressed ? 1 : 0);
        return v;
      };
      const pThr = btn('throttle'), pBr = btn('brake');
      const dpad = btn('steerRight') - btn('steerLeft');
      if (Math.abs(shaped) > 0 || pThr > 0.04 || pBr > 0.04 || Math.abs(dpad) > 0) this.lastDevice = 'gamepad';
      if (Math.abs(shaped) > Math.abs(steer)) steer = shaped;
      if (Math.abs(dpad) > 0) steer = dpad;
      throttle = Math.max(throttle, pThr > 0.04 ? pThr : 0);
      brake = Math.max(brake, pBr > 0.04 ? pBr : 0);
      handbrake = Math.max(handbrake, btn('handbrake'));
      clutch = Math.max(clutch, btn('clutch'));
      // edge-triggered buttons
      const edges: Action[] = ['shiftUp', 'shiftDown', 'camera', 'reset', 'pause'];
      for (const a of edges) {
        for (const i of s.pad[a] ?? []) {
          const down = !!pad.buttons[i]?.pressed;
          if (down && !this.padPrev[i]) {
            this.lastDevice = 'gamepad';
            this.fire(a);
          }
        }
      }
      this.padPrev = pad.buttons.map((b) => b.pressed);
      if (this.keyDownPad(pad, 'lookBack')) this.lookBackPad = true;
      else this.lookBackPad = false;
    }

    // touch
    const t = this.touch;
    if (Math.abs(t.steer) > 0.01 || t.throttle || t.brake || t.handbrake) {
      if (Math.abs(t.steer) > Math.abs(steer)) steer = t.steer;
      throttle = Math.max(throttle, t.throttle);
      brake = Math.max(brake, t.brake);
      handbrake = Math.max(handbrake, t.handbrake);
    }

    st.steer = Math.max(-1, Math.min(1, steer));
    st.throttle = throttle;
    st.brake = brake;
    st.handbrake = handbrake;
    st.clutch = clutch;
    if (this.override) Object.assign(st, this.override);
    return st;
  }

  private lookBackPad = false;
  private keyDownPad(pad: Gamepad, a: Action): boolean {
    for (const i of this.settings.pad[a] ?? []) if (pad.buttons[i]?.pressed) return true;
    return false;
  }

  get lookBack(): boolean {
    return this.keyDown('lookBack') || this.lookBackPad;
  }

  /** Rumble on supported gamepads. */
  rumble(strong: number, weak: number, ms: number): void {
    if (!this.settings.vibration) return;
    const pad = this.gamepad();
    const act = (pad as unknown as { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } } | null)?.vibrationActuator;
    if (!act?.playEffect) return;
    act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => undefined);
  }
}

/** Human-readable label for a KeyboardEvent.code. */
export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
    ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', AltLeft: 'L-Alt', AltRight: 'R-Alt', Escape: 'Esc', Enter: 'Enter', Tab: 'Tab', Backspace: 'Bksp',
  };
  return map[code] ?? code;
}

export const PAD_LABELS = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'Back', 'Start', 'LS', 'RS', 'D↑', 'D↓', 'D←', 'D→', 'Home'];
