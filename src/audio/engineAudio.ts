import type { AudioSettings } from '../core/settings';

// Synthesised car audio (Web Audio). The engine is built from harmonics of the firing
// frequency, run through a waveshaper and a load-dependent filter, with separate on- and
// off-throttle layers. Turbo whistle, blow-off, tire squeal, wind and impacts are layered on top.

export interface AudioFrame {
  rpm: number;
  throttle: number;
  load: number;
  boost: number;
  speed: number;
  slip: number;
  surface: 'tarmac' | 'gravel' | 'grass';
  limiter: boolean;
  bov: number;
}

export class CarAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private engineBus!: GainNode;
  private fxBus!: GainNode;
  private oscs: OscillatorNode[] = [];
  private oscGains: GainNode[] = [];
  private shaper!: WaveShaperNode;
  private lp!: BiquadFilterNode;
  private onGain!: GainNode;
  private offGain!: GainNode;
  private offLp!: BiquadFilterNode;
  private intakeGain!: GainNode;
  private intakeBp!: BiquadFilterNode;
  private turbo!: OscillatorNode;
  private turboGain!: GainNode;
  private squealGain!: GainNode;
  private squealBp!: BiquadFilterNode;
  private gravelGain!: GainNode;
  private windGain!: GainNode;
  private windLp!: BiquadFilterNode;
  private noise!: AudioBuffer;
  private cylinders = 4;
  started = false;

  constructor(private settings: AudioSettings) {}

  /** Must be called from a user gesture. */
  start(cylinders = 4): void {
    if (this.started) {
      void this.ctx?.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.cylinders = cylinders;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.engineBus = ctx.createGain();
    this.fxBus = ctx.createGain();
    this.engineBus.connect(this.master);
    this.fxBus.connect(this.master);

    // noise buffer
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // engine harmonics → shaper → lowpass
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = makeDrive(2.2);
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 1.6;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const harmonics = [0.5, 1, 1.5, 2, 3, 4];
    const levels = [0.35, 1, 0.3, 0.55, 0.22, 0.12];
    harmonics.forEach((h, i) => {
      const o = ctx.createOscillator();
      o.type = i === 1 ? 'sawtooth' : i === 3 ? 'square' : 'triangle';
      const g = ctx.createGain();
      g.gain.value = levels[i] * 0.3;
      o.connect(g).connect(mix);
      o.start();
      (o as OscillatorNode & { harmonic: number }).harmonic = h;
      this.oscs.push(o);
      this.oscGains.push(g);
    });
    mix.connect(this.shaper).connect(this.lp);
    this.onGain = ctx.createGain();
    this.offGain = ctx.createGain();
    this.offLp = ctx.createBiquadFilter();
    this.offLp.type = 'lowpass';
    this.offLp.frequency.value = 700;
    this.lp.connect(this.onGain).connect(this.engineBus);
    this.lp.connect(this.offLp).connect(this.offGain).connect(this.engineBus);

    // intake/induction roar: filtered noise
    const intake = this.loopNoise();
    this.intakeBp = ctx.createBiquadFilter();
    this.intakeBp.type = 'bandpass';
    this.intakeBp.Q.value = 1.2;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    intake.connect(this.intakeBp).connect(this.intakeGain).connect(this.engineBus);

    // turbo whistle
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.engineBus);
    this.turbo.start();

    // tire squeal
    const sq = this.loopNoise();
    this.squealBp = ctx.createBiquadFilter();
    this.squealBp.type = 'bandpass';
    this.squealBp.Q.value = 7;
    this.squealBp.frequency.value = 1100;
    const sq2 = ctx.createBiquadFilter();
    sq2.type = 'peaking';
    sq2.frequency.value = 2400;
    sq2.gain.value = 8;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    sq.connect(this.squealBp).connect(sq2).connect(this.squealGain).connect(this.fxBus);

    // gravel crunch
    const gr = this.loopNoise();
    const grF = ctx.createBiquadFilter();
    grF.type = 'lowpass';
    grF.frequency.value = 900;
    this.gravelGain = ctx.createGain();
    this.gravelGain.gain.value = 0;
    gr.connect(grF).connect(this.gravelGain).connect(this.fxBus);

    // wind
    const wind = this.loopNoise();
    this.windLp = ctx.createBiquadFilter();
    this.windLp.type = 'lowpass';
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windLp).connect(this.windGain).connect(this.fxBus);

    this.started = true;
    this.applySettings();
  }

  private loopNoise(): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    s.start(0, Math.random() * 1.5);
    return s;
  }

  applySettings(s: AudioSettings = this.settings): void {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.muted ? 0 : s.master * 0.9, t, 0.05);
    this.engineBus.gain.setTargetAtTime(s.engine, t, 0.05);
    this.fxBus.gain.setTargetAtTime(s.effects, t, 0.05);
  }

  suspend(): void {
    void this.ctx?.suspend();
  }
  resume(): void {
    void this.ctx?.resume();
  }

  update(f: AudioFrame): void {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const fire = (f.rpm / 60) * (this.cylinders / 2);
    const jitter = f.limiter ? (Math.random() - 0.5) * 12 : 0;
    for (const o of this.oscs) {
      const h = (o as OscillatorNode & { harmonic: number }).harmonic;
      o.frequency.setTargetAtTime(Math.max(10, fire * h + jitter), t, 0.012);
    }
    const load = f.load;
    this.lp.frequency.setTargetAtTime(400 + f.rpm * 0.32 + load * 2200, t, 0.03);
    this.onGain.gain.setTargetAtTime(0.06 + load * 0.2, t, 0.04);
    this.offGain.gain.setTargetAtTime((1 - load) * 0.12, t, 0.06);
    this.intakeBp.frequency.setTargetAtTime(300 + f.rpm * 0.18, t, 0.05);
    this.intakeGain.gain.setTargetAtTime(load * 0.05 * (0.4 + f.rpm / 8000), t, 0.05);
    this.turbo.frequency.setTargetAtTime(2200 + f.boost * 5200, t, 0.08);
    this.turboGain.gain.setTargetAtTime(f.boost * f.boost * 0.018, t, 0.1);
    if (f.bov > 0.3) this.blowOff(f.bov);
    const squeal = f.surface === 'tarmac' ? Math.min(0.32, Math.max(0, f.slip - 0.05) * 0.5) : 0;
    this.squealGain.gain.setTargetAtTime(squeal, t, 0.05);
    this.squealBp.frequency.setTargetAtTime(900 + f.speed * 10 + f.slip * 300, t, 0.08);
    const crunch = f.surface !== 'tarmac' ? Math.min(0.25, f.speed / 40) : 0;
    this.gravelGain.gain.setTargetAtTime(crunch, t, 0.08);
    this.windLp.frequency.setTargetAtTime(300 + f.speed * 25, t, 0.2);
    this.windGain.gain.setTargetAtTime(Math.min(0.2, (f.speed / 70) ** 2 * 0.2), t, 0.2);
  }

  private blowOff(amount: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 2.5;
    bp.frequency.setValueAtTime(3200, ctx.currentTime);
    bp.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.35);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.22 * amount, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.45);
    s.connect(bp).connect(g).connect(this.fxBus);
    s.start();
    s.stop(ctx.currentTime + 0.5);
  }

  impact(strength: number, material: string): void {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = material === 'guardrail' ? 'bandpass' : 'lowpass';
    f.frequency.value = material === 'guardrail' ? 1800 : material === 'tire' ? 220 : 450;
    f.Q.value = material === 'guardrail' ? 6 : 1;
    const g = ctx.createGain();
    const a = Math.min(0.8, strength / 12);
    g.gain.setValueAtTime(a, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (material === 'guardrail' ? 0.6 : 0.3));
    s.connect(f).connect(g).connect(this.fxBus);
    s.start();
    s.stop(ctx.currentTime + 0.7);
  }

  /** Short click for menus. */
  click(): void {
    if (!this.ctx || !this.started) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.setValueAtTime(1400, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(700, ctx.currentTime + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.04, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.07);
    o.connect(g).connect(this.fxBus);
    o.start();
    o.stop(ctx.currentTime + 0.08);
  }
}

function makeDrive(k: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const c = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(k * x) / Math.tanh(k);
  }
  return c;
}
