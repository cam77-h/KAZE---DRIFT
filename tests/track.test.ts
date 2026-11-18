import { describe, expect, it } from 'vitest';
import { Track } from '../src/world/track';
import minami from '../src/data/tracks/minami.json';
import skidpad from '../src/data/tracks/skidpad.json';
import { Vehicle } from '../src/physics/vehicle';
import { emptyInput, defaultAssists } from '../src/physics/types';
import { makeSample } from '../src/physics/collision';
import { carPhysics } from '../src/data';
import type { TrackDef } from '../src/world/track';

const spec = () => carPhysics('sakura_s15');
const DT = 1 / 120;

describe('track ground', () => {
  for (const def of [minami, skidpad] as unknown as TrackDef[]) {
    it(`${def.id}: ground is continuous along the road and finite everywhere`, () => {
      const t = new Track(def);
      const s = makeSample();
      for (let x = -def.size / 2; x < def.size / 2; x += 7.3) for (let z = -def.size / 2; z < def.size / 2; z += 7.3) {
        t.sampleGround(x, z, s);
        expect(Number.isFinite(s.height)).toBe(true);
        expect(s.ny).toBeGreaterThan(0.1);
      }
      for (const road of t.roads) {
        for (let i = 1; i < road.samples.length; i++) {
          const a = road.samples[i - 1], b = road.samples[i];
          expect(Math.abs(t.height(a.x, a.z) - t.height(b.x, b.z))).toBeLessThan(0.5);
        }
      }
    });

    it(`${def.id}: the car spawns on asphalt and drives without NaN`, () => {
      const t = new Track(def);
      const car = new Vehicle(spec(), defaultAssists());
      car.reset(t, def.spawn.x, def.spawn.z, def.spawn.yaw);
      const inp = emptyInput();
      for (let i = 0; i < 120; i++) car.step(DT, inp, t);
      expect(car.wheels.every((w) => w.onGround)).toBe(true);
      expect(car.wheels.every((w) => w.surface === 'asphalt' || w.surface === 'paint')).toBe(true);
      inp.throttle = 0.6;
      for (let i = 0; i < 120 * 6; i++) {
        car.step(DT, inp, t);
        expect(Number.isFinite(car.position.x + car.position.y + car.position.z)).toBe(true);
      }
      expect(car.telemetry.speed).toBeGreaterThan(5);
    });
  }

  it('minami has walls of several kinds', () => {
    const t = new Track(minami as unknown as TrackDef);
    const kinds = new Set(t.walls.walls.map((w) => w.material));
    expect(kinds.has('tire')).toBe(true);
    expect(kinds.has('concrete')).toBe(true);
    expect(kinds.has('guardrail')).toBe(true);
  });
});
