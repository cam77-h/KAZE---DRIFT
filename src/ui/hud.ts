import type { Vehicle } from '../physics/vehicle';
import type { Track } from '../world/track';
import type { Settings } from '../core/settings';

const SVGNS = 'http://www.w3.org/2000/svg';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** Tachometer arc from 135° to 405° (270° sweep). */
function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => [cx + Math.cos((a * Math.PI) / 180) * r, cy + Math.sin((a * Math.PI) / 180) * r];
  const [x0, y0] = p(a0), [x1, y1] = p(a1);
  const large = a1 - a0 > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export class Hud {
  readonly root: HTMLElement;
  private gear: HTMLElement;
  private speed: HTMLElement;
  private unit: HTMLElement;
  private needle: SVGLineElement;
  private fill: SVGPathElement;
  private shiftLights: HTMLElement[] = [];
  private shiftBox: HTMLElement;
  private boostBar: HTMLElement;
  private boostNum: HTMLElement;
  private angle: HTMLElement;
  private angleNum: HTMLElement;
  private angleArc: HTMLElement;
  private mapCanvas: HTMLCanvasElement;
  private mapBase: HTMLCanvasElement | null = null;
  private mapScale = 1;
  private assistEls: Record<string, HTMLElement> = {};
  private telemetry: HTMLElement;
  private toastEl: HTMLElement;
  private toastTimer = 0;
  private redline = 7200;
  private maxRpm = 8000;
  private locName: HTMLElement;
  private locJp: HTMLElement;
  private carName: HTMLElement;
  onPause: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.root = el('div');
    this.root.id = 'hud';
    const loc = el('div', 'hud-loc');
    this.locName = el('div', 'name');
    this.locJp = el('div', 'jp');
    this.carName = el('div', 'car');
    loc.append(this.locName, this.locJp, this.carName);

    // tach
    const tach = el('div', 'tach');
    const svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 240 240');
    const bg = document.createElementNS(SVGNS, 'circle');
    bg.setAttribute('cx', '120');
    bg.setAttribute('cy', '120');
    bg.setAttribute('r', '112');
    bg.setAttribute('fill', 'rgba(13,26,43,0.72)');
    svg.appendChild(bg);
    const track = document.createElementNS(SVGNS, 'path');
    track.setAttribute('d', arcPath(120, 120, 98, 135, 405));
    track.setAttribute('stroke', 'rgba(242,239,230,0.14)');
    track.setAttribute('stroke-width', '10');
    track.setAttribute('fill', 'none');
    svg.appendChild(track);
    this.fill = document.createElementNS(SVGNS, 'path');
    this.fill.setAttribute('stroke', '#f2efe6');
    this.fill.setAttribute('stroke-width', '10');
    this.fill.setAttribute('fill', 'none');
    svg.appendChild(this.fill);
    this.ticks = document.createElementNS(SVGNS, 'g');
    svg.appendChild(this.ticks);
    this.needle = document.createElementNS(SVGNS, 'line');
    this.needle.setAttribute('x1', '120');
    this.needle.setAttribute('y1', '120');
    this.needle.setAttribute('stroke', '#e8202f');
    this.needle.setAttribute('stroke-width', '3');
    this.needle.setAttribute('stroke-linecap', 'round');
    svg.appendChild(this.needle);
    tach.appendChild(svg);
    this.gear = el('div', 'gear', 'N');
    const spd = el('div', 'spd');
    this.speed = el('b', '', '0');
    this.unit = el('span', '', 'KM/H');
    spd.append(this.speed, this.unit);
    tach.append(this.gear, spd);

    this.shiftBox = el('div', 'shift');
    for (let i = 0; i < 10; i++) {
      const l = el('i');
      this.shiftLights.push(l);
      this.shiftBox.appendChild(l);
    }
    const boost = el('div', 'boost');
    boost.append(el('div', 'lbl', 'BOOST'));
    const bar = el('div', 'bar');
    this.boostBar = el('i');
    bar.appendChild(this.boostBar);
    this.boostNum = el('div', 'num', '0.0');
    boost.append(bar, this.boostNum);
    const assists = el('div', 'assists');
    for (const a of ['ABS', 'TCS', 'STM', 'DRIFT']) {
      const s = el('span', '', a);
      this.assistEls[a] = s;
      assists.appendChild(s);
    }

    const map = el('div', 'minimap');
    this.mapCanvas = el('canvas');
    this.mapCanvas.width = this.mapCanvas.height = 256;
    map.appendChild(this.mapCanvas);

    this.angle = el('div', 'angle');
    this.angle.append(el('div', 'lbl', 'DRIFT ANGLE · 角度'));
    this.angleNum = el('b', '', '0°');
    const arc = el('div', 'arc');
    this.angleArc = el('i');
    arc.appendChild(this.angleArc);
    this.angle.append(this.angleNum, arc);

    this.telemetry = el('div', 'telemetry');
    const pause = el('button', 'pausebtn', '<i></i><i></i>');
    pause.setAttribute('aria-label', 'Pause');
    pause.addEventListener('click', () => this.onPause?.());

    this.root.append(loc, tach, this.shiftBox, boost, assists, map, this.angle, this.telemetry, pause);
    parent.appendChild(this.root);
    this.toastEl = el('div', 'toast');
    document.body.appendChild(this.toastEl);
  }
  private ticks: SVGGElement;

  setVisible(on: boolean): void {
    this.root.classList.toggle('on', on);
  }

  configure(v: Vehicle, track: Track, names: { location: string; jp: string; car: string }, settings: Settings): void {
    this.locName.textContent = names.location;
    this.locJp.textContent = names.jp;
    this.carName.textContent = names.car.toUpperCase();
    this.redline = v.spec.engine.redlineRpm;
    this.maxRpm = Math.ceil((v.spec.engine.limiterRpm + 400) / 1000) * 1000;
    this.unit.textContent = settings.gameplay.units === 'mph' ? 'MPH' : 'KM/H';
    document.documentElement.style.setProperty('--hud-scale', String(settings.gameplay.hudScale));
    this.telemetry.classList.toggle('on', settings.gameplay.showTelemetry);
    // tach ticks + redline
    this.ticks.innerHTML = '';
    for (let r = 0; r <= this.maxRpm; r += 1000) {
      const a = (135 + (r / this.maxRpm) * 270) * (Math.PI / 180);
      const line = document.createElementNS(SVGNS, 'line');
      line.setAttribute('x1', String(120 + Math.cos(a) * 84));
      line.setAttribute('y1', String(120 + Math.sin(a) * 84));
      line.setAttribute('x2', String(120 + Math.cos(a) * 92));
      line.setAttribute('y2', String(120 + Math.sin(a) * 92));
      line.setAttribute('stroke', r >= this.redline ? '#e8202f' : '#f2efe6');
      line.setAttribute('stroke-width', '2');
      this.ticks.appendChild(line);
      const t = document.createElementNS(SVGNS, 'text');
      t.setAttribute('x', String(120 + Math.cos(a) * 72));
      t.setAttribute('y', String(124 + Math.sin(a) * 72));
      t.setAttribute('fill', r >= this.redline ? '#e8202f' : '#9fb0c3');
      t.setAttribute('font-size', '12');
      t.setAttribute('font-family', 'Chakra Petch');
      t.setAttribute('text-anchor', 'middle');
      t.textContent = String(r / 1000);
      this.ticks.appendChild(t);
    }
    const red = document.createElementNS(SVGNS, 'path');
    red.setAttribute('d', arcPath(120, 120, 98, 135 + (this.redline / this.maxRpm) * 270, 405));
    red.setAttribute('stroke', 'rgba(232,32,47,0.55)');
    red.setAttribute('stroke-width', '10');
    red.setAttribute('fill', 'none');
    this.ticks.appendChild(red);
    this.buildMap(track);
  }

  private mapBounds = { x: 0, z: 0, size: 1 };
  private buildMap(track: Track): void {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const g = c.getContext('2d')!;
    const size = track.def.size;
    const sc = 1024 / size;
    this.mapScale = sc;
    this.mapBounds = { x: -size / 2, z: -size / 2, size };
    const W = (x: number) => (x + size / 2) * sc;
    for (const pad of track.def.pads) {
      g.fillStyle = 'rgba(242,239,230,0.35)';
      if (pad.shape === 'circle') {
        g.beginPath();
        g.arc(W(pad.x), W(pad.z), (pad.r ?? 1) * sc, 0, Math.PI * 2);
        g.fill();
      } else {
        g.save();
        g.translate(W(pad.x), W(pad.z));
        g.rotate(pad.rot ?? 0);
        g.fillRect((-(pad.w ?? 1) / 2) * sc, (-(pad.d ?? 1) / 2) * sc, (pad.w ?? 1) * sc, (pad.d ?? 1) * sc);
        g.restore();
      }
    }
    for (const road of track.roads) {
      g.lineJoin = 'round';
      g.lineCap = 'round';
      for (const [w, col] of [[road.def.width * sc + 10, 'rgba(10,15,23,0.9)'], [road.def.width * sc, '#f2efe6']] as const) {
        g.strokeStyle = col;
        g.lineWidth = w;
        g.beginPath();
        road.samples.forEach((p, i) => (i ? g.lineTo(W(p.x), W(p.z)) : g.moveTo(W(p.x), W(p.z))));
        if (road.def.closed) g.closePath();
        g.stroke();
      }
      const s0 = road.samples[0];
      g.fillStyle = '#e8202f';
      g.fillRect(W(s0.x) - 6, W(s0.z) - 6, 12, 12);
    }
    this.mapBase = c;
  }

  private mapAngle = 0;
  update(v: Vehicle, settings: Settings, dt: number, assistActive: Record<string, boolean>): void {
    const t = v.telemetry;
    const mph = settings.gameplay.units === 'mph';
    const spd = Math.abs(t.forwardSpeed) * (mph ? 2.23694 : 3.6);
    this.speed.textContent = String(Math.round(spd));
    this.gear.textContent = t.gear === -1 ? 'R' : t.gear === 0 ? 'N' : String(t.gear);
    const f = Math.min(1, t.rpm / this.maxRpm);
    const a = 135 + f * 270;
    this.fill.setAttribute('d', arcPath(120, 120, 98, 135, Math.max(135.1, a)));
    this.fill.setAttribute('stroke', t.rpm > this.redline ? '#e8202f' : '#f2efe6');
    const rad = (a * Math.PI) / 180;
    this.needle.setAttribute('x2', String(120 + Math.cos(rad) * 100));
    this.needle.setAttribute('y2', String(120 + Math.sin(rad) * 100));
    // shift lights from 70% of redline
    const s = (t.rpm - this.redline * 0.7) / (this.redline * 0.3);
    const lit = Math.max(0, Math.min(10, Math.floor(s * 10)));
    this.shiftLights.forEach((l, i) => (l.className = i < lit ? (i < 4 ? 'g' : i < 7 ? 'y' : 'r') : ''));
    this.shiftBox.classList.toggle('flash', t.rpm > this.redline && Math.floor(performance.now() / 80) % 2 === 0);
    const turbo = v.spec.engine.turbo;
    const bar = turbo ? t.boost * turbo.maxBoostBar : 0;
    this.boostBar.style.width = `${turbo ? t.boost * 100 : 0}%`;
    this.boostNum.textContent = turbo ? bar.toFixed(1) + ' bar' : 'N/A';
    // drift angle
    const ang = Math.abs(t.driftAngle) * (180 / Math.PI);
    const sliding = ang > 8 && t.speed > 6 && t.forwardSpeed > 0;
    this.angle.classList.toggle('on', sliding);
    if (sliding) {
      this.angleNum.textContent = `${Math.round(ang)}°`;
      const w = Math.min(50, ang * 0.8);
      this.angleArc.style.width = `${w}%`;
      this.angleArc.style.left = t.driftAngle > 0 ? '50%' : `${50 - w}%`;
    }
    for (const [k, on] of Object.entries(assistActive)) this.assistEls[k]?.classList.toggle('act', on);
    this.drawMap(v, dt);
    if (settings.gameplay.showTelemetry) {
      const w = v.wheels;
      this.telemetry.textContent =
        `rpm ${t.rpm.toFixed(0)}  boost ${t.boost.toFixed(2)}  yaw ${t.yawRate.toFixed(2)}\n` +
        w.map((x, i) => `${['FL', 'FR', 'RL', 'RR'][i]} load ${x.load.toFixed(0)}  slip ${x.result.slipRatio.toFixed(2)}  α ${(x.result.slipAngle * 57.3).toFixed(1)}°  ${x.surface}`).join('\n');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('on');
    }
  }

  private drawMap(v: Vehicle, dt: number): void {
    const g = this.mapCanvas.getContext('2d')!;
    const W = this.mapCanvas.width;
    g.clearRect(0, 0, W, W);
    if (!this.mapBase) return;
    const sc = this.mapScale;
    const px = (v.position.x - this.mapBounds.x) * sc, pz = (v.position.z - this.mapBounds.z) * sc;
    const yaw = v.yaw;
    // rotate the map so the car always points up; smooth the rotation
    let target = Math.PI + yaw;
    while (target - this.mapAngle > Math.PI) target -= Math.PI * 2;
    while (target - this.mapAngle < -Math.PI) target += Math.PI * 2;
    this.mapAngle += (target - this.mapAngle) * Math.min(1, dt * 6);
    const zoom = 0.55;
    g.save();
    g.translate(W / 2, W / 2);
    g.rotate(this.mapAngle);
    g.scale(zoom, zoom);
    g.translate(-px, -pz);
    g.drawImage(this.mapBase, 0, 0);
    g.restore();
    // player arrow
    g.fillStyle = '#e8202f';
    g.beginPath();
    g.moveTo(W / 2, W / 2 - 14);
    g.lineTo(W / 2 + 9, W / 2 + 10);
    g.lineTo(W / 2, W / 2 + 5);
    g.lineTo(W / 2 - 9, W / 2 + 10);
    g.closePath();
    g.fill();
  }

  toast(text: string, seconds = 1.8): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('on');
    this.toastTimer = seconds;
  }
}
